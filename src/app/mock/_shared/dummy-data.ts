import type { CardDefinition, CardId, CardInstance, MockCardGameState } from "./types";
import type { Player } from "@/lib/shogi/types";

export const MOCK_CARD_DEFS: Record<CardId, CardDefinition> = {
  mana_up: {
    id: "mana_up",
    kind: "normal",
    name: "マナUP",
    description: "マナを3チャージする",
    cost: 2,
    rarity: "common",
    effectId: "mana_up",
    targeting: "none",
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
  },
};

let counter = 0;
function newInstanceId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

function makeInstance(defId: CardId): CardInstance {
  return { instanceId: newInstanceId(defId), defId };
}

function buildInitialDeck(player: Player): CardInstance[] {
  // 各カード2枚ずつ、計6枚で構成(plan 通り)
  return [
    makeInstance("mana_up"),
    makeInstance("mana_up"),
    makeInstance("pawn_return"),
    makeInstance("pawn_return"),
    makeInstance("no_promote"),
    makeInstance("no_promote"),
  ].map((c) => ({ ...c, instanceId: `${player}-${c.instanceId}` }));
}

export function createMockInitialCardState(): MockCardGameState {
  const senteDeck = buildInitialDeck("sente");
  const goteDeck = buildInitialDeck("gote");

  // 初期手札としてランダムに2枚ずつ引いた状態でデモを開始(タップ評価しやすく)
  const senteHand = senteDeck.splice(0, 2);
  const goteHand = goteDeck.splice(0, 2);

  return {
    mana: { sente: 3, gote: 1 },
    manaCap: 10,
    hand: { sente: senteHand, gote: goteHand },
    deck: { sente: senteDeck, gote: goteDeck },
    graveyard: { sente: [], gote: [] },
    trap: { sente: null, gote: null },
    pendingCard: null,
  };
}
