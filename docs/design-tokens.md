# デザイントークン（ブランドカラー）

このラボの配色は [new-one.co.jp](https://new-one.co.jp/) のブランドカラーを採取したもの。

- **単一の真実（コード）**: [frontend/src/theme.ts](../frontend/src/theme.ts) … アプリはここだけを参照する。色変更はこのファイルで完結。
- **このドキュメント**: 各色の意味・出典・使いどころの説明（人と Claude が見る用）。

> 採取方法: `https://new-one.co.jp/` のテーマ CSS（WordPress テーマ `newone` の `style.css` / `additional.css`）から色値を頻度集計。最頻出のティールをプライマリ、黄をアクセントと判断した。

## パレット

| トークン | HEX | 役割 | 備考 |
| --- | --- | --- | --- |
| `primary` | `#00aebb` | ブランドのティール | CSS で最頻出（ヘッダ・ボタン・リンク） |
| `primaryDark` | `#008e99` | ホバー/押下 | primary を暗くした派生色 |
| `accent` | `#fdd000` | アクセントの黄 | ヘッダ下線などの差し色 |
| `ink` | `#231835` | 見出し | 濃い紫紺 |
| `text` | `#494747` | 本文 | |
| `muted` | `#8e8e8e` | 補助・無効状態 | |
| `border` | `#dedede` | 罫線・カード枠 | |
| `bg` | `#f7f7f7` | ページ背景 | |
| `surface` | `#ffffff` | カード/前面 | |
| `danger` | `#e53935` | エラー | |

## 「Claude に最適な保存方法」の考え方

色を Claude（と自分）が安定して再利用できるようにするコツ:

1. **コードを単一の真実にする**（`theme.ts` のようなトークンファイル）。アプリもドキュメントもそこを指す → 値がブレない。
2. **意味（セマンティック名）で持つ**（`primary` / `accent` …）。生の HEX を直書きしない → 用途が伝わり、差し替えも一箇所。
3. **出典と採取方法を残す**（このdoc）。なぜその色かが分かる → 後から再現・更新できる。
4. **横断記憶にはポインタだけ置く**（Claude のメモリに「ブランド色は theme.ts / このdoc」と1行）。本体は repo に置き、記憶は場所を指すだけにする。

## 使い方

```ts
import { colors, radius } from "./theme";
// 例: <button style={{ background: colors.primary, color: colors.surface }}>
```
