// Issue #193 / PR1d-3: double_move super-action 探索の data integrity 検証。
//
// 設計意図:
// - コミット 1: CurrentRules.applyAction の二手指し制御 (turnEnded / doubleMove 遷移)
// - コミット 2: search.ts super-action 内部探索 (player 反転禁止 / α/β 継承 /
//   DOUBLE_MOVE_TOP_K フォールバック) ← 本コミットでは未追加
//
// 計画 md `docs/plans/issue-193-pr1d.md` PR1d-3 詳細 / 検証計画 参照。

import { describe, it, expect } from "vitest";
import { CurrentRules } from "../turn/current-rules";
import { createInitialCardState } from "@/lib/shogi/cards/state";
import { createInitialGameState } from "@/lib/shogi/board";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";
import { getFullLegalMoves } from "@/lib/shogi/moves";
import type { AiTurnState, TurnAction } from "../turn/types";

const TEST_DECK = [
  { defId: "double_move" as const, count: 4 },
  { defId: "pawn_return" as const, count: 4 },
];

function makeAiTurnState(): AiTurnState {
  return {
    gameState: createInitialGameState(CARD_SHOGI_VARIANT),
    cardState: createInitialCardState(TEST_DECK),
    doubleMove: null,
    isRoot: true,
  };
}

function firstLegalMove(state: AiTurnState): TurnAction {
  const moves = getFullLegalMoves(state.gameState, "sente", CARD_SHOGI_VARIANT);
  return { kind: "move", move: moves[0] };
}

describe("CurrentRules.applyAction 二手指し制御 (PR1d-3 コミット 1)", () => {
  const rules = new CurrentRules(CARD_SHOGI_VARIANT);

  it("通常 move (doubleMove === null) は turnEnded=true / doubleMove=null", () => {
    const state = makeAiTurnState();
    const result = rules.applyAction(state, firstLegalMove(state));
    expect(result.turnEnded).toBe(true);
    expect(result.next.doubleMove).toBeNull();
  });

  it("二手指し 1 手目 (movesLeft=2) は turnEnded=false / movesLeft 1 に減算", () => {
    const state = makeAiTurnState();
    state.doubleMove = { active: "sente", movesLeft: 2 };
    const result = rules.applyAction(state, firstLegalMove(state));
    expect(result.turnEnded).toBe(false);
    expect(result.next.doubleMove).toEqual({ active: "sente", movesLeft: 1 });
  });

  it("二手指し 2 手目 (movesLeft=1) は turnEnded=true / doubleMove リセット", () => {
    const state = makeAiTurnState();
    state.doubleMove = { active: "sente", movesLeft: 1 };
    const result = rules.applyAction(state, firstLegalMove(state));
    expect(result.turnEnded).toBe(true);
    expect(result.next.doubleMove).toBeNull();
  });

  it('playCard "double_move" は turnEnded=false / doubleMove={active,movesLeft:2} / 盤面不変', () => {
    const state = makeAiTurnState();
    const action: TurnAction = {
      kind: "playCard",
      cardInstanceId: "test-dm1",
      defId: "double_move",
      target: undefined,
    };
    const result = rules.applyAction(state, action);
    expect(result.turnEnded).toBe(false);
    expect(result.next.doubleMove).toEqual({ active: "sente", movesLeft: 2 });
    // targeting:none = 盤面不変 (gameState 参照が同一)
    expect(result.next.gameState).toBe(state.gameState);
  });

  it('playCard "double_move" の active は gameState.currentPlayer に追従 (gote 手番)', () => {
    const state = makeAiTurnState();
    state.gameState = { ...state.gameState, currentPlayer: "gote" };
    const action: TurnAction = {
      kind: "playCard",
      cardInstanceId: "test-dm2",
      defId: "double_move",
      target: undefined,
    };
    const result = rules.applyAction(state, action);
    expect(result.next.doubleMove).toEqual({ active: "gote", movesLeft: 2 });
  });

  it('playCard "double_move" 以外 (pawn_return) は throw (PR3 で実装予定)', () => {
    const state = makeAiTurnState();
    const action: TurnAction = {
      kind: "playCard",
      cardInstanceId: "test-pr1",
      defId: "pawn_return",
      target: { kind: "square", row: 6, col: 0 },
    };
    expect(() => rules.applyAction(state, action)).toThrow(/PR3/);
  });

  it("draw は throw (PR3 で実装予定、evaluateAction が直接処理)", () => {
    const state = makeAiTurnState();
    expect(() => rules.applyAction(state, { kind: "draw" })).toThrow(/PR3/);
  });

  it("二手指し 1 手目適用後の state を再投入すると 2 手目で正しく終了する", () => {
    const state = makeAiTurnState();
    state.doubleMove = { active: "sente", movesLeft: 2 };
    // 1 手目
    const r1 = rules.applyAction(state, firstLegalMove(state));
    expect(r1.turnEnded).toBe(false);
    // 1 手目適用後の state で 2 手目
    const r2 = rules.applyAction(r1.next, firstLegalMove(r1.next));
    expect(r2.turnEnded).toBe(true);
    expect(r2.next.doubleMove).toBeNull();
  });
});
