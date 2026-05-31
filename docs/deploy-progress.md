# デプロイ進捗ログ（GitHub Actions + OIDC）

このファイルは「[deploy-cicd.md](deploy-cicd.md) の設計を、実際にどこまで流したか」の記録です。
設計の意図・仕様はあちらを、ここでは**実施済みの事実と次の一手**を残します。

最終更新: 2026-05-31 / 対象: dev アカウント `027204872496` / `ap-northeast-1`

---

## 現在地（ひとことで）

**バックエンド一式は AWS にデプロイ済みで、API・CDN の URL は発行済み。**
フロントは設計どおりローカル Vite のままなので「画面の公開 URL」は無い（意図どおり）。
独自ドメイン（Route53）は設計に含めていないので不要。

---

## 完了したこと

### 1. 設計・コード（PR #1 / マージ済み）
- [docs/deploy-cicd.md](deploy-cicd.md) … 確定版の設計
- [infra/bootstrap.yaml](../infra/bootstrap.yaml) … OIDC プロバイダ / DeployRole / アーティファクトバケット
- [infra/template.yaml](../infra/template.yaml) … アプリ本体（S3 / CloudFront / Lambda / API GW）。
  PassRole 限定のため実行ロールに `RoleName: ${AWS::StackName}-lambda-exec` を付与済み。
- [.github/workflows/deploy.yml](../.github/workflows/deploy.yml) … 手動 `workflow_dispatch`
- [.github/workflows/validate.yml](../.github/workflows/validate.yml) … PR 検証（cfn-lint + build。AWS 認証なし）
- validate CI は PR #1 で成功実績あり。

### 2. bootstrap スタックを手動デプロイ（初回1回）
スタック `s3-presigned-url-lab-bootstrap` を作成（`CAPABILITY_NAMED_IAM`）。Outputs:

| Output | 値 |
| --- | --- |
| DeployRoleArn | `arn:aws:iam::027204872496:role/s3-presigned-url-lab-deploy` |
| ArtifactBucketName | `s3-presigned-url-lab-artifacts-027204872496` |
| OidcProviderArn | `arn:aws:iam::027204872496:oidc-provider/token.actions.githubusercontent.com` |

### 3. GitHub Environment `dev` を作成 + Variables 登録
- `AWS_DEPLOY_ROLE_ARN` = 上記 DeployRoleArn
- `ARTIFACT_BUCKET` = `s3-presigned-url-lab-artifacts-027204872496`
- OIDC 方式なので Secrets（アクセスキー）は登録していない。

### 4. deploy ワークフローを実行 → アプリスタック作成成功
- Actions → deploy → Run workflow（`workflow_dispatch`）で起動。
  ※ GitHub UI では Actions タブ → deploy → 右上「Run workflow」ボタンから人が起動できる。
- 全ステップ success（checkout → esbuild build → **OIDC で AssumeRole** → S3 へ zip → `cloudformation deploy` → outputs）。
- スタック `s3-presigned-url-lab` = **CREATE_COMPLETE**。
- アクセスキーを GitHub に置かずにデプロイできた（OIDC の狙いどおり）。

#### アプリスタックの Outputs（= 提供される URL）
| Output | 値 |
| --- | --- |
| ApiBaseUrl | `https://5hyxk53i09.execute-api.ap-northeast-1.amazonaws.com` |
| CdnDomain | `d3bhtum71uj3w1.cloudfront.net` |
| BucketName | `s3-presigned-url-lab-imagebucket-dsfwhbifdsan` |

---

## URL とドメインについて（よくある疑問）

- **Route53 は不要。** このラボは独自ドメインを使わない設計。API も CDN も AWS の
  デフォルトドメインがそのまま有効な URL になる。Route53 は `api.example.com` の
  ような独自ドメインを当てたいときだけ必要。
- **画面（フロント）の公開 URL は無いのが正しい。** フロントは AWS にホスティングせず、
  手元の `http://localhost:5173`（Vite dev server）を使う設計（[architecture.md](architecture.md)）。
  フロントの公開ホスティングは deploy-cicd.md §10「将来拡張」の範囲で、今回は対象外。

---

## 残っていること（次の一手）

- [ ] **フロントに API URL を反映**: `frontend/.env` に
      `VITE_API_BASE_URL=https://5hyxk53i09.execute-api.ap-northeast-1.amazonaws.com`
      を設定（`.env` は gitignore 済み。手動反映が設計どおり）。
- [ ] **ローカルで動作確認**: `frontend` で `npm run dev` → `http://localhost:5173` で
      アップロード → presign → PUT → CloudFront 経由 GET の一連を確認。
- [ ] （任意）`dev` 環境に必須レビュアー等の保護を付ける。
- [ ] （任意）片付け: 不要になったらアプリスタック →（必要なら）bootstrap スタックの順で削除
      （[README の片付け](../README.md) 参照。bootstrap を消すと OIDC ロールごと消える）。

---

## 通常運用（2回目以降のデプロイ）

bootstrap はもう不要。コードを main に入れたあと **Actions → deploy → Run workflow** を
押すだけ（または `gh workflow run deploy.yml --ref main`）。
インフラ変更の PR では validate CI（cfn-lint + build）が自動で回る。
