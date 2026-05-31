/**
 * 署名付きURL（presigned URL）を生成する Lambda 関数。
 *
 * HTTP API (payload format 2.0) から呼ばれる。2つのルートを処理する:
 *   POST /upload-url     アップロード用の署名付き PUT URL を発行（=「保存用URL」）
 *   GET  /download-url   非公開ダウンロード用の署名付き GET URL を発行（期限付き）
 *
 * ポイント:
 *  - S3 バケットは非公開。クライアントは「署名付きURL」を使うときだけ S3 を操作できる。
 *  - 署名付きURL自体の生成にはネットワーク通信は不要（IAM資格情報で署名計算するだけ）。
 *  - PutObject を ContentType 付きで署名した場合、クライアントの PUT も同じ
 *    Content-Type ヘッダを送らないと署名不一致(SignatureDoesNotMatch)になる。
 */
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";

const s3 = new S3Client({});
const BUCKET = process.env.BUCKET_NAME!;
const CDN_DOMAIN = process.env.CDN_DOMAIN!;

/** 署名付きURLの有効期限（秒）。短いほど安全。 */
const EXPIRES_IN = 300;

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

  // ② 保存先キーを決める。衝突しないよう UUID を使う（実務でも定番）。
  const key = `uploads/${randomUUID()}.${ext}`;

  // ③ PutObject に対する署名付きURLを生成（有効期限つき）。
  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }),
    { expiresIn: EXPIRES_IN }
  );

  // 表示用URL（CloudFront経由）。これは署名なしの普通のURL。
  const cdnUrl = `https://${CDN_DOMAIN}/${key}`;

  return json(200, { uploadUrl, key, cdnUrl, expiresIn: EXPIRES_IN });
}

/** 非公開ダウンロード用の、期限付き署名付き GET URL を返す。 */
async function createDownloadUrl(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  const key = event.queryStringParameters?.key;
  // uploads/ 配下だけを許可（任意キーの読み出しを防ぐ）。
  if (!key || !key.startsWith("uploads/")) {
    return json(400, { message: "Invalid or missing 'key' query parameter" });
  }

  const downloadUrl = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    { expiresIn: EXPIRES_IN }
  );

  return json(200, { downloadUrl, key, expiresIn: EXPIRES_IN });
}
