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

// マナ・ドローコストの確定値(Issue #81 / 2026-05-01 確定)
export const INITIAL_MANA: Record<"sente" | "gote", number> = {
  sente: 2,
  gote: 3,
};

// 将来カード効果(自分UP/相手DOWN)で動的化する想定。state 側で保持する初期値として参照する。
export const MANA_CAP = 20;

// マナを消費して山札からドロー
export const DRAW_COST = 3;

// 1ターン消費すると +1、早指し(FAST_THRESHOLD_MS 以内)で +2
export const MANA_PER_TURN = 1;
export const MANA_FAST_BONUS = 1; // 早指し時の追加分(合計+2)
export const FAST_THRESHOLD_MS = 3000;
