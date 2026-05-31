import { useState } from "react";
import { requestUploadUrl, uploadToS3, requestDownloadUrl } from "./api";

type Status = "idle" | "requesting" | "uploading" | "done" | "error";

export function App() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string>("");
  const [cdnUrl, setCdnUrl] = useState<string>("");
  const [key, setKey] = useState<string>("");
  const [signedUrl, setSignedUrl] = useState<string>("");

  async function handleUpload() {
    if (!file) return;
    setError("");
    setSignedUrl("");
    try {
      // ① 署名付きURLをもらう
      setStatus("requesting");
      const result = await requestUploadUrl(file.type);
      // ③ S3 へ直接アップロード
      setStatus("uploading");
      await uploadToS3(result.uploadUrl, file);
      // ④ 表示用URL（CloudFront）で表示
      setCdnUrl(result.cdnUrl);
      setKey(result.key);
      setStatus("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  async function handleSignedDownload() {
    if (!key) return;
    try {
      const url = await requestDownloadUrl(key);
      setSignedUrl(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: 640,
        margin: "40px auto",
        padding: "0 16px",
        lineHeight: 1.6,
      }}
    >
      <h1>S3 署名付きURL ラボ</h1>
      <p>画像を選んでアップロードすると、CloudFront 経由で表示されます。</p>

      <div style={{ margin: "16px 0" }}>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <button
          onClick={handleUpload}
          disabled={!file || status === "uploading" || status === "requesting"}
          style={{ marginLeft: 8 }}
        >
          アップロード
        </button>
      </div>

      <p>
        状態: <strong>{status}</strong>
        {error && <span style={{ color: "crimson" }}> — {error}</span>}
      </p>

      {status === "done" && (
        <section>
          <h2>① 表示用URL（CloudFront・署名なし）</h2>
          <code style={{ wordBreak: "break-all" }}>{cdnUrl}</code>
          <div>
            <img
              src={cdnUrl}
              alt="アップロードした画像"
              style={{ maxWidth: "100%", marginTop: 8, borderRadius: 8 }}
            />
          </div>

          <h2 style={{ marginTop: 24 }}>② 署名付きGET URL（期限付き・非公開）</h2>
          <button onClick={handleSignedDownload}>署名付きGET URLを取得</button>
          {signedUrl && (
            <p>
              <a href={signedUrl} target="_blank" rel="noreferrer">
                期限付きダウンロードリンクを開く
              </a>
            </p>
          )}
        </section>
      )}
    </main>
  );
}
