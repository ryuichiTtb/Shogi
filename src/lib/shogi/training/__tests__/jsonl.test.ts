import { describe, expect, it } from "vitest";

import { parseTrainingRecordLine, trainingRecordToJsonl } from "../jsonl";
import type { TrainingGameRecord } from "../types";

const record: TrainingGameRecord = {
  game: {
    source: "self_play",
    variantId: "card-shogi",
    winner: "sente",
    finalStatus: "checkmate",
    moveCount: 2,
  },
  samples: [
    {
      plyIndex: 0,
      moveCount: 0,
      sideToMove: "sente",
      boardState: { board: [], hand: {}, currentPlayer: "sente", status: "active", moveCount: 0 },
      cardState: { mana: { sente: 0, gote: 0 } },
      action: { kind: "draw" },
      events: [],
    },
  ],
};

describe("training JSONL", () => {
  it("1 試合を 1 行に直列化し、ラウンドトリップで復元できる", () => {
    const line = trainingRecordToJsonl(record);
    expect(line).not.toContain("\n");
    expect(parseTrainingRecordLine(line)).toEqual(record);
  });

  it("壊れた行 (game/samples 欠落) は例外", () => {
    expect(() => parseTrainingRecordLine("{}")).toThrow();
    expect(() => parseTrainingRecordLine(JSON.stringify({ game: {} }))).toThrow();
  });
});
