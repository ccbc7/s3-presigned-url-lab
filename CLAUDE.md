# CLAUDE.md

S3 署名付きURL（presigned URL）の学習ラボ。React(Vite/ローカル) → API Gateway(HTTP API) + Lambda が署名付きURLを発行 → S3(非公開) へ直 PUT、表示は CloudFront(OAC) 経由。
全体像は [README.md](README.md)、設計の意図は [docs/architecture.md](docs/architecture.md)、CI/CD は [docs/deploy-cicd.md](docs/deploy-cicd.md)、実施記録は [docs/deploy-progress.md](docs/deploy-progress.md)。

## 重要な運用ルール（必読）

- **デプロイ先は dev アカウント `027204872496` / `ap-northeast-1` のみ。prod には絶対に出さない。**
- **デプロイは GitHub Actions(OIDC) 経由が正。** `Actions → deploy → Run workflow`（または `gh workflow run deploy.yml --ref main`）。
  ローカルからスクリプトで直接デプロイする運用ではない（OIDC でアクセスキーを置かない設計）。
- **フロントは AWS にホスティングしない。** 手元の `http://localhost:5173`(Vite dev) で動かすのが設計どおり。公開URLが無いのが正しい。
- **`frontend/.env` は手動設定・コミットしない**（gitignore 済み）。`VITE_API_BASE_URL` に API の URL を貼る。
- Route53 / 独自ドメインは設計外（不要）。

## コマンド

```bash
# フロント（ローカル実行）
cd frontend && npm install && npm run dev   # http://localhost:5173
npm run build                               # tsc + vite build

# バックエンド（Lambda）
cd backend && npm ci && npm run typecheck && npm run build   # esbuild で dist/handler.js

# IaC 検証（PR の validate CI と同じ）
cfn-lint --non-zero-exit-code error infra/template.yaml infra/bootstrap.yaml
```

PR で `infra/** | backend/** | .github/**` を触ると validate CI(cfn-lint + backend build) が自動で回る。

## 構成

- `backend/src/handler.ts` … `POST /upload-url`（署名付き PUT URL）/ `GET /download-url`（期限付き GET URL）。許可Content-Typeのリスト方式、キーは `uploads/<uuid>.<ext>`、失効 300s。
- `frontend/src/{App.tsx,api.ts}` … アップロードUIと API 呼び出し（①URL要求 → ③S3へ直PUT → ④CloudFrontで表示）。
- `infra/bootstrap.yaml` … OIDC プロバイダ / DeployRole / アーティファクトバケット（初回1回だけ手動デプロイ済み）。
- `infra/template.yaml` … アプリ本体（S3 / CloudFront / Lambda / HTTP API）。アプリスタック名 `s3-presigned-url-lab`。

## 現状（2026-05-31 時点）

バックエンド一式はデプロイ済みで URL 発行済み。残りはローカルでの動作確認のみ（`.env` 設定 → `npm run dev` で一連を確認）。最新の正は [docs/deploy-progress.md](docs/deploy-progress.md) を参照。
