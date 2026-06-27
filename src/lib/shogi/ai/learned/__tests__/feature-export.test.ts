import { describe, expect, it } from "vitest";

import { createInitialGameState } from "@/lib/shogi/board";
import { createInitialCardState, serializeCardState } from "@/lib/shogi/cards/state";
import { serializeBoardForTraining } from "@/lib/shogi/training/serialize";
import type { TrainingGameRecord, TrainingSampleData } from "@/lib/shogi/training/types";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";

import { encodePosition, FEATURE_DIM, type EncoderPosition } from "../encoder";
import {
  gameToSparseRows,
  sampleToSparseRow,
  winnerToLabel,
} from "../feature-export";

function makeSample(plyIndex: number): TrainingSampleData {
  const gs = createInitialGameState(CARD_SHOGI_VARIANT);
  const cs = createInitialCardState([{ defId: "pawn_return", count: 4 }]);
  return {
    plyIndex,
    moveCount: plyIndex,
    sideToMove: plyIndex % 2 === 0 ? "sente" : "gote",
    boardState: serializeBoardForTraining(gs),
    cardState: serializeCardState(cs),
    action: { kind: "draw" },
    events: [],
  };
}

function makeRecord(winner: TrainingGameRecord["game"]["winner"], nSamples: number): TrainingGameRecord {
  return {
    game: {
      source: "self_play",
      variantId: "card-shogi",
      winner,
      finalStatus: winner === "draw" ? "repetition" : "checkmate",
      moveCount: nSamples,
    },
    samples: Array.from({ length: nSamples }, (_, i) => makeSample(i)),
  };
}

describe("winnerToLabel", () => {
  it("勝敗を先手絶対視点 z へ写す", () => {
    expect(winnerToLabel("sente")).toBe(1);
    expect(winnerToLabel("gote")).toBe(-1);
    expect(winnerToLabel("draw")).toBe(0);
  });
  it("中断 (null/undefined) は学習対象外 = null", () => {
    expect(winnerToLabel(null)).toBeNull();
    expect(winnerToLabel(undefined)).toBeNull();
  });
});

describe("sampleToSparseRow", () => {
  it("疎表現を密へ復元すると encodePosition と完全一致する", () => {
    const sample = makeSample(0);
    const row = sampleToSparseRow(sample, 1);

    // 密へ復元。
    const dense = new Float32Array(FEATURE_DIM);
    for (let i = 0; i < row.idx.length; i++) dense[row.idx[i]] = row.val[i];

    // 基準: 同じ局面を encoder へ直接 (serializeBoardForTraining 出力は EncoderPosition)。
    const gs = createInitialGameState(CARD_SHOGI_VARIANT);
    const cs = createInitialCardState([{ defId: "pawn_return", count: 4 }]);
    const expected = encodePosition(serializeBoardForTraining(gs) as unknown as EncoderPosition, cs);

    expect(Array.from(dense)).toEqual(Array.from(expected));
  });

  it("idx は昇順・val と同長・全て非ゼロ", () => {
    const row = sampleToSparseRow(makeSample(0), 0);
    expect(row.idx.length).toBe(row.val.length);
    expect(row.idx.length).toBeGreaterThan(0);
    for (let i = 1; i < row.idx.length; i++) expect(row.idx[i]).toBeGreaterThan(row.idx[i - 1]);
    for (const v of row.val) expect(v).not.toBe(0);
  });

  it("label と sideToMove を行へ帯同する", () => {
    const row = sampleToSparseRow(makeSample(1), -1);
    expect(row.label).toBe(-1);
    expect(row.sideToMove).toBe("gote");
  });

  it("game インデックスを帯同する (既定 0、指定値を反映)", () => {
    expect(sampleToSparseRow(makeSample(0), 1).game).toBe(0);
    expect(sampleToSparseRow(makeSample(0), 1, 7).game).toBe(7);
  });
});

describe("gameToSparseRows", () => {
  it("ゲーム結果ラベルを全サンプルへ付与する", () => {
    const rows = gameToSparseRows(makeRecord("gote", 3));
    expect(rows.length).toBe(3);
    for (const r of rows) expect(r.label).toBe(-1);
  });

  it("引き分けは label=0", () => {
    const rows = gameToSparseRows(makeRecord("draw", 2));
    expect(rows.map((r) => r.label)).toEqual([0, 0]);
  });

  it("中断 (winner=null) の試合は空配列 (学習除外)", () => {
    expect(gameToSparseRows(makeRecord(null, 5))).toEqual([]);
  });

  it("game インデックスを全サンプルへ伝播する (試合単位分割キー)", () => {
    const rows = gameToSparseRows(makeRecord("sente", 4), 3);
    expect(rows.every((r) => r.game === 3)).toBe(true);
  });
});
