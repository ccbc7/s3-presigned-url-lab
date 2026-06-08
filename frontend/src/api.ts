// API クライアント。署名付きURLの流れ ①→③ をそのまま関数にしている。
const API_BASE = import.meta.env.VITE_API_BASE_URL as string;

export type UploadUrlResponse = {
  uploadUrl: string; // 署名付き PUT URL（保存用・期限付き）
  key: string; // S3 のキー（例: uploads/<uuid>.jpg）
  cdnUrl: string; // 表示用URL（CloudFront経由・署名なし）
  expiresIn: number;
};

// ① API に「アップロード用の署名付きURL」を要求する。
//    scope="private" にすると CloudFront 署名必須の private/ 配下に保存される。
export async function requestUploadUrl(
  contentType: string,
  scope: "public" | "private" = "public"
): Promise<UploadUrlResponse> {
  const res = await fetch(`${API_BASE}/upload-url`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contentType, scope }),
  });
  if (!res.ok) {
    throw new Error(`upload-url の取得に失敗: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

// ③ 受け取った署名付きURLへ、ファイルを直接 PUT する（S3へ直アップロード）。
//    注意: Content-Type は署名時(PutObjectCommand)と一致させること。
export async function uploadToS3(uploadUrl: string, file: File): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "content-type": file.type },
    body: file,
  });
  if (!res.ok) {
    throw new Error(`S3 への PUT に失敗: ${res.status} ${await res.text()}`);
  }
}

// （任意）非公開ダウンロード用の S3 署名付き GET URL を要求する（S3 直行）。
export async function requestDownloadUrl(key: string): Promise<string> {
  const res = await fetch(
    `${API_BASE}/download-url?key=${encodeURIComponent(key)}`
  );
  if (!res.ok) {
    throw new Error(`download-url の取得に失敗: ${res.status}`);
  }
  const data = (await res.json()) as { downloadUrl: string };
  return data.downloadUrl;
}

// （任意）CloudFront 署名付きURL（期限付き・CDN経由）を要求する。private/ のキー専用。
export async function requestCfSignedUrl(key: string): Promise<string> {
  const res = await fetch(
    `${API_BASE}/cf-signed-url?key=${encodeURIComponent(key)}`
  );
  if (!res.ok) {
    throw new Error(`cf-signed-url の取得に失敗: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { signedUrl: string };
  return data.signedUrl;
}
