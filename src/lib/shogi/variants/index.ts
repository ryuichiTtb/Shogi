export { STANDARD_VARIANT } from "./standard";
export { CARD_SHOGI_VARIANT } from "./card-shogi";
export type { RuleVariant, GameConfig, Difficulty } from "./types";

import { STANDARD_VARIANT } from "./standard";
import { CARD_SHOGI_VARIANT } from "./card-shogi";
import type { RuleVariant } from "./types";

// 利用可能なバリアント一覧
export const ALL_VARIANTS: RuleVariant[] = [
  STANDARD_VARIANT,
  CARD_SHOGI_VARIANT,
  // 将来追加: HANDICAP_VARIANT, MINI5X5_VARIANT, etc.
];

export function getVariantById(id: string): RuleVariant {
  const variant = ALL_VARIANTS.find((v) => v.id === id);
  if (!variant) {
    throw new Error(`Unknown variant: ${id}`);
  }
  return variant;
}
