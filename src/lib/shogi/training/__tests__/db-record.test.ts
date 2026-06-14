import { describe, expect, it } from "vitest";

import { parseTrainingRecordLine, trainingRecordToJsonl } from "../jsonl";
import {
  toTrainingGameRecord,
  type TrainingGameRow,
  type TrainingSampleRow,
} from "../db-record";

function makeGameRow(overrides: Partial<TrainingGameRow> = {}): TrainingGameRow {
  return {
    source: "self_play",
    variantId: "card-shogi",
    senteDifficulty: "expert",
    senteCharacterId: null,
    goteDifficulty: "expert",
    goteCharacterId: null,
    humanColor: null,
    deckSpecSente: [{ defId: "pawn_return", count: 4 }],
    deckSpecGote: [{ defId: "no_promote", count: 4 }],
    winner: "sente",
    finalStatus: "checkmate",
    moveCount: 42,
    engineVersion: "bolt-on",
    sourceGameId: null,
    ...overrides,
  };
}

function makeSampleRow(plyIndex: number, overrides: Partial<TrainingSampleRow> = {}): TrainingSampleRow {
  return {
    plyIndex,
    moveCount: plyIndex,
    sideToMove: plyIndex % 2 === 0 ? "sente" : "gote",
    boardState: { board: [], hand: {}, currentPlayer: "sente", status: "active", winner: null, moveCount: plyIndex },
    cardState: { mana: { sente: 3, gote: 3 } },
    action: { kind: "move", move: { type: "move", from: { row: 6, col: 7 }, to: { row: 5, col: 7 }, piece: "pawn", player: "sente" } },
    events: [{ kind: "move" }],
    ...overrides,
  };
}

describe("toTrainingGameRecord", () => {
  it("game メタを忠実にマップする (union 文字列 / Json をロスレス復元)", () => {
    const rec = toTrainingGameRecord(makeGameRow(), [makeSampleRow(0)]);
    expect(rec.game.source).toBe("self_play");
    expect(rec.game.variantId).toBe("card-shogi");
    expect(rec.game.senteDifficulty).toBe("expert");
    expect(rec.game.winner).toBe("sente");
    expect(rec.game.finalStatus).toBe("checkmate");
    expect(rec.game.moveCount).toBe(42);
    expect(rec.game.engineVersion).toBe("bolt-on");
    expect(rec.game.deckSpecSente).toEqual([{ defId: "pawn_return", count: 4 }]);
  });

  it("null フィールドは null のまま通す (人間側の難易度 / deckSpec 等)", () => {
    const rec = toTrainingGameRecord(
      makeGameRow({
        source: "human",
        humanColor: "sente",
        senteDifficulty: null,
        senteCharacterId: null,
        deckSpecSente: null,
        winner: "draw",
        finalStatus: "repetition",
      }),
      [makeSampleRow(0)],
    );
    expect(rec.game.source).toBe("human");
    expect(rec.game.humanColor).toBe("sente");
    expect(rec.game.senteDifficulty).toBeNull();
    expect(rec.game.deckSpecSente).toBeNull();
    expect(rec.game.winner).toBe("draw");
  });

  it("samples を plyIndex 昇順へ defensively 整列する (取得順に依存しない)", () => {
    const rec = toTrainingGameRecord(makeGameRow(), [
      makeSampleRow(2),
      makeSampleRow(0),
      makeSampleRow(1),
    ]);
    expect(rec.samples.map((s) => s.plyIndex)).toEqual([0, 1, 2]);
  });

  it("sample の boardState/cardState/action/events をロスレスに通す", () => {
    const board = { board: [[null]], hand: { sente: {} }, currentPlayer: "gote", status: "active", winner: null, moveCount: 3 };
    const card = { mana: { sente: 5, gote: 2 }, hand: { sente: ["pawn_return"], gote: [] } };
    const action = { kind: "playCard", cardInstanceId: "c1", defId: "pawn_return" };
    const events = [{ kind: "cardPlay", defId: "pawn_return" }, { kind: "move" }];
    const rec = toTrainingGameRecord(makeGameRow(), [
      makeSampleRow(0, { boardState: board, cardState: card, action, events }),
    ]);
    expect(rec.samples[0].boardState).toEqual(board);
    expect(rec.samples[0].cardState).toEqual(card);
    expect(rec.samples[0].action).toEqual(action);
    expect(rec.samples[0].events).toEqual(events);
  });

  it("events が null/undefined のサンプルは空配列へフォールバックする", () => {
    const rec = toTrainingGameRecord(makeGameRow(), [
      makeSampleRow(0, { events: null }),
      makeSampleRow(1, { events: undefined }),
    ]);
    expect(rec.samples[0].events).toEqual([]);
    expect(rec.samples[1].events).toEqual([]);
  });

  it("空 samples でも成立する (game メタのみの試合)", () => {
    const rec = toTrainingGameRecord(makeGameRow(), []);
    expect(rec.samples).toEqual([]);
    expect(rec.game.source).toBe("self_play");
  });

  it("JSONL ラウンドトリップで等価 (export → parse)", () => {
    const original = toTrainingGameRecord(makeGameRow(), [makeSampleRow(0), makeSampleRow(1)]);
    const restored = parseTrainingRecordLine(trainingRecordToJsonl(original));
    expect(restored).toEqual(original);
  });
});
