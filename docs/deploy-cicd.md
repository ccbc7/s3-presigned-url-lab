# デプロイ設計 — GitHub Actions + OIDC で CloudFormation を流す

このドキュメントは「ローカルから `deploy.sh` を手で叩く」運用をやめ、**インフラを Git 管理し
GitHub Actions からデプロイする**ための設計（確定版）です。実装（`bootstrap.yaml` /
`.github/workflows/*.yml`）は本書の仕様に従って後で作ります。

> 関連: アプリ本体の仕組みは [architecture.md](architecture.md)、手元実行の旧手順は
> [../README.md](../README.md) を参照。

---

## 0. 前提（確定値）

| 項目 | 値 |
| --- | --- |
| GitHub リポジトリ | `ccbc7/s3-presigned-url-lab` |
| デプロイ先アカウント | dev `027204872496`（**prod には流さない**） |
| リージョン | `ap-northeast-1` |
| ローカル AWS プロファイル | `awsmaster-dev`（SSO） |
| アプリスタック名 | `s3-presigned-url-lab` |
| ブートストラップスタック名 | `s3-presigned-url-lab-bootstrap` |
| 認証方式 | **GitHub OIDC → IAM ロール（アクセスキー不使用）** |

確認済みの事実（設計時点）:
- dev アカウントに GitHub OIDC プロバイダは**未作成**（bootstrap で新規作成・衝突なし）
- アプリスタックも**未作成**（まっさらな状態から）

---

## 1. 確定した設計判断

| # | 論点 | 決定 |
| --- | --- | --- |
| 1 | OIDC `sub` の固定粒度 | `repo:ccbc7/s3-presigned-url-lab:environment:dev` に固定 |
| 2 | DeployRole の権限 | サービス列挙の**中粒度スコープ**（可能な所はリージョン/アカウント/スタックで限定） |
| 3 | `iam:PassRole` の対象 | `arn:aws:iam::027204872496:role/s3-presigned-url-lab-*` に限定 |
| 4 | デプロイのトリガ | **`workflow_dispatch` 手動のみ**（main push の自動デプロイはしない） |
| 5 | bootstrap の流し方 | ローカルから**1回だけ**手動 `cloudformation deploy` |
| 6 | PR 検証 CI | 入れる（テンプレート検証 + changeset 作成のみ。デプロイはしない） |

---

## 2. 全体フロー

```
（インフラ変更を PR）──► validate.yml: cfn validate-template / changeset 作成のみ（デプロイしない）
                              │  レビュー & マージ
                              ▼
人が手動で実行 (Actions > deploy > Run workflow)
                              ▼
                 GitHub Actions: deploy.yml  (environment: dev)
   ① OIDC トークン発行 (permissions: id-token: write)
   ② configure-aws-credentials → AssumeRoleWithWebIdentity → DeployRole
   ③ backend を esbuild でビルド → function.zip
   ④ zip を S3 (アーティファクトバケット) へ: lambda/handler-<git sha>.zip
   ⑤ aws cloudformation deploy infra/template.yaml
   ⑥ Outputs(ApiBaseUrl 等) を Job Summary に出力
                              ▼
        AWS dev (027204872496) / ap-northeast-1
        CloudFormation スタック: s3-presigned-url-lab
```

---

## 3. スタックは2層に分ける

| スタック | 頻度 | 作るもの | 流す人/方法 |
| --- | --- | --- | --- |
| **bootstrap**（新規 `infra/bootstrap.yaml`） | 初回1回だけ | OIDC プロバイダ / DeployRole / アーティファクトバケット | 人がローカルから手動（`CAPABILITY_NAMED_IAM`） |
| **app**（既存 `infra/template.yaml`） | 毎デプロイ | S3 / CloudFront / Lambda / API GW | deploy.yml（OIDC で引き受けた DeployRole） |

「Actions がデプロイするための土台（ロール等）」は Actions 自身では作れない（鶏と卵）。
そこだけ手動、以後はすべて Actions 経由。

---

## 4. `infra/bootstrap.yaml` の仕様

### 4.1 OIDC プロバイダ
- `Url`: `https://token.actions.githubusercontent.com`
- `ClientIdList`: `sts.amazonaws.com`
- `ThumbprintList`: GitHub 用の既知サムプリント（現在 AWS は信頼ストアで検証するため値の運用負担はないが、`AWS::IAM::OIDCProvider` ではフィールド必須）

### 4.2 DeployRole（信頼ポリシーが肝）
- `RoleName`: `s3-presigned-url-lab-deploy`
- 信頼ポリシー（repo と environment に限定。他リポジトリ・他環境からの引き受けを遮断）:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::027204872496:oidc-provider/token.actions.githubusercontent.com" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        "token.actions.githubusercontent.com:sub": "repo:ccbc7/s3-presigned-url-lab:environment:dev"
      }
    }
  }]
}
```

### 4.3 DeployRole の権限ポリシー（中粒度スコープ）
このアプリスタックが触るサービスのみ。可能な所はアカウント/リージョン/スタックで限定する。

- `cloudformation:*` … 対象は `arn:aws:cloudformation:ap-northeast-1:027204872496:stack/s3-presigned-url-lab/*`（+ `validate-template` は changeset 用に必要）
- `s3:*` … アーティファクトバケットと、スタックが作る画像バケット（作成/CORS/ポリシー/PublicAccessBlock）
- `cloudfront:*` … OAC / Distribution（**CloudFront はリソースレベル権限が弱く `Resource: "*"` になる** — 設計上の許容点）
- `lambda:*` … 関数の作成/更新（`arn:aws:lambda:ap-northeast-1:027204872496:function:s3-presigned-url-lab-*` を基本に）
- `apigateway:*` … HTTP API
- `logs:*` … Lambda のロググループ
- `iam:CreateRole/DeleteRole/GetRole/PutRolePolicy/DeleteRolePolicy/AttachRolePolicy/DetachRolePolicy/TagRole` … `role/s3-presigned-url-lab-*` に限定
- **`iam:PassRole`** … `arn:aws:iam::027204872496:role/s3-presigned-url-lab-*` に限定（最も強い権限。命名規則で縛る）

> ⚠️ **`template.yaml` に必要な小改修**: 上の PassRole/IAM 限定を効かせるため、Lambda 実行ロール
> `PresignFnRole` に `RoleName: !Sub "${AWS::StackName}-lambda-exec"` を付ける。
> （現状は CFN 自動命名のため `s3-presigned-url-lab-*` にマッチしない。）

### 4.4 アーティファクトバケット
- `BucketName`: `s3-presigned-url-lab-artifacts-027204872496`
- Lambda zip 置き場。PublicAccessBlock 全 true。
- ライフサイクル: `lambda/` 配下の古い zip を 30 日で失効。

### 4.5 bootstrap の Outputs
- `DeployRoleArn` … deploy.yml の `role-to-assume` に使う
- `ArtifactBucketName` … deploy.yml の zip アップロード先

---

## 5. `.github/workflows/deploy.yml` の仕様（手動のみ）

```yaml
name: deploy
on:
  workflow_dispatch: {}        # 手動実行のみ（自動 push デプロイはしない）
permissions:
  id-token: write              # OIDC に必須
  contents: read
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: dev           # GitHub Environment で保護 + 変数管理
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: "npm", cache-dependency-path: backend/package-lock.json }
      - run: npm ci && npm run build
        working-directory: backend
      - run: (cd dist && zip ../function.zip handler.js)
        working-directory: backend
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ vars.AWS_DEPLOY_ROLE_ARN }}
          aws-region: ap-northeast-1
      - name: upload lambda zip
        run: |
          KEY="lambda/handler-${{ github.sha }}.zip"
          aws s3 cp backend/function.zip "s3://${{ vars.ARTIFACT_BUCKET }}/$KEY"
          echo "KEY=$KEY" >> "$GITHUB_ENV"
      - name: deploy stack
        run: |
          aws cloudformation deploy \
            --region ap-northeast-1 \
            --stack-name s3-presigned-url-lab \
            --template-file infra/template.yaml \
            --capabilities CAPABILITY_NAMED_IAM \
            --parameter-overrides \
              LambdaCodeBucket=${{ vars.ARTIFACT_BUCKET }} \
              LambdaCodeKey=$KEY \
              AllowedOrigin=http://localhost:5173
      - name: outputs to summary
        run: |
          aws cloudformation describe-stacks --region ap-northeast-1 \
            --stack-name s3-presigned-url-lab \
            --query "Stacks[0].Outputs" --output table >> "$GITHUB_STEP_SUMMARY"
```

設計上のポイント:
- zip キーは時刻でなく **`github.sha`**（追跡性）。
- ロール ARN / バケット名は **GitHub Environment(dev) の Variables**（OIDC なので Secrets 不要）:
  - `AWS_DEPLOY_ROLE_ARN` = bootstrap の `DeployRoleArn`
  - `ARTIFACT_BUCKET` = `s3-presigned-url-lab-artifacts-027204872496`
- `--capabilities` は IAM 名前付きロールを作るため `CAPABILITY_NAMED_IAM`（既存 deploy.sh の `CAPABILITY_IAM` から変更が必要 = 4.3 の RoleName 付与と対）。

---

## 6. `.github/workflows/validate.yml` の仕様（PR 検証・安全側）

```yaml
name: validate
on:
  pull_request:
    paths: ["infra/**", "backend/**", ".github/workflows/**"]
permissions:
  contents: read          # AWS 認証は不要（cfn-lint はオフライン）
jobs:
  cfn-lint:               # テンプレートの静的検証
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: pip install cfn-lint
      - run: cfn-lint --non-zero-exit-code error infra/template.yaml infra/bootstrap.yaml
  build:                  # backend の型チェック + ビルドが通るか
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: npm, cache-dependency-path: backend/package-lock.json }
      - run: npm ci && npm run typecheck && npm run build
        working-directory: backend
```
- **デプロイも AWS 認証もしない**。cfn-lint（オフライン静的検証）+ backend の型チェック/ビルドのみ。
- AWS クレデンシャルを PR で一切扱わないので、fork PR 経由の権限悪用リスクを避けられる（当初案の `validate-template` から安全側に変更）。

---

## 7. 初回ブートストラップ手順（人が1回だけ）

```bash
# 0) SSO ログイン（dev）
aws sso login --profile awsmaster-dev

# 1) bootstrap スタックを流す（OIDCプロバイダ / DeployRole / アーティファクトバケット）
aws cloudformation deploy \
  --profile awsmaster-dev --region ap-northeast-1 \
  --stack-name s3-presigned-url-lab-bootstrap \
  --template-file infra/bootstrap.yaml \
  --capabilities CAPABILITY_NAMED_IAM

# 2) Outputs を確認（DeployRoleArn / ArtifactBucketName）
aws cloudformation describe-stacks --profile awsmaster-dev --region ap-northeast-1 \
  --stack-name s3-presigned-url-lab-bootstrap \
  --query "Stacks[0].Outputs" --output table
```

そのあと GitHub 側で（1回だけ）:
- Settings → Environments → `dev` を作成（必要なら必須レビュアー等の保護を設定）
- `dev` の **Variables** に `AWS_DEPLOY_ROLE_ARN` と `ARTIFACT_BUCKET` を登録

以後の通常デプロイは **Actions → deploy → Run workflow** だけ。

---

## 8. デプロイ後の運用
- `deploy` 実行後、Job Summary に出る **`ApiBaseUrl`** を `frontend/.env` の `VITE_API_BASE_URL` に貼る（フロントはローカル Vite のままなので手動）。
- 片付けは従来どおり（[README の「片付け」](../README.md)）。bootstrap スタックを消すと OIDC ロールごと消える。

---

## 9. セキュリティ上のメモ
- アクセスキーを GitHub に保存しない（OIDC の短命クレデンシャルのみ）。
- 信頼ポリシーで `aud` と `sub`（repo + environment）を固定し、他リポジトリ/他環境からの引き受けを遮断。
- DeployRole は admin ではなく、当スタックが触るサービスに絞る。`iam:PassRole` は命名規則で限定。
- `workflow_dispatch` 手動のみ＝意図しない自動デプロイが起きない。

---

## 10. 将来拡張（今回はやらない）
- `prod` 環境（別アカウント `636052468636`）を GitHub Environment `prod` + 必須レビュー承認で追加。
- フロントのホスティング（S3+CloudFront 等）と ApiBaseUrl の自動注入。
- DeployRole をさらに最小権限へ（実行ログから不要 Action を削る）。
