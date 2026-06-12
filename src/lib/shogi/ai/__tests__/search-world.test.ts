// Issue #235 S4b-2a: WorldState (TurnAction) 並走探索の特性化テスト。
// 計画 §11 の訂正済ゲート: flag OFF = production 完全不変 / flag ON = 新 card-aware 探索の
// correctness (合法手返却・詰み検知・終了・手番ゲート・double_move 除外)。
// 「move-only と byte 等価」は達成不可 (WorldState 探索は per-node cardDigest + applyTurnAction
// で本質的に別物) ゆえ検証しない。
import { describe, it, expect } from "vitest";
import { findBestMove, getWorldLegalActions } from "../search";
import { createSearchContext } from "../search-context";
import { createInitialGameState } from "../../board";
import { CARD_SHOGI_VARIANT } from "../../variants/card-shogi";
import { MANA_CAP } from "../../cards/definitions";
import type { Board, GameState, Piece, Player } from "../../types";
import type { CardGameState, CardInstance } from "../../cards/types";
import type { WorldState } from "../../kernel/world-kernel";

function emptyBoard(): Board {
  return Array.from({ length: 9 }, () =>
    Array.from({ length: 9 }, () => null as Board[number][number]),
  );
}

function pc(type: Piece["type"], owner: Player): Piece {
  return { type, owner };
}

function buildGameState(
  place: (b: Board) => void,
  currentPlayer: Player,
): GameState {
  const board = emptyBoard();
  place(board);
  return {
    board,
    hand: { sente: {}, gote: {} },
    currentPlayer,
    moveHistory: [],
    positionHistory: [],
    status: "active",
    moveCount: 0,
  };
}

function cardState(over: Partial<CardGameState> = {}): CardGameState {
  return {
    mana: { sente: 10, gote: 10 },
    manaCap: MANA_CAP,
    hand: { sente: [], gote: [] },
    deck: { sente: [], gote: [] },
    graveyard: { sente: [], gote: [] },
    trap: { sente: null, gote: null },
    pendingCard: null,
    lastTurnStartedAt: { sente: null, gote: null },
    noPromoteMarks: { sente: [], gote: [] },
    drawProgress: { sente: 0, gote: 0 },
    ...over,
  };
}

const DET_OPTIONS = {
  maxDepth: 3,
  timeLimitMs: 60000, // 大きめ = 固定 depth が必ず完了 (決定論)
  addNoise: 0,
  nearEqualThreshold: 0,
};

function worldCtx(cardDigest?: undefined) {
  return createSearchContext({
    timeLimitMs: DET_OPTIONS.timeLimitMs,
    useTurnActionSearch: true,
    spectatorMode: true,
    cardDigest,
  });
}

describe("S4b-2a: getWorldLegalActions (手番ゲート + double_move 除外)", () => {
  it("自分番ノードは move + draw + card を生成し double_move を除外する", () => {
    const gs = createInitialGameState(CARD_SHOGI_VARIANT); // sente 番、初期盤
    const pawnReturn: CardInstance = { instanceId: "s-pr", defId: "pawn_return" };
    const doubleMove: CardInstance = { instanceId: "s-dm", defId: "double_move" };
    const cs = cardState({
      hand: { sente: [pawnReturn, doubleMove], gote: [] },
      mana: { sente: 12, gote: 12 },
      deck: { sente: [{ instanceId: "d1", defId: "mana_up" }], gote: [] },
    });
    const world: WorldState = { gameState: gs, cardState: cs, doubleMove: null };

    const actions = getWorldLegalActions(world, "sente", CARD_SHOGI_VARIANT);

    expect(actions.some((a) => a.kind === "move")).toBe(true);
    expect(actions.some((a) => a.kind === "draw")).toBe(true);
    expect(
      actions.some((a) => a.kind === "playCard" && a.defId === "pawn_return"),
    ).toBe(true);
    // double_move は 2a 除外
    expect(
      actions.some((a) => a.kind === "playCard" && a.defId === "double_move"),
    ).toBe(false);
  });

  it("王手中の自分番ノードは draw を生成しない (王手放置パス防止、M2 指摘)", () => {
    // 先手玉(4,4) を 後手飛(4,0) が row4 で王手 (間 col1-3 空)。先手は deck/mana 充足。
    const place = (b: Board) => {
      b[4][4] = pc("king", "sente");
      b[4][0] = pc("rook", "gote");
      b[0][0] = pc("king", "gote");
    };
    const gs = buildGameState(place, "sente");
    const cs = cardState({
      mana: { sente: 12, gote: 12 },
      deck: { sente: [{ instanceId: "d1", defId: "mana_up" }], gote: [] },
      drawProgress: { sente: 0, gote: 0 },
    });
    const world: WorldState = { gameState: gs, cardState: cs, doubleMove: null };

    const actions = getWorldLegalActions(world, "sente", CARD_SHOGI_VARIANT);
    // 王手中: draw は生成されない (canDraw 単独なら true だが王手で抑止)。
    expect(actions.some((a) => a.kind === "draw")).toBe(false);
    // 王手回避の move は存在する。
    expect(actions.some((a) => a.kind === "move")).toBe(true);
  });

  it("相手番ノード (player !== rootPlayer) は move のみ (card/draw 抑止 = L-3)", () => {
    const gs = createInitialGameState(CARD_SHOGI_VARIANT); // currentPlayer = sente
    const pawnReturn: CardInstance = { instanceId: "g-pr", defId: "pawn_return" };
    const cs = cardState({
      hand: { sente: [pawnReturn], gote: [] },
      mana: { sente: 12, gote: 12 },
      deck: { sente: [{ instanceId: "d1", defId: "mana_up" }], gote: [] },
    });
    const world: WorldState = { gameState: gs, cardState: cs, doubleMove: null };

    // rootPlayer = gote だが currentPlayer = sente → 相手番扱い → move のみ
    const actions = getWorldLegalActions(world, "gote", CARD_SHOGI_VARIANT);
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.every((a) => a.kind === "move")).toBe(true);
  });
});

describe("S4b-2a: findBestMoveWorld (flag ON correctness)", () => {
  // 頭金詰み: 後手玉(0,4) を 先手金(2,4)→(1,4) で詰ます。金は先手飛(8,4)が支える。
  const placeHeadGoldMate = (b: Board) => {
    b[0][4] = pc("king", "gote");
    b[2][4] = pc("gold", "sente");
    b[8][4] = pc("rook", "sente");
    b[8][8] = pc("king", "sente");
  };

  it("詰み手を発見する (status ベースの詰み検知が効く)", () => {
    const gs = buildGameState(placeHeadGoldMate, "sente");
    const cs = cardState(); // 手札空 = move-only 木
    const result = findBestMove(
      gs,
      "sente",
      DET_OPTIONS,
      CARD_SHOGI_VARIANT,
      worldCtx(),
      cs,
    );
    expect(result).not.toBeNull();
    // 頭金 (2,4)→(1,4) を選ぶ
    expect(result!.move.from).toEqual({ row: 2, col: 4 });
    expect(result!.move.to).toEqual({ row: 1, col: 4 });
  });

  it("無防備な大駒を取る明白な手を選ぶ (探索が機能している)", () => {
    // 先手飛(4,4)が後手金(4,7)を横利きで只取りできる (間に駒なし)。玉は安全圏。
    const place = (b: Board) => {
      b[0][0] = pc("king", "gote");
      b[8][8] = pc("king", "sente");
      b[4][4] = pc("rook", "sente");
      b[4][7] = pc("gold", "gote");
    };
    const gs = buildGameState(place, "sente");
    const result = findBestMove(
      gs,
      "sente",
      DET_OPTIONS,
      CARD_SHOGI_VARIANT,
      worldCtx(),
      cardState(),
    );
    expect(result).not.toBeNull();
    // 金を取る手 (to = (4,7)) を選ぶ
    expect(result!.move.to).toEqual({ row: 4, col: 7 });
    expect(result!.move.captured).toBe("gold");
  });

  it("カード保有局面でも合法手を返し depthCompleted >= 1 (終了する)", () => {
    const gs = createInitialGameState(CARD_SHOGI_VARIANT);
    const cs = cardState({
      hand: { sente: [{ instanceId: "s-mu", defId: "mana_up" }], gote: [] },
      mana: { sente: 12, gote: 12 },
      deck: { sente: [{ instanceId: "d1", defId: "pawn_return" }], gote: [] },
    });
    const ctx = worldCtx();
    const result = findBestMove(gs, "sente", DET_OPTIONS, CARD_SHOGI_VARIANT, ctx, cs);
    expect(result).not.toBeNull();
    // 返り値は合法な move (root の合法手集合に含まれる)
    const legalMoves = getWorldLegalActions(
      { gameState: gs, cardState: cs, doubleMove: null },
      "sente",
      CARD_SHOGI_VARIANT,
    ).filter((a) => a.kind === "move");
    expect(
      legalMoves.some(
        (a) =>
          a.kind === "move" &&
          a.move.to.row === result!.move.to.row &&
          a.move.to.col === result!.move.to.col,
      ),
    ).toBe(true);
    expect(ctx.depthCompleted).toBeGreaterThanOrEqual(1);
  });
});

describe("S4b-2a: flag OFF は production move-only 経路で不変", () => {
  it("useTurnActionSearch=false なら cardState を渡しても move-only 探索 (分岐しない)", () => {
    const gs = createInitialGameState(CARD_SHOGI_VARIANT);
    const cs = cardState({
      hand: { sente: [{ instanceId: "s-mu", defId: "mana_up" }], gote: [] },
    });
    // flag OFF の ctx (useTurnActionSearch 未指定 = false)
    const ctxOff = createSearchContext({
      timeLimitMs: DET_OPTIONS.timeLimitMs,
      spectatorMode: true,
    });
    const withCard = findBestMove(gs, "sente", DET_OPTIONS, CARD_SHOGI_VARIANT, ctxOff, cs);

    const ctxOff2 = createSearchContext({
      timeLimitMs: DET_OPTIONS.timeLimitMs,
      spectatorMode: true,
    });
    const withoutCard = findBestMove(gs, "sente", DET_OPTIONS, CARD_SHOGI_VARIANT, ctxOff2);

    // flag OFF では cardState 有無で結果不変 (move-only 経路で cardState 未参照)
    expect(withCard).not.toBeNull();
    expect(withoutCard).not.toBeNull();
    expect(withCard!.move).toEqual(withoutCard!.move);
  });
});
