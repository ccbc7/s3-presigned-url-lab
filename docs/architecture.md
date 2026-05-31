# 仕組みの解説 — S3 署名付きURL を体系的に理解する

このドキュメントは「動かす手順」ではなく「なぜそうなるのか」を理解するための読み物です。
コードは [backend/src/handler.ts](../backend/src/handler.ts) と
[infra/template.yaml](../infra/template.yaml) を一緒に見てください。

---

## 1. 署名付きURL（presigned URL）とは何か

S3 バケットは既定で**完全非公開**です。では、なぜブラウザから直接アップロードできるのか？

答えが **署名付きURL** です。これは

> 「この操作（例: このキーへの PutObject）を、この期限まで許可する」

という許可情報を、AWS の資格情報で**署名（暗号計算）した一時的なURL**です。

重要な性質:

- **生成にネットワーク通信は不要**。Lambda は自分の IAM 資格情報を使って、URLに
  署名を**計算するだけ**。S3 へは問い合わせない。だから速いし安い。
- **許可範囲が限定的**。「どのバケットの・どのキーに・どの操作を・いつまで」が URL に
  埋め込まれている。期限が切れたら（このラボでは 300 秒）使えなくなる。
- **発行者の権限を超えられない**。Lambda 実行ロールに `s3:PutObject` が無ければ、
  署名付きURLでも PUT は失敗する（[template.yaml](../infra/template.yaml) の `PresignFnRole`）。

これにより「S3 のシークレットをブラウザに渡さずに、ブラウザから直接 S3 を操作させる」が
安全に実現できます。

---

## 2. アップロードの流れ（①〜④）

```
React ──①POST /upload-url──► API Gateway ──► Lambda
                                               ├ ② キー決定 uploads/<uuid>.jpg
                                               └ ③ 署名付きPUT URL を計算
React ◄── { uploadUrl, key, cdnUrl } ──────────┘
React ──④PUT uploadUrl (body=file)──► S3（直接）
```

- **①** フロントは「これから image/png を上げたい」と Content-Type を伝える
  （[api.ts `requestUploadUrl`](../frontend/src/api.ts)）。
- **②** API がキーを決める。衝突しないよう **UUID** を使うのが定番
  （`uploads/<uuid>.<ext>`）。ファイル名をそのまま使うと上書き・推測・日本語問題が起きる。
- **③** `getSignedUrl(PutObjectCommand, { expiresIn: 300 })` で署名付きURLを生成。
- **④** フロントは**API を経由せず**、その URL に `fetch(url, { method: "PUT", body: file })`。
  大きなファイルが API/Lambda を通らないので、サーバー負荷とコストを抑えられる。

### よくある落とし穴: Content-Type 不一致

`PutObjectCommand` に `ContentType` を指定して署名した場合、ブラウザの PUT も
**同じ `Content-Type` ヘッダ**を送らないと `SignatureDoesNotMatch` になります。
このラボでは [api.ts `uploadToS3`](../frontend/src/api.ts) で `file.type` を送って一致させています。

---

## 3. 「2種類のURL」を区別する

混乱しやすいポイント。URL には目的の違う2種類があります。

| | 保存用URL | 表示用URL |
| --- | --- | --- |
| 何 | 署名付き **PUT** URL | CloudFront のURL |
| 誰が作る | Lambda（署名計算） | キーから組み立てるだけ |
| 例 | `https://bucket.s3...?X-Amz-Signature=...` | `https://<cdn>/uploads/<uuid>.jpg` |
| 期限 | あり（数分） | なし（公開配信） |
| 用途 | アップロード専用 | 画像の表示 |

このラボでは**ダウンロード（取得）も2方式**を用意し、違いを体感できるようにしています。

1. **表示用URL（CloudFront）** … 画像表示の定番。誰でも見られる公開配信。
2. **署名付き GET URL** … `GET /download-url?key=...` で発行する**期限付き・非公開**リンク。
   「ログインユーザーだけに見せたい」「期限付き共有」などに使う。

---

## 4. なぜ CloudFront + OAC なのか

S3 を直接公開（バケットをパブリックに）してもURLは作れますが、推奨されません。

- **OAC（Origin Access Control）** を使うと、S3 は**非公開のまま**、
  CloudFront だけが読み取れる構成にできる（[template.yaml](../infra/template.yaml) の
  `Oac` と `ImageBucketPolicy`）。
- バケットポリシーは「**この CloudFront ディストリビューションから来た時だけ** GetObject 許可」
  という条件（`AWS:SourceArn`）になっている。
- CloudFront は CDN なのでキャッシュが効き、速くて安い。HTTPS も自動。

つまり **アップロードは署名付き PUT、表示は CloudFront(OAC)** が、非公開バケットを保ったまま
両立させるための定石です。

---

## 5. IaC（生 CloudFormation）の読み方

[infra/template.yaml](../infra/template.yaml) の主要リソース:

| 論理名 | 種類 | 役割 |
| --- | --- | --- |
| `ImageBucket` | `AWS::S3::Bucket` | 非公開の保存先。ブラウザ直PUT用に CORS 設定 |
| `Oac` / `Distribution` | CloudFront | OACで非公開S3を安全に表示配信 |
| `ImageBucketPolicy` | `AWS::S3::BucketPolicy` | CloudFrontからの読み取りだけ許可 |
| `PresignFnRole` | `AWS::IAM::Role` | Lambda の権限（uploads/ への Put/Get だけ） |
| `PresignFn` | `AWS::Lambda::Function` | 署名付きURL生成。コードはS3のzipを参照 |
| `HttpApi`/`Integration`/`*Route`/`Stage` | API Gateway v2 | Lambda を公開するHTTPエンドポイント |
| `LambdaPermission` | `AWS::Lambda::Permission` | API GatewayがLambdaを呼ぶ許可 |

### Lambda コードのデプロイ方法（SAMとの違い）

SAM なら `sam build` が裏でやってくれる部分を、生 CloudFormation では自分で行います。
[deploy.sh](../infra/deploy.sh) の流れ:

1. `esbuild` で `handler.ts` を**単一ファイルにバンドル**（依存も同梱）→ `dist/handler.js`
2. zip に固める
3. アーティファクト用 S3 バケットへ `aws s3 cp`
4. `aws cloudformation deploy` で、その S3 の場所（`LambdaCodeBucket`/`LambdaCodeKey`）を
   パラメータ渡し

> `AWS::Lambda::Function` のコードは「インラインZip(4KB上限)」か「S3のzip」か「コンテナ」で
> しか渡せません。実用的なサイズになると **S3 経由**が基本になります。

---

## 6. このラボで“あえて省いた”もの＝本番で足すもの

学習のため最小構成にしています。本番化では次を検討してください。

- **認証/認可**: 今は API がオープン。実際は「ログイン済みユーザーだけが署名URLをもらえる」
  ようにする（Cognito / API キー / JWT オーソライザ）。**誰がアップロードできるかは
  API 側で制御**するのが署名付きURL方式の要。
- **アップロード制限**: Content-Type の許可リストは実装済み。さらにサイズ上限は
  POST Policy（`createPresignedPost`）や CloudFront/WAF で制限可能。
- **メタデータDB**: 実務ではアップロード後に DynamoDB 等へ `userId → key` を保存し、
  表示時は DB のキーから URL を組み立てる。
- **非公開配信の強化**: 表示も秘匿したいなら CloudFront 署名付き URL / Cookie を使う。
- **ウイルススキャン / 画像変換**: S3 イベント → Lambda でサムネイル生成・検査など。

---

## 7. 用語ミニ辞典

- **presigned URL（署名付きURL）**: 一時的に特定のS3操作を許可する署名付きURL。
- **OAC（Origin Access Control）**: CloudFront から非公開S3へ安全にアクセスする仕組み（旧OAIの後継）。
- **HTTP API**: API Gateway の軽量・低コスト版。REST API より安い。
- **CORS**: 別オリジン（localhost:5173）からブラウザがS3/APIを叩くための許可設定。
- **IaC**: インフラをコードで管理すること。ここでは CloudFormation。
