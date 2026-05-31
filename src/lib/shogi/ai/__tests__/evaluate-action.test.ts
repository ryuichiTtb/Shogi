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
import { evaluateAction } from "../search";
import { computeCardDigest } from "../cards/digest";
import {
  getDrawValue,
  TRAP_VALUE_NO_PROMOTE,
  TRAP_VALUE_CHECK_BREAK,
} from "../cards/heuristics";
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
