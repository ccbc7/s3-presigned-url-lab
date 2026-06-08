/**
 * デザイントークン（このアプリの色の「単一の真実」）。
 *
 * 出典: https://new-one.co.jp/ のブランドカラーを CSS から採取したもの。
 * 色を変えたいときは **ここだけ** を直す（App はこの値を参照する）。
 * 各色の意味・採取の経緯は docs/design-tokens.md を参照。
 */
export const colors = {
  // ブランド
  primary: "#00aebb", // メインのティール（サイトCSSで最頻出）
  primaryDark: "#008e99", // ホバー/押下用に primary を暗くした派生色
  accent: "#fdd000", // アクセントのイエロー
  ink: "#231835", // 見出し向けの濃い紫紺

  // ニュートラル
  text: "#494747", // 本文
  muted: "#8e8e8e", // 補助テキスト・無効状態
  border: "#dedede", // 罫線・カード枠
  bg: "#f7f7f7", // ページ背景
  surface: "#ffffff", // カード/前面

  // 状態
  danger: "#e53935", // エラー
} as const;

export const radius = { md: 8, lg: 12 } as const;

export type Colors = typeof colors;
