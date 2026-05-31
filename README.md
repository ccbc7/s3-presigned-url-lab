# s3-presigned-url-lab

S3 の **署名付きURL（presigned URL）** を使った画像アップロード/ダウンロードを、
手を動かして体系的に学ぶための最小構成ラボです。

- **フロント**: React + TypeScript（Vite、ローカル実行）
- **API**: API Gateway (HTTP API) + Lambda（署名付きURLを生成）
- **ストレージ**: S3（完全非公開）+ CloudFront（OAC で安全に表示配信）
- **IaC**: 生の CloudFormation（`infra/template.yaml`）

> なぜこの構成？ → 設計判断の詳細は [docs/architecture.md](docs/architecture.md) を参照。

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
│  └─ deploy.sh           ← ビルド→S3アップロード→デプロイ の一括スクリプト
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

### 0. AWS 認証情報を設定（未設定なら必須）

```bash
aws configure   # Access Key / Secret / region(ap-northeast-1) を入力
aws sts get-caller-identity   # 確認
```

### 1. アーティファクト用バケットを作成（初回のみ）

Lambda の zip を置く置き場。名前は世界で一意にする（アカウントIDを混ぜると安全）。

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
aws s3 mb "s3://my-presign-artifacts-$ACCOUNT_ID" --region ap-northeast-1
```

### 2. デプロイ

```bash
cd infra
ARTIFACT_BUCKET="my-presign-artifacts-$ACCOUNT_ID" ./deploy.sh
```

完了すると `Outputs`（`ApiBaseUrl` / `CdnDomain` / `BucketName`）が表示されます。
※ CloudFront は初回のみ展開に 5〜15 分ほどかかります。

### 3. フロントを設定して起動

```bash
cd ../frontend
cp .env.example .env
# .env の VITE_API_BASE_URL に Outputs の ApiBaseUrl を貼り付け
npm install
npm run dev   # http://localhost:5173
```

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
