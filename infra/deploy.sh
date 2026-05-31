#!/usr/bin/env bash
#
# Lambda をビルド → zip を S3 にアップロード → CloudFormation をデプロイ する一括スクリプト。
#
# 事前準備（初回のみ）:
#   1) AWS 認証情報を設定:  aws configure
#   2) アーティファクト用バケットを作成（世界で一意な名前にする）:
#        aws s3 mb s3://my-presign-artifacts-<your-account-id> --region ap-northeast-1
#
# 使い方:
#   ARTIFACT_BUCKET=my-presign-artifacts-123456789012 ./deploy.sh
#
# 任意の環境変数で上書き可:
#   STACK_NAME（既定 s3-presigned-url-lab） / REGION（既定 ap-northeast-1）
#   ALLOWED_ORIGIN（既定 http://localhost:5173）
#
set -euo pipefail

STACK_NAME="${STACK_NAME:-s3-presigned-url-lab}"
REGION="${REGION:-ap-northeast-1}"
ALLOWED_ORIGIN="${ALLOWED_ORIGIN:-http://localhost:5173}"
ARTIFACT_BUCKET="${ARTIFACT_BUCKET:?ARTIFACT_BUCKET を指定してください（例: export ARTIFACT_BUCKET=my-presign-artifacts-<account-id>）}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> 1/4 Lambda をビルド (esbuild で単一ファイルにバンドル)"
(cd "$ROOT/backend" && npm install && npm run build)

echo "==> 2/4 zip を作成"
ZIP="$ROOT/backend/function.zip"
rm -f "$ZIP"
(cd "$ROOT/backend/dist" && zip -q "$ZIP" handler.js)
KEY="lambda/handler-$(date +%s).zip"

echo "==> 3/4 S3 にアップロード: s3://$ARTIFACT_BUCKET/$KEY"
aws s3 cp "$ZIP" "s3://$ARTIFACT_BUCKET/$KEY" --region "$REGION"

echo "==> 4/4 CloudFormation をデプロイ (stack: $STACK_NAME)"
aws cloudformation deploy \
  --region "$REGION" \
  --stack-name "$STACK_NAME" \
  --template-file "$ROOT/infra/template.yaml" \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    LambdaCodeBucket="$ARTIFACT_BUCKET" \
    LambdaCodeKey="$KEY" \
    AllowedOrigin="$ALLOWED_ORIGIN"

echo ""
echo "==> 完了。スタックの Outputs:"
aws cloudformation describe-stacks \
  --region "$REGION" \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs" \
  --output table

echo ""
echo "ApiBaseUrl を frontend/.env の VITE_API_BASE_URL に設定してください。"
