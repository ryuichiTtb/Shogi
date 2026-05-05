import { createInitialGameState } from "@/lib/shogi/board";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";
import { MANA_CAP } from "@/lib/shogi/cards/definitions";
import type { CardGameState, CardId, CardInstance, TrapInstance } from "@/lib/shogi/cards/types";
import type { GameState, Hand } from "@/lib/shogi/types";

export type CardShogiLayoutScenario =
  | "initial"
  | "progress1"
  | "progress4"
  | "many-hands"
  | "captured"
  | "trap"
  | "drawer"
  | "end";

export const CARD_SHOGI_LAYOUT_SCENARIOS: CardShogiLayoutScenario[] = [
  "initial",
  "progress1",
  "progress4",
  "many-hands",
  "captured",
  "trap",
  "drawer",
  "end",
];

interface CardShogiLayoutFixture {
  gameState: GameState;
  cardState: CardGameState;
  debugInitialUi: {
    drawerOpen?: boolean;
    endCardMinimized?: boolean;
  };
}

function card(instanceId: string, defId: CardId): CardInstance {
  return { instanceId, defId };
}

function cards(prefix: string, ids: CardId[]): CardInstance[] {
  return ids.map((id, i) => card(`${prefix}-${i + 1}-${id}`, id));
}

function makeDeck(prefix: string, count: number): CardInstance[] {
  const ids: CardId[] = ["pawn_return", "double_pawn", "piece_return", "check_break", "double_move", "no_promote"];
  return Array.from({ length: count }, (_, i) => card(`${prefix}-deck-${i + 1}`, ids[i % ids.length]));
}

function makeCardState(scenario: CardShogiLayoutScenario): CardGameState {
  const manyOwnCards = cards("sente-hand", [
    "pawn_return",
    "double_pawn",
    "piece_return",
    "check_break",
    "double_move",
    "no_promote",
    "pawn_return",
    "double_pawn",
  ]);
  const manyOpponentCards = cards("gote-hand", [
    "pawn_return",
    "double_pawn",
    "piece_return",
    "check_break",
    "double_move",
    "no_promote",
    "pawn_return",
    "double_pawn",
    "piece_return",
    "check_break",
  ]);
  const baseHand = scenario === "many-hands" || scenario === "drawer"
    ? { sente: manyOwnCards, gote: manyOpponentCards }
    : {
        sente: cards("sente-hand", ["pawn_return", "double_pawn", "piece_return"]),
        gote: cards("gote-hand", ["check_break", "double_move", "no_promote"]),
      };
  const trap: TrapInstance | null = scenario === "trap"
    ? { instanceId: "sente-trap-check-break", defId: "check_break", owner: "sente" }
    : null;

  return {
    mana: { sente: 8, gote: 6 },
    manaCap: MANA_CAP,
    hand: baseHand,
    deck: { sente: makeDeck("sente", 18), gote: makeDeck("gote", 18) },
    graveyard: { sente: [], gote: [] },
    trap: { sente: trap, gote: scenario === "trap" ? { instanceId: "gote-trap-no-promote", defId: "no_promote", owner: "gote" } : null },
    pendingCard: null,
    lastTurnStartedAt: { sente: null, gote: null },
    noPromoteMarks: { sente: [], gote: [] },
    drawProgress:
      scenario === "progress4"
        ? { sente: 4, gote: 4 }
        : scenario === "progress1"
          ? { sente: 1, gote: 1 }
          : { sente: 0, gote: 0 },
  };
}

function makeGameState(scenario: CardShogiLayoutScenario): GameState {
  const state = createInitialGameState(CARD_SHOGI_VARIANT);
  state.moveCount = scenario === "initial" ? 0 : 24;
  state.currentPlayer = "sente";

  if (scenario === "captured" || scenario === "many-hands" || scenario === "drawer") {
    state.hand = {
      sente: { pawn: 4, gold: 1, silver: 1, bishop: 1 },
      gote: { pawn: 3, lance: 1, knight: 1, rook: 1 },
    } satisfies Hand;
  }

  if (scenario === "end") {
    state.status = "resign";
    state.winner = "sente";
  }

  return state;
}

export function normalizeCardShogiLayoutScenario(value: unknown): CardShogiLayoutScenario {
  if (typeof value !== "string") return "initial";
  return CARD_SHOGI_LAYOUT_SCENARIOS.includes(value as CardShogiLayoutScenario)
    ? (value as CardShogiLayoutScenario)
    : "initial";
}

export function getCardShogiLayoutFixture(scenario: CardShogiLayoutScenario): CardShogiLayoutFixture {
  return {
    gameState: makeGameState(scenario),
    cardState: makeCardState(scenario),
    debugInitialUi: {
      drawerOpen: scenario === "drawer",
      endCardMinimized: false,
    },
  };
}
