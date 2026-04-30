// CardGameState の初期化と DB 往復(シリアライズ/デシリアライズ)

import type { Player } from "@/lib/shogi/types";
import type { CardGameState, CardId, CardInstance } from "./types";
import {
  PHASE0_INITIAL_MANA,
  PHASE0_MANA_CAP,
} from "./definitions";

export interface DeckSpec {
  defId: CardId;
  count: number;
}

// 設計ドキュメント 3.5 の Phase 0 初期構成。
// DB の DeckEntry から取得したスペックを CardInstance[] に展開し、
// 各プレイヤーに同一のデッキを発行(対称、初期手札2枚で開始、残り山札)。
export function createInitialCardState(deckSpec: DeckSpec[]): CardGameState {
  const senteDeck = buildDeck("sente", deckSpec);
  const goteDeck = buildDeck("gote", deckSpec);

  const senteHand = senteDeck.splice(0, 2);
  const goteHand = goteDeck.splice(0, 2);

  return {
    mana: { ...PHASE0_INITIAL_MANA },
    manaCap: PHASE0_MANA_CAP,
    hand: { sente: senteHand, gote: goteHand },
    deck: { sente: senteDeck, gote: goteDeck },
    graveyard: { sente: [], gote: [] },
    trap: { sente: null, gote: null },
    pendingCard: null,
    lastTurnStartedAt: { sente: null, gote: null },
  };
}

function buildDeck(player: Player, deckSpec: DeckSpec[]): CardInstance[] {
  const cards: CardInstance[] = [];
  let counter = 0;
  for (const { defId, count } of deckSpec) {
    for (let i = 0; i < count; i++) {
      counter++;
      cards.push({ instanceId: `${player}-${defId}-${counter}`, defId });
    }
  }
  // Phase 0 では shuffle なし(決定的)。Phase A で疑似乱数導入予定。
  return cards;
}

// DB 往復: pendingCard は復元しない (B4: リロード = キャンセル相当)
// lastTurnStartedAt も保存しない (リロード後の早指し誤検出を避ける)
export function serializeCardState(state: CardGameState): unknown {
  return {
    mana: state.mana,
    manaCap: state.manaCap,
    hand: state.hand,
    deck: state.deck,
    graveyard: state.graveyard,
    trap: state.trap,
    pendingCard: null,
    lastTurnStartedAt: { sente: null, gote: null },
  };
}

export function deserializeCardState(data: unknown): CardGameState {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid cardState data");
  }
  const obj = data as Partial<CardGameState>;
  return {
    mana: obj.mana ?? { sente: 0, gote: 0 },
    manaCap: obj.manaCap ?? PHASE0_MANA_CAP,
    hand: obj.hand ?? { sente: [], gote: [] },
    deck: obj.deck ?? { sente: [], gote: [] },
    graveyard: obj.graveyard ?? { sente: [], gote: [] },
    trap: obj.trap ?? { sente: null, gote: null },
    pendingCard: null,
    lastTurnStartedAt: { sente: null, gote: null },
  };
}
