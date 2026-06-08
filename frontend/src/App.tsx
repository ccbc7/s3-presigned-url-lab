import { useState, type CSSProperties } from "react";
import { requestUploadUrl, uploadToS3, requestDownloadUrl } from "./api";
import { colors, radius } from "./theme";

type Status = "idle" | "requesting" | "uploading" | "done" | "error";

const card: CSSProperties = {
  background: colors.surface,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.lg,
  padding: 20,
  boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
};

const primaryBtn = (disabled: boolean): CSSProperties => ({
  background: disabled ? colors.muted : colors.primary,
  color: colors.surface,
  border: "none",
  borderRadius: radius.md,
  padding: "8px 18px",
  fontWeight: 600,
  cursor: disabled ? "default" : "pointer",
});

const outlineBtn: CSSProperties = {
  background: "transparent",
  color: colors.primary,
  border: `1px solid ${colors.primary}`,
  borderRadius: radius.md,
  padding: "8px 16px",
  fontWeight: 600,
  cursor: "pointer",
};

const link: CSSProperties = { color: colors.primary, wordBreak: "break-all" };
const h2: CSSProperties = { color: colors.ink, fontSize: 18, marginTop: 0 };

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

  const busy = status === "uploading" || status === "requesting";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: colors.bg,
        color: colors.text,
        fontFamily: "system-ui, sans-serif",
        lineHeight: 1.6,
      }}
    >
      <header
        style={{
          background: colors.primary,
          borderBottom: `4px solid ${colors.accent}`,
        }}
      >
        <div style={{ maxWidth: 720, margin: "0 auto", padding: "18px 16px" }}>
          <h1 style={{ margin: 0, color: colors.surface, fontSize: 20 }}>
            S3 署名付きURL ラボ
          </h1>
        </div>
      </header>

      <main style={{ maxWidth: 720, margin: "24px auto", padding: "0 16px" }}>
        <p>画像を選んでアップロードすると、CloudFront 経由で表示されます。</p>

        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <button
              onClick={handleUpload}
              disabled={!file || busy}
              style={primaryBtn(!file || busy)}
            >
              アップロード
            </button>
          </div>

          <p style={{ marginBottom: 0 }}>
            状態:{" "}
            <strong style={{ color: status === "error" ? colors.danger : colors.ink }}>
              {status}
            </strong>
            {error && <span style={{ color: colors.danger }}> — {error}</span>}
          </p>
        </div>

        {status === "done" && (
          <section style={{ ...card, marginTop: 16 }}>
            <h2 style={h2}>① 表示用URL（CloudFront・署名なし）</h2>
            <a href={cdnUrl} target="_blank" rel="noreferrer" style={link}>
              {cdnUrl}
            </a>
            <div>
              <img
                src={cdnUrl}
                alt="アップロードした画像"
                style={{
                  maxWidth: "100%",
                  marginTop: 8,
                  borderRadius: radius.md,
                  border: `1px solid ${colors.border}`,
                }}
              />
            </div>

            <h2 style={{ ...h2, marginTop: 24 }}>
              ② 署名付きGET URL（期限付き・非公開）
            </h2>
            <button onClick={handleSignedDownload} style={outlineBtn}>
              署名付きGET URLを取得
            </button>
            {signedUrl && (
              <p>
                <a href={signedUrl} target="_blank" rel="noreferrer" style={link}>
                  期限付きダウンロードリンクを開く
                </a>
              </p>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
