export type ThemePreference = "light" | "dark" | "system";
export type CardBackStyle = "seigaiha" | "koke" | "emblem" | "minimal" | "kurenai";
// Issue #177: 将棋盤レイアウト ID。public/img/wood/ の採用 4 種に対応する。
// UI カタログ (画像 URL / 名前 / 線色) は components/board-layout/options.ts 側で持つ。
export type BoardLayoutId = "light-1" | "light-2" | "dark-1" | "dark-2";

export const DEFAULT_THEME: ThemePreference = "system";
export const DEFAULT_CARD_BACK_STYLE: CardBackStyle = "seigaiha";
export const DEFAULT_BOARD_LAYOUT_ID: BoardLayoutId = "light-2";

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
