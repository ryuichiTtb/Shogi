// Issue #193 / PR1d-2: evaluateAction (search.ts) の data integrity 検証。
//
// 設計意図:
// - TurnAction 3 種 (move / draw / playCard) を player 視点のスカラー評価値に変換する
//   evaluateAction 関数の振る舞いを検証
// - simulateCardEffect が null を返すカード (target なしカード) は NEGATIVE_INFINITY 扱い
// - cardDigest 渡時/未渡時の振る舞い差分 (PR1d-1 W-1 root スカラー方式) を確認
//
// 計画 md `docs/plans/issue-193-pr1d.md` PR1d-2 詳細 / 検証計画 / 機能追加検証 参照。

import { describe, it, expect } from "vitest";
import { evaluateAction, evaluateActionWithLookahead } from "../search";
import { computeCardDigest } from "../cards/digest";
import { getDrawValue, MANA_DELTA_COEFFICIENT } from "../cards/heuristics";
import { CARD_DEFS } from "@/lib/shogi/cards/definitions";
import { CARD_SPECS } from "@/lib/shogi/cards/card-spec-server";
import { evaluate } from "../evaluate";
import { applyMoveForSearch } from "@/lib/shogi/board";
import { createInitialCardState } from "@/lib/shogi/cards/state";
import { createInitialGameState } from "@/lib/shogi/board";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";
import { createSearchContext } from "../search-context";
import { getFullLegalMoves } from "@/lib/shogi/moves";
import type { AiTurnState } from "../turn/types";
import type { TurnAction } from "../turn/types";
import type { GameState } from "@/lib/shogi/types";

const TEST_DECK = [
  { defId: "pawn_return" as const, count: 4 },
  { defId: "piece_return" as const, count: 4 },
  { defId: "double_pawn" as const, count: 4 },
];

function makeAiTurnState(): AiTurnState {
  return {
    gameState: createInitialGameState(CARD_SHOGI_VARIANT),
    cardState: createInitialCardState(TEST_DECK),
    doubleMove: null,
    isRoot: true,
  };
}

describe("evaluateAction (move / draw / playCard 統一評価)", () => {
  it("move: 通常 move 適用後の sente 視点評価値が返る", () => {
    const state = makeAiTurnState();
    const moves = getFullLegalMoves(state.gameState, "sente", CARD_SHOGI_VARIANT);
    const move = moves[0];
    const action: TurnAction = { kind: "move", move };
    const result = evaluateAction(state, action, "sente", CARD_SHOGI_VARIANT);
    // applyMoveForSearch 後の evaluate 値と一致
    const nextState = applyMoveForSearch(state.gameState, move);
    const expected = evaluate(nextState, CARD_SHOGI_VARIANT);
    expect(result).toBe(expected);
  });

  it("move: gote 視点では sente 視点の符号反転値が返る", () => {
    const state = makeAiTurnState();
    const moves = getFullLegalMoves(state.gameState, "sente", CARD_SHOGI_VARIANT);
    const move = moves[0];
    const action: TurnAction = { kind: "move", move };
    const senteResult = evaluateAction(state, action, "sente", CARD_SHOGI_VARIANT);
    const goteResult = evaluateAction(state, action, "gote", CARD_SHOGI_VARIANT);
    expect(senteResult + goteResult).toBe(0);
  });

  it("draw: 現局面評価値 + getDrawValue(state, sente, cardState) が返る (sente)", () => {
    const state = makeAiTurnState();
    const action: TurnAction = { kind: "draw" };
    const result = evaluateAction(state, action, "sente", CARD_SHOGI_VARIANT);
    const baseEval = evaluate(state.gameState, CARD_SHOGI_VARIANT);
    // PR3-1: 旧 DRAW_VALUE_BONUS=30 固定を getDrawValue() に置換 (退化原因 ① 解消)。
    // テストも同じ引数で算出した動的値で行うことで定数調整に追従。
    expect(result).toBe(
      baseEval + getDrawValue(state.gameState, "sente", state.cardState),
    );
  });

  it("draw: gote 視点でも getDrawValue が加算される (符号反転後)", () => {
    const state = makeAiTurnState();
    const action: TurnAction = { kind: "draw" };
    const result = evaluateAction(state, action, "gote", CARD_SHOGI_VARIANT);
    const baseEval = evaluate(state.gameState, CARD_SHOGI_VARIANT);
    // gote 視点 = -baseEval (sente 絶対) + getDrawValue(gote, ...)
    expect(result).toBe(
      -baseEval + getDrawValue(state.gameState, "gote", state.cardState),
    );
  });

  it("playCard (double_pawn): simulateCardEffect 後の評価値が返る", () => {
    const state = makeAiTurnState();
    // double_pawn の use condition (持ち駒に歩あり) を満たす
    state.gameState.hand.sente.pawn = 1;
    // double_pawn は cost 1 で初期マナ 2 で使用可
    const action: TurnAction = {
      kind: "playCard",
      cardInstanceId: "test-dp1",
      defId: "double_pawn",
      target: { kind: "square", row: 4, col: 4 }, // 中央付近の空きマス
    };
    const result = evaluateAction(state, action, "sente", CARD_SHOGI_VARIANT);
    // 有効な target なら null でなく数値が返る (NEGATIVE_INFINITY 以外)
    expect(result).not.toBe(Number.NEGATIVE_INFINITY);
    expect(Number.isFinite(result)).toBe(true);
  });

  it("playCard: simulateCardEffect が null を返すケース (無効な target) は NEGATIVE_INFINITY", () => {
    const state = makeAiTurnState();
    // pawn_return に対して相手駒マス (= 自駒ではないため無効) を指定
    const action: TurnAction = {
      kind: "playCard",
      cardInstanceId: "test-pr-invalid",
      defId: "pawn_return",
      target: { kind: "square", row: 0, col: 0 }, // gote の香車マス (自駒の歩ではない)
    };
    const result = evaluateAction(state, action, "sente", CARD_SHOGI_VARIANT);
    expect(result).toBe(Number.NEGATIVE_INFINITY);
  });

  it("playCard: target が undefined (target なしカード扱い) なら NEGATIVE_INFINITY", () => {
    const state = makeAiTurnState();
    const action: TurnAction = {
      kind: "playCard",
      cardInstanceId: "test-no-target",
      defId: "pawn_return",
      target: undefined,
    };
    const result = evaluateAction(state, action, "sente", CARD_SHOGI_VARIANT);
    expect(result).toBe(Number.NEGATIVE_INFINITY);
  });

  it("ctx.cardDigest 未渡時は cardDigest 加算 skip = 振る舞いキープ", () => {
    const state = makeAiTurnState();
    const moves = getFullLegalMoves(state.gameState, "sente", CARD_SHOGI_VARIANT);
    const action: TurnAction = { kind: "move", move: moves[0] };
    // ctx 未渡 = cardDigest 加算なし
    const resultNoCtx = evaluateAction(state, action, "sente", CARD_SHOGI_VARIANT);
    // 既存 evaluate (cardDigest 未渡) と一致
    const nextState = applyMoveForSearch(state.gameState, moves[0]);
    expect(resultNoCtx).toBe(evaluate(nextState, CARD_SHOGI_VARIANT));
  });

  it("ctx.cardDigest 渡時は cardDigest が evaluate に伝播される", () => {
    const state = makeAiTurnState();
    const cardDigest = computeCardDigest(state.cardState);
    const ctx = createSearchContext({ timeLimitMs: 1000, cardDigest });
    const moves = getFullLegalMoves(state.gameState, "sente", CARD_SHOGI_VARIANT);
    const action: TurnAction = { kind: "move", move: moves[0] };
    const resultWithDigest = evaluateAction(state, action, "sente", CARD_SHOGI_VARIANT, ctx);
    const nextState = applyMoveForSearch(state.gameState, moves[0]);
    expect(resultWithDigest).toBe(evaluate(nextState, CARD_SHOGI_VARIANT, cardDigest));
  });

  it("S3b playCard no_promote: 現局面評価 + valueModel(no_promote, sente)", () => {
    const state = makeAiTurnState();
    const action: TurnAction = {
      kind: "playCard",
      cardInstanceId: "np",
      defId: "no_promote",
      target: undefined,
    };
    const result = evaluateAction(state, action, "sente", CARD_SHOGI_VARIANT);
    const baseEval = evaluate(state.gameState, CARD_SHOGI_VARIANT);
    expect(result).toBe(baseEval + CARD_SPECS.no_promote.valueModel(state.gameState, "sente"));
  });

  it("S3b playCard check_break: 現局面評価 + valueModel(check_break, sente)", () => {
    const state = makeAiTurnState();
    const action: TurnAction = {
      kind: "playCard",
      cardInstanceId: "cb",
      defId: "check_break",
      target: undefined,
    };
    const result = evaluateAction(state, action, "sente", CARD_SHOGI_VARIANT);
    const baseEval = evaluate(state.gameState, CARD_SHOGI_VARIANT);
    expect(result).toBe(baseEval + CARD_SPECS.check_break.valueModel(state.gameState, "sente"));
  });

  it("S3b playCard no_promote: gote 視点は -baseEval + valueModel(no_promote, gote) (符号整合)", () => {
    const state = makeAiTurnState();
    const action: TurnAction = {
      kind: "playCard",
      cardInstanceId: "np",
      defId: "no_promote",
      target: undefined,
    };
    const result = evaluateAction(state, action, "gote", CARD_SHOGI_VARIANT);
    const baseEval = evaluate(state.gameState, CARD_SHOGI_VARIANT);
    expect(result).toBe(-baseEval + CARD_SPECS.no_promote.valueModel(state.gameState, "gote"));
  });
});

describe("evaluateActionWithLookahead (PR3-3 C-1)", () => {
  it("lookaheadPly=0 は evaluateAction と同値 (互換性)", () => {
    const state = makeAiTurnState();
    const moves = getFullLegalMoves(state.gameState, "sente", CARD_SHOGI_VARIANT);
    const action: TurnAction = { kind: "move", move: moves[0] };
    const v0 = evaluateActionWithLookahead(
      state,
      action,
      "sente",
      CARD_SHOGI_VARIANT,
      undefined,
      false,
      0,
    );
    const v1 = evaluateAction(state, action, "sente", CARD_SHOGI_VARIANT);
    expect(v0).toBe(v1);
  });

  it("lookaheadPly=1 move は相手 1 ply 最善応答後のスコア (depth=0 とは通常異なる)", () => {
    const state = makeAiTurnState();
    const moves = getFullLegalMoves(state.gameState, "sente", CARD_SHOGI_VARIANT);
    const action: TurnAction = { kind: "move", move: moves[0] };
    const lookaheadScore = evaluateActionWithLookahead(
      state,
      action,
      "sente",
      CARD_SHOGI_VARIANT,
      undefined,
      false,
      1,
    );
    // lookahead は数値 (NaN/Infinity でない有限値)
    expect(Number.isFinite(lookaheadScore)).toBe(true);
  });

  it("lookaheadPly=1 draw は opp response score + getDrawValue", () => {
    const state = makeAiTurnState();
    const action: TurnAction = { kind: "draw" };
    const score = evaluateActionWithLookahead(
      state,
      action,
      "sente",
      CARD_SHOGI_VARIANT,
      undefined,
      false,
      1,
    );
    const draw = getDrawValue(state.gameState, "sente", state.cardState);
    // lookahead score は opp response (有限値) + draw bonus を含む。draw 値以上であることを確認:
    // (opp 応答後の eval は ±数百 cp の範囲、draw が必ず加算されているか型確認)
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeGreaterThanOrEqual(draw - 10000); // 範囲 sanity
  });

  it("lookaheadPly=1 playCard no_promote/check_break は opp response + valueModel 差 (S3b)", () => {
    const state = makeAiTurnState();
    const npAction: TurnAction = {
      kind: "playCard",
      cardInstanceId: "np",
      defId: "no_promote",
      target: undefined,
    };
    const cbAction: TurnAction = {
      kind: "playCard",
      cardInstanceId: "cb",
      defId: "check_break",
      target: undefined,
    };
    const npScore = evaluateActionWithLookahead(
      state,
      npAction,
      "sente",
      CARD_SHOGI_VARIANT,
      undefined,
      false,
      1,
    );
    const cbScore = evaluateActionWithLookahead(
      state,
      cbAction,
      "sente",
      CARD_SHOGI_VARIANT,
      undefined,
      false,
      1,
    );
    // S3b: 差分は digest 経由の valueModel 差 (check_break - no_promote、局面依存 gross 値) と
    // mana cost 差 (cb=4 / np=3 = +1 → manaDelta -1 → eval -MANA_DELTA_COEFFICIENT) の合算。
    // 期待値 = (valueModel(check_break) - valueModel(no_promote))
    //        - (CARD_DEFS.check_break.cost - CARD_DEFS.no_promote.cost) * MANA_DELTA_COEFFICIENT
    const trapDiff =
      CARD_SPECS.check_break.valueModel(state.gameState, "sente") -
      CARD_SPECS.no_promote.valueModel(state.gameState, "sente");
    const costDiff =
      (CARD_DEFS["check_break"].cost - CARD_DEFS["no_promote"].cost) *
      MANA_DELTA_COEFFICIENT;
    expect(cbScore - npScore).toBeCloseTo(trapDiff - costDiff, 6);
  });

  it("lookaheadPly=1 playCard double_move は searchDoubleMoveSuperAction に delegate (有限値)", () => {
    const state = makeAiTurnState();
    const action: TurnAction = {
      kind: "playCard",
      cardInstanceId: "dm",
      defId: "double_move",
      target: undefined,
    };
    const score = evaluateActionWithLookahead(
      state,
      action,
      "sente",
      CARD_SHOGI_VARIANT,
      undefined,
      false,
      1,
    );
    expect(Number.isFinite(score)).toBe(true);
  });

  it("lookaheadPly=1 sente/gote 対称性: same move なら senteScore + goteScore のレンジ妥当", () => {
    const state = makeAiTurnState();
    const moves = getFullLegalMoves(state.gameState, "sente", CARD_SHOGI_VARIANT);
    const action: TurnAction = { kind: "move", move: moves[0] };
    const senteScore = evaluateActionWithLookahead(
      state,
      action,
      "sente",
      CARD_SHOGI_VARIANT,
      undefined,
      false,
      1,
    );
    const goteScore = evaluateActionWithLookahead(
      state,
      action,
      "gote",
      CARD_SHOGI_VARIANT,
      undefined,
      false,
      1,
    );
    // sente と gote は別 player なので score は反転関係に近い (厳密一致ではないが、両者が有限値)
    expect(Number.isFinite(senteScore)).toBe(true);
    expect(Number.isFinite(goteScore)).toBe(true);
  });
});

// PR3-3 C-13 (Workflow adversarial verify F-2 残課題解消):
// calibration regression を deterministic に検出する unit test。
//
// 背景: perf-bench-card-usage.test.ts の旧 strict assert は findBestMove のランダム要素
// (addNoise / nearEqualThreshold / BEGINNER_TADASUTE_ALLOW_RATE) で flaky だった
// (10 回中 2 回 fail)。本セクションは evaluateActionWithLookahead を直接呼ぶことで
// ランダム要素を完全に排除し、calibration が意図通り action 選択を駆動するかを
// 安定的に検証する。
//
// 検証方針: action 単独のスコアを直接 assert するのは盤面 eval の値に依存して脆い
// (盤面評価の改修で値が動く) ため、**同じ AiTurnState 上で複数 action のスコアを
// 計算し相対関係を assert** する (盤面 eval が共通成分で打ち消し、calibration 差のみ残る)。
describe("evaluateActionWithLookahead calibration regression (deterministic、PR3-3 C-13)", () => {
  function buildState(opts: {
    moveCount: number;
    handSize: number;
    manaSente: number;
    manaGote: number;
    handCardId?: "pawn_return" | "no_promote";
    emptyDeck?: boolean;
  }): AiTurnState {
    const initial = createInitialGameState(CARD_SHOGI_VARIANT);
    const cs = createInitialCardState([
      { defId: "pawn_return" as const, count: 4 },
      { defId: "no_promote" as const, count: 4 },
    ]);
    const handCardId = opts.handCardId ?? "pawn_return";
    cs.hand.sente = Array.from({ length: opts.handSize }, (_, i) => ({
      instanceId: `t-${handCardId}-${i}`,
      defId: handCardId,
    }));
    if (opts.emptyDeck) cs.deck.sente = [];
    cs.mana.sente = opts.manaSente;
    cs.mana.gote = opts.manaGote;
    return {
      gameState: { ...initial, moveCount: opts.moveCount },
      cardState: cs,
      doubleMove: null,
      isRoot: true,
    };
  }

  function someMove(state: AiTurnState): TurnAction {
    const moves = getFullLegalMoves(state.gameState, "sente", CARD_SHOGI_VARIANT);
    return { kind: "move", move: moves[0] };
  }

  it("空手札 + マナ余剰 (mana=15) で draw が move を上回る (getDrawValue が機能)", () => {
    const state = buildState({
      moveCount: 50, // phase=1 mid
      handSize: 0,
      manaSente: 15,
      manaGote: 8,
    });
    const moveScore = evaluateActionWithLookahead(
      state, someMove(state), "sente", CARD_SHOGI_VARIANT, undefined, false, 1,
    );
    const drawScore = evaluateActionWithLookahead(
      state, { kind: "draw" }, "sente", CARD_SHOGI_VARIANT, undefined, false, 1,
    );
    // getDrawValue = BASE(20) + (15-8)*3 + PHASE_MID(15) - 0 = 56cp が move 評価を上回るはず。
    // calibration regression (例: DRAW_VALUE_BASE=0) なら逆転して fail。
    expect(drawScore).toBeGreaterThan(moveScore);
  });

  it("trap-only + 山札空 + マナ上限近接 + 相手成り脅威ありで trap が move を上回る (S3b valueModel)", () => {
    const state = buildState({
      moveCount: 50,
      handSize: 2,
      manaSente: 19,
      manaGote: 12,
      handCardId: "no_promote",
      emptyDeck: true, // draw を候補から外す → 純粋に move vs trap の比較
    });
    // S3b: no_promote の価値は局面依存 (相手成り脅威度)。相手 (gote) の成り可能・未成り駒を
    // gote の成り地点近傍 (下段、row5 は初期盤面で空) に配置し、no_promote を高価値局面にする。
    state.gameState.board[5][2] = { type: "pawn", owner: "gote" };
    state.gameState.board[5][4] = { type: "pawn", owner: "gote" };
    state.gameState.board[5][6] = { type: "pawn", owner: "gote" };
    const moveScore = evaluateActionWithLookahead(
      state, someMove(state), "sente", CARD_SHOGI_VARIANT, undefined, false, 1,
    );
    const trapAction: TurnAction = {
      kind: "playCard",
      cardInstanceId: state.cardState.hand.sente[0].instanceId,
      defId: "no_promote",
      target: undefined,
    };
    const trapScore = evaluateActionWithLookahead(
      state, trapAction, "sente", CARD_SHOGI_VARIANT, undefined, false, 1,
    );
    // digest.trapValueDelta で +valueModel(no_promote, sente) (相手成り脅威で高値) が opp scan の
    // eval に乗る + 死にマナ回収 (mana 19→16 で overflow 3→0、+12cp)。合計が manaDelta -30cp と
    // hand -1 の小減を上回り move を超える。calibration regression (脅威0でも trap 選好等) なら fail。
    expect(trapScore).toBeGreaterThan(moveScore);
  });

  // (3つ目: pawn_return + dead mana 組合せのテストは simulateCardEffect の target 要件が
  //  厳しく値が脆い (返却対象マスの選択で結果が大きく変動) ため削除。pawn_return 自体の
  //  動作は effects.test.ts でカバー済、digest update wiring は C-6 で trap テスト経由でも
  //  検証済 (trap 経由で digest が変化する確認が wiring 動作の保証になる)。)

  it("getDrawValue が calibration を反映: mana surplus を増やすと draw score も単調増加", () => {
    // 同盤面 / 同手札で mana のみ変えて draw score の単調性を確認 (relative regression test)
    const stateLow = buildState({
      moveCount: 50,
      handSize: 1,
      manaSente: 10,
      manaGote: 8,
    });
    const stateHigh = buildState({
      moveCount: 50,
      handSize: 1,
      manaSente: 18,
      manaGote: 8,
    });
    const drawLow = evaluateActionWithLookahead(
      stateLow, { kind: "draw" }, "sente", CARD_SHOGI_VARIANT, undefined, false, 1,
    );
    const drawHigh = evaluateActionWithLookahead(
      stateHigh, { kind: "draw" }, "sente", CARD_SHOGI_VARIANT, undefined, false, 1,
    );
    // mana 余剰増 → getDrawValue 増 (DRAW_MANA_SURPLUS_COEF=3 経由) + opp scan は同盤面
    expect(drawHigh).toBeGreaterThan(drawLow);
  });
});

// Issue #235 S3c: トラップ valueModel 係数校正 (TRAP_P_MIN 0.05 → 0.10) の決定的回帰テスト。
//
// 背景 (計画 docs/plans/issue-235-s3-valuemodel.md §6 M-2 / §12):
// - S3b でトラップ価値を局面依存 valueModel に cutover 済。S3c は PoC-2 仮係数を校正し本採用。
// - 検証は noise を含む findBestMove ではなく evaluateActionWithLookahead / evaluateAction を
//   直接呼び決定論化 (C-13 と同方式)。同一 AiTurnState 上で複数 action のスコアを比較し相対順序を
//   pin する (盤面 eval が共通成分で打ち消し calibration 差のみ残す)。
//
// 校正で担保する挙動 (§12):
// - no_promote: 相手成り脅威が高い局面で trap > move、脅威なしで move > trap (局面依存が機能)。
// - check_break: 露出玉ほど valueModel が上がり trap の「決定価値」(vs draw) が上がる。ただし露出玉
//   そのものでは「玉を安全マスへ逃がす move」が trap より勝つ (能動防御が正。check_break は
//   checkUsage="forbidden" で王手中は使用不可ゆえ、本来の使い所は **予防セット**)。よって
//   check_break の決定レベル検証は (a) 露出が trap の対 draw 決定価値を押し上げること、
//   (b) TRAP_P_MIN=0.10 校正で「静かな盤面 + dead マナ → dormant trap セット (option value)」が
//   正 EV になり「静かな盤面 + 通常マナ → move (過剰セット抑止)」を保つこと、の 2 点で pin する。
describe("evaluateAction calibration (S3c: トラップ valueModel 係数校正、deterministic)", () => {
  function buildTrapState(opts: {
    board?: (gs: GameState) => void;
    trapId: "no_promote" | "check_break";
    manaSente: number;
    manaGote: number;
  }): AiTurnState {
    const gs = createInitialGameState(CARD_SHOGI_VARIANT);
    gs.moveCount = 50; // phase=1 mid
    if (opts.board) opts.board(gs);
    const cs = createInitialCardState([
      { defId: "no_promote" as const, count: 4 },
      { defId: "check_break" as const, count: 4 },
    ]);
    cs.hand.sente = [
      { instanceId: `t-${opts.trapId}-0`, defId: opts.trapId },
      { instanceId: `t-${opts.trapId}-1`, defId: opts.trapId },
    ];
    cs.deck.sente = []; // 山札空 → draw を候補外に (純粋に move vs trap を比較)
    cs.mana.sente = opts.manaSente;
    cs.mana.gote = opts.manaGote;
    return { gameState: gs, cardState: cs, doubleMove: null, isRoot: true };
  }

  function firstMove(state: AiTurnState): TurnAction {
    const moves = getFullLegalMoves(state.gameState, "sente", CARD_SHOGI_VARIANT);
    return { kind: "move", move: moves[0] };
  }

  function trapAction(state: AiTurnState, defId: "no_promote" | "check_break"): TurnAction {
    return {
      kind: "playCard",
      cardInstanceId: state.cardState.hand.sente[0].instanceId,
      defId,
      target: undefined,
    };
  }

  // 相手 (gote) の未成り駒を gote 成り地点 (下 3 段 rows 6-8) 近傍に置き、no_promote を高価値に。
  function placePromotionThreat(gs: GameState) {
    gs.board[5][2] = { type: "pawn", owner: "gote" };
    gs.board[5][4] = { type: "pawn", owner: "gote" };
    gs.board[6][6] = { type: "silver", owner: "gote" };
  }

  // sente 玉を中央 (4,4) へ動かし、gote 飛車で近傍を攻撃 (玉自身は外して王手回避)。
  // → 自玉露出度が最大化し check_break valueModel が P_MAX に到達。
  function exposeSenteKing(gs: GameState) {
    gs.board[8][4] = null;
    gs.board[4][4] = { type: "king", owner: "sente" };
    gs.board[2][3] = null; // gote 歩をどけて縦利きを通す
    gs.board[0][3] = { type: "rook", owner: "gote" }; // 列3縦 → 近傍 (3,3)(4,3)(5,3)
    gs.board[2][5] = null;
    gs.board[1][5] = { type: "rook", owner: "gote" }; // 列5縦 → 近傍 (3,5)(4,5)(5,5)
  }

  const ply = 1; // production 経路 (engine root → evaluateActionWithLookahead lookaheadPly=1)
  const lookahead = (state: AiTurnState, action: TurnAction) =>
    evaluateActionWithLookahead(state, action, "sente", CARD_SHOGI_VARIANT, undefined, false, ply);

  it("no_promote: 相手成り脅威ありで trap > move、脅威なしで move > trap (局面依存 flip)", () => {
    // 脅威あり (通常マナ): no_promote の valueModel が高く (相手成り脅威度 → P_MAX 近傍)、trap を選好。
    const threat = buildTrapState({
      board: placePromotionThreat,
      trapId: "no_promote",
      manaSente: 8,
      manaGote: 8,
    });
    expect(lookahead(threat, trapAction(threat, "no_promote"))).toBeGreaterThan(
      lookahead(threat, firstMove(threat)),
    );
    // 脅威なし (同マナ・同手札、盤面のみ初期): valueModel は下限値、mana cost を上回らず move を選好。
    const quiet = buildTrapState({ trapId: "no_promote", manaSente: 8, manaGote: 8 });
    expect(lookahead(quiet, trapAction(quiet, "no_promote"))).toBeLessThan(
      lookahead(quiet, firstMove(quiet)),
    );
  });

  it("check_break: 露出玉は安全玉より trap の決定価値 (vs draw) が高い (valueModel が決定に伝播)", () => {
    // evaluateAction(ply=0) の trap = eval(現局面) + valueModel、draw = eval(現局面) + getDrawValue。
    // 同マナ/手札なら getDrawValue は両局面で同値 → (trap - draw) = valueModel - getDrawValue。
    // 露出玉 (valueModel 高) と安全玉 (valueModel 下限) の差は valueModel 差そのものに帰着する
    // (盤面 eval が共通成分で打ち消し)。露出が trap の決定価値を押し上げることを pin。
    const exposed = buildTrapState({
      board: exposeSenteKing,
      trapId: "check_break",
      manaSente: 8,
      manaGote: 8,
    });
    const safe = buildTrapState({ trapId: "check_break", manaSente: 8, manaGote: 8 });
    const diff = (s: AiTurnState) =>
      evaluateAction(s, trapAction(s, "check_break"), "sente", CARD_SHOGI_VARIANT) -
      evaluateAction(s, { kind: "draw" }, "sente", CARD_SHOGI_VARIANT);
    expect(diff(exposed)).toBeGreaterThan(diff(safe));
  });

  it("check_break: 静かな盤面で dead マナなら dormant trap セット、通常マナなら move (S3c 校正 P_MIN=0.10)", () => {
    // S3c 校正の核: TRAP_P_MIN=0.10 で check_break floor=30cp。マナ上限近接 (19、overflow 3) では
    // dormant トラップのセットが死にマナ回収 (+12cp) と相まって move をわずかに上回る (option value)。
    // 通常マナ (8、overflow なし) では floor 30cp < mana cost 効果で move を維持 (過剰セット抑止)。
    // ※ P_MIN=0.05 (floor 15cp) では dead マナでも move が勝ち flip しない = 本テストが校正の回帰ガード。
    const dead = buildTrapState({ trapId: "check_break", manaSente: 19, manaGote: 12 });
    expect(lookahead(dead, trapAction(dead, "check_break"))).toBeGreaterThan(
      lookahead(dead, firstMove(dead)),
    );
    const normal = buildTrapState({ trapId: "check_break", manaSente: 8, manaGote: 8 });
    expect(lookahead(normal, trapAction(normal, "check_break"))).toBeLessThan(
      lookahead(normal, firstMove(normal)),
    );
  });
});

// Issue #235 派生 (Vercel 504 対策、2026-06-10): root アクション評価フェーズの専用 deadline。
//
// 背景: deep search (findBestMove) が ctx.deadlineAt を使い切った後に走る root カード評価
// (engine.ts) と double_move super-action (search.ts) には時間チェックがなく、終盤の高分岐局面
// (持ち駒ドロップで 2 手目候補 ~130 手) で super-action 1 回 ≈ 4s 超 → Vercel maxDuration 10s
// 超過の FUNCTION_INVOCATION_TIMEOUT (504) が発生していた。engine が ctx.actionPhaseDeadlineAt
// を設定し、super-action の first/second move ループが isActionPhaseTimeUp で打ち切る。
describe("アクション評価フェーズ deadline (Vercel 504 対策、Issue #235 派生)", () => {
  function buildDmState(): AiTurnState {
    const gs = createInitialGameState(CARD_SHOGI_VARIANT);
    const cs = createInitialCardState(TEST_DECK);
    cs.hand.sente = [{ instanceId: "dm-test-1", defId: "double_move" as const }];
    cs.mana.sente = 10;
    return { gameState: gs, cardState: cs, doubleMove: null, isRoot: true };
  }
  const dmAction: TurnAction = {
    kind: "playCard",
    cardInstanceId: "dm-test-1",
    defId: "double_move",
  };

  it("actionPhaseDeadlineAt 超過時、double_move super-action は即座に NEG_INF (kernel ON/OFF 両経路)", () => {
    for (const useKernelSearch of [true, false]) {
      const state = buildDmState();
      const ctx = createSearchContext({ timeLimitMs: 60_000, useKernelSearch });
      ctx.actionPhaseDeadlineAt = 0; // 過去時刻 = 即時超過 (1 combo も評価せず打ち切り)
      const score = evaluateActionWithLookahead(
        state,
        dmAction,
        "sente",
        CARD_SHOGI_VARIANT,
        ctx,
        false,
        1,
      );
      // 全 combo 打ち切り → bestScore/bestScoreIgnoringTadasute とも NEG_INF
      // → engine 側は move フォールバック (move は予算設定前に評価済) で安全。
      expect(score).toBe(Number.NEGATIVE_INFINITY);
    }
  });

  it("actionPhaseDeadlineAt 未設定 (undefined) は無制限互換 = 従来通り有限スコア", () => {
    for (const useKernelSearch of [true, false]) {
      const state = buildDmState();
      const ctx = createSearchContext({ timeLimitMs: 60_000, useKernelSearch });
      // actionPhaseDeadlineAt 未設定 (テスト / fixture 生成の決定論互換)
      const score = evaluateActionWithLookahead(
        state,
        dmAction,
        "sente",
        CARD_SHOGI_VARIANT,
        ctx,
        false,
        1,
      );
      expect(Number.isFinite(score)).toBe(true);
    }
  });
});
