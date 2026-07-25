export type ThemePreference = "light" | "dark" | "system";
export type CardBackStyle = "seigaiha" | "koke" | "emblem" | "minimal" | "kurenai";
// Issue #177: 将棋盤レイアウト ID。public/img/wood/ の採用 4 種に対応する。
// UI カタログ (画像 URL / 名前 / 線色) は components/board-layout/options.ts 側で持つ。
export type BoardLayoutId = "light-1" | "light-2" | "dark-1" | "dark-2";

export const DEFAULT_THEME: ThemePreference = "system";
export const DEFAULT_CARD_BACK_STYLE: CardBackStyle = "seigaiha";
// Issue #250 (#245 派生、2026-07-05 ユーザー指示): 既定盤デザインをダーク02へ変更。
// ★この定数が「未設定ユーザーの既定」の単一情報源。DB 側 (UserPreference.boardLayout) は
// nullable かつ @default を持たない = 未設定は NULL のままなので、ここを変えるだけで
// 明示選択していない全ユーザーへ届く (DB 作業不要)。schema.prisma のコメントも参照。
export const DEFAULT_BOARD_LAYOUT_ID: BoardLayoutId = "dark-2";

export function isValidThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function isValidCardBackStyle(value: unknown): value is CardBackStyle {
  return (
    value === "seigaiha" ||
    value === "koke" ||
    value === "emblem" ||
    value === "minimal" ||
    value === "kurenai"
  );
}

export function isValidBoardLayoutId(value: unknown): value is BoardLayoutId {
  return (
    value === "light-1" ||
    value === "light-2" ||
    value === "dark-1" ||
    value === "dark-2"
  );
}

// DB から読んだ生値 (未設定 = null / 旧 ID / 想定外の型) を既定へ吸収する。
// ★Issue #250: 「未設定なら常に最新のコード既定を適用する」の実装点。
// サーバアクション (app/actions/preferences.ts) 側に置くと "use server" + prisma import で
// 単体テストできないため、純関数として型定義と同じ場所に置く。
export function normalizeThemePreference(value: unknown): ThemePreference {
  return isValidThemePreference(value) ? value : DEFAULT_THEME;
}

export function normalizeCardBackStyle(value: unknown): CardBackStyle {
  return isValidCardBackStyle(value) ? value : DEFAULT_CARD_BACK_STYLE;
}

export function normalizeBoardLayoutId(value: unknown): BoardLayoutId {
  return isValidBoardLayoutId(value) ? value : DEFAULT_BOARD_LAYOUT_ID;
}
