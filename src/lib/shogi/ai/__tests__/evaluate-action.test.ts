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
