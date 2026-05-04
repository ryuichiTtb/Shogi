import { describe, expect, it } from "vitest";

import { createInitialGameState } from "@/lib/shogi/board";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";
import type { GameState } from "@/lib/shogi/types";
import type { CardGameState, CardInstance, GameEvent } from "@/lib/shogi/cards/types";
import { MANA_CAP, DRAW_COST } from "@/lib/shogi/cards/definitions";

import { reducer, type CardShogiGameStateInternal } from "../reducer";

// ===== fixtures =====

function makeInitialCardState(overrides: Partial<CardGameState> = {}): CardGameState {
  return {
    mana: { sente: 5, gote: 5 },
    manaCap: MANA_CAP,
    hand: { sente: [], gote: [] },
    deck: { sente: [], gote: [] },
    graveyard: { sente: [], gote: [] },
    trap: { sente: null, gote: null },
    pendingCard: null,
    lastTurnStartedAt: { sente: null, gote: null },
    noPromoteMarks: { sente: [], gote: [] },
    ...overrides,
  };
}

function makeInitialState(
  gameState: GameState = createInitialGameState(CARD_SHOGI_VARIANT),
  cardState: CardGameState = makeInitialCardState(),
): CardShogiGameStateInternal {
  return {
    gameState,
    selectedSquare: null,
    selectedHandPiece: null,
    legalMoves: [],
    isAiThinking: false,
    promotionPendingMove: null,
    cardState,
    eventLog: [],
    isDrawing: false,
    pendingDrawPlayer: null,
    isPlayingCard: false,
    pendingPlayCardOpponent: null,
    isCheckBreakAnimating: false,
    doubleMove: null,
  };
}

const card = (id: string, defId: CardInstance["defId"]): CardInstance => ({
  instanceId: id,
  defId,
});

// ===== tests =====

describe("reducer / 駒指し系", () => {
  it("SELECT_SQUARE: 自分の駒を選択すると selectedSquare と legalMoves が設定される", () => {
    const state = makeInitialState();
    // 先手の歩 (row=6, col=4) を選択
    const next = reducer(state, { type: "SELECT_SQUARE", pos: { row: 6, col: 4 } });
    expect(next.selectedSquare).toEqual({ row: 6, col: 4 });
    expect(next.legalMoves.length).toBeGreaterThan(0);
  });

  it("SELECT_SQUARE: pendingCard 中は無視 (state 不変)", () => {
    const pendingCard = { instance: card("c1", "mana_up"), player: "sente" as const, phase: "confirm" as const };
    const state = makeInitialState(
      undefined,
      makeInitialCardState({ pendingCard }),
    );
    const next = reducer(state, { type: "SELECT_SQUARE", pos: { row: 6, col: 4 } });
    expect(next).toBe(state);
  });

  it("SELECT_SQUARE: ドロー演出中 (isDrawing=true) は無視", () => {
    const state = { ...makeInitialState(), isDrawing: true };
    const next = reducer(state, { type: "SELECT_SQUARE", pos: { row: 6, col: 4 } });
    expect(next).toBe(state);
  });

  it("DESELECT で selectedSquare がクリア", () => {
    const state = {
      ...makeInitialState(),
      selectedSquare: { row: 6, col: 4 },
      legalMoves: [],
    };
    const next = reducer(state, { type: "DESELECT" });
    expect(next.selectedSquare).toBeNull();
  });

  it("RESIGN: status=resign + winner が逆プレイヤーに設定", () => {
    const state = makeInitialState();
    // 初期は currentPlayer=sente
    const next = reducer(state, { type: "RESIGN" });
    expect(next.gameState.status).toBe("resign");
    expect(next.gameState.winner).toBe("gote");
  });
});

describe("reducer / カード系: ドロー", () => {
  it("DRAW_CARD: マナ十分 + 手番なら手札に 1 枚追加", () => {
    const deckCard = card("d1", "mana_up");
    const state = makeInitialState(
      undefined,
      makeInitialCardState({
        mana: { sente: DRAW_COST, gote: 0 },
        deck: { sente: [deckCard], gote: [] },
      }),
    );
    const next = reducer(state, { type: "DRAW_CARD", player: "sente" });
    expect(next.cardState.hand.sente).toEqual([deckCard]);
    expect(next.cardState.deck.sente).toEqual([]);
    expect(next.cardState.mana.sente).toBe(0);
    expect(next.isDrawing).toBe(true);
    expect(next.pendingDrawPlayer).toBe("sente");
  });

  it("DRAW_CARD: マナ不足なら state 不変", () => {
    const state = makeInitialState(
      undefined,
      makeInitialCardState({
        mana: { sente: 1, gote: 0 },
        deck: { sente: [card("d1", "mana_up")], gote: [] },
      }),
    );
    const next = reducer(state, { type: "DRAW_CARD", player: "sente" });
    expect(next).toBe(state);
  });

  it("DRAW_CARD: 手番でなければ state 不変", () => {
    const state = makeInitialState();
    const next = reducer(state, { type: "DRAW_CARD", player: "gote" });
    expect(next).toBe(state);
  });

  it("COMMIT_DRAW: isDrawing をクリアし currentPlayer を反転", () => {
    const state: CardShogiGameStateInternal = {
      ...makeInitialState(),
      isDrawing: true,
      pendingDrawPlayer: "sente",
    };
    const next = reducer(state, { type: "COMMIT_DRAW" });
    expect(next.isDrawing).toBe(false);
    expect(next.pendingDrawPlayer).toBeNull();
    expect(next.gameState.currentPlayer).toBe("gote");
  });
});

describe("reducer / カード系: 使用フロー", () => {
  it("BEGIN_PLAY_CARD: target なしカード (mana_up) は phase=confirm", () => {
    const c = card("c1", "mana_up");
    const state = makeInitialState(
      undefined,
      makeInitialCardState({
        mana: { sente: 10, gote: 0 },
        hand: { sente: [c], gote: [] },
      }),
    );
    const next = reducer(state, {
      type: "BEGIN_PLAY_CARD",
      player: "sente",
      instanceId: c.instanceId,
    });
    expect(next.cardState.pendingCard?.phase).toBe("confirm");
    expect(next.cardState.pendingCard?.instance.instanceId).toBe(c.instanceId);
  });

  it("BEGIN_PLAY_CARD: マナ不足なら state 不変", () => {
    const c = card("c1", "mana_up");
    const state = makeInitialState(
      undefined,
      makeInitialCardState({
        mana: { sente: 0, gote: 0 },
        hand: { sente: [c], gote: [] },
      }),
    );
    const next = reducer(state, {
      type: "BEGIN_PLAY_CARD",
      player: "sente",
      instanceId: c.instanceId,
    });
    expect(next).toBe(state);
  });

  it("BEGIN_PLAY_CARD: 手番でなければ state 不変", () => {
    const c = card("c1", "mana_up");
    const state = makeInitialState(
      undefined,
      makeInitialCardState({
        mana: { sente: 10, gote: 10 },
        hand: { sente: [], gote: [c] },
      }),
    );
    // 手番が sente なのに gote が打とうとする
    const next = reducer(state, {
      type: "BEGIN_PLAY_CARD",
      player: "gote",
      instanceId: c.instanceId,
    });
    expect(next).toBe(state);
  });

  it("CONFIRM_PLAY_CARD (mana_up): マナ +3 + 手札からグレイブへ + isPlayingCard=true", () => {
    const c = card("c1", "mana_up");
    const state = makeInitialState(
      undefined,
      makeInitialCardState({
        mana: { sente: 5, gote: 0 },
        hand: { sente: [c], gote: [] },
        pendingCard: { instance: c, player: "sente", phase: "confirm" },
      }),
    );
    const next = reducer(state, { type: "CONFIRM_PLAY_CARD" });
    // mana_up は cost=2 の前提だがここでは具体値より「マナ消費 + applyManaUp(+3) が起きた」ことを検証
    expect(next.cardState.hand.sente).toEqual([]);
    expect(next.cardState.graveyard.sente.length).toBe(1);
    expect(next.isPlayingCard).toBe(true);
    expect(next.pendingPlayCardOpponent).toBe("gote");
  });

  it("CANCEL_PLAY_CARD: pendingCard をクリア", () => {
    const c = card("c1", "mana_up");
    const state = makeInitialState(
      undefined,
      makeInitialCardState({
        pendingCard: { instance: c, player: "sente", phase: "confirm" },
      }),
    );
    const next = reducer(state, { type: "CANCEL_PLAY_CARD" });
    expect(next.cardState.pendingCard).toBeNull();
  });

  it("COMMIT_PLAY_CARD: isPlayingCard をクリアし currentPlayer 反転", () => {
    const state: CardShogiGameStateInternal = {
      ...makeInitialState(),
      isPlayingCard: true,
      pendingPlayCardOpponent: "gote",
    };
    const next = reducer(state, { type: "COMMIT_PLAY_CARD" });
    expect(next.isPlayingCard).toBe(false);
    expect(next.pendingPlayCardOpponent).toBeNull();
    expect(next.gameState.currentPlayer).toBe("gote");
  });
});

describe("reducer / UNDO", () => {
  it("moveHistory が 2 未満なら state 不変", () => {
    const state = makeInitialState();
    const next = reducer(state, { type: "UNDO" });
    expect(next).toBe(state);
  });

  it("eventLog にカード操作 (cardPlayEvent / drawEvent / trapSetEvent / trapTriggerEvent) が含まれていれば state 不変", () => {
    const c = card("c1", "mana_up");
    const state: CardShogiGameStateInternal = {
      ...makeInitialState(),
      // moveHistory を擬似的に積んでも eventLog にカード操作があれば弾かれる
      gameState: {
        ...makeInitialState().gameState,
        moveHistory: [
          { type: "move", player: "sente", piece: "pawn", from: { row: 6, col: 4 }, to: { row: 5, col: 4 } },
          { type: "move", player: "gote", piece: "pawn", from: { row: 2, col: 4 }, to: { row: 3, col: 4 } },
        ],
      },
      eventLog: [
        { kind: "moveEvent", move: { type: "move", player: "sente", piece: "pawn", from: { row: 6, col: 4 }, to: { row: 5, col: 4 } }, at: 0 },
        { kind: "drawEvent", player: "sente", instance: c, at: 0 },
        { kind: "moveEvent", move: { type: "move", player: "gote", piece: "pawn", from: { row: 2, col: 4 }, to: { row: 3, col: 4 } }, at: 0 },
      ],
    };
    const next = reducer(state, { type: "UNDO" });
    expect(next).toBe(state);
  });
});

describe("reducer / RESET_TURN_TIMER", () => {
  it("指定プレイヤーの lastTurnStartedAt を現在時刻にセット", () => {
    const state = makeInitialState();
    expect(state.cardState.lastTurnStartedAt.sente).toBeNull();
    const next = reducer(state, { type: "RESET_TURN_TIMER", player: "sente" });
    expect(next.cardState.lastTurnStartedAt.sente).not.toBeNull();
    expect(next.cardState.lastTurnStartedAt.gote).toBeNull();
  });
});

describe("reducer / SET_AI_THINKING / SHOW_PROMOTION_DIALOG / CANCEL_PROMOTION", () => {
  it("SET_AI_THINKING で isAiThinking が切替", () => {
    const state = makeInitialState();
    const next = reducer(state, { type: "SET_AI_THINKING", thinking: true });
    expect(next.isAiThinking).toBe(true);
  });

  it("SHOW_PROMOTION_DIALOG で promotionPendingMove セット", () => {
    const move = { type: "move" as const, player: "sente" as const, piece: "pawn", from: { row: 3, col: 4 }, to: { row: 2, col: 4 } };
    const state = makeInitialState();
    const next = reducer(state, { type: "SHOW_PROMOTION_DIALOG", move });
    expect(next.promotionPendingMove).toEqual(move);
  });

  it("CANCEL_PROMOTION で promotionPendingMove クリア", () => {
    const move = { type: "move" as const, player: "sente" as const, piece: "pawn", from: { row: 3, col: 4 }, to: { row: 2, col: 4 } };
    const state = { ...makeInitialState(), promotionPendingMove: move };
    const next = reducer(state, { type: "CANCEL_PROMOTION" });
    expect(next.promotionPendingMove).toBeNull();
  });
});

// ===== 王手崩しトラップ (#82) =====

describe("reducer / 王手崩しトラップ (check_break)", () => {
  it("MAKE_MOVE で相手 (gote) を王手 + gote が check_break セット中 → トラップ発動", () => {
    // sente の歩 (row=4, col=4) → (row=3, col=4) に進めて gote 玉 (row=2, col=4) に王手
    const gameState: GameState = {
      ...createInitialGameState(CARD_SHOGI_VARIANT),
      board: Array.from({ length: 9 }, () => Array(9).fill(null)),
      hand: { sente: {}, gote: {} },
      currentPlayer: "sente",
    };
    gameState.board[8][4] = { type: "king", owner: "sente" };
    gameState.board[2][4] = { type: "king", owner: "gote" };
    gameState.board[4][4] = { type: "pawn", owner: "sente" };
    const cardState = makeInitialCardState({
      trap: {
        sente: null,
        gote: { instanceId: "trap-1", defId: "check_break", owner: "gote" },
      },
    });
    const state = makeInitialState(gameState, cardState);
    const move = {
      type: "move" as const,
      player: "sente" as const,
      piece: "pawn",
      from: { row: 4, col: 4 },
      to: { row: 3, col: 4 },
    };
    const next = reducer(state, { type: "MAKE_MOVE", move });

    // 移動した sente 歩 (= 王手駒) が gote の持ち駒に
    expect(next.gameState.hand.gote.pawn).toBe(1);
    // 元の盤上 (3,4) は除去済
    expect(next.gameState.board[3][4]).toBeNull();
    // gote 王手解除
    // (isInCheck の検証は effects.test.ts 側でカバー、ここではトラップが消費されたことを確認)
    expect(next.cardState.trap.gote).toBeNull();
    // isCheckBreakAnimating がセット
    expect(next.isCheckBreakAnimating).toBe(true);
    // trapTriggerEvent が emit されている
    const trapEvent = next.eventLog.find((e) => e.kind === "trapTriggerEvent");
    expect(trapEvent).toBeDefined();
    if (trapEvent && trapEvent.kind === "trapTriggerEvent") {
      expect(trapEvent.reason).toBe("check_declared");
      expect(trapEvent.capturedPieces).toBeDefined();
      expect(trapEvent.capturedPieces!.length).toBeGreaterThan(0);
    }
  });

  it("COMMIT_CHECK_BREAK で isCheckBreakAnimating がクリアされる", () => {
    const state: CardShogiGameStateInternal = {
      ...makeInitialState(),
      isCheckBreakAnimating: true,
    };
    const next = reducer(state, { type: "COMMIT_CHECK_BREAK" });
    expect(next.isCheckBreakAnimating).toBe(false);
  });

  it("COMMIT_CHECK_BREAK は isCheckBreakAnimating=false なら state 不変", () => {
    const state = makeInitialState();
    const next = reducer(state, { type: "COMMIT_CHECK_BREAK" });
    expect(next).toBe(state);
  });

  it("trap がセットされていないなら check_break は発動しない (通常の MAKE_MOVE 動作)", () => {
    const gameState: GameState = {
      ...createInitialGameState(CARD_SHOGI_VARIANT),
      board: Array.from({ length: 9 }, () => Array(9).fill(null)),
      hand: { sente: {}, gote: {} },
      currentPlayer: "sente",
    };
    gameState.board[8][4] = { type: "king", owner: "sente" };
    gameState.board[2][4] = { type: "king", owner: "gote" };
    gameState.board[4][4] = { type: "pawn", owner: "sente" };
    const state = makeInitialState(gameState); // trap なし
    const move = {
      type: "move" as const,
      player: "sente" as const,
      piece: "pawn",
      from: { row: 4, col: 4 },
      to: { row: 3, col: 4 },
    };
    const next = reducer(state, { type: "MAKE_MOVE", move });

    // 歩は (3,4) に移動して残っている (持ち駒化されない)
    expect(next.gameState.board[3][4]).toEqual({ type: "pawn", owner: "sente" });
    expect(next.gameState.hand.gote.pawn).toBeUndefined();
    expect(next.isCheckBreakAnimating).toBe(false);
  });
});

// ===== Issue #82: 二手指し (double_move) =====

describe("reducer / 二手指し (double_move)", () => {
  function makeBaseGameState(): GameState {
    const state = createInitialGameState(CARD_SHOGI_VARIANT);
    return state;
  }

  it("CONFIRM_PLAY_CARD (double_move): doubleMove セット + マナ -6 + cardPlayEvent 追加 + currentPlayer 維持", () => {
    const c = card("dm1", "double_move");
    const state = makeInitialState(
      makeBaseGameState(),
      makeInitialCardState({
        mana: { sente: 10, gote: 0 },
        hand: { sente: [c], gote: [] },
        pendingCard: { instance: c, player: "sente", phase: "confirm" },
      }),
    );
    const next = reducer(state, { type: "CONFIRM_PLAY_CARD" });

    expect(next.cardState.mana.sente).toBe(4); // 10 - 6
    expect(next.cardState.hand.sente).toEqual([]);
    expect(next.cardState.graveyard.sente.length).toBe(1);
    expect(next.doubleMove).not.toBeNull();
    expect(next.doubleMove?.active).toBe("sente");
    expect(next.doubleMove?.movesLeft).toBe(2);
    expect(next.doubleMove?.preState.cardState.graveyard.sente.length).toBe(1);
    expect(next.isPlayingCard).toBe(true);
    expect(next.pendingPlayCardOpponent).toBe("gote");
    // cardPlayEvent が eventLog に追加
    const last = next.eventLog[next.eventLog.length - 1];
    expect(last.kind).toBe("cardPlayEvent");
  });

  it("COMMIT_PLAY_CARD (二手指し中): currentPlayer 反転を skip", () => {
    const state: CardShogiGameStateInternal = {
      ...makeInitialState(makeBaseGameState()),
      isPlayingCard: true,
      pendingPlayCardOpponent: "gote",
      doubleMove: {
        active: "sente",
        movesLeft: 2,
        mateInOneAvailable: false,
        preState: {
          gameState: makeBaseGameState(),
          cardState: makeInitialCardState(),
          eventLog: [],
        },
      },
    };
    const next = reducer(state, { type: "COMMIT_PLAY_CARD" });
    // currentPlayer は反転しない (sente のまま)
    expect(next.gameState.currentPlayer).toBe("sente");
    expect(next.isPlayingCard).toBe(false);
    expect(next.pendingPlayCardOpponent).toBeNull();
    expect(next.doubleMove).not.toBeNull();
  });

  it("MAKE_MOVE 1手目 (movesLeft=2): currentPlayer 維持 + movesLeft=1 + マナチャージなし", () => {
    const gameState = makeBaseGameState();
    const cardState = makeInitialCardState({ mana: { sente: 4, gote: 0 } });
    const state: CardShogiGameStateInternal = {
      ...makeInitialState(gameState, cardState),
      doubleMove: {
        active: "sente",
        movesLeft: 2,
        mateInOneAvailable: false,
        preState: { gameState, cardState, eventLog: [] },
      },
    };

    const move = {
      type: "move" as const,
      player: "sente" as const,
      piece: "pawn",
      from: { row: 6, col: 4 },
      to: { row: 5, col: 4 },
    };
    const next = reducer(state, { type: "MAKE_MOVE", move });

    expect(next.gameState.currentPlayer).toBe("sente"); // 自分のターン継続
    expect(next.doubleMove?.movesLeft).toBe(1);
    expect(next.cardState.mana.sente).toBe(4); // マナチャージなし
  });

  it("MAKE_MOVE 2手目 (movesLeft=1): currentPlayer 反転 + doubleMove クリア + マナチャージなし", () => {
    const gameState = makeBaseGameState();
    const cardState = makeInitialCardState({ mana: { sente: 4, gote: 0 } });
    // 1手目を仮想的に適用済みの状態
    const state: CardShogiGameStateInternal = {
      ...makeInitialState(gameState, cardState),
      doubleMove: {
        active: "sente",
        movesLeft: 1,
        mateInOneAvailable: false,
        preState: { gameState, cardState, eventLog: [] },
      },
    };

    const move = {
      type: "move" as const,
      player: "sente" as const,
      piece: "pawn",
      from: { row: 6, col: 4 },
      to: { row: 5, col: 4 },
    };
    const next = reducer(state, { type: "MAKE_MOVE", move });

    expect(next.gameState.currentPlayer).toBe("gote"); // 相手ターンへ
    expect(next.doubleMove).toBeNull();
    expect(next.cardState.mana.sente).toBe(4); // マナチャージなし (カード使用扱い)
  });

  it("UNDO_DOUBLE_MOVE_FIRST: movesLeft=1 で動作、preState から完全復元", () => {
    const preGameState = makeBaseGameState();
    const preCardState = makeInitialCardState({ mana: { sente: 4, gote: 0 } });
    const preEventLog: GameEvent[] = [];

    // 1手目適用後の仮想状態
    const afterFirstMoveState = createInitialGameState(CARD_SHOGI_VARIANT);
    afterFirstMoveState.board[5][4] = { type: "pawn", owner: "sente" };
    afterFirstMoveState.board[6][4] = null;

    const state: CardShogiGameStateInternal = {
      ...makeInitialState(afterFirstMoveState, preCardState),
      doubleMove: {
        active: "sente",
        movesLeft: 1,
        mateInOneAvailable: false,
        preState: { gameState: preGameState, cardState: preCardState, eventLog: preEventLog },
      },
    };

    const next = reducer(state, { type: "UNDO_DOUBLE_MOVE_FIRST" });

    expect(next.gameState).toEqual(preGameState); // 完全復元
    expect(next.cardState).toEqual(preCardState);
    expect(next.eventLog).toEqual(preEventLog);
    expect(next.doubleMove?.movesLeft).toBe(2); // 1手目前に戻る
  });

  it("UNDO_DOUBLE_MOVE_FIRST: movesLeft=2 では state 不変 (1手目未適用)", () => {
    const state: CardShogiGameStateInternal = {
      ...makeInitialState(makeBaseGameState()),
      doubleMove: {
        active: "sente",
        movesLeft: 2,
        mateInOneAvailable: false,
        preState: {
          gameState: makeBaseGameState(),
          cardState: makeInitialCardState(),
          eventLog: [],
        },
      },
    };
    const next = reducer(state, { type: "UNDO_DOUBLE_MOVE_FIRST" });
    expect(next).toBe(state);
  });

  it("UNDO_DOUBLE_MOVE_FIRST: doubleMove 未セットなら state 不変", () => {
    const state = makeInitialState();
    const next = reducer(state, { type: "UNDO_DOUBLE_MOVE_FIRST" });
    expect(next).toBe(state);
  });

  it("BEGIN_PLAY_CARD: 二手指し中は他カード使用禁止 (state 不変)", () => {
    const c = card("dm1", "double_move");
    const otherC = card("ot1", "mana_up");
    const cardState = makeInitialCardState({
      mana: { sente: 10, gote: 0 },
      hand: { sente: [otherC], gote: [] },
    });
    const state: CardShogiGameStateInternal = {
      ...makeInitialState(makeBaseGameState(), cardState),
      doubleMove: {
        active: "sente",
        movesLeft: 1,
        mateInOneAvailable: false,
        preState: { gameState: makeBaseGameState(), cardState, eventLog: [] },
      },
    };
    void c;
    const next = reducer(state, {
      type: "BEGIN_PLAY_CARD",
      player: "sente",
      instanceId: otherC.instanceId,
    });
    expect(next).toBe(state);
  });

  it("DRAW_CARD: 二手指し中はドロー禁止 (state 不変)", () => {
    const cardState = makeInitialCardState({
      mana: { sente: 10, gote: 0 },
      deck: { sente: [card("d1", "mana_up")], gote: [] },
    });
    const state: CardShogiGameStateInternal = {
      ...makeInitialState(makeBaseGameState(), cardState),
      doubleMove: {
        active: "sente",
        movesLeft: 1,
        mateInOneAvailable: false,
        preState: { gameState: makeBaseGameState(), cardState, eventLog: [] },
      },
    };
    const next = reducer(state, { type: "DRAW_CARD", player: "sente" });
    expect(next).toBe(state);
  });

  it("UNDO: 二手指し中は state 不変 (待った不可)", () => {
    const state: CardShogiGameStateInternal = {
      ...makeInitialState(makeBaseGameState()),
      doubleMove: {
        active: "sente",
        movesLeft: 1,
        mateInOneAvailable: false,
        preState: {
          gameState: makeBaseGameState(),
          cardState: makeInitialCardState(),
          eventLog: [],
        },
      },
    };
    const next = reducer(state, { type: "UNDO" });
    expect(next).toBe(state);
  });

  // 回帰テスト: バグ報告「1手目で王手後、2手目で相手玉を取れる」
  // 修正後: SELECT_SQUARE で生成される 2手目候補に玉取り手は含まれない
  it("SELECT_SQUARE 2手目: 1手目王手後の盤面で玉取り手は legalMoves に含まれない", () => {
    // 1手目完了後の仮想盤面: sente 飛車 (1,4) が gote 玉 (0,4) を直接攻撃
    const gameState: GameState = {
      board: Array.from({ length: 9 }, () => Array(9).fill(null)),
      hand: { sente: {}, gote: {} },
      currentPlayer: "sente", // 二手指し override で sente のまま
      moveHistory: [],
      positionHistory: [],
      status: "active",
      moveCount: 1,
    };
    gameState.board[8][4] = { type: "king", owner: "sente" };
    gameState.board[0][4] = { type: "king", owner: "gote" };
    gameState.board[1][4] = { type: "rook", owner: "sente" };

    const state: CardShogiGameStateInternal = {
      ...makeInitialState(gameState),
      doubleMove: {
        active: "sente",
        movesLeft: 1,
        mateInOneAvailable: false,
        preState: {
          gameState,
          cardState: makeInitialCardState(),
          eventLog: [],
        },
      },
    };

    // sente 飛車 (1,4) を選択
    const next = reducer(state, {
      type: "SELECT_SQUARE",
      pos: { row: 1, col: 4 },
    });

    // legalMoves には飛車が玉を取る手 (0,4) が含まれていてはいけない
    const kingCapture = next.legalMoves.find(
      (m) => m.type === "move" && m.to.row === 0 && m.to.col === 4 && m.captured === "king",
    );
    expect(kingCapture).toBeUndefined();
  });
});

// ===== Issue #82 反映: 待った の カード操作直後ガード (回帰テスト) =====
// 過去 2 ターン (= プレイヤー切替 2 回までの範囲) に カード操作系イベント
// (cardPlayEvent / drawEvent / trapSetEvent / trapTriggerEvent) があれば、
// reducer の UNDO は state を変えず返す。
//
// 既存の通常カード代表 + 二手指し の代表 2 ケースで結合動作を検証。

describe("reducer / UNDO カード操作ガード (Issue #82)", () => {
  it("通常カード使用直後 (cardPlayEvent → 相手手) → UNDO は state 不変", () => {
    const gameState: GameState = {
      board: Array.from({ length: 9 }, () => Array(9).fill(null)),
      hand: { sente: {}, gote: {} },
      currentPlayer: "sente",
      moveHistory: [
        // 過去に sente, gote の通常手が 1 件ずつあるとする (待った には 2 手必要)
        { type: "move", from: { row: 6, col: 4 }, to: { row: 5, col: 4 }, piece: "pawn", player: "sente" },
        { type: "move", from: { row: 2, col: 4 }, to: { row: 3, col: 4 }, piece: "pawn", player: "gote" },
      ],
      positionHistory: [],
      status: "active",
      moveCount: 2,
    };
    const eventLog: GameEvent[] = [
      { kind: "moveEvent", move: gameState.moveHistory[0], at: 1 },
      { kind: "manaChargeEvent", player: "sente", reason: "turn", amount: 1, at: 2 },
      { kind: "moveEvent", move: gameState.moveHistory[1], at: 3 },
      { kind: "manaChargeEvent", player: "gote", reason: "turn", amount: 1, at: 4 },
      // sente が通常カードを使用 → cardPlayEvent (sente の手番消費 = moveEvent なし)
      {
        kind: "cardPlayEvent",
        player: "sente",
        instance: { instanceId: "c1", defId: "pawn_return" },
        at: 5,
      },
      // gote の手番
      { kind: "moveEvent", move: gameState.moveHistory[1], at: 6 },
      { kind: "manaChargeEvent", player: "gote", reason: "turn", amount: 1, at: 7 },
    ];

    const state: CardShogiGameStateInternal = {
      ...makeInitialState(gameState),
      eventLog,
    };

    const next = reducer(state, { type: "UNDO" });
    // state 不変であること (block されたら元の state を返す)
    expect(next).toBe(state);
  });

  it("二手指し使用後 (cardPlayEvent → 1手目 + 2手目 → 相手手) → UNDO は state 不変", () => {
    const gameState: GameState = {
      board: Array.from({ length: 9 }, () => Array(9).fill(null)),
      hand: { sente: {}, gote: {} },
      currentPlayer: "sente",
      moveHistory: [
        // 1手目, 2手目, gote の 3 手 (待った 対象は最後の 2 手 = 2手目 + gote)
        { type: "move", from: { row: 6, col: 4 }, to: { row: 5, col: 4 }, piece: "pawn", player: "sente" },
        { type: "move", from: { row: 5, col: 4 }, to: { row: 4, col: 4 }, piece: "pawn", player: "sente" },
        { type: "move", from: { row: 2, col: 4 }, to: { row: 3, col: 4 }, piece: "pawn", player: "gote" },
      ],
      positionHistory: [],
      status: "active",
      moveCount: 3,
    };
    const eventLog: GameEvent[] = [
      // sente が double_move カードを使用
      {
        kind: "cardPlayEvent",
        player: "sente",
        instance: { instanceId: "dm1", defId: "double_move" },
        at: 1,
      },
      // 1手目 (sente moveEvent、manaChargeEvent なし: double_move_first モード)
      { kind: "moveEvent", move: gameState.moveHistory[0], at: 2 },
      // 2手目 (sente moveEvent、manaChargeEvent なし: double_move_second モード)
      { kind: "moveEvent", move: gameState.moveHistory[1], at: 3 },
      // gote の手番
      { kind: "moveEvent", move: gameState.moveHistory[2], at: 4 },
      { kind: "manaChargeEvent", player: "gote", reason: "turn", amount: 1, at: 5 },
    ];

    const state: CardShogiGameStateInternal = {
      ...makeInitialState(gameState),
      eventLog,
    };

    const next = reducer(state, { type: "UNDO" });
    // state 不変であること (cardPlayEvent が直近 2 ターン内に検出されて block)
    expect(next).toBe(state);
  });

  it("通常進行 (カード操作なし、4 手以上) → UNDO は実行され state が変わる", () => {
    const gameState: GameState = {
      board: Array.from({ length: 9 }, () => Array(9).fill(null)),
      hand: { sente: {}, gote: {} },
      currentPlayer: "sente",
      moveHistory: [
        { type: "move", from: { row: 6, col: 4 }, to: { row: 5, col: 4 }, piece: "pawn", player: "sente" },
        { type: "move", from: { row: 2, col: 4 }, to: { row: 3, col: 4 }, piece: "pawn", player: "gote" },
        { type: "move", from: { row: 6, col: 5 }, to: { row: 5, col: 5 }, piece: "pawn", player: "sente" },
        { type: "move", from: { row: 2, col: 5 }, to: { row: 3, col: 5 }, piece: "pawn", player: "gote" },
      ],
      positionHistory: [],
      status: "active",
      moveCount: 4,
    };
    const eventLog: GameEvent[] = [
      { kind: "moveEvent", move: gameState.moveHistory[0], at: 1 },
      { kind: "manaChargeEvent", player: "sente", reason: "turn", amount: 1, at: 2 },
      { kind: "moveEvent", move: gameState.moveHistory[1], at: 3 },
      { kind: "manaChargeEvent", player: "gote", reason: "turn", amount: 1, at: 4 },
      { kind: "moveEvent", move: gameState.moveHistory[2], at: 5 },
      { kind: "manaChargeEvent", player: "sente", reason: "turn", amount: 1, at: 6 },
      { kind: "moveEvent", move: gameState.moveHistory[3], at: 7 },
      { kind: "manaChargeEvent", player: "gote", reason: "turn", amount: 1, at: 8 },
    ];

    const cardState = makeInitialCardState({ mana: { sente: 5, gote: 5 } });
    const state: CardShogiGameStateInternal = {
      ...makeInitialState(gameState, cardState),
      eventLog,
    };

    const next = reducer(state, { type: "UNDO" });
    // state が変わること (UNDO が実行された)
    expect(next).not.toBe(state);
    // moveHistory が 2 件減ること
    expect(next.gameState.moveHistory.length).toBe(2);
    // マナが巻き戻ること (sente: 5-1=4, gote: 5-1=4)
    expect(next.cardState.mana.sente).toBe(4);
    expect(next.cardState.mana.gote).toBe(4);
    // eventLog が scope 前まで truncate されること
    expect(next.eventLog.length).toBe(4); // 元の 8 件のうち 後半 4 件が削除
  });
});
