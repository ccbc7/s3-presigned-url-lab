import { useState, type CSSProperties } from "react";
import {
  requestUploadUrl,
  uploadToS3,
  requestDownloadUrl,
  requestCfSignedUrl,
} from "./api";
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

const segBtn = (active: boolean): CSSProperties => ({
  border: "none",
  padding: "6px 16px",
  borderRadius: radius.md,
  fontWeight: 600,
  cursor: "pointer",
  background: active ? colors.primary : "transparent",
  color: active ? colors.surface : colors.text,
});

const link: CSSProperties = { color: colors.primary, wordBreak: "break-all" };
const h2: CSSProperties = { color: colors.ink, fontSize: 18, marginTop: 0 };
const img: CSSProperties = {
  maxWidth: "100%",
  marginTop: 8,
  borderRadius: radius.md,
  border: `1px solid ${colors.border}`,
};

export function App() {
  const [file, setFile] = useState<File | null>(null);
  const [privateMode, setPrivateMode] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string>("");
  const [cdnUrl, setCdnUrl] = useState<string>("");
  const [key, setKey] = useState<string>("");
  const [signedUrl, setSignedUrl] = useState<string>("");
  const [cfSignedUrl, setCfSignedUrl] = useState<string>("");

  async function handleUpload() {
    if (!file) return;
    setError("");
    setSignedUrl("");
    setCfSignedUrl("");
    try {
      // ① 署名付きURLをもらう（private なら CloudFront 署名必須の経路へ）
      setStatus("requesting");
      const result = await requestUploadUrl(
        file.type,
        privateMode ? "private" : "public"
      );
      // ③ S3 へ直接アップロード
      setStatus("uploading");
      await uploadToS3(result.uploadUrl, file);
      // ④ 表示用URL（CloudFront）
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
      setSignedUrl(await requestDownloadUrl(key));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleCfSigned() {
    if (!key) return;
    try {
      setCfSignedUrl(await requestCfSignedUrl(key));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const busy = status === "uploading" || status === "requesting";
  const isPrivate = key.startsWith("private/");

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
        <div style={{ maxWidth: 720, margin: "0 auto", padding: "16px" }}>
          <h1 style={{ margin: 0, color: colors.surface, fontSize: 20 }}>
            S3 署名付きURL ラボ
          </h1>
        </div>
      </header>

      <main style={{ maxWidth: 720, margin: "24px auto", padding: "0 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <span style={{ color: colors.muted, fontSize: 13 }}>保存モード</span>
          <div
            style={{
              display: "inline-flex",
              gap: 4,
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              padding: 4,
              borderRadius: radius.md,
            }}
          >
            <button style={segBtn(!privateMode)} onClick={() => setPrivateMode(false)}>
              public
            </button>
            <button style={segBtn(privateMode)} onClick={() => setPrivateMode(true)}>
              private
            </button>
          </div>
        </div>
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
            <h2 style={h2}>
              ① CloudFront 公開URL（署名なし）
              {isPrivate && "（このキーは署名必須 → 403）"}
            </h2>
            <a href={cdnUrl} target="_blank" rel="noreferrer" style={link}>
              {cdnUrl}
            </a>
            {isPrivate ? (
              <p style={{ color: colors.muted, margin: "8px 0 0" }}>
                private/ は CloudFront 側で署名必須なので、この公開URLは 403。下の③の署名付きURLで表示できます。
              </p>
            ) : (
              <div>
                <img src={cdnUrl} alt="アップロードした画像" style={img} />
              </div>
            )}

            <h2 style={{ ...h2, marginTop: 24 }}>
              ② S3 署名付きGET URL（期限付き・S3直）
            </h2>
            <button onClick={handleSignedDownload} style={outlineBtn}>
              S3 署名付きGET URLを取得
            </button>
            {signedUrl && (
              <p>
                <a href={signedUrl} target="_blank" rel="noreferrer" style={link}>
                  {signedUrl}
                </a>
              </p>
            )}

            {isPrivate && (
              <>
                <h2 style={{ ...h2, marginTop: 24 }}>
                  ③ CloudFront 署名付きURL（期限付き・CDN経由）
                </h2>
                <button onClick={handleCfSigned} style={outlineBtn}>
                  CloudFront 署名付きURLを取得
                </button>
                {cfSignedUrl && (
                  <>
                    <p>
                      <a href={cfSignedUrl} target="_blank" rel="noreferrer" style={link}>
                        {cfSignedUrl}
                      </a>
                    </p>
                    <img src={cfSignedUrl} alt="CloudFront署名で表示" style={img} />
                  </>
                )}
              </>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
