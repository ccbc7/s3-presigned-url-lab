# s3-presigned-url-lab

S3 の **署名付きURL（presigned URL）** を使った画像アップロード/ダウンロードを、
手を動かして体系的に学ぶための最小構成ラボです。

- **フロント**: React + TypeScript（Vite、ローカル実行）
- **API**: API Gateway (HTTP API) + Lambda（署名付きURLを生成）
- **ストレージ**: S3（完全非公開）+ CloudFront（OAC で安全に表示配信）
- **IaC**: 生の CloudFormation（`infra/template.yaml`）

> なぜこの構成？ → 設計判断の詳細は [docs/architecture.md](docs/architecture.md) を参照。
> 独自ドメインを dev CloudFront に紐づける計画は
> [docs/custom-domain-plan.md](docs/custom-domain-plan.md) にまとめています。

---

## 全体の流れ

```
[React (Vite/TS)]
   │  ① POST /upload-url  （contentType を渡す）
   ▼
[API Gateway (HTTP API)] ──► [Lambda: 署名URL生成]
   │                              ・保存先キーを決定 uploads/<uuid>.<ext>
   │  ② { uploadUrl, key, cdnUrl }  ・PutObject の署名付きURLを返す（期限300s）
   ▼
[React] ── ③ PUT uploadUrl (body = file) ──► [S3 バケット（非公開）]
   │
   │  ④ 表示は CloudFront 経由（cdnUrl）
   ▼
[CloudFront (OAC)] ──（内部で署名アクセス）──► [S3 バケット（非公開）]
```

- **保存用URL**＝Lambda が発行する署名付き PUT URL（数分で失効）
- **表示用URL**＝CloudFront ドメイン + キー（`https://<cdn>/uploads/<uuid>.jpg`）

---

## ディレクトリ構成

```
.
├─ README.md              ← このファイル（全体像と手順）
├─ docs/architecture.md   ← 仕組みの詳しい解説（読み物）
├─ infra/
│  ├─ template.yaml       ← 生CloudFormation（S3 / CloudFront / Lambda / HTTP API）
│  └─ bootstrap.yaml      ← OIDC / DeployRole / アーティファクトバケット（初回1回だけ）
├─ backend/
│  └─ src/handler.ts      ← 署名付きURLを生成する Lambda
└─ frontend/
   ├─ src/App.tsx         ← アップロードUI＋プレビュー表示
   └─ src/api.ts          ← API 呼び出し（①→③）
```

---

## 必要なもの

| ツール | 確認 | 入れ方 |
| --- | --- | --- |
| Node.js 20+ / npm | `node -v` | 済（v26 確認済み） |
| AWS CLI | `aws --version` | 済 |
| **AWS 認証情報** | `aws sts get-caller-identity` | **未設定** → `aws configure` |
| zip | `zip -v` | macOS 標準 |

> SAM CLI は今回は不要です（生 CloudFormation のため）。

---

## セットアップ手順

### 1. バックエンドをデプロイ（GitHub Actions / OIDC）

デプロイは GitHub Actions 経由で行う設計です（ローカルに AWS アクセスキーを置かない）。

- **初回のみ**: `infra/bootstrap.yaml` を手動で1回デプロイし、OIDC ロール・アーティファクト
  バケットを作成（実施済み）。
- **通常運用**: コードを main に入れたあと **Actions → deploy → Run workflow**
  （または `gh workflow run deploy.yml --ref main`）を実行するだけ。

完了するとジョブのサマリに `Outputs`（`ApiBaseUrl` / `CdnDomain` / `BucketName`）が表示されます。
※ CloudFront は初回のみ展開に 5〜15 分ほどかかります。

> 設計と実施記録の詳細は [docs/deploy-cicd.md](docs/deploy-cicd.md) /
> [docs/deploy-progress.md](docs/deploy-progress.md) を参照。

### 2. フロントを設定して起動

```bash
make up       # http://localhost:5173
```

初回は `frontend/.env` がなければ自動で作成されます。
画像アップロードまで試す場合は、`.env` の `VITE_API_BASE_URL` に Outputs の ApiBaseUrl を貼り付けます。

ブラウザで画像を選んで「アップロード」→ CloudFront 経由で表示されれば成功です。

---

## 動作確認（CLIだけでも試せる）

```bash
API="<ApiBaseUrl>"

# ① 署名付きURLを取得
curl -s -X POST "$API/upload-url" \
  -H 'content-type: application/json' \
  -d '{"contentType":"image/png"}'

# ③ 返ってきた uploadUrl にファイルを PUT（Content-Type を一致させる）
curl -X PUT "<uploadUrl>" -H 'content-type: image/png' --data-binary @sample.png

# ④ cdnUrl をブラウザで開く / 署名付きGETを取得
curl -s "$API/download-url?key=<key>"
```

---

## 片付け（課金を残さない）

```bash
# バケットは中身があると消せないので先に空にする
aws s3 rm "s3://<BucketName>" --recursive
aws cloudformation delete-stack --stack-name s3-presigned-url-lab --region ap-northeast-1
# アーティファクトバケットも不要なら
aws s3 rb "s3://my-presign-artifacts-$ACCOUNT_ID" --force
```

---

## コスト感

ラボ規模なら **ほぼ無料〜数円/月**。HTTP API・Lambda・S3・CloudFront いずれも無料枠が大きく、
使い終わったら削除すれば残りません。

---

## さらに学ぶ

仕組みの詳細・本番化で足すべきもの（認証、メタデータDB、サイズ制限など）は
[docs/architecture.md](docs/architecture.md) にまとめています。
