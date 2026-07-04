// Issue #235 S4b-2a: WorldState (TurnAction) 並走探索の特性化テスト。
// 計画 §11 の訂正済ゲート: flag OFF = production 完全不変 / flag ON = 新 card-aware 探索の
// correctness (合法手返却・詰み検知・終了・手番ゲート・double_move 除外)。
// 「move-only と byte 等価」は達成不可 (WorldState 探索は per-node cardDigest + applyTurnAction
// で本質的に別物) ゆえ検証しない。
import { describe, it, expect, afterEach } from "vitest";
import {
  evaluatePositionWorldMoveOnly,
  findBestMove,
  getWorldLegalActions,
  selectBranchCandidates,
  updateHash,
} from "../search";
import { findBestMoveWithStats } from "../engine";
import { createModel, serializeModel } from "../learned/mlp";
import { getInferenceCount, loadLearnedModel, resetInferenceCount } from "../learned/infer";
import { computeHash } from "../zobrist";
import { applyTurnAction } from "../../kernel/world-kernel";
import { createSearchContext } from "../search-context";
import { createInitialGameState } from "../../board";
import { createInitialCardState } from "../../cards/state";
import { CARD_SHOGI_VARIANT } from "../../variants/card-shogi";
import { MANA_CAP } from "../../cards/definitions";
import type { Board, GameState, Piece, Player } from "../../types";
import type { CardGameState, CardInstance } from "../../cards/types";
import type { WorldState } from "../../kernel/world-kernel";
import type { TurnAction } from "../turn/types";

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

describe("S4c-1: getWorldLegalActions (expandCards gate + double_move 除外)", () => {
  it("expandCards=true (root) は move + draw + card を生成し double_move を除外する", () => {
    const gs = createInitialGameState(CARD_SHOGI_VARIANT); // sente 番、初期盤
    const pawnReturn: CardInstance = { instanceId: "s-pr", defId: "pawn_return" };
    const doubleMove: CardInstance = { instanceId: "s-dm", defId: "double_move" };
    const cs = cardState({
      hand: { sente: [pawnReturn, doubleMove], gote: [] },
      mana: { sente: 12, gote: 12 },
      deck: { sente: [{ instanceId: "d1", defId: "mana_up" }], gote: [] },
    });
    const world: WorldState = { gameState: gs, cardState: cs, doubleMove: null };

    const actions = getWorldLegalActions(world, CARD_SHOGI_VARIANT, true);

    expect(actions.some((a) => a.kind === "move")).toBe(true);
    expect(actions.some((a) => a.kind === "draw")).toBe(true);
    expect(
      actions.some((a) => a.kind === "playCard" && a.defId === "pawn_return"),
    ).toBe(true);
    // double_move は S4c-1 除外 (S4c-1d で統合)
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

    const actions = getWorldLegalActions(world, CARD_SHOGI_VARIANT, true);
    // 王手中: draw は生成されない (canDraw 単独なら true だが王手で抑止)。
    expect(actions.some((a) => a.kind === "draw")).toBe(false);
    // 王手回避の move は存在する。
    expect(actions.some((a) => a.kind === "move")).toBe(true);
  });

  it("expandCards=false (deep node) は move のみ (card/draw 抑止 = root のみ展開)", () => {
    const gs = createInitialGameState(CARD_SHOGI_VARIANT); // currentPlayer = sente
    const pawnReturn: CardInstance = { instanceId: "s-pr", defId: "pawn_return" };
    const cs = cardState({
      hand: { sente: [pawnReturn], gote: [] },
      mana: { sente: 12, gote: 12 },
      deck: { sente: [{ instanceId: "d1", defId: "mana_up" }], gote: [] },
    });
    const world: WorldState = { gameState: gs, cardState: cs, doubleMove: null };

    // expandCards=false → 自分番でも card/draw を生成せず move-only (deep node 相当)
    const actions = getWorldLegalActions(world, CARD_SHOGI_VARIANT, false);
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.every((a) => a.kind === "move")).toBe(true);
  });
});

describe("S4b-2b: selectBranchCandidates (selector 枝刈り)", () => {
  const gs = createInitialGameState(CARD_SHOGI_VARIANT);
  const ctx = createSearchContext({ timeLimitMs: 1000 });
  const mkMove = (fromRow: number): TurnAction => ({
    kind: "move",
    move: {
      type: "move",
      from: { row: fromRow, col: 0 },
      to: { row: fromRow - 1, col: 0 },
      piece: "pawn",
      player: "sente",
    },
  });
  const actions: TurnAction[] = [
    mkMove(6),
    mkMove(5),
    mkMove(4),
    mkMove(3),
    { kind: "playCard", cardInstanceId: "c1", defId: "pawn_return" },
    { kind: "playCard", cardInstanceId: "c2", defId: "mana_up" },
    { kind: "draw" },
  ];

  it("M で move を上位 M に絞る (全展開時は全件)", () => {
    const full = selectBranchCandidates(actions, Infinity, Infinity, gs, "sente", 0, ctx);
    expect(full.filter((a) => a.kind === "move")).toHaveLength(4);
    expect(full.filter((a) => a.kind === "playCard")).toHaveLength(2);
    expect(full.filter((a) => a.kind === "draw")).toHaveLength(1);

    const m2 = selectBranchCandidates(actions, 2, Infinity, gs, "sente", 0, ctx);
    expect(m2.filter((a) => a.kind === "move")).toHaveLength(2);
    expect(m2.filter((a) => a.kind === "playCard")).toHaveLength(2);
  });

  it("K=0 は card/draw を完全除外 (move-only control)", () => {
    const ctrl = selectBranchCandidates(actions, 3, 0, gs, "sente", 0, ctx);
    expect(ctrl.filter((a) => a.kind === "move")).toHaveLength(3);
    expect(ctrl.filter((a) => a.kind === "playCard")).toHaveLength(0);
    expect(ctrl.filter((a) => a.kind === "draw")).toHaveLength(0);
  });

  it("K>0 は card 上位 K + draw を残す", () => {
    const k1 = selectBranchCandidates(actions, 3, 1, gs, "sente", 0, ctx);
    expect(k1.filter((a) => a.kind === "move")).toHaveLength(3);
    expect(k1.filter((a) => a.kind === "playCard")).toHaveLength(1);
    expect(k1.filter((a) => a.kind === "draw")).toHaveLength(1); // draw は K>0 で含む
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
      CARD_SHOGI_VARIANT,
      true,
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

describe("S4c-1: findBestMoveWorld bestAction 返却 + noise 移植", () => {
  // 無防備な大駒取り (move が明白に最善、手札空)。
  const placeObviousCapture = (b: Board) => {
    b[0][0] = pc("king", "gote");
    b[8][8] = pc("king", "sente");
    b[4][4] = pc("rook", "sente");
    b[4][7] = pc("gold", "gote");
  };

  it("bestAction を返し、move 採用時は result.move と一致する", () => {
    const gs = buildGameState(placeObviousCapture, "sente");
    const result = findBestMove(gs, "sente", DET_OPTIONS, CARD_SHOGI_VARIANT, worldCtx(), cardState());
    expect(result).not.toBeNull();
    // 手札空 → bestAction は move
    expect(result!.bestAction).toBeDefined();
    expect(result!.bestAction!.kind).toBe("move");
    if (result!.bestAction!.kind === "move") {
      // bestAction.move は result.move と一致 (blunder guard 整合)
      expect(result!.bestAction!.move.to).toEqual(result!.move.to);
    }
  });

  it("bestAction は root の合法 TurnAction のいずれか (カード保有局面)", () => {
    const gs = createInitialGameState(CARD_SHOGI_VARIANT);
    const cs = cardState({
      hand: { sente: [{ instanceId: "s-pr", defId: "pawn_return" }], gote: [] },
      mana: { sente: 12, gote: 12 },
      deck: { sente: [{ instanceId: "d1", defId: "mana_up" }], gote: [] },
    });
    const result = findBestMove(gs, "sente", DET_OPTIONS, CARD_SHOGI_VARIANT, worldCtx(), cs);
    expect(result).not.toBeNull();
    expect(result!.bestAction).toBeDefined();
    const rootActions = getWorldLegalActions(
      { gameState: gs, cardState: cs, doubleMove: null },
      CARD_SHOGI_VARIANT,
      true,
    );
    const ba = result!.bestAction!;
    // bestAction は root 候補に含まれる種類 (move/draw/playCard)。double_move は候補化されない。
    expect(["move", "draw", "playCard"]).toContain(ba.kind);
    if (ba.kind === "playCard") {
      expect(ba.defId).not.toBe("double_move");
      expect(rootActions.some((a) => a.kind === "playCard" && a.defId === ba.defId)).toBe(true);
    }
  });

  it("addNoise=1 でも bestAction は合法 move を返す (クラッシュしない)", () => {
    const gs = buildGameState(placeObviousCapture, "sente");
    const noisyOpts = { ...DET_OPTIONS, addNoise: 1, nearEqualThreshold: 500 };
    const result = findBestMove(gs, "sente", noisyOpts, CARD_SHOGI_VARIANT, worldCtx(), cardState());
    expect(result).not.toBeNull();
    expect(result!.bestAction).toBeDefined();
    // addNoise は move 上位5 から選ぶため kind は move
    expect(result!.bestAction!.kind).toBe("move");
    const rootMoves = getWorldLegalActions(
      { gameState: gs, cardState: cardState(), doubleMove: null },
      CARD_SHOGI_VARIANT,
      true,
    ).filter((a) => a.kind === "move");
    if (result!.bestAction!.kind === "move") {
      const chosen = result!.bestAction!.move;
      // 選ばれた move は合法手集合に含まれる
      expect(
        rootMoves.some(
          (a) =>
            a.kind === "move" &&
            a.move.from?.row === chosen.from?.row &&
            a.move.from?.col === chosen.from?.col &&
            a.move.to.row === chosen.to.row &&
            a.move.to.col === chosen.to.col,
        ),
      ).toBe(true);
    }
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

describe("S4c-1b: null-move 退化窓修正 (カード有利局面で card を正しく選択)", () => {
  // 回帰: 飛車の利きを塞ぐ自歩(5,1)を pawn_return で戻すと、飛が col1 を通って後手金(2,1)を
  // 取りながら/成りながら進入できる明確にカード有利な局面。
  // バグ (修正前): findBestMoveWorld が aspiration 無しで PV を full-window 探索 → null-move の
  // null 窓 (-Infinity,-Infinity) 退化 → quiescence に alpha=±Infinity → 探索全体が ±Infinity 化し、
  // root 全 action が同値(-Infinity)→ 無意味な move を選びカードを一切使わなかった (bench card% 0%)。
  // 修正後: card 効果+局面を深く正しく評価し、有利なら card を選ぶ。
  const placePawnReturnTactic = (b: Board) => {
    b[8][8] = pc("king", "sente");
    b[0][0] = pc("king", "gote");
    b[8][1] = pc("rook", "sente");
    b[5][1] = pc("pawn", "sente"); // 飛の利きを塞ぐ自歩 (pawn_return 対象)
    b[2][1] = pc("gold", "gote"); // col1 上方の標的 (row 2 = 先手成り圏)
  };
  const cs = () =>
    cardState({
      hand: { sente: [{ instanceId: "s-pr", defId: "pawn_return" }], gote: [] },
      mana: { sente: 12, gote: 12 },
    });
  // ±Infinity 汚染回帰の捕捉に十分な深さ。バグは null-move (depth>=3) + beta=+Infinity で発火する
  // ため maxDepth 4 (root i=0 child が depth 3 で null-move 到達) で旧コードなら全スコア -Infinity 化。
  // 修正後は有限。TT 無し full-window は遅いので深さは最小限。カード選択の正しさは下の engine テストで検証。
  const TACTIC_OPTIONS = { maxDepth: 4, timeLimitMs: 60000, addNoise: 0, nearEqualThreshold: 0 };

  it("findBestMove(world) のスコアは有限 (±Infinity 退化窓汚染なし = null-move 修正の回帰)", () => {
    const gs = buildGameState(placePawnReturnTactic, "sente");
    const result = findBestMove(gs, "sente", TACTIC_OPTIONS, CARD_SHOGI_VARIANT, worldCtx(), cs());
    expect(result).not.toBeNull();
    expect(result!.bestAction).toBeDefined();
    // 退化窓バグでは root 全 action が -Infinity 同値になり rootMoveScores が空/−∞ 化していた。
    // 修正後は move スコアがすべて有限。
    expect(result!.rootMoveScores.length).toBeGreaterThan(0);
    for (const ms of result!.rootMoveScores) {
      expect(Number.isFinite(ms.score)).toBe(true);
    }
  }, 15000);

  it("findBestMoveWithStats(useTurnActionSearch:true) も pawn_return を採用 (production cutover 経路)", () => {
    const gs = buildGameState(placePawnReturnTactic, "sente");
    // expert: addNoise=0/nearEqual=0 で決定的。selector K=∞ (Issue #245 Stage 1a 足切り廃止) で
    // 全 pawn_return 対象を候補化し、カード有利な本局面では深読みで card を採用する。
    const r = findBestMoveWithStats(gs, "sente", "expert", CARD_SHOGI_VARIANT, {
      cardState: cs(),
      useTurnActionSearch: true,
    });
    expect(r.action).not.toBeNull();
    expect(r.action!.kind).toBe("playCard");
    if (r.action && r.action.kind === "playCard") {
      expect(r.action.defId).toBe("pawn_return");
    }
    expect(r.stats.usedCardAction).toBe(true);
  });

  it("初期局面: 全 pawn_return 対象を探索し現評価が最善視する歩戻しを採用 (Issue #245 Stage 1a 特性化)", () => {
    // Issue #245 Stage 1a (足切り廃止 K=1→∞): pawn_return は自歩 9 通りを対象に取れる。
    // 旧 K=1 cap は 9 対象のうち 1 つしか残さず「飛車の前の歩を戻す」高評価対象を見落として
    // いた (= 盲点)。cap 撤廃で全対象を探索した結果、現在の手作り評価は「飛車の前の歩を戻す」を
    // 最善視し playCard を採用する。
    //
    // ★これは "正しい" 好手ではなく現評価の **既知の過大評価** を pin する特性化テストである:
    //   飛筋を開けると相手の歩を pieceSafety が「タダ取り可能」と +85 する浅い 1 手検知が原因
    //   (取りに行く飛車の深入りリスクを見ていない)。カード下駄ではなく盤面評価の浅さ。
    //   調査詳細: docs/plans/issue-245-tobe-eval-selector.md (2026-06-28)。
    //   本来の修正は Stage 2 (学習評価)。Stage 2 で評価が改善されると本テストは更新される
    //   見込み (= 過大評価が解消された検知点)。
    const gs = createInitialGameState(CARD_SHOGI_VARIANT);
    const r = findBestMoveWithStats(gs, "sente", "expert", CARD_SHOGI_VARIANT, {
      cardState: cs(),
      useTurnActionSearch: true,
    });
    expect(r.action).not.toBeNull();
    expect(r.action!.kind).toBe("playCard");
  });
});

describe("S4c-2b: R-14 incremental boardHash === computeHash 全量 (TT 誤hit 防止)", () => {
  // 通常 move (action.kind==="move" && !boardChangedBeyondMove) で
  // updateHash(computeHash(parent), parent, move, child) が computeHash(child) と一致することを
  // 各 move 種別 (通常/取り/成り/打ち) で検証。一致しないと TT key がズレ誤 hit する。
  const hashEq = (a: { lo: number; hi: number }, b: { lo: number; hi: number }) =>
    a.lo === b.lo && a.hi === b.hi;

  function assertAllMoveHashesConsistent(world: WorldState) {
    const moves = getWorldLegalActions(world, CARD_SHOGI_VARIANT, true).filter(
      (a) => a.kind === "move",
    );
    expect(moves.length).toBeGreaterThan(0);
    const parentHash = computeHash(world.gameState);
    let checked = 0;
    for (const action of moves) {
      const applied = applyTurnAction(world, action, { spectatorMode: true });
      // 通常 move 経路 (incremental 適用条件) のみ検証。盤面1手分以外の変更は computeHash 全量経路。
      if (action.kind === "move" && !applied.boardChangedBeyondMove) {
        const incremental = updateHash(parentHash, world.gameState, action.move, applied.world.gameState);
        const full = computeHash(applied.world.gameState);
        expect(
          hashEq(incremental, full),
          `move ${action.move.from?.row},${action.move.from?.col}->${action.move.to.row},${action.move.to.col}${action.move.promote ? "+" : ""} の incremental hash が computeHash と不一致`,
        ).toBe(true);
        checked++;
      }
    }
    return checked;
  }

  it("通常/取り/成り 局面の全 move で incremental === full", () => {
    // 取り (飛で金) + 成り (歩が成り圏へ) + 通常 move を含む局面。
    const place = (b: Board) => {
      b[8][4] = pc("king", "sente");
      b[0][4] = pc("king", "gote");
      b[4][4] = pc("rook", "sente"); // (4,7) の金を取れる + 縦横の通常 move
      b[4][7] = pc("gold", "gote");
      b[3][3] = pc("pawn", "sente"); // (2,3) へ成り進入可
    };
    const gs = buildGameState(place, "sente");
    const world: WorldState = { gameState: gs, cardState: cardState(), doubleMove: null };
    const checked = assertAllMoveHashesConsistent(world);
    expect(checked).toBeGreaterThan(5);
  });

  it("打ち (drop) を含む局面の全 move で incremental === full", () => {
    const place = (b: Board) => {
      b[8][4] = pc("king", "sente");
      b[0][4] = pc("king", "gote");
      b[8][8] = pc("rook", "sente");
    };
    const gs = buildGameState(place, "sente");
    // 持ち駒 (盤の hand) に歩・銀を持たせて drop move を生成。
    gs.hand.sente = { pawn: 1, silver: 1 };
    const world: WorldState = { gameState: gs, cardState: cardState(), doubleMove: null };
    const moves = getWorldLegalActions(world, CARD_SHOGI_VARIANT, true).filter((a) => a.kind === "move");
    expect(moves.some((a) => a.kind === "move" && a.move.type === "drop")).toBe(true);
    assertAllMoveHashesConsistent(world);
  });

  it("auto-draw 発火 move でも incremental === full (盤は1手分・cardState は board 非依存)", () => {
    const place = (b: Board) => {
      b[8][4] = pc("king", "sente");
      b[0][4] = pc("king", "gote");
      b[6][0] = pc("pawn", "sente");
    };
    const gs = buildGameState(place, "sente");
    // drawProgress を AUTO_DRAW_INTERVAL-1 にし、deck 非空 → move 後の advanceDrawProgress で auto-draw 発火。
    const cs = cardState({
      drawProgress: { sente: 4, gote: 0 },
      deck: { sente: [{ instanceId: "d1", defId: "mana_up" }], gote: [] },
    });
    const world: WorldState = { gameState: gs, cardState: cs, doubleMove: null };
    assertAllMoveHashesConsistent(world);
  });
});

describe("S4c-2b: M2 指摘の MUST テスト補完 (R-14 promote-drop + B-1 trap-skip)", () => {
  const hashEq = (a: { lo: number; hi: number }, b: { lo: number; hi: number }) =>
    a.lo === b.lo && a.hi === b.hi;

  it("no_promote 発火で promote が落ちる move でも incremental === full (R-14 promote-drop)", () => {
    // gote が no_promote トラップ保有。sente 歩(3,4)→(2,4) 成り宣言で発火 → 成り negate + マーク。
    const place = (b: Board) => {
      b[8][4] = pc("king", "sente");
      b[0][0] = pc("king", "gote");
      b[3][4] = pc("pawn", "sente");
    };
    const gs = buildGameState(place, "sente");
    const cs = cardState({
      trap: { sente: null, gote: { instanceId: "t", defId: "no_promote", owner: "gote" } },
    });
    const world: WorldState = { gameState: gs, cardState: cs, doubleMove: null };
    const promoteMoves = getWorldLegalActions(world, CARD_SHOGI_VARIANT, true).filter(
      (a): a is Extract<TurnAction, { kind: "move" }> =>
        a.kind === "move" &&
        a.move.from?.row === 3 &&
        a.move.from?.col === 4 &&
        a.move.to.row === 2 &&
        a.move.to.col === 4 &&
        a.move.promote === true,
    );
    expect(promoteMoves.length).toBe(1);
    const applied = applyTurnAction(world, promoteMoves[0], { spectatorMode: true });
    // no_promote 発火は check_break でない → boardChangedBeyondMove=false (incremental 経路)
    expect(applied.boardChangedBeyondMove).toBe(false);
    // 成りが落ちて不成歩 (promoted_pawn でない)
    expect(applied.world.gameState.board[2][4]?.type).toBe("pawn");
    const incremental = updateHash(computeHash(gs), gs, promoteMoves[0].move, applied.world.gameState);
    const full = computeHash(applied.world.gameState);
    expect(hashEq(incremental, full)).toBe(true);
  });

  it("S4d-4: trap セット済ノードも TT 有効化 (旧 trap-skip 撤去、trap board 由来化で誤 hit 解消)", () => {
    const placeQuiet = (b: Board) => {
      b[8][4] = pc("king", "sente");
      b[0][4] = pc("king", "gote");
      b[5][4] = pc("gold", "sente");
      b[3][4] = pc("gold", "gote");
    };
    const gs = buildGameState(placeQuiet, "sente");
    const opts = { maxDepth: 3, timeLimitMs: 60000, addNoise: 0, nearEqualThreshold: 0 };
    // (a) 非 trap: TT 有効 → ttProbes > 0
    const ctxA = worldCtx();
    findBestMove(gs, "sente", opts, CARD_SHOGI_VARIANT, ctxA, cardState());
    expect(ctxA.ttProbes).toBeGreaterThan(0);
    // (b) trap セット (quiet で発火しない=全ノード trap 保持): S4d-4 で TT も有効 → ttProbes > 0。
    // trapValueDelta を board 由来 leaf 算出 (getCardValue) へ移行したため「同 board + 同 trap defId →
    // 同 score」が成立し誤 hit が消滅 (旧 trap-skip が不要に)。
    const ctxB = worldCtx();
    const csTrap = cardState({
      trap: { sente: { instanceId: "t", defId: "no_promote", owner: "sente" }, gote: null },
    });
    const resB = findBestMove(gs, "sente", opts, CARD_SHOGI_VARIANT, ctxB, csTrap);
    expect(ctxB.ttProbes).toBeGreaterThan(0);
    expect(resB?.move).toBeTruthy(); // trap 局面でも TT 有効で正常に最善手を返す
  });
});

describe("S4e: engagement 下駄 撤去後の merit ベース card 採用", () => {
  // sente 金が gote 金をタダ取りできる局面 (best move = 捕獲 +600cp、draw/card は明確に劣る)。
  const placeCapture = (b: Board) => {
    b[8][0] = pc("king", "sente");
    b[0][8] = pc("king", "gote");
    b[5][4] = pc("gold", "sente");
    b[4][4] = pc("gold", "gote"); // sente 金が前進して取れる (タダ取り)
  };
  const gs = buildGameState(placeCapture, "sente");
  const drawableCs = () =>
    cardState({
      mana: { sente: 10, gote: 10 },
      deck: { sente: [{ instanceId: "d1", defId: "mana_up" }], gote: [] },
    });

  it("明確に良い move がある局面では card/draw を強制採用しない (forcing 撤去)", () => {
    // engagement 下駄を撤去したため、card/draw は深読み negamax で move と同列比較され、
    // 明確に劣る (タダ取り move より低スコア) card/draw は採用されない = purposeless な card 使用なし。
    const ctx = worldCtx();
    const res = findBestMove(
      gs, "sente",
      { ...DET_OPTIONS },
      CARD_SHOGI_VARIANT, ctx, drawableCs(),
    );
    expect(res?.bestAction?.kind).toBe("move"); // 最善 = 金のタダ取り (card/draw は強制されない)
  });
});

// Issue #245 Stage 2 P2-0: search-score ラベル生成の符号規約 (M2 MINOR-1)。
// evaluatePositionWorldMoveOnly は negamaxWorld の手番相対値を **先手絶対視点** へ変換する
// (`currentPlayer==="sente" ? rel : -rel`)。符号は #235 で繰り返しバグった最危険領域ゆえ、
// 「材料有利な側が、手番に依らず先手絶対視点で正しい符号になる」ことを決定的に検証する。
describe("evaluatePositionWorldMoveOnly (先手絶対視点の符号規約)", () => {
  const card = createInitialCardState([{ defId: "pawn_return", count: 2 }]);
  // 初期盤面に持駒の飛車を一方へ追加 = 明確な材料差。手番だけ差し替えて評価する。
  const evalWithAdvantage = (advantage: Player, currentPlayer: Player): number => {
    const base = createInitialGameState(CARD_SHOGI_VARIANT);
    const state: GameState = {
      ...base,
      hand: advantage === "sente" ? { sente: { rook: 1 }, gote: {} } : { sente: {}, gote: { rook: 1 } },
      currentPlayer,
    };
    const ctx = createSearchContext({ timeLimitMs: 60000, useLearnedEval: false });
    return evaluatePositionWorldMoveOnly(state, card, 2, CARD_SHOGI_VARIANT, ctx);
  };

  it("先手が材料有利なら、手番に依らず先手絶対視点で正", () => {
    expect(evalWithAdvantage("sente", "sente")).toBeGreaterThan(0);
    // ★後手手番でも正 = gote 分岐の符号反転 (-rel) が正しいことの検証 (これが無いと負になる)。
    expect(evalWithAdvantage("sente", "gote")).toBeGreaterThan(0);
  });

  it("後手が材料有利なら、手番に依らず先手絶対視点で負", () => {
    expect(evalWithAdvantage("gote", "sente")).toBeLessThan(0);
    expect(evalWithAdvantage("gote", "gote")).toBeLessThan(0);
  });
});

// Issue #245 Stage 2 P2-2a: engine (findBestMoveWithStats) の useLearnedEval 配線。
// evalLeafWorld は useTurnActionSearch 経路 (world) のリーフでのみ useLearnedEval && hasLearnedModel()
// の両真時に NN へ分岐する二重 flag。NN 呼出カウンタで「実際に NN 経路を通ったか」を検証し、
// silent fallback (未ロードで人手 eval のまま) と明示 OFF を区別する = 勝率ハーネスの誤 PASS 防止。
describe("findBestMoveWithStats の useLearnedEval 配線 (P2-2a)", () => {
  const fixture = () => {
    const state = createInitialGameState(CARD_SHOGI_VARIANT);
    const base = createInitialCardState([
      { defId: "pawn_return", count: 4 },
      { defId: "no_promote", count: 4 },
      { defId: "double_pawn", count: 4 },
    ]);
    const cardState: CardGameState = { ...base, mana: { sente: 12, gote: 12 } };
    return { state, cardState };
  };

  afterEach(() => {
    loadLearnedModel(null);
    resetInferenceCount();
  });

  it("world 経路 + useLearnedEval:true + モデルロードで NN が呼ばれる", () => {
    loadLearnedModel(serializeModel(createModel(2478, 8, 1)));
    resetInferenceCount();
    const { state, cardState } = fixture();
    findBestMoveWithStats(state, "sente", "expert", CARD_SHOGI_VARIANT, {
      cardState,
      useKernelSearch: true,
      useTurnActionSearch: true,
      useLearnedEval: true,
      maxDepth: 2,
    });
    expect(getInferenceCount()).toBeGreaterThan(0);
  });

  it("useLearnedEval:false は NN 非経由 (人手 eval、明示 OFF = production 経路)", () => {
    loadLearnedModel(serializeModel(createModel(2478, 8, 1)));
    resetInferenceCount();
    const { state, cardState } = fixture();
    findBestMoveWithStats(state, "sente", "expert", CARD_SHOGI_VARIANT, {
      cardState,
      useKernelSearch: true,
      useTurnActionSearch: true,
      useLearnedEval: false,
      maxDepth: 2,
    });
    expect(getInferenceCount()).toBe(0);
  });

  it("world 経路 OFF (useTurnActionSearch 未指定) なら useLearnedEval:true でも NN 未到達", () => {
    loadLearnedModel(serializeModel(createModel(2478, 8, 1)));
    resetInferenceCount();
    const { state, cardState } = fixture();
    findBestMoveWithStats(state, "sente", "expert", CARD_SHOGI_VARIANT, {
      cardState,
      useKernelSearch: true,
      useLearnedEval: true,
      maxDepth: 2,
    });
    expect(getInferenceCount()).toBe(0);
  });
});
