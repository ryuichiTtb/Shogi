import { describe, expect, it } from "vitest";

import type { GameEvent } from "@/lib/shogi/cards/types";
import type { Move } from "@/lib/shogi/types";

import { deriveActionFromEvents } from "../derive-action";

const move: Move = { type: "move", from: { row: 6, col: 7 }, to: { row: 5, col: 7 }, piece: "pawn", player: "sente" };
const moveEvent: GameEvent = { kind: "moveEvent", move, at: 1 };
const manaCharge: GameEvent = { kind: "manaChargeEvent", player: "sente", amount: 1, reason: "turn", at: 2 };

describe("deriveActionFromEvents", () => {
  it("moveEvent → move (manaCharge 付随)", () => {
    expect(deriveActionFromEvents([moveEvent, manaCharge])).toEqual({ kind: "move", move });
  });

  it("cardPlayEvent → playCard (defId / target を保持)", () => {
    const ev: GameEvent = {
      kind: "cardPlayEvent",
      player: "sente",
      instance: { instanceId: "i1", defId: "pawn_return" },
      target: { kind: "square", row: 4, col: 2 },
      at: 3,
    };
    expect(deriveActionFromEvents([ev])).toEqual({
      kind: "playCard",
      cardInstanceId: "i1",
      defId: "pawn_return",
      target: { kind: "square", row: 4, col: 2 },
    });
  });

  it("trapSetEvent → playCard (トラップカード設置)", () => {
    const ev: GameEvent = {
      kind: "trapSetEvent",
      player: "sente",
      instance: { instanceId: "t1", defId: "check_break", owner: "sente" },
      at: 4,
    };
    expect(deriveActionFromEvents([ev])).toEqual({ kind: "playCard", cardInstanceId: "t1", defId: "check_break" });
  });

  it("手動ドロー → draw", () => {
    const ev: GameEvent = {
      kind: "drawEvent",
      player: "sente",
      instance: { instanceId: "c1", defId: "mana_up" },
      source: "manual",
      at: 5,
    };
    expect(deriveActionFromEvents([ev])).toEqual({ kind: "draw" });
  });

  it("auto-draw のみ → null (独立 decision でない)", () => {
    const ev: GameEvent = {
      kind: "drawEvent",
      player: "sente",
      instance: { instanceId: "c2", defId: "mana_up" },
      source: "auto",
      at: 6,
    };
    expect(deriveActionFromEvents([ev])).toBeNull();
  });

  it("double_move: cardPlayEvent + moveEvent×2 → playCard(double_move)", () => {
    const move2: Move = { type: "move", from: { row: 5, col: 7 }, to: { row: 4, col: 7 }, piece: "pawn", player: "sente" };
    const events: GameEvent[] = [
      { kind: "moveEvent", move, at: 1 },
      { kind: "moveEvent", move: move2, at: 2 },
      { kind: "cardPlayEvent", player: "sente", instance: { instanceId: "d1", defId: "double_move" }, at: 3 },
    ];
    // cardPlay 優先 → playCard(double_move)。2 手の軌跡は events 側に保持される。
    expect(deriveActionFromEvents(events)).toEqual({ kind: "playCard", cardInstanceId: "d1", defId: "double_move" });
  });

  it("move + 相手トラップ発動(trapTriggerEvent) → move", () => {
    const trig: GameEvent = {
      kind: "trapTriggerEvent",
      player: "sente",
      instance: { instanceId: "t1", defId: "check_break", owner: "gote" },
      reason: "check_declared",
      at: 7,
    };
    expect(deriveActionFromEvents([moveEvent, trig, manaCharge])).toEqual({ kind: "move", move });
  });

  it("空 / decision-starter 無し → null", () => {
    expect(deriveActionFromEvents([])).toBeNull();
    expect(deriveActionFromEvents([manaCharge])).toBeNull();
  });
});
