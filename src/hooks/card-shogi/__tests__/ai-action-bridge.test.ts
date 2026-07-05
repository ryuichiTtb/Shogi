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

  it("double_move で move ペア未供給なら null (bolt-on / 旧サーバの後方互換フォールバック)", () => {
    const action: TurnAction = {
      kind: "playCard",
      cardInstanceId: "inst-3",
      defId: "double_move",
    };
    expect(turnActionToReducerActions(action, "sente")).toBeNull();
  });

  it("double_move + move ペア供給 → BEGIN→CONFIRM→MAKE_MOVE×2 の 4-dispatch (S4c-1d 1-response)", () => {
    const action: TurnAction = {
      kind: "playCard",
      cardInstanceId: "inst-4",
      defId: "double_move",
    };
    const move2: Move = { type: "move", from: { row: 5, col: 4 }, to: { row: 4, col: 4 }, piece: "pawn", player: "sente" };
    expect(turnActionToReducerActions(action, "sente", { move1: sampleMove, move2 })).toEqual([
      { type: "BEGIN_PLAY_CARD", player: "sente", instanceId: "inst-4" },
      { type: "CONFIRM_PLAY_CARD" },
      { type: "MAKE_MOVE", move: sampleMove },
      { type: "MAKE_MOVE", move: move2 },
    ]);
  });

  it("double_move で 1手目詰み (move2=null) → 3-dispatch (2手目を dispatch しない)", () => {
    const action: TurnAction = {
      kind: "playCard",
      cardInstanceId: "inst-5",
      defId: "double_move",
    };
    expect(turnActionToReducerActions(action, "gote", { move1: sampleMove, move2: null })).toEqual([
      { type: "BEGIN_PLAY_CARD", player: "gote", instanceId: "inst-5" },
      { type: "CONFIRM_PLAY_CARD" },
      { type: "MAKE_MOVE", move: sampleMove },
    ]);
  });

  it("double_move 以外の playCard に move ペアを渡しても無視される (通常 card 経路)", () => {
    const action: TurnAction = { kind: "playCard", cardInstanceId: "inst-6", defId: "mana_up" };
    expect(turnActionToReducerActions(action, "sente", { move1: sampleMove, move2: null })).toEqual([
      { type: "BEGIN_PLAY_CARD", player: "sente", instanceId: "inst-6" },
      { type: "CONFIRM_PLAY_CARD" },
    ]);
  });
});
