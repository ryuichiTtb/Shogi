export type ThemePreference = "light" | "dark" | "system";
export type CardBackStyle = "emblem" | "seigaiha" | "minimal";

export const DEFAULT_THEME: ThemePreference = "system";
export const DEFAULT_CARD_BACK_STYLE: CardBackStyle = "seigaiha";

export function isValidThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function isValidCardBackStyle(value: unknown): value is CardBackStyle {
  return value === "emblem" || value === "seigaiha" || value === "minimal";
}
