import { describe, expect, it } from "vitest";

import { MemoryTrainingSink } from "../sink";
import type { TrainingGameData, TrainingSampleData } from "../types";

function makeGame(source: "human" | "self_play"): TrainingGameData {
  return {
    source,
    variantId: "card-shogi",
    finalStatus: "checkmate",
    moveCount: 2,
    winner: "sente",
  };
}

function makeSample(plyIndex: number): TrainingSampleData {
  return {
    plyIndex,
    moveCount: plyIndex,
    sideToMove: "sente",
    boardState: {},
    cardState: {},
    action: { kind: "draw" },
    events: [],
  };
}

describe("MemoryTrainingSink", () => {
  it("writeGame で試合とサンプルを順に貯める", async () => {
    const sink = new MemoryTrainingSink();
    await sink.writeGame(makeGame("self_play"), [makeSample(0), makeSample(1)]);
    await sink.writeGame(makeGame("human"), [makeSample(0)]);

    expect(sink.games).toHaveLength(2);
    expect(sink.totalSamples).toBe(3);
    expect(sink.games[0].game.source).toBe("self_play");
    expect(sink.games[1].samples).toHaveLength(1);
  });
});
