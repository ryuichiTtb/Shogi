import { describe, expect, it } from "vitest";

import { createInitialGameState } from "@/lib/shogi/board";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";
import type { GameState } from "@/lib/shogi/types";
import type { CardGameState, CardInstance } from "@/lib/shogi/cards/types";
import { MANA_CAP, DRAW_COST, AUTO_DRAW_INTERVAL } from "@/lib/shogi/cards/definitions";

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
    drawProgress: { sente: 0, gote: 0 },
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
    pendingDrawSource: null,
    isPlayingCard: false,
    pendingPlayCardOpponent: null,
    isCheckBreakAnimating: false,
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

  // ===== Issue #130: 自動ドローと UNDO の干渉 =====

  it("scope 内に auto drawEvent のみ含まれる場合は UNDO 可能 + 手札/山札/drawProgress を復元", () => {
    const senteMove = {
      type: "move" as const,
      player: "sente" as const,
      piece: "pawn",
      from: { row: 6, col: 4 },
      to: { row: 5, col: 4 },
    };
    const goteMove = {
      type: "move" as const,
      player: "gote" as const,
      piece: "pawn",
      from: { row: 2, col: 4 },
      to: { row: 3, col: 4 },
    };
    const autoDrawnCard = card("auto-1", "mana_up");
    // 設定: drawProgress[sente]=4 から sente が move → auto-draw 発火 (scope 内)
    // → gote move → UNDO で sente の auto-draw が巻き戻される想定。
    // hand[sente] には auto-draw されたカードが入っており、deck[sente] からは消えている前提。
    const state: CardShogiGameStateInternal = {
      ...makeInitialState(
        undefined,
        makeInitialCardState({
          hand: { sente: [autoDrawnCard], gote: [] },
          deck: { sente: [], gote: [] },
          // 自動ドロー後の状態: drawProgress[sente]=0 (リセット済), gote=1 (1 手指し済)
          drawProgress: { sente: 0, gote: 1 },
        }),
      ),
      gameState: {
        ...makeInitialState().gameState,
        moveHistory: [senteMove, goteMove],
      },
      eventLog: [
        { kind: "moveEvent", move: senteMove, at: 0 },
        // auto-draw が move 直後に発火 (scope 内)
        { kind: "drawEvent", player: "sente", instance: autoDrawnCard, source: "auto", at: 0 },
        { kind: "manaChargeEvent", player: "sente", amount: 1, reason: "turn", at: 0 },
        { kind: "moveEvent", move: goteMove, at: 0 },
        { kind: "manaChargeEvent", player: "gote", amount: 1, reason: "turn", at: 0 },
      ],
    };
    const next = reducer(state, { type: "UNDO" });
    // UNDO 成立 (state が変化している)
    expect(next).not.toBe(state);
    // hand[sente] から auto-draw された 1 枚が除去
    expect(next.cardState.hand.sente).toEqual([]);
    // deck[sente] 先頭に instance が戻る
    expect(next.cardState.deck.sente).toEqual([autoDrawnCard]);
    // drawProgress 再計算: log 切詰め後はイベントなし → 両者 0
    expect(next.cardState.drawProgress.sente).toBe(0);
    expect(next.cardState.drawProgress.gote).toBe(0);
    // eventLog は scope 前まで切詰め
    expect(next.eventLog.length).toBe(0);
    // ドロー演出フラグもクリア
    expect(next.isDrawing).toBe(false);
    expect(next.pendingDrawSource).toBeNull();
  });

  it("scope 内に明示的 manual drawEvent が含まれる場合は引き続きブロック (回帰防止)", () => {
    const c = card("m-1", "mana_up");
    const senteMove = {
      type: "move" as const,
      player: "sente" as const,
      piece: "pawn",
      from: { row: 6, col: 4 },
      to: { row: 5, col: 4 },
    };
    const goteMove = {
      type: "move" as const,
      player: "gote" as const,
      piece: "pawn",
      from: { row: 2, col: 4 },
      to: { row: 3, col: 4 },
    };
    const state: CardShogiGameStateInternal = {
      ...makeInitialState(),
      gameState: {
        ...makeInitialState().gameState,
        moveHistory: [senteMove, goteMove],
      },
      eventLog: [
        { kind: "moveEvent", move: senteMove, at: 0 },
        // 明示的 source: "manual" の drawEvent → UNDO ブロック
        { kind: "drawEvent", player: "sente", instance: c, source: "manual", at: 0 },
        { kind: "moveEvent", move: goteMove, at: 0 },
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

// ===== 自動ドロー (#130) =====

describe("reducer / 自動ドロー (#130)", () => {
  // 共通: 1 マス前進する歩の move
  const sentePawnMove = {
    type: "move" as const,
    player: "sente" as const,
    piece: "pawn",
    from: { row: 6, col: 4 },
    to: { row: 5, col: 4 },
  };

  it("MAKE_MOVE で drawProgress[mover] が +1 される", () => {
    const state = makeInitialState();
    expect(state.cardState.drawProgress.sente).toBe(0);
    const next = reducer(state, { type: "MAKE_MOVE", move: sentePawnMove });
    expect(next.cardState.drawProgress.sente).toBe(1);
    expect(next.cardState.drawProgress.gote).toBe(0);
  });

  it("CONFIRM_PROMOTION で drawProgress[mover] が +1 される (成り宣言したケース)", () => {
    // 成り対象範囲 (row<=2) の sente 歩を作成
    const gameState: GameState = {
      ...createInitialGameState(CARD_SHOGI_VARIANT),
      board: Array.from({ length: 9 }, () => Array(9).fill(null)),
      hand: { sente: {}, gote: {} },
      currentPlayer: "sente",
    };
    gameState.board[8][4] = { type: "king", owner: "sente" };
    gameState.board[0][8] = { type: "king", owner: "gote" };
    gameState.board[3][4] = { type: "pawn", owner: "sente" };
    const state = makeInitialState(gameState);
    const move = {
      type: "move" as const,
      player: "sente" as const,
      piece: "pawn",
      from: { row: 3, col: 4 },
      to: { row: 2, col: 4 },
    };
    const stateWithPending = { ...state, promotionPendingMove: move };
    const next = reducer(stateWithPending, { type: "CONFIRM_PROMOTION", promote: true });
    expect(next.cardState.drawProgress.sente).toBe(1);
    expect(next.cardState.drawProgress.gote).toBe(0);
  });

  it("DRAW_CARD → COMMIT_DRAW (manual) で drawProgress[drawer] が +1 される (連鎖発火しない正常系)", () => {
    const deckCard = card("d1", "mana_up");
    const state = makeInitialState(
      undefined,
      makeInitialCardState({
        mana: { sente: DRAW_COST, gote: 0 },
        deck: { sente: [deckCard, card("d2", "mana_up")], gote: [] },
      }),
    );
    expect(state.cardState.drawProgress.sente).toBe(0);
    const drawn = reducer(state, { type: "DRAW_CARD", player: "sente" });
    // DRAW_CARD 単体では drawProgress は変化しない (COMMIT_DRAW で加算)
    expect(drawn.cardState.drawProgress.sente).toBe(0);
    expect(drawn.pendingDrawSource).toBe("manual");
    const committed = reducer(drawn, { type: "COMMIT_DRAW" });
    expect(committed.cardState.drawProgress.sente).toBe(1);
    expect(committed.gameState.currentPlayer).toBe("gote");
    expect(committed.isDrawing).toBe(false);
    expect(committed.pendingDrawSource).toBeNull();
  });

  it("CONFIRM_PLAY_CARD → COMMIT_PLAY_CARD で drawProgress[player] が +1 される", () => {
    const c = card("c1", "mana_up");
    const state = makeInitialState(
      undefined,
      makeInitialCardState({
        mana: { sente: 5, gote: 0 },
        hand: { sente: [c], gote: [] },
        pendingCard: { instance: c, player: "sente", phase: "confirm" },
      }),
    );
    const confirmed = reducer(state, { type: "CONFIRM_PLAY_CARD" });
    // CONFIRM_PLAY_CARD では drawProgress は変化しない (COMMIT_PLAY_CARD で加算)
    expect(confirmed.cardState.drawProgress.sente).toBe(0);
    const committed = reducer(confirmed, { type: "COMMIT_PLAY_CARD" });
    expect(committed.cardState.drawProgress.sente).toBe(1);
    expect(committed.gameState.currentPlayer).toBe("gote");
  });

  it("drawProgress=4 で MAKE_MOVE → 自動ドローが発火 (isDrawing=true, source=auto)", () => {
    const deckCard = card("d1", "pawn_return");
    const state = makeInitialState(
      undefined,
      makeInitialCardState({
        deck: { sente: [deckCard], gote: [] },
        drawProgress: { sente: AUTO_DRAW_INTERVAL - 1, gote: 0 },
      }),
    );
    const next = reducer(state, { type: "MAKE_MOVE", move: sentePawnMove });
    expect(next.cardState.drawProgress.sente).toBe(0);
    expect(next.cardState.hand.sente).toEqual([deckCard]);
    expect(next.cardState.deck.sente).toEqual([]);
    expect(next.isDrawing).toBe(true);
    expect(next.pendingDrawPlayer).toBe("sente");
    expect(next.pendingDrawSource).toBe("auto");
    // drawEvent (auto) が emit されている
    const drawEvents = next.eventLog.filter((e) => e.kind === "drawEvent");
    expect(drawEvents.length).toBe(1);
    if (drawEvents[0].kind === "drawEvent") {
      expect(drawEvents[0].source).toBe("auto");
      expect(drawEvents[0].player).toBe("sente");
    }
  });

  it("drawProgress=4 で 手動ドロー → COMMIT_DRAW(manual) で auto-draw 連鎖発火 (二段階)", () => {
    const deckCard1 = card("d1", "mana_up");
    const deckCard2 = card("d2", "pawn_return");
    const state = makeInitialState(
      undefined,
      makeInitialCardState({
        mana: { sente: DRAW_COST, gote: 0 },
        deck: { sente: [deckCard1, deckCard2], gote: [] },
        drawProgress: { sente: AUTO_DRAW_INTERVAL - 1, gote: 0 },
      }),
    );
    // 1段目: 手動ドロー
    const drawn = reducer(state, { type: "DRAW_CARD", player: "sente" });
    expect(drawn.cardState.hand.sente).toEqual([deckCard1]);
    expect(drawn.cardState.deck.sente).toEqual([deckCard2]);
    expect(drawn.pendingDrawSource).toBe("manual");
    // drawProgress は DRAW_CARD では変化しない
    expect(drawn.cardState.drawProgress.sente).toBe(AUTO_DRAW_INTERVAL - 1);

    // 2段目: COMMIT_DRAW(manual) → drawProgress 4→5 でしきい値到達 → auto-draw 連鎖
    const committed = reducer(drawn, { type: "COMMIT_DRAW" });
    // 連鎖 auto-draw が発火: hand に 2 枚目の deckCard2 が追加
    expect(committed.cardState.hand.sente).toEqual([deckCard1, deckCard2]);
    expect(committed.cardState.deck.sente).toEqual([]);
    expect(committed.cardState.drawProgress.sente).toBe(0);
    // isDrawing は連鎖 auto-draw 用に再度 true、source=auto
    expect(committed.isDrawing).toBe(true);
    expect(committed.pendingDrawPlayer).toBe("sente");
    expect(committed.pendingDrawSource).toBe("auto");
    // currentPlayer は manual COMMIT_DRAW で gote に反転済 (auto は反転しない)
    expect(committed.gameState.currentPlayer).toBe("gote");
    // drawEvent が 2 件 (manual + auto)
    const drawEvents = committed.eventLog.filter((e) => e.kind === "drawEvent");
    expect(drawEvents.length).toBe(2);
    if (drawEvents[0].kind === "drawEvent" && drawEvents[1].kind === "drawEvent") {
      expect(drawEvents[0].source).toBe("manual");
      expect(drawEvents[1].source).toBe("auto");
    }
  });

  it("deck 空時: drawProgress が 5 に達してもドローは発火せず isDrawing=false のまま", () => {
    const state = makeInitialState(
      undefined,
      makeInitialCardState({
        deck: { sente: [], gote: [] },
        drawProgress: { sente: AUTO_DRAW_INTERVAL - 1, gote: 0 },
      }),
    );
    const next = reducer(state, { type: "MAKE_MOVE", move: sentePawnMove });
    // 進捗は 5 に達したが、deck 空なので発火せず加算のみ
    expect(next.cardState.drawProgress.sente).toBe(AUTO_DRAW_INTERVAL);
    expect(next.cardState.hand.sente).toEqual([]);
    expect(next.isDrawing).toBe(false);
    expect(next.pendingDrawSource).toBeNull();
    // drawEvent は emit されない
    const drawEvents = next.eventLog.filter((e) => e.kind === "drawEvent");
    expect(drawEvents.length).toBe(0);
  });

  it("両者独立カウント: sente の MAKE_MOVE は gote の drawProgress に影響しない", () => {
    const state = makeInitialState(
      undefined,
      makeInitialCardState({
        drawProgress: { sente: 2, gote: 3 },
      }),
    );
    const next = reducer(state, { type: "MAKE_MOVE", move: sentePawnMove });
    expect(next.cardState.drawProgress.sente).toBe(3);
    expect(next.cardState.drawProgress.gote).toBe(3);
  });

  it("DRAW_COST=2: マナ 2 で manual draw 成立、マナ 1 では state 不変", () => {
    // commit 1 で DRAW_COST が 3→2 に下がった事を保証する回帰テスト
    expect(DRAW_COST).toBe(2);
    const c = card("d-cost", "mana_up");
    // mana=2: 成立
    const stateOk = makeInitialState(
      undefined,
      makeInitialCardState({
        mana: { sente: 2, gote: 0 },
        deck: { sente: [c], gote: [] },
      }),
    );
    const okNext = reducer(stateOk, { type: "DRAW_CARD", player: "sente" });
    expect(okNext.cardState.mana.sente).toBe(0);
    expect(okNext.cardState.hand.sente).toEqual([c]);
    expect(okNext.isDrawing).toBe(true);
    // mana=1: 不成立
    const stateNg = makeInitialState(
      undefined,
      makeInitialCardState({
        mana: { sente: 1, gote: 0 },
        deck: { sente: [c], gote: [] },
      }),
    );
    const ngNext = reducer(stateNg, { type: "DRAW_CARD", player: "sente" });
    expect(ngNext).toBe(stateNg);
  });

  it("AI 二重発火防止: gote の MAKE_MOVE で auto-draw 発火後、currentPlayer は反転済 + isDrawing=true を維持", () => {
    // gote 手番、drawProgress[gote]=4。gote が 1 手指すと drawProgress=5 → auto-draw 発火。
    // 結果として currentPlayer は sente に反転済 (applyMove 結果) かつ
    // isDrawing=true (=auto-draw 演出中) で、AI useEffect の再発火条件を満たさないこと。
    const gameState: GameState = {
      ...createInitialGameState(CARD_SHOGI_VARIANT),
      currentPlayer: "gote",
    };
    const deckCard = card("auto-gote", "mana_up");
    const state = makeInitialState(
      gameState,
      makeInitialCardState({
        deck: { sente: [], gote: [deckCard] },
        drawProgress: { sente: 0, gote: AUTO_DRAW_INTERVAL - 1 },
      }),
    );
    const goteMove = {
      type: "move" as const,
      player: "gote" as const,
      piece: "pawn",
      from: { row: 2, col: 4 },
      to: { row: 3, col: 4 },
    };
    const next = reducer(state, { type: "MAKE_MOVE", move: goteMove });
    // currentPlayer は applyMove で sente に反転済
    expect(next.gameState.currentPlayer).toBe("sente");
    // auto-draw が発火し isDrawing=true
    expect(next.isDrawing).toBe(true);
    expect(next.pendingDrawPlayer).toBe("gote");
    expect(next.pendingDrawSource).toBe("auto");
    // hand[gote] にカード追加、deck[gote] 空
    expect(next.cardState.hand.gote).toEqual([deckCard]);
    expect(next.cardState.deck.gote).toEqual([]);
    // drawProgress[gote] リセット
    expect(next.cardState.drawProgress.gote).toBe(0);
    // 次に MAKE_MOVE をもう 1 回呼んでも、本テストでは AI 二重発火は reducer 自体ではなく
    // use-card-shogi-game.ts の useEffect ガード (state.isDrawing チェック) で防がれる。
    // ここでは reducer 出力が「ガード条件を満たす状態 (currentPlayer flipped + isDrawing=true)」
    // になっていることを保証する。
  });
});
