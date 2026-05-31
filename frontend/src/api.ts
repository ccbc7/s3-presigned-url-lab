// API クライアント。署名付きURLの流れ ①→③ をそのまま関数にしている。
const API_BASE = import.meta.env.VITE_API_BASE_URL as string;

export type UploadUrlResponse = {
  uploadUrl: string; // 署名付き PUT URL（保存用・期限付き）
  key: string; // S3 のキー（例: uploads/<uuid>.jpg）
  cdnUrl: string; // 表示用URL（CloudFront経由・署名なし）
  expiresIn: number;
};

// ① API に「アップロード用の署名付きURL」を要求する。
export async function requestUploadUrl(
  contentType: string
): Promise<UploadUrlResponse> {
  const res = await fetch(`${API_BASE}/upload-url`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contentType }),
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

// （任意）非公開ダウンロード用の署名付き GET URL を要求する。
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
