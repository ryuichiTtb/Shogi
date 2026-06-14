import { describe, expect, it } from "vitest";

import { createInitialGameState } from "@/lib/shogi/board";
import { createInitialCardState, serializeCardState } from "@/lib/shogi/cards/state";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";
import type { GameEvent } from "@/lib/shogi/cards/types";
import type { TurnAction } from "@/lib/shogi/kernel/turn-action-types";
import type { WorldState } from "@/lib/shogi/kernel/world-kernel";
import type { Move } from "@/lib/shogi/types";

import { buildTrainingSample, serializeBoardForTraining, stripEventTimestamp, stripEventTimestamps } from "../serialize";

function makeWorld(): WorldState {
  return {
    gameState: createInitialGameState(CARD_SHOGI_VARIANT),
    cardState: createInitialCardState([{ defId: "pawn_return", count: 2 }]),
    doubleMove: null,
  };
}

const sampleMove: Move = {
  type: "move",
  from: { row: 6, col: 7 },
  to: { row: 5, col: 7 },
  piece: "pawn",
  player: "sente",
};

describe("stripEventTimestamp", () => {
  it("at を剥がし、kind と他フィールドを保持する", () => {
    const ev: GameEvent = { kind: "moveEvent", move: sampleMove, at: 123456 };
    const stripped = stripEventTimestamp(ev);
    expect("at" in stripped).toBe(false);
    expect(stripped.kind).toBe("moveEvent");
    expect((stripped as { move: Move }).move).toEqual(sampleMove);
  });

  it("manaChargeEvent の amount / fastMove は保持し at のみ剥がす", () => {
    const ev: GameEvent = {
      kind: "manaChargeEvent",
      player: "sente",
      amount: 2,
      reason: "turn",
      fastMove: true,
      at: 999,
    };
    const stripped = stripEventTimestamp(ev) as { amount: number; fastMove?: boolean };
    expect("at" in stripped).toBe(false);
    expect(stripped.amount).toBe(2);
    expect(stripped.fastMove).toBe(true);
  });

  it("配列をまとめて剥がす", () => {
    const evs: GameEvent[] = [
      { kind: "moveEvent", move: sampleMove, at: 1 },
      { kind: "manaChargeEvent", player: "sente", amount: 1, reason: "turn", at: 2 },
    ];
    const out = stripEventTimestamps(evs);
    expect(out).toHaveLength(2);
    expect(out.every((e) => !("at" in e))).toBe(true);
  });
});

describe("buildTrainingSample", () => {
  it("行動前の局面・カード状態を serialize 関数と一致させる", () => {
    const world = makeWorld();
    const action: TurnAction = { kind: "move", move: sampleMove };
    const events: GameEvent[] = [{ kind: "moveEvent", move: sampleMove, at: 42 }];

    const sample = buildTrainingSample(world, action, events, 0);

    expect(sample.plyIndex).toBe(0);
    expect(sample.moveCount).toBe(world.gameState.moveCount);
    expect(sample.sideToMove).toBe(world.gameState.currentPlayer);
    expect(sample.boardState).toEqual(serializeBoardForTraining(world.gameState));
    // moveHistory / positionHistory は学習用には保存しない (O(N^2) 肥大回避, §10)。
    expect(sample.boardState).not.toHaveProperty("moveHistory");
    expect(sample.boardState).not.toHaveProperty("positionHistory");
    expect(sample.cardState).toEqual(serializeCardState(world.cardState));
    expect(sample.action).toEqual(action);
    expect(sample.events[0]).not.toHaveProperty("at");
  });

  it("draw / playCard の action もそのまま保持する", () => {
    const world = makeWorld();

    const drawAction: TurnAction = { kind: "draw" };
    const s1 = buildTrainingSample(world, drawAction, [], 1);
    expect(s1.action).toEqual(drawAction);
    expect(s1.events).toEqual([]);

    const playAction: TurnAction = { kind: "playCard", cardInstanceId: "abc", defId: "pawn_return" };
    const s2 = buildTrainingSample(world, playAction, [], 2);
    expect(s2.action).toEqual(playAction);
  });
});
