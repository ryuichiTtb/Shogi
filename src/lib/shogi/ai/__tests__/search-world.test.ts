// Issue #235 S4b-2a: WorldState (TurnAction) 並走探索の特性化テスト。
// 計画 §11 の訂正済ゲート: flag OFF = production 完全不変 / flag ON = 新 card-aware 探索の
// correctness (合法手返却・詰み検知・終了・手番ゲート・double_move 除外)。
// 「move-only と byte 等価」は達成不可 (WorldState 探索は per-node cardDigest + applyTurnAction
// で本質的に別物) ゆえ検証しない。
import { describe, it, expect, afterEach } from "vitest";
import {
  evaluatePositionWorldMoveOnly,
  evaluatePositionWorldWithCards,
  findBestMove,
  getLabelCardActions,
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

  // Issue #245 教材多様化 段2: playCard と draw の展開を別フラグに分離した。
  describe("段2: expandDraw の分離", () => {
    const world = (): WorldState => {
      const gs = createInitialGameState(CARD_SHOGI_VARIANT); // sente 番、初期盤 (王手なし)
      const cs = cardState({
        hand: { sente: [{ instanceId: "s-pr", defId: "pawn_return" }], gote: [] },
        mana: { sente: 12, gote: 12 },
        deck: { sente: [{ instanceId: "d1", defId: "mana_up" }], gote: [] },
      });
      return { gameState: gs, cardState: cs, doubleMove: null };
    };

    it("expandDraw の既定は expandCards と同じ (既存 3 引数呼出は挙動不変)", () => {
      const w = world();
      const implicitTrue = getWorldLegalActions(w, CARD_SHOGI_VARIANT, true);
      const explicitTrue = getWorldLegalActions(w, CARD_SHOGI_VARIANT, true, true);
      expect(implicitTrue).toEqual(explicitTrue);
      const implicitFalse = getWorldLegalActions(w, CARD_SHOGI_VARIANT, false);
      const explicitFalse = getWorldLegalActions(w, CARD_SHOGI_VARIANT, false, false);
      expect(implicitFalse).toEqual(explicitFalse);
    });

    it("expandCards=true / expandDraw=false は playCard だけ展開し draw を出さない (ラベル用)", () => {
      const actions = getWorldLegalActions(world(), CARD_SHOGI_VARIANT, true, false);
      expect(actions.some((a) => a.kind === "playCard" && a.defId === "pawn_return")).toBe(true);
      expect(actions.some((a) => a.kind === "draw")).toBe(false);
      expect(actions.some((a) => a.kind === "move")).toBe(true);
    });

    it("expandCards=false / expandDraw=true は draw だけ展開し playCard を出さない", () => {
      const actions = getWorldLegalActions(world(), CARD_SHOGI_VARIANT, false, true);
      expect(actions.some((a) => a.kind === "draw")).toBe(true);
      expect(actions.some((a) => a.kind === "playCard")).toBe(false);
    });
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
  const advantageState = (advantage: Player, currentPlayer: Player): GameState => {
    const base = createInitialGameState(CARD_SHOGI_VARIANT);
    return {
      ...base,
      hand: advantage === "sente" ? { sente: { rook: 1 }, gote: {} } : { sente: {}, gote: { rook: 1 } },
      currentPlayer,
    };
  };
  // 時間予算が潤沢なので採点は必ず成立する。null (採点不能) が返ったらそれ自体が異常なので
  // ここで明示的に落とす (?? 0 のような握り潰しをすると符号バグと区別できなくなる)。
  const evalWithAdvantage = (advantage: Player, currentPlayer: Player): number => {
    const ctx = createSearchContext({ timeLimitMs: 60000, useLearnedEval: false });
    const score = evaluatePositionWorldMoveOnly(
      advantageState(advantage, currentPlayer), card, 2, CARD_SHOGI_VARIANT, ctx,
    );
    expect(score).not.toBeNull();
    return score as number;
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

  // 教材多様化 段1: 深さ 1 すら完了しない場合に「互角 (0)」という嘘のラベルを返さず null。
  it("停止済みの ctx (深さ1 も完了できない) では null を返す (嘘ラベル 0 を書かない)", () => {
    const ctx = createSearchContext({ timeLimitMs: 60000, useLearnedEval: false });
    ctx.stopped = true; // 探索開始前から停止済み = 1 反復も完了できない状態
    const score = evaluatePositionWorldMoveOnly(
      advantageState("sente", "sente"), card, 3, CARD_SHOGI_VARIANT, ctx,
    );
    expect(score).toBeNull();
    expect(ctx.depthCompleted).toBe(0); // 達成深さも 0 のまま (嘘の深さを記録しない)
  });

  // 実際に到達した深さを ctx.depthCompleted へ記録する (呼び出し側が D 未達を実測で検知するため)。
  it("完了した最大の深さを ctx.depthCompleted に記録する", () => {
    const ctx = createSearchContext({ timeLimitMs: 60000, useLearnedEval: false });
    evaluatePositionWorldMoveOnly(advantageState("sente", "sente"), card, 2, CARD_SHOGI_VARIANT, ctx);
    expect(ctx.depthCompleted).toBe(2);
  });
});

// Issue #245 教材多様化 段2 ★本丸: root で playCard を展開したラベル。
describe("evaluatePositionWorldWithCards (root カード展開)", () => {
  const DEPTH = 2;
  const fresh = () => createSearchContext({ timeLimitMs: 60000, useLearnedEval: false });
  const labelOf = (
    fn: typeof evaluatePositionWorldMoveOnly,
    state: GameState,
    cs: CardGameState,
  ): number => {
    const score = fn(state, cs, DEPTH, CARD_SHOGI_VARIANT, fresh());
    expect(score).not.toBeNull();
    return score as number;
  };

  // カードを 1 枚も使えない局面 (マナ 0) では展開する枝が無いので move-only と完全一致する。
  // これが段2 の「無回帰」の芯 (カードが無関係な局面のラベルを 1cp も動かさない)。
  it("カードが使えない局面では move-only とバイト一致する", () => {
    const state = createInitialGameState(CARD_SHOGI_VARIANT);
    const cs: CardGameState = {
      ...createInitialCardState([{ defId: "pawn_return", count: 2 }]),
      mana: { sente: 0, gote: 0 }, // マナ 0 = どのカードも使用条件を満たさない
    };
    expect(labelOf(evaluatePositionWorldWithCards, state, cs)).toBe(
      labelOf(evaluatePositionWorldMoveOnly, state, cs),
    );
  });

  // 終局局面ではカードを展開しない (本ゲームの終局判定は盤面のみで、カードによる詰み解除を
  // 見ていない。ラベルだけがカードで詰みを回避すると実ゲームと食い違う)。
  // ガードは 2 条件あるので両方を個別に固定する。
  it("合法手が 1 つも無い局面ではカードを展開しない", () => {
    // 後手玉(0,0) を 先手飛(0,1)+先手金(1,1) が詰めた形。手番は後手 = 合法手なし。
    const place = (b: Board) => {
      b[0][0] = pc("king", "gote");
      b[0][1] = pc("rook", "sente");
      b[1][1] = pc("gold", "sente");
      b[8][8] = pc("king", "sente");
    };
    const state = buildGameState(place, "gote");
    const cs = cardState({
      hand: { sente: [], gote: [{ instanceId: "g-pr", defId: "pawn_return" }] },
      mana: { sente: 12, gote: 12 },
    });
    expect(getLabelCardActions({ gameState: state, cardState: cs, doubleMove: null }, CARD_SHOGI_VARIANT))
      .toHaveLength(0);
    expect(labelOf(evaluatePositionWorldWithCards, state, cs)).toBe(
      labelOf(evaluatePositionWorldMoveOnly, state, cs),
    );
  });

  it("status が active でない局面ではカードを展開しない", () => {
    // 合法手は残っているが対局は終わっている (投了など) 状態。status ガード側の pin。
    const state: GameState = {
      ...createInitialGameState(CARD_SHOGI_VARIANT),
      status: "resign",
    };
    const cs = cardState({
      hand: { sente: [{ instanceId: "s-pr", defId: "pawn_return" }], gote: [] },
      mana: { sente: 12, gote: 12 },
    });
    // 合法手はある = もう一方のガードでは弾かれない。status ガードだけが効いていることを示す。
    expect(getWorldLegalActions({ gameState: state, cardState: cs, doubleMove: null }, CARD_SHOGI_VARIANT, true, false)
      .some((a) => a.kind === "playCard")).toBe(true);
    expect(getLabelCardActions({ gameState: state, cardState: cs, doubleMove: null }, CARD_SHOGI_VARIANT))
      .toHaveLength(0);
  });

  // カード枝は root の追加選択肢なので、**手番側から見た値**は move-only 以上にしかならない。
  // 先手絶対視点のラベルでは、先手番なら「以上」・後手番なら「以下」になる (符号規約こみの検証)。
  // ※厳密には「反復を跨ぐと killer/history/TT の汚染で move 側の探索結果も動きうる」ので構造保証
  //   ではないが、DEPTH=2 では LMR (depth>=3 が条件) が不発で決定的に成立する。実データでの
  //   大規模確認は scripts/diag-label-cards-245.ts の ④ (符号違反件数) が担う。
  it("カードが使える局面では手番側に有利な方向にしか動かない", () => {
    const withHand = (owner: Player): CardGameState =>
      cardState({
        hand: {
          sente: owner === "sente" ? [{ instanceId: "s-pr", defId: "pawn_return" }] : [],
          gote: owner === "gote" ? [{ instanceId: "g-pr", defId: "pawn_return" }] : [],
        },
        mana: { sente: 12, gote: 12 },
      });

    const senteToMove = createInitialGameState(CARD_SHOGI_VARIANT); // 先手番
    const csS = withHand("sente");
    expect(labelOf(evaluatePositionWorldWithCards, senteToMove, csS)).toBeGreaterThanOrEqual(
      labelOf(evaluatePositionWorldMoveOnly, senteToMove, csS),
    );

    const goteToMove: GameState = { ...createInitialGameState(CARD_SHOGI_VARIANT), currentPlayer: "gote" };
    const csG = withHand("gote");
    expect(labelOf(evaluatePositionWorldWithCards, goteToMove, csG)).toBeLessThanOrEqual(
      labelOf(evaluatePositionWorldMoveOnly, goteToMove, csG),
    );
  });

  // 段1 と同じ規約: 深さ 1 すら完了しないなら「互角 (0)」の嘘ラベルでなく null。
  it("停止済みの ctx では null を返す", () => {
    const ctx = fresh();
    ctx.stopped = true;
    const cs = cardState({
      hand: { sente: [{ instanceId: "s-pr", defId: "pawn_return" }], gote: [] },
      mana: { sente: 12, gote: 12 },
    });
    expect(
      evaluatePositionWorldWithCards(
        createInitialGameState(CARD_SHOGI_VARIANT), cs, 3, CARD_SHOGI_VARIANT, ctx,
      ),
    ).toBeNull();
    expect(ctx.depthCompleted).toBe(0);
  });

  // ★段2 の芯: カード枝が**実際に探索されている**こと。
  // 当初の実装はカード枝を null 窓 scout で読んでいたため、非厳密な枝刈り (quiescence の fail-hard /
  // LMR の未検証 fail-high / 小数評価値と幅 1cp 窓による TT の exact 誤付与) が
  // 「カードが 172.7cp 良いのに 1 件も採用されない」局面を作っていた (実データで再現)。
  // ラベルの値だけを見ても「カードが同価値だったのか、捨てられたのか」を区別できないので、
  // 探索ノード数という**必ず動く観測量**で固定する。
  it("カード枝を実際に探索している (カードあり=ノード増 / カードなし=完全一致)", () => {
    const state = createInitialGameState(CARD_SHOGI_VARIANT);
    const usable = cardState({
      hand: { sente: [{ instanceId: "s-pr", defId: "pawn_return" }], gote: [] },
      mana: { sente: 12, gote: 12 },
    });
    const world = { gameState: state, cardState: usable, doubleMove: null };
    expect(getLabelCardActions(world, CARD_SHOGI_VARIANT).length).toBeGreaterThan(0);

    const ctxMove = fresh();
    evaluatePositionWorldMoveOnly(state, usable, DEPTH, CARD_SHOGI_VARIANT, ctxMove);
    const ctxCards = fresh();
    evaluatePositionWorldWithCards(state, usable, DEPTH, CARD_SHOGI_VARIANT, ctxCards);
    expect(ctxCards.nodes).toBeGreaterThan(ctxMove.nodes);

    // カードが 1 枚も使えなければ探索は完全に同一 (= ① バイト一致の構造的な裏づけ)。
    const unusable: CardGameState = { ...usable, mana: { sente: 0, gote: 0 } };
    expect(getLabelCardActions({ ...world, cardState: unusable }, CARD_SHOGI_VARIANT)).toHaveLength(0);
    const ctxMove2 = fresh();
    evaluatePositionWorldMoveOnly(state, unusable, DEPTH, CARD_SHOGI_VARIANT, ctxMove2);
    const ctxCards2 = fresh();
    evaluatePositionWorldWithCards(state, unusable, DEPTH, CARD_SHOGI_VARIANT, ctxCards2);
    expect(ctxCards2.nodes).toBe(ctxMove2.nodes);
  });
});

// ★段2 の回帰防御 (M2 2 巡目 MAJOR-3): 実教材から取り出した「カードが決定的に良い」局面。
//
// 段2 の実装は当初カード枝を null 窓 scout で読んでおり、実データで「カードが 172.7cp 良いのに
// 1 件も採用されず、ラベルが move-only とビット単位で一致する」局面が出た。この失敗は
// 例外も警告も出さず**ラベルが静かに変わらないだけ**なので、初期盤面や人工局面では踏めない。
// そこで教材 (snap-selfplay.jsonl) から効果が大きい実局面を 1 つ固定 fixture として持ち込む。
// 深さ 3 = 当該バグが再現した深さ帯 (深さ 2 は LMR が不発、深さ 4 では消えた)。
describe("evaluatePositionWorldWithCards: 実教材の局面でカード価値が伝播する", () => {
  const DEPTH = 3;
  // 22 手目・後手番。後手はマナ 1 で double_pawn が使え、それが最善になる。
  const PIECES: [number, number, Piece["type"], Player][] = [
    [0, 0, "lance", "gote"], [0, 1, "knight", "gote"], [0, 3, "gold", "gote"], [0, 5, "gold", "gote"],
    [0, 6, "silver", "gote"], [0, 7, "knight", "gote"], [0, 8, "lance", "gote"],
    [1, 3, "silver", "gote"], [1, 4, "pawn", "gote"], [1, 5, "king", "gote"], [1, 7, "bishop", "gote"],
    [2, 1, "rook", "gote"], [2, 2, "pawn", "gote"], [2, 3, "pawn", "gote"], [2, 4, "pawn", "gote"],
    [2, 5, "pawn", "gote"], [2, 6, "pawn", "gote"], [2, 7, "pawn", "gote"], [2, 8, "pawn", "gote"],
    [5, 1, "pawn", "sente"], [5, 2, "pawn", "sente"],
    [6, 0, "pawn", "sente"], [6, 1, "pawn", "sente"], [6, 2, "silver", "sente"], [6, 3, "pawn", "sente"],
    [6, 4, "bishop", "sente"], [6, 5, "pawn", "sente"], [6, 6, "pawn", "sente"], [6, 7, "pawn", "sente"],
    [6, 8, "pawn", "sente"],
    [7, 2, "king", "sente"], [7, 4, "rook", "sente"], [7, 6, "silver", "sente"],
    [8, 0, "lance", "sente"], [8, 1, "knight", "sente"], [8, 3, "gold", "sente"], [8, 5, "gold", "sente"],
    [8, 7, "knight", "sente"], [8, 8, "lance", "sente"],
  ];

  const fixture = (): { state: GameState; cs: CardGameState } => {
    const board = emptyBoard();
    for (const [r, c, type, owner] of PIECES) board[r][c] = pc(type, owner);
    const state: GameState = {
      board,
      hand: { sente: {}, gote: { pawn: 1 } },
      currentPlayer: "gote",
      moveHistory: [],
      positionHistory: [],
      status: "active",
      moveCount: 22,
    };
    const cs = cardState({
      mana: { sente: 3, gote: 1 },
      hand: {
        sente: [
          { instanceId: "sente-double_pawn-11", defId: "double_pawn" },
          { instanceId: "sente-no_promote-6", defId: "no_promote" },
          { instanceId: "sente-pawn_return-2", defId: "pawn_return" },
        ],
        gote: [
          { instanceId: "gote-no_promote-6", defId: "no_promote" },
          { instanceId: "gote-double_pawn-9", defId: "double_pawn" },
          { instanceId: "gote-double_pawn-12", defId: "double_pawn" },
        ],
      },
      trap: {
        sente: { instanceId: "sente-no_promote-7", defId: "no_promote", owner: "sente" },
        gote: { instanceId: "gote-no_promote-8", defId: "no_promote", owner: "gote" },
      },
    });
    return { state, cs };
  };
  const fresh = () => createSearchContext({ timeLimitMs: 60000, useLearnedEval: false });

  it("カード枝がラベルを手番側に有利な方向へ大きく動かす (値が捨てられない)", () => {
    const { state, cs } = fixture();
    expect(getLabelCardActions({ gameState: state, cardState: cs, doubleMove: null }, CARD_SHOGI_VARIANT).length)
      .toBeGreaterThan(0);
    const moveOnly = evaluatePositionWorldMoveOnly(state, cs, DEPTH, CARD_SHOGI_VARIANT, fresh());
    const withCards = evaluatePositionWorldWithCards(state, cs, DEPTH, CARD_SHOGI_VARIANT, fresh());
    expect(moveOnly).not.toBeNull();
    expect(withCards).not.toBeNull();
    // 後手番なので、先手絶対視点では「下がる」= 後手にとって有利。実測 614cp 動く局面。
    expect((withCards as number)).toBeLessThan((moveOnly as number) - 100);
    // 実教材の中盤局面 + 深さ3 は 1 回 1 秒前後かかる (vitest 既定の 5s では足りない)。
  }, 30_000);

  // ★窓を絞る最適化に対する回帰テスト。
  // 段2 では速度のためにカード枝の探索窓を絞る案を 2 度試し、2 度とも「カードの価値が
  // 静かに消える」形で失敗した。この局面は **(-∞, -iter) に絞った瞬間 withCards が
  // moveOnly とビット単位で一致する** (= カードが 1 件も採用されない) 実データで、
  // full-window なら +120.3cp を拾う。窓を狭める変更を入れるとここが必ず落ちる。
  it("窓を絞ると消えるカード価値を full-window が拾う (40 手目・先手番)", () => {
    const board = emptyBoard();
    const pieces: [number, number, Piece["type"], Player][] = [
      [0, 4, "gold", "gote"], [0, 5, "gold", "gote"], [0, 7, "knight", "gote"],
      [1, 0, "pawn", "sente"], [1, 1, "promoted_pawn", "sente"], [1, 3, "silver", "gote"],
      [1, 4, "rook", "gote"], [1, 6, "king", "gote"], [1, 7, "bishop", "gote"], [1, 8, "lance", "gote"],
      [2, 2, "pawn", "gote"], [2, 3, "pawn", "gote"], [2, 4, "pawn", "gote"], [2, 5, "pawn", "gote"],
      [2, 6, "pawn", "gote"], [2, 7, "silver", "gote"], [2, 8, "pawn", "gote"],
      [5, 1, "pawn", "sente"], [5, 7, "pawn", "gote"],
      [6, 2, "pawn", "sente"], [6, 3, "pawn", "sente"], [6, 4, "pawn", "sente"], [6, 5, "pawn", "sente"],
      [6, 8, "pawn", "sente"],
      [7, 0, "lance", "sente"], [7, 1, "bishop", "sente"], [7, 3, "king", "sente"],
      [7, 5, "silver", "sente"], [7, 6, "rook", "sente"],
      [8, 1, "knight", "sente"], [8, 2, "silver", "sente"], [8, 3, "gold", "sente"],
      [8, 4, "gold", "sente"], [8, 5, "pawn", "sente"], [8, 7, "knight", "sente"], [8, 8, "lance", "sente"],
    ];
    for (const [r, c, type, owner] of pieces) board[r][c] = pc(type, owner);
    const state: GameState = {
      board,
      hand: { sente: { knight: 1, lance: 1, pawn: 2 }, gote: {} },
      currentPlayer: "sente",
      moveHistory: [],
      positionHistory: [],
      status: "active",
      moveCount: 40,
    };
    const cs = cardState({
      mana: { sente: 5, gote: 10 },
      hand: {
        sente: [
          { instanceId: "sente-no_promote-8", defId: "no_promote" },
          { instanceId: "sente-no_promote-6", defId: "no_promote" },
        ],
        gote: [
          { instanceId: "gote-double_pawn-12", defId: "double_pawn" },
          { instanceId: "gote-pawn_return-1", defId: "pawn_return" },
        ],
      },
      trap: {
        sente: null,
        gote: { instanceId: "gote-no_promote-8", defId: "no_promote", owner: "gote" },
      },
      noPromoteMarks: { sente: [{ row: 1, col: 0 }], gote: [] },
    });

    const moveOnly = evaluatePositionWorldMoveOnly(state, cs, 4, CARD_SHOGI_VARIANT, fresh());
    const withCards = evaluatePositionWorldWithCards(state, cs, 4, CARD_SHOGI_VARIANT, fresh());
    expect(moveOnly).not.toBeNull();
    expect(withCards).not.toBeNull();
    // 先手番なので先手絶対視点で「上がる」。実測 +120.3cp。
    expect((withCards as number)).toBeGreaterThan((moveOnly as number) + 100);
    // 深さ4 の実局面 2 回で 10 秒前後かかる。
  }, 60_000);
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

describe("S4c-1d: double_move (二手指し) の root 探索統合", () => {
  const dmCs = (over: Partial<CardGameState> = {}): CardGameState =>
    cardState({
      hand: { sente: [{ instanceId: "s-dm", defId: "double_move" } as CardInstance], gote: [] },
      mana: { sente: 12, gote: 12 },
      ...over,
    });
  // 飛(8,4)は無防備な金(5,3)へ1手で届かない(同row/col でない)。二手指しなら (8,4)→(8,3)→(5,3) で金得。
  const placeTwoMoveGain = (b: Board) => {
    b[8][8] = pc("king", "sente");
    b[0][0] = pc("king", "gote");
    b[8][4] = pc("rook", "sente");
    b[5][3] = pc("gold", "gote");
  };

  it("2手で無防備な金を取れる局面: bestAction=double_move + 合法な move ペア (2手目が金取り・玉取りでない)", () => {
    const gs = buildGameState(placeTwoMoveGain, "sente");
    const r = findBestMove(gs, "sente", DET_OPTIONS, CARD_SHOGI_VARIANT, worldCtx(), dmCs());
    expect(r).not.toBeNull();
    expect(r!.bestAction).toBeDefined();
    expect(r!.bestAction!.kind).toBe("playCard");
    if (r!.bestAction!.kind === "playCard") expect(r!.bestAction!.defId).toBe("double_move");
    // 実行用ペアが添付され、2手目で金を取る合法手。
    expect(r!.doubleMoveMoves).toBeDefined();
    expect(r!.doubleMoveMoves!.move2).not.toBeNull();
    expect(r!.doubleMoveMoves!.move2!.captured).toBe("gold");
    // B-3: 1手目・2手目とも玉取りでない (相手玉取りは常時禁止)。
    expect(r!.doubleMoveMoves!.move1.captured).not.toBe("king");
    expect(r!.doubleMoveMoves!.move2!.captured).not.toBe("king");
    // dm 線が rootActionScores に含まれ、move 最善より高評価 (駒得ゆえ)。
    const dmScore = r!.rootActionScores!.find(
      (a) => a.action.kind === "playCard" && a.action.defId === "double_move",
    )?.score;
    const bestMoveScore = Math.max(...r!.rootMoveScores.map((m) => m.score));
    expect(dmScore).toBeDefined();
    expect(dmScore!).toBeGreaterThan(bestMoveScore);
  });

  it("手札に double_move が無ければ bestAction は move、doubleMoveMoves 未設定 (隔離・無回帰)", () => {
    const gs = buildGameState(placeTwoMoveGain, "sente");
    // 手札空 = dm 候補が append されない → 従来 move-only + card なし経路。
    const r = findBestMove(gs, "sente", DET_OPTIONS, CARD_SHOGI_VARIANT, worldCtx(), cardState());
    expect(r).not.toBeNull();
    expect(r!.bestAction!.kind).toBe("move");
    expect(r!.doubleMoveMoves).toBeUndefined();
  });

  it("double_move 採用時のみ doubleMoveMoves を設定する整合性 (静かな少数駒局面)", () => {
    // 少数駒の静かな局面 (合法手が少なく dm ヘルパの m×n が小さい)。dm 採用/非採用いずれでも、
    // doubleMoveMoves は「bestAction=dm」と厳密に一致することを確認 (整合性の不変条件)。
    const place = (b: Board) => {
      b[8][8] = pc("king", "sente");
      b[0][0] = pc("king", "gote");
      b[6][4] = pc("pawn", "sente");
      b[2][4] = pc("pawn", "gote");
    };
    const gs = buildGameState(place, "sente");
    const r = findBestMove(gs, "sente", DET_OPTIONS, CARD_SHOGI_VARIANT, worldCtx(), dmCs());
    expect(r).not.toBeNull();
    const isDm = r!.bestAction!.kind === "playCard" && r!.bestAction!.defId === "double_move";
    expect(r!.doubleMoveMoves !== undefined).toBe(isDm);
    if (isDm) {
      expect(r!.doubleMoveMoves!.move1.captured).not.toBe("king");
      if (r!.doubleMoveMoves!.move2) expect(r!.doubleMoveMoves!.move2.captured).not.toBe("king");
    }
  }, 15000);
});
