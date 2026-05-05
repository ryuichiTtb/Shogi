// CardGameState の初期化と DB 往復(シリアライズ/デシリアライズ)

import type { Player } from "@/lib/shogi/types";
import type { CardGameState, CardId, CardInstance } from "./types";
import {
  INITIAL_MANA,
  MANA_CAP,
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
    mana: { ...INITIAL_MANA },
    manaCap: MANA_CAP,
    hand: { sente: senteHand, gote: goteHand },
    deck: { sente: senteDeck, gote: goteDeck },
    graveyard: { sente: [], gote: [] },
    trap: { sente: null, gote: null },
    pendingCard: null,
    lastTurnStartedAt: { sente: null, gote: null },
    noPromoteMarks: { sente: [], gote: [] },
    drawProgress: { sente: 0, gote: 0 },
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
  // Fisher-Yates: sente/gote それぞれ独立にシャッフルする (両者で順序は揃わない)。
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

// DB 往復: pendingCard は復元しない (B4: リロード = キャンセル相当)
// lastTurnStartedAt も保存しない (リロード後の早指し誤検出を避ける)
// noPromoteMarks は永続効果なので保存・復元する
// drawProgress (#130) はゲーム進行に直結するため保存・復元する
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
    noPromoteMarks: state.noPromoteMarks,
    drawProgress: state.drawProgress,
  };
}

export function deserializeCardState(data: unknown): CardGameState {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid cardState data");
  }
  const obj = data as Partial<CardGameState>;
  return {
    mana: obj.mana ?? { sente: 0, gote: 0 },
    manaCap: obj.manaCap ?? MANA_CAP,
    hand: obj.hand ?? { sente: [], gote: [] },
    deck: obj.deck ?? { sente: [], gote: [] },
    graveyard: obj.graveyard ?? { sente: [], gote: [] },
    trap: obj.trap ?? { sente: null, gote: null },
    pendingCard: null,
    lastTurnStartedAt: { sente: null, gote: null },
    noPromoteMarks: obj.noPromoteMarks ?? { sente: [], gote: [] },
    // 旧データ (drawProgress 未保存時代) との互換: 0 から再開する。
    drawProgress: obj.drawProgress ?? { sente: 0, gote: 0 },
  };
}
