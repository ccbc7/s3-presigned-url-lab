---
marp: true
theme: default
paginate: false
size: 16:9
---

<style>
section {
  --accent: #00a9b4;
  --accent-sub: #ffd200;
  --text: #333333;
  --muted: #b8b8b8;
  background:
    linear-gradient(
      to bottom,
      var(--accent) 0 54%,
      var(--accent-sub) 54% 100%
    )
    0 0 / 10px 100% no-repeat,
    #ffffff;
  color: var(--text);
  font-family: "Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif;
  font-size: 30px;
  line-height: 1.55;
  padding: 78px 96px 62px 88px;
}

h1 {
  color: var(--text);
  font-size: 52px;
  font-weight: 700;
  margin: 0 0 62px;
  letter-spacing: 0;
}

h2,
h3 {
  color: var(--accent);
  font-size: 34px;
  font-weight: 700;
  margin: 28px 0 18px;
  letter-spacing: 0;
}

p {
  margin: 0 0 18px;
}

ul,
ol {
  margin: 14px 0 0 42px;
  padding: 0;
}

li {
  margin: 10px 0;
}

code,
pre {
  font-family: "SFMono-Regular", Consolas, monospace;
}

pre {
  background: #f7f9fa;
  border-left: 5px solid var(--accent);
  border-radius: 0;
  color: var(--text);
  font-size: 24px;
  line-height: 1.35;
  padding: 18px 22px;
}

table {
  font-size: 24px;
}

.meta-flow {
  display: grid;
  grid-template-columns: 1fr 120px 1fr;
  align-items: center;
  gap: 24px;
  margin: 28px 0;
  max-width: 900px;
}

.store-box {
  border: 2px solid #d9e1e5;
  padding: 22px 26px;
  min-height: 210px;
}

.store-box strong {
  color: var(--accent);
  display: block;
  font-size: 32px;
  margin-bottom: 14px;
}

.store-box ul {
  font-size: 24px;
  margin: 0;
  padding-left: 24px;
}

.flow-arrow {
  color: var(--accent);
  font-size: 42px;
  font-weight: 700;
  text-align: center;
}

section::marker {
  color: var(--accent);
}

footer {
  color: var(--muted);
  font-size: 14px;
  left: 42px;
  bottom: 12px;
}

section.title {
  display: flex;
  flex-direction: column;
  justify-content: center;
}

section.title h1 {
  font-size: 56px;
  margin-bottom: 28px;
}

section.title p {
  color: var(--accent);
  font-size: 30px;
  font-weight: 700;
}
</style>

<!-- _class: title -->

# CloudFrontで画像を配信するようにしてみた

---


# 今日話すこと

今回作った画像アップロード機能では、
画像データをDBではなくS3に保存しました。

そして、画像の表示はS3直接ではなくCloudFront経由にしました。

今日はこの2つを話します。

- なぜ画像をDBに入れないのか
- なぜS3だけでなくCloudFrontを使うのか

---


# なぜDBに画像を入れないのか


画像をDBに入れると、次のような問題が出やすくなります。

- DBの読み書きが重くなる
- バックアップやリストアが重くなる
- 画像配信の負荷がDBやAPIに乗る

---


# DBにはメタデータだけ持たせる

DBには画像本体ではなく、
画像に関する情報だけを保存します。

<div class="meta-flow">
  <div class="store-box">
    <strong>DB</strong>
    <ul>
      <li>userId</li>
      <li>imageKey</li>
      <li>fileName</li>
      <li>createdAt</li>
    </ul>
  </div>
  <div class="flow-arrow">→</div>
  <div class="store-box">
    <strong>S3</strong>
    <ul>
      <li>uploads/uuid.jpg</li>
    </ul>
  </div>
</div>

DBは検索や管理、
S3は画像ファイル本体の保存を担当します。

---


# なぜS3を使うのか

S3は画像や動画などのファイル保存に向いています。

今回の構成では、ブラウザからS3へ直接アップロードします。

```text
React -> S3
```

APIやLambdaが画像本体を受け取らないので、
サーバー側の処理を軽くできます。

---


# 今回の構成

1. React → API Gateway / Lambda
   - アップロード用の署名付きURLをリクエスト
   - `uploadUrl` と `cdnUrl` を受け取る

2. React → S3
   - `uploadUrl` に画像をPUT
   - S3の非公開バケットに画像を保存

3. React → CloudFront
   - `cdnUrl` で画像を表示
   - CloudFrontがS3から画像を取得

アップロードはS3署名付きURL、
表示はCloudFront URLを使います。

---


# S3だけでも配信はできる

S3のオブジェクトURLを使えば、
画像を表示することはできます。

```text
https://bucket-name.s3.ap-northeast-1.amazonaws.com/uploads/image.jpg
```

ただし、S3を直接公開するより、
CloudFrontを前に置く方が実務では扱いやすいです。

---


# CloudFrontを使う理由

CloudFrontを使う理由は大きく3つです。

- 速く配信できる
- S3へのアクセスを減らせる
- S3を非公開にできる

つまり、CloudFrontは画像配信用の入口です。

---


# 1. 速く配信できる

CloudFrontはCDNです。

ユーザーに近い場所に画像をキャッシュして返します。

```text
ユーザー -> 近くのCloudFront -> 画像
```

毎回S3まで取りに行かなくてよいので、
画像表示が速くなります。

---


# 2. S3へのアクセスを減らせる

同じ画像が何度も見られる場合、
CloudFrontのキャッシュから返せます。

```text
1回目: CloudFront -> S3
2回目: CloudFront cache
3回目: CloudFront cache
```

その分、S3へのGETリクエストや通信量を減らせます。

---


# 3. S3を非公開にできる

今回の構成では、S3バケットを公開していません。

CloudFrontだけがS3から画像を取得できます。

```text
ユーザー -> CloudFront -> S3
ユーザー -x-> S3
```

S3を直接公開せずに画像配信できます。

---


# OACでS3を守る

CloudFront OACを使うと、
非公開S3にCloudFrontだけがアクセスできます。

S3のバケットポリシーでは、
CloudFrontからの読み取りだけ許可します。

「画像は見せたい」
「でもS3は公開したくない」

この両方を実現できます。

---


# まとめ

今回の役割分担はこうです。

```text
DB: 画像のメタデータ
S3: 画像ファイル本体
CloudFront: 画像の配信
```

S3だけでも画像URLは出せます。

でもCloudFrontを使うと、
速く、安全に、S3への負荷を抑えて配信できます。

---


# まとめ

画像本体はS3に置く。

配信はCloudFrontに任せる。

DBには画像そのものではなく、
画像を管理するための情報だけを持たせる。
