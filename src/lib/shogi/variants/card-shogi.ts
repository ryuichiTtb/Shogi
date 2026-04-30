// カード将棋(card-shogi)バリアント。
// Phase 0 では駒の動き・盤・基本ルールは標準将棋と同一。マナ・カード・トラップは
// `RuleVariant` の枠外で `use-card-shogi-game` が管理する(イベント駆動設計、設計ドキュメント 2.6)。

import type { RuleVariant } from "./types";
import { STANDARD_VARIANT } from "./standard";

export const CARD_SHOGI_VARIANT: RuleVariant = {
  ...STANDARD_VARIANT,
  id: "card-shogi",
  name: "カード将棋",
  description: "標準将棋にマナ・カード・トラップを加えた拡張ルール",
};
