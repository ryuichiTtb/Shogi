// Issue #193 / card-apply: turnActionToReducerActions の純粋関数ユニットテスト。
// AI の TurnAction → reducer Action 列変換が仕様通りか (move / draw /
// playCard target あり・なし / double_move フォールバック) を検証する。

import { describe, it, expect } from "vitest";
import { turnActionToReducerActions } from "../ai-action-bridge";
import type { TurnAction } from "@/lib/shogi/ai/turn/types";
import type { Move } from "@/lib/shogi/types";

const sampleMove: Move = {
  type: "move",
  from: { row: 6, col: 4 },
  to: { row: 5, col: 4 },
  piece: "pawn",
  player: "sente",
};

describe("turnActionToReducerActions", () => {
  it("move は MAKE_MOVE 1 つに変換される", () => {
    const action: TurnAction = { kind: "move", move: sampleMove };
    expect(turnActionToReducerActions(action, "sente")).toEqual([
      { type: "MAKE_MOVE", move: sampleMove },
    ]);
  });

  it("draw は DRAW_CARD (player 付き) に変換される", () => {
    const action: TurnAction = { kind: "draw" };
    expect(turnActionToReducerActions(action, "gote")).toEqual([
      { type: "DRAW_CARD", player: "gote" },
    ]);
  });

  it("target あり playCard は BEGIN_PLAY_CARD → SELECT_CARD_TARGET (CONFIRM 自動) に変換される", () => {
    const target = { kind: "square" as const, row: 4, col: 2 };
    const action: TurnAction = {
      kind: "playCard",
      cardInstanceId: "inst-1",
      defId: "pawn_return",
      target,
    };
    expect(turnActionToReducerActions(action, "sente")).toEqual([
      { type: "BEGIN_PLAY_CARD", player: "sente", instanceId: "inst-1" },
      { type: "SELECT_CARD_TARGET", target },
    ]);
  });

  it("target なし playCard は BEGIN_PLAY_CARD → CONFIRM_PLAY_CARD に変換される", () => {
    const action: TurnAction = {
      kind: "playCard",
      cardInstanceId: "inst-2",
      defId: "mana_up",
    };
    expect(turnActionToReducerActions(action, "gote")).toEqual([
      { type: "BEGIN_PLAY_CARD", player: "gote", instanceId: "inst-2" },
      { type: "CONFIRM_PLAY_CARD" },
    ]);
  });

  it("double_move playCard は null を返す (move フォールバック指示、論点 A)", () => {
    const action: TurnAction = {
      kind: "playCard",
      cardInstanceId: "inst-3",
      defId: "double_move",
    };
    expect(turnActionToReducerActions(action, "sente")).toBeNull();
  });
});
