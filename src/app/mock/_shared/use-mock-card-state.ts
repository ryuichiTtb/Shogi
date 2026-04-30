"use client";

import { useReducer, useCallback } from "react";
import type { Player } from "@/lib/shogi/types";
import type { MockCardAction, MockCardGameState, CardInstance } from "./types";
import { createMockInitialCardState, MOCK_CARD_DEFS } from "./dummy-data";

function reducer(state: MockCardGameState, action: MockCardAction): MockCardGameState {
  switch (action.type) {
    case "CHARGE_MANA": {
      const next = Math.min(state.manaCap, state.mana[action.player] + action.amount);
      return {
        ...state,
        mana: { ...state.mana, [action.player]: next },
      };
    }
    case "DRAW_CARD": {
      const deck = state.deck[action.player];
      if (deck.length === 0) return state;
      if (state.mana[action.player] < 5) return state;
      const [top, ...rest] = deck;
      return {
        ...state,
        mana: { ...state.mana, [action.player]: state.mana[action.player] - 5 },
        deck: { ...state.deck, [action.player]: rest },
        hand: { ...state.hand, [action.player]: [...state.hand[action.player], top] },
      };
    }
    case "BEGIN_PLAY_CARD": {
      const card = state.hand[action.player].find((c) => c.instanceId === action.instanceId);
      if (!card) return state;
      const def = MOCK_CARD_DEFS[card.defId];
      if (state.mana[action.player] < def.cost) return state;
      // モックでは効果は発動しない。確認ダイアログだけ開く。
      return {
        ...state,
        pendingCard: {
          instance: card,
          phase: def.targeting === "none" || def.kind === "trap" ? "confirm" : "selectTarget",
        },
      };
    }
    case "CONFIRM_PLAY_CARD": {
      if (!state.pendingCard) return state;
      const card = state.pendingCard.instance;
      const def = MOCK_CARD_DEFS[card.defId];
      // 手札から除去
      const owner = findOwner(state, card.instanceId);
      if (!owner) return state;
      const newHand = state.hand[owner].filter((c) => c.instanceId !== card.instanceId);
      const baseState: MockCardGameState = {
        ...state,
        mana: { ...state.mana, [owner]: state.mana[owner] - def.cost },
        hand: { ...state.hand, [owner]: newHand },
        pendingCard: null,
      };
      if (def.kind === "trap") {
        return {
          ...baseState,
          trap: {
            ...state.trap,
            [owner]: { instanceId: card.instanceId, defId: card.defId, owner },
          },
        };
      }
      return {
        ...baseState,
        graveyard: { ...state.graveyard, [owner]: [...state.graveyard[owner], card] },
      };
    }
    case "CANCEL_PLAY_CARD":
      return { ...state, pendingCard: null };
    case "SET_TRAP": {
      const card = state.hand[action.player].find((c) => c.instanceId === action.instanceId);
      if (!card) return state;
      const def = MOCK_CARD_DEFS[card.defId];
      if (def.kind !== "trap") return state;
      if (state.mana[action.player] < def.cost) return state;
      return {
        ...state,
        mana: { ...state.mana, [action.player]: state.mana[action.player] - def.cost },
        hand: {
          ...state.hand,
          [action.player]: state.hand[action.player].filter((c) => c.instanceId !== action.instanceId),
        },
        trap: {
          ...state.trap,
          [action.player]: { instanceId: card.instanceId, defId: card.defId, owner: action.player },
        },
      };
    }
    default:
      return state;
  }
}

function findOwner(state: MockCardGameState, instanceId: string): Player | null {
  if (state.hand.sente.some((c) => c.instanceId === instanceId)) return "sente";
  if (state.hand.gote.some((c) => c.instanceId === instanceId)) return "gote";
  // pendingCardは手札から外していないため通常はhandに残るが、念のため
  if (state.pendingCard?.instance.instanceId === instanceId) {
    if (state.hand.sente.some((c) => c.instanceId === state.pendingCard!.instance.instanceId)) return "sente";
    if (state.hand.gote.some((c) => c.instanceId === state.pendingCard!.instance.instanceId)) return "gote";
  }
  return null;
}

export function useMockCardState() {
  const [state, dispatch] = useReducer(reducer, undefined, createMockInitialCardState);

  const chargeMana = useCallback((player: Player, amount: number) => {
    dispatch({ type: "CHARGE_MANA", player, amount });
  }, []);
  const drawCard = useCallback((player: Player) => {
    dispatch({ type: "DRAW_CARD", player });
  }, []);
  const beginPlayCard = useCallback((player: Player, instanceId: string) => {
    dispatch({ type: "BEGIN_PLAY_CARD", player, instanceId });
  }, []);
  const confirmPlayCard = useCallback(() => {
    dispatch({ type: "CONFIRM_PLAY_CARD" });
  }, []);
  const cancelPlayCard = useCallback(() => {
    dispatch({ type: "CANCEL_PLAY_CARD" });
  }, []);
  const setTrap = useCallback((player: Player, instanceId: string) => {
    dispatch({ type: "SET_TRAP", player, instanceId });
  }, []);

  return {
    state,
    chargeMana,
    drawCard,
    beginPlayCard,
    confirmPlayCard,
    cancelPlayCard,
    setTrap,
  };
}

export type UseMockCardState = ReturnType<typeof useMockCardState>;
export type { CardInstance };
