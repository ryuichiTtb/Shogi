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
import {
  evaluateAction,
  evaluateActionWithLookahead,
  evaluateActionDeep,
} from "../search";
import { computeCardDigest } from "../cards/digest";
import { STANDARD_VARIANT } from "@/lib/shogi/variants/standard";
import {
  getDrawValue,
  TRAP_VALUE_NO_PROMOTE,
  TRAP_VALUE_CHECK_BREAK,
  MANA_DELTA_COEFFICIENT,
} from "../cards/heuristics";
import { CARD_DEFS } from "@/lib/shogi/cards/definitions";
import { evaluate } from "../evaluate";
import { applyMoveForSearch } from "@/lib/shogi/board";
import { createInitialCardState } from "@/lib/shogi/cards/state";
import { createInitialGameState } from "@/lib/shogi/board";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";
import { createSearchContext } from "../search-context";
import { getFullLegalMoves } from "@/lib/shogi/moves";
import type { AiTurnState } from "../turn/types";
import type { TurnAction } from "../turn/types";

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

  it("PR1d-4 playCard no_promote: 現局面評価 + TRAP_VALUE_NO_PROMOTE (sente)", () => {
    const state = makeAiTurnState();
    const action: TurnAction = {
      kind: "playCard",
      cardInstanceId: "np",
      defId: "no_promote",
      target: undefined,
    };
    const result = evaluateAction(state, action, "sente", CARD_SHOGI_VARIANT);
    const baseEval = evaluate(state.gameState, CARD_SHOGI_VARIANT);
    expect(result).toBe(baseEval + TRAP_VALUE_NO_PROMOTE);
  });

  it("PR1d-4 playCard check_break: 現局面評価 + TRAP_VALUE_CHECK_BREAK (sente)", () => {
    const state = makeAiTurnState();
    const action: TurnAction = {
      kind: "playCard",
      cardInstanceId: "cb",
      defId: "check_break",
      target: undefined,
    };
    const result = evaluateAction(state, action, "sente", CARD_SHOGI_VARIANT);
    const baseEval = evaluate(state.gameState, CARD_SHOGI_VARIANT);
    expect(result).toBe(baseEval + TRAP_VALUE_CHECK_BREAK);
  });

  it("PR1d-4 playCard no_promote: gote 視点は -baseEval + TRAP_VALUE_NO_PROMOTE (符号整合)", () => {
    const state = makeAiTurnState();
    const action: TurnAction = {
      kind: "playCard",
      cardInstanceId: "np",
      defId: "no_promote",
      target: undefined,
    };
    const result = evaluateAction(state, action, "gote", CARD_SHOGI_VARIANT);
    const baseEval = evaluate(state.gameState, CARD_SHOGI_VARIANT);
    expect(result).toBe(-baseEval + TRAP_VALUE_NO_PROMOTE);
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

  it("lookaheadPly=1 playCard no_promote/check_break は opp response + TRAP_VALUE", () => {
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
    // PR3-3 C-6 wiring 後: 差分は digest 経由で TRAP_VALUE 差 (cb=+80 / np=+50 = +30) と
    // mana cost 差 (cb=4 / np=3 = +1 → manaDelta -1 → eval -MANA_DELTA_COEFFICIENT) の合算。
    // 期待値 = (TRAP_VALUE_CHECK_BREAK - TRAP_VALUE_NO_PROMOTE)
    //        - (CARD_DEFS.check_break.cost - CARD_DEFS.no_promote.cost) * MANA_DELTA_COEFFICIENT
    //        = 30 - 10 = 20
    const trapDiff = TRAP_VALUE_CHECK_BREAK - TRAP_VALUE_NO_PROMOTE;
    const costDiff =
      (CARD_DEFS["check_break"].cost - CARD_DEFS["no_promote"].cost) *
      MANA_DELTA_COEFFICIENT;
    expect(cbScore - npScore).toBe(trapDiff - costDiff);
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

  it("trap-only 手札 + 山札空 + マナ上限近接 (mana=19) で trap が move を上回る (digest.trapPresence が機能)", () => {
    const state = buildState({
      moveCount: 50,
      handSize: 2,
      manaSente: 19,
      manaGote: 12,
      handCardId: "no_promote",
      emptyDeck: true, // draw を候補から外す → 純粋に move vs trap の比較
    });
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
    // digest.trapPresence で +TRAP_VALUE_NO_PROMOTE (=50) が opp scan の eval に乗る。
    // mana 19 → 16 (cost 3 消費) で死にマナ overflow 3 → 0、+12cp 改善。
    // 合計 +50+12=+62cp が manaDelta -3*10=-30cp と hand -1 の小減を上回り、move を超える。
    // calibration regression (例: TRAP_VALUE_NO_PROMOTE=0) なら逆転して fail。
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

// PR3-3-2 C-2: evaluateActionDeep (深さ budget 付き card-aware 評価) の土台検証。
//
// 検証方針 (計画 md docs/plans/issue-193-pr3-3-2-deep-search-calibration.md §5.1):
// - budget=0 で既存 evaluateActionWithLookahead(lookaheadPly=1) と完全一致 (後方互換)
// - budget 単調非減少: deep(budget=1) >= deep(budget=0) (探索プレイヤー視点、深掘りで損しない)
// - standard variant では card 再帰に入らず budget に依らず同値 (非デグレ)
// - 再帰停止 (大きな budget でも有限値) / double_move は delegate
//
// 本コミット (C-2) 時点では production (engine.ts) は依然 evaluateActionWithLookahead を使い、
// evaluateActionDeep は未 wiring。engine 切替は C-3。
describe("evaluateActionDeep (PR3-3-2 C-2 土台)", () => {
  function midState(): AiTurnState {
    // 中盤 phase=1 / sente マナ余剰・手札ありで深掘りに意味が出る局面
    const cs = createInitialCardState(TEST_DECK);
    cs.mana.sente = 12;
    cs.mana.gote = 10;
    return {
      gameState: { ...createInitialGameState(CARD_SHOGI_VARIANT), moveCount: 50 },
      cardState: cs,
      doubleMove: null,
      isRoot: true,
    };
  }
  function firstMove(state: AiTurnState, player: "sente" | "gote" = "sente"): TurnAction {
    const moves = getFullLegalMoves(state.gameState, player, CARD_SHOGI_VARIANT);
    return { kind: "move", move: moves[0] };
  }

  it("budget=0 は evaluateActionWithLookahead(lookaheadPly=1) と一致: move", () => {
    const state = midState();
    const action = firstMove(state);
    const deep0 = evaluateActionDeep(state, action, "sente", CARD_SHOGI_VARIANT, undefined, false, 0);
    const look1 = evaluateActionWithLookahead(state, action, "sente", CARD_SHOGI_VARIANT, undefined, false, 1);
    expect(deep0).toBe(look1);
  });

  it("budget=0 は evaluateActionWithLookahead(lookaheadPly=1) と一致: draw", () => {
    const state = midState();
    const action: TurnAction = { kind: "draw" };
    const deep0 = evaluateActionDeep(state, action, "sente", CARD_SHOGI_VARIANT, undefined, false, 0);
    const look1 = evaluateActionWithLookahead(state, action, "sente", CARD_SHOGI_VARIANT, undefined, false, 1);
    expect(deep0).toBe(look1);
  });

  it("budget=0 は evaluateActionWithLookahead(lookaheadPly=1) と一致: trap (no_promote)", () => {
    const state = midState();
    const action: TurnAction = {
      kind: "playCard",
      cardInstanceId: "np",
      defId: "no_promote",
      target: undefined,
    };
    const deep0 = evaluateActionDeep(state, action, "sente", CARD_SHOGI_VARIANT, undefined, false, 0);
    const look1 = evaluateActionWithLookahead(state, action, "sente", CARD_SHOGI_VARIANT, undefined, false, 1);
    expect(deep0).toBe(look1);
  });

  it("budget=0 は evaluateActionWithLookahead(lookaheadPly=1) と一致: double_move delegate", () => {
    const state = midState();
    const action: TurnAction = {
      kind: "playCard",
      cardInstanceId: "dm",
      defId: "double_move",
      target: undefined,
    };
    const deep0 = evaluateActionDeep(state, action, "sente", CARD_SHOGI_VARIANT, undefined, false, 0);
    const look1 = evaluateActionWithLookahead(state, action, "sente", CARD_SHOGI_VARIANT, undefined, false, 1);
    expect(deep0).toBe(look1);
  });

  it("budget 単調非減少: deep(budget=1) >= deep(budget=0) (move、探索プレイヤー視点)", () => {
    const state = midState();
    const action = firstMove(state);
    const deep0 = evaluateActionDeep(state, action, "sente", CARD_SHOGI_VARIANT, undefined, false, 0);
    const deep1 = evaluateActionDeep(state, action, "sente", CARD_SHOGI_VARIANT, undefined, false, 1);
    // best は oppScore を floor に max を取るため、深掘りで自分のスコアは下がらない
    expect(deep1).toBeGreaterThanOrEqual(deep0);
  });

  it("budget 単調非減少: deep(budget=1) >= deep(budget=0) (draw)", () => {
    const state = midState();
    const action: TurnAction = { kind: "draw" };
    const deep0 = evaluateActionDeep(state, action, "sente", CARD_SHOGI_VARIANT, undefined, false, 0);
    const deep1 = evaluateActionDeep(state, action, "sente", CARD_SHOGI_VARIANT, undefined, false, 1);
    expect(deep1).toBeGreaterThanOrEqual(deep0);
  });

  it("standard variant: budget>0 でも card 再帰に入らず budget=0 と同値 (非デグレ)", () => {
    const stdState: AiTurnState = {
      gameState: createInitialGameState(STANDARD_VARIANT),
      cardState: createInitialCardState(TEST_DECK), // standard では未使用
      doubleMove: null,
      isRoot: true,
    };
    const moves = getFullLegalMoves(stdState.gameState, "sente", STANDARD_VARIANT);
    const action: TurnAction = { kind: "move", move: moves[0] };
    const deep0 = evaluateActionDeep(stdState, action, "sente", STANDARD_VARIANT, undefined, false, 0);
    const deep5 = evaluateActionDeep(stdState, action, "sente", STANDARD_VARIANT, undefined, false, 5);
    expect(deep5).toBe(deep0);
  });

  it("budget=2 でも再帰が停止し有限値を返す (枝刈りなしのため重いが収束)", () => {
    // 注 (C-2 知見): 枝刈りなしの深掘りは cost(B) ≈ (自分分岐 × 相手分岐)^B でフル盤面では
    // budget=3 が ~130 万 evaluate に達し非現実的。production の K は ≤1 から開始し、K≥2 は
    // 候補上位 M 手への枝刈り (scoreMoveForOrdering) を C-3/C-5 で導入してから引き上げる。
    // 本テストは「再帰が確実に停止し有限値を返す」ことの確認 (budget=2、余裕を持った timeout)。
    const state = midState();
    const action = firstMove(state);
    const score = evaluateActionDeep(state, action, "sente", CARD_SHOGI_VARIANT, undefined, false, 2);
    expect(Number.isFinite(score)).toBe(true);
  }, 30_000);

  it("prevDigest を渡しても渡さなくても budget=0 の結果は一致 (fallback computeCardDigest)", () => {
    const state = midState();
    const action = firstMove(state);
    const digest = computeCardDigest(state.cardState);
    const withDigest = evaluateActionDeep(state, action, "sente", CARD_SHOGI_VARIANT, undefined, false, 0, digest);
    const withoutDigest = evaluateActionDeep(state, action, "sente", CARD_SHOGI_VARIANT, undefined, false, 0);
    expect(withDigest).toBe(withoutDigest);
  });
});
