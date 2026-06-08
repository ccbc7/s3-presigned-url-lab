/**
 * 署名付きURL（presigned URL）を生成する Lambda 関数。
 *
 * HTTP API (payload format 2.0) から呼ばれる。3つのルートを処理する:
 *   POST /upload-url     アップロード用の署名付き PUT URL を発行（=「保存用URL」）
 *   GET  /download-url   非公開ダウンロード用の S3 署名付き GET URL（期限付き・S3直）
 *   GET  /cf-signed-url  CloudFront 署名付きURL（期限付き・CDN経由。private/* は署名必須）
 *
 * ポイント:
 *  - S3 バケットは非公開。クライアントは「署名付きURL」を使うときだけ S3 を操作できる。
 *  - S3 presigned は S3 のホストに対して署名する（download-url はS3直行）。
 *  - CloudFront 署名付きURLは CloudFront のホストで期限付き配信できる（cf-signed-url）。
 *    こちらは CloudFront の鍵（KeyGroup の秘密鍵）で署名し、private/* を署名必須にしている。
 */
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getSignedUrl as getCloudFrontSignedUrl } from "@aws-sdk/cloudfront-signer";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { randomUUID } from "node:crypto";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";

const s3 = new S3Client({});
const ssm = new SSMClient({});
const BUCKET = process.env.BUCKET_NAME!;
const CDN_DOMAIN = process.env.CDN_DOMAIN!;

/** CloudFront 署名付きURL用（未設定なら cf-signed-url は無効）。 */
const CF_KEY_PAIR_ID = process.env.CF_KEY_PAIR_ID ?? "";
const CF_PRIVATE_KEY_PARAM = process.env.CF_PRIVATE_KEY_PARAM ?? "";
/** CloudFront で署名必須にしているプレフィックス（template の private/* と対）。 */
const CF_SIGNED_PREFIX = process.env.CF_SIGNED_PREFIX ?? "private/";

/** 署名付きURLの有効期限（秒）。短いほど安全。 */
const EXPIRES_IN = 300;

/** CloudFront 署名付きURL（③）の有効期限（秒）。失効デモ用に短くしている。 */
const CF_EXPIRES_IN = 10;

/** 許可する画像 Content-Type と拡張子の対応。許可リスト方式で安全に。 */
const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  // routeKey は "POST /upload-url" のような文字列（HTTP API が付与）。
  const route = event.routeKey;
  try {
    if (route === "POST /upload-url") return await createUploadUrl(event);
    if (route === "GET /download-url") return await createDownloadUrl(event);
    if (route === "GET /cf-signed-url") return await createCfSignedUrl(event);
    return json(404, { message: `No handler for route: ${route}` });
  } catch (err) {
    console.error("handler error", err);
    return json(500, { message: "Internal error" });
  }
};

/** ① React からの要求に対し、保存先キーを決め、署名付き PUT URL を返す。 */
async function createUploadUrl(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  const body = event.body ? JSON.parse(event.body) : {};
  const contentType: string = body.contentType ?? "";
  const ext = EXT_BY_CONTENT_TYPE[contentType];
  if (!ext) {
    return json(400, {
      message: `Unsupported contentType: "${contentType}". Allowed: ${Object.keys(
        EXT_BY_CONTENT_TYPE
      ).join(", ")}`,
    });
  }

  // scope=private なら CloudFront 署名必須の private/ 配下に、それ以外は公開 uploads/ 配下に置く。
  const prefix = body.scope === "private" ? CF_SIGNED_PREFIX : "uploads/";
  // ② 保存先キーを決める。衝突しないよう UUID を使う（実務でも定番）。
  const key = `${prefix}${randomUUID()}.${ext}`;

  // ③ PutObject に対する署名付きURLを生成（有効期限つき）。
  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }),
    { expiresIn: EXPIRES_IN }
  );

  // 表示用URL（CloudFront経由）。private/ の場合は署名必須なのでこのままだと 403 になる
  // （= 署名なしでは見られないことの確認に使える）。public(uploads/) は署名なしで見られる。
  const cdnUrl = `https://${CDN_DOMAIN}/${key}`;

  return json(200, { uploadUrl, key, cdnUrl, expiresIn: EXPIRES_IN });
}

/** 非公開ダウンロード用の、期限付き S3 署名付き GET URL を返す（S3 直行）。 */
async function createDownloadUrl(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  const key = event.queryStringParameters?.key;
  // uploads/ か private/ 配下だけを許可（任意キーの読み出しを防ぐ）。
  if (!key || !(key.startsWith("uploads/") || key.startsWith(CF_SIGNED_PREFIX))) {
    return json(400, { message: "Invalid or missing 'key' query parameter" });
  }

  const downloadUrl = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    { expiresIn: EXPIRES_IN }
  );

  return json(200, { downloadUrl, key, expiresIn: EXPIRES_IN });
}

/** SSM SecureString から CloudFront 署名用の秘密鍵を取得（コンテナ存続中はキャッシュ）。 */
let cachedPrivateKey: string | undefined;
async function getCfPrivateKey(): Promise<string> {
  if (cachedPrivateKey) return cachedPrivateKey;
  const res = await ssm.send(
    new GetParameterCommand({ Name: CF_PRIVATE_KEY_PARAM, WithDecryption: true })
  );
  cachedPrivateKey = res.Parameter?.Value ?? "";
  return cachedPrivateKey;
}

/** CloudFront 署名付きURL（期限付き・CDN経由）を返す。private/* 配下のみ対象。 */
async function createCfSignedUrl(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  if (!CF_KEY_PAIR_ID || !CF_PRIVATE_KEY_PARAM) {
    return json(501, { message: "CloudFront signed URLs are not configured" });
  }
  const key = event.queryStringParameters?.key;
  // 署名必須にしている private/ 配下だけを対象にする。
  if (!key || !key.startsWith(CF_SIGNED_PREFIX)) {
    return json(400, {
      message: `'key' must start with "${CF_SIGNED_PREFIX}"`,
    });
  }

  const privateKey = await getCfPrivateKey();
  const url = `https://${CDN_DOMAIN}/${key}`;
  const dateLessThan = new Date(Date.now() + CF_EXPIRES_IN * 1000).toISOString();

  // CloudFront の鍵で署名（S3 ではなく CloudFront に対する署名）。
  const signedUrl = getCloudFrontSignedUrl({
    url,
    keyPairId: CF_KEY_PAIR_ID,
    privateKey,
    dateLessThan,
  });

  return json(200, { signedUrl, key, expiresIn: CF_EXPIRES_IN });
}
