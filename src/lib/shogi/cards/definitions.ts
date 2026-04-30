import type { CardDefinition, CardId } from "./types";

// Phase 0 暫定カード3種(設計ドキュメント 3.5)
// 「状態のみ」「ターゲット選択あり」「トラップ」の3パターンを最小被覆。
export const CARD_DEFS: Record<CardId, CardDefinition> = {
  mana_up: {
    id: "mana_up",
    kind: "normal",
    name: "マナUP",
    description: "マナを3チャージする",
    cost: 2,
    rarity: "common",
    effectId: "mana_up",
    targeting: "none",
    icon: "💎",
  },
  pawn_return: {
    id: "pawn_return",
    kind: "normal",
    name: "歩戻し",
    description: "自分の盤上の歩を1枚、持ち駒に戻す",
    cost: 3,
    rarity: "common",
    effectId: "pawn_return",
    targeting: "ownPiece",
    icon: "↩️",
  },
  no_promote: {
    id: "no_promote",
    kind: "trap",
    name: "成り無効化",
    description: "次に相手が成りを宣言したとき、それを1回無効化する",
    cost: 4,
    rarity: "rare",
    effectId: "no_promote",
    targeting: "none",
    icon: "🛡️",
  },
};

export const ALL_CARD_DEFS: CardDefinition[] = Object.values(CARD_DEFS);

// Phase 0 暫定数値(設計ドキュメント 3.5)
export const PHASE0_INITIAL_MANA: Record<"sente" | "gote", number> = {
  sente: 3,
  gote: 1,
};

export const PHASE0_MANA_CAP = 10;

// マナを5消費して山札からドロー
export const PHASE0_DRAW_COST = 5;

// 1ターン消費すると +1、早指し(1秒以内)で +2
export const PHASE0_MANA_PER_TURN = 1;
export const PHASE0_MANA_FAST_BONUS = 1; // 早指し時の追加分(合計+2)
export const PHASE0_FAST_THRESHOLD_MS = 1000;
