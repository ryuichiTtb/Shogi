export type ThemePreference = "light" | "dark" | "system";
export type CardBackStyle = "seigaiha" | "koke" | "emblem" | "minimal" | "kurenai";

export const DEFAULT_THEME: ThemePreference = "system";
export const DEFAULT_CARD_BACK_STYLE: CardBackStyle = "seigaiha";

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
