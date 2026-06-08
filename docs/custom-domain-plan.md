# dev CloudFront に prod Route53 の独自ドメインを紐づける実装計画

## 前提

このリポの配信実体は **dev アカウント** にあります。

| 用途 | アカウント | アカウントID |
| --- | --- | --- |
| CloudFront / S3 / API Gateway / Lambda | `awsmaster-dev` | `027204872496` |
| Route53 Hosted Zone | `awsmaster-prod` | `636052468636` |

やりたいことは、prod アカウントの Route53 Hosted Zone にある独自ドメインを、
dev アカウントの CloudFront Distribution に向けることです。

例:

```text
images-dev.example.com -> d3bhtum71uj3w1.cloudfront.net
```

## 実施状況（2026-06-07 記録）

委任方式で構築済み（**prod への書き込みは委任 NS 1件のみ**、既存レコードは不変更）。

- 委任ゾーン: `dev.hiro-lab-linux.com`（dev アカウントに新規 Hosted Zone を作成）
- prod `hiro-lab-linux.com` に上記サブドメインの **NS 委任を1件追加**
- CloudFront 用ホスト名: `images.dev.hiro-lab-linux.com`
- ACM 証明書（us-east-1 / dev）: **ISSUED**。検証 CNAME・Alias は委任先（dev ゾーン）で完結
- CloudFront への Aliases / 証明書反映は deploy ワークフローで実施
  （GitHub vars `CDN_ALTERNATE_DOMAIN` / `CDN_ACM_CERT_ARN`）

以後 `dev.hiro-lab-linux.com` 配下のホストは prod を触らず dev 側だけで増やせる。

## 方針

prod の Hosted Zone は DNS 管理だけに使い、実際の配信先は dev CloudFront のままにします。

本番影響を避けるため、既存の本番レコードは変更せず、dev 用の新しいサブドメインを作ります。

推奨:

```text
images-dev.example.com
```

避ける:

```text
images.example.com
www.example.com
```

## 実装ステップ

### 1. 利用するサブドメインを決める

dev 用であることが分かる名前にします。

例:

```text
images-dev.example.com
```

### 2. dev アカウントの ACM us-east-1 で証明書を作成する

CloudFront に独自ドメインを設定する場合、ACM 証明書は **us-east-1** に必要です。

dev アカウントで作成します。

```text
Profile: awsmaster-dev
Region: us-east-1
Domain: images-dev.example.com
Validation: DNS validation
```

### 3. ACM の DNS 検証レコードを prod Route53 に追加する

ACM が発行する検証用 CNAME を、prod アカウントの Hosted Zone に追加します。

例:

```text
_xxxxxxxx.images-dev.example.com
  CNAME _yyyyyyyy.acm-validations.aws.
```

ここで prod Route53 を触りますが、追加するのは検証用 CNAME のみです。
既存の本番向けレコードは変更しません。

### 4. 証明書が Issued になるまで待つ

ACM 証明書のステータスが `Issued` になったら、CloudFront に設定できます。

### 5. CloudFormation に独自ドメイン用パラメータを追加する

`infra/template.yaml` に CloudFront の Alternate Domain Name と ACM 証明書 ARN を渡せるようにします。

追加イメージ:

```yaml
Parameters:
  AlternateDomainName:
    Type: String
    Default: ""
    Description: Optional custom domain name for CloudFront

  AcmCertificateArn:
    Type: String
    Default: ""
    Description: Optional ACM certificate ARN in us-east-1 for CloudFront
```

CloudFront Distribution 側では、独自ドメインを使う場合だけ `Aliases` と
`ViewerCertificate` を設定します。

```yaml
Aliases:
  - !Ref AlternateDomainName

ViewerCertificate:
  AcmCertificateArn: !Ref AcmCertificateArn
  SslSupportMethod: sni-only
  MinimumProtocolVersion: TLSv1.2_2021
```

独自ドメインを使わない場合は、今まで通り CloudFront のデフォルト証明書を使います。

### 6. Lambda が返す `cdnUrl` を独自ドメインにする

現在は CloudFront のデフォルトドメインを使います。

```text
https://d3bhtum71uj3w1.cloudfront.net/uploads/uuid.jpg
```

独自ドメイン設定後は、API が返す `cdnUrl` を次の形にします。

```text
https://images-dev.example.com/uploads/uuid.jpg
```

実装としては、Lambda 環境変数 `CDN_DOMAIN` に独自ドメインを渡すようにします。

### 7. dev CloudFront をデプロイする

GitHub Actions の `deploy` ワークフローで dev アカウントへ反映します。

このリポの通常運用どおり、ローカルから prod / dev に直接デプロイしません。

```text
Actions -> deploy -> Run workflow
```

### 8. prod Route53 に Alias レコードを作成する

prod アカウントの Hosted Zone に、dev CloudFront へ向く Alias レコードを追加します。

```text
images-dev.example.com
  A Alias -> d3bhtum71uj3w1.cloudfront.net
```

IPv6 も使う場合:

```text
images-dev.example.com
  AAAA Alias -> d3bhtum71uj3w1.cloudfront.net
```

CloudFront 側に Alternate Domain Name が設定されていない状態で Route53 だけ向けても、
HTTPS 配信は正しく動きません。

必ず次の順で進めます。

```text
ACM証明書 Issued
-> CloudFront に Alternate Domain Name と証明書を設定
-> Route53 Alias を作成
```

### 9. 動作確認する

DNS:

```bash
dig images-dev.example.com
```

CloudFront:

```bash
curl -I https://images-dev.example.com/uploads/<existing-key>
```

フロント:

```bash
make up
```

ブラウザでアップロードし、API レスポンスまたは画面上の表示URLが次の形式になっていることを確認します。

```text
https://images-dev.example.com/uploads/...
```

## 触るもの / 触らないもの

触るもの:

```text
dev:
  ACM us-east-1
  CloudFront Distribution
  Lambda CDN_DOMAIN 環境変数

prod:
  Route53 Hosted Zone の新規レコード
```

触らないもの:

```text
prod:
  CloudFront
  S3
  API Gateway
  Lambda
  既存の本番DNSレコード
```

## 注意点

- CloudFront 用 ACM 証明書は `us-east-1` に作る。
- 証明書の SAN は Alternate Domain Name と一致させる。
- Route53 Alias の名前は CloudFront の Alternate Domain Name と一致させる。
- prod Route53 を触る作業は、新規サブドメインの追加だけに限定する。
- 本番ドメイン直下や既存の本番レコードは変更しない。

## 参考

- CloudFront: Alternate domain names and HTTPS
  - https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-https-alternate-domain-names.html
- CloudFront: Configure alternate domain names and HTTPS
  - https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-procedures.html
- Route53: Routing traffic to a CloudFront distribution
  - https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-to-cloudfront-distribution.html
- Route53: Alias record values
  - https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resource-record-sets-values-alias-common.html
