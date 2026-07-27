import { describe, expect, it } from "vitest";

import { BRANCH_SOURCE_PREFIX, contentFamilyKey, familyIdFor } from "./corpus-family";
import type { TrainingGameRecord, TrainingSampleData } from "@/lib/shogi/training/types";

// 最小限のサンプル (family 鍵が見るのは boardState / cardState / action だけ)。
function sample(file: number, plyIndex: number): TrainingSampleData {
  return {
    plyIndex,
    moveCount: plyIndex,
    sideToMove: plyIndex % 2 === 0 ? "sente" : "gote",
    boardState: { board: `b${plyIndex}` },
    cardState: { mana: plyIndex },
    action: {
      kind: "move",
      move: {
        type: "move",
        from: { row: 6, col: file },
        to: { row: 5, col: file },
        piece: "pawn",
        player: plyIndex % 2 === 0 ? "sente" : "gote",
        promote: false,
      },
    },
    events: [],
  } as TrainingSampleData;
}

function record(
  samples: TrainingSampleData[],
  game: Partial<TrainingGameRecord["game"]> = {},
): TrainingGameRecord {
  return {
    game: {
      source: "self_play",
      variantId: "card-shogi",
      finalStatus: "checkmate",
      moveCount: samples.length,
      winner: "sente",
      ...game,
    } as TrainingGameRecord["game"],
    samples,
  };
}

describe("corpus-family", () => {
  it("同じ内容なら同じ鍵、行動が 1 手でも違えば別の鍵になる", () => {
    const a = record([sample(7, 0), sample(3, 1)]);
    const b = record([sample(7, 0), sample(3, 1)]);
    const c = record([sample(7, 0), sample(2, 1)]);
    expect(contentFamilyKey(a)).toBe(contentFamilyKey(b));
    expect(contentFamilyKey(a)).not.toBe(contentFamilyKey(c));
    expect(contentFamilyKey(a)).toHaveLength(16);
  });

  it("★分岐棋譜は親と同じ family になる (これが崩れると val リークが起きる)", () => {
    const parent = record([sample(7, 0), sample(3, 1), sample(2, 2)]);
    const parentKey = contentFamilyKey(parent);
    // 枝は親とまったく違う指し手を持つが、sourceGameId に親の鍵を帯同している。
    const branch1 = record([sample(9, 0)], {
      sourceGameId: `${BRANCH_SOURCE_PREFIX}${parentKey}:2`,
      familyId: parentKey,
    });
    const branch2 = record([sample(1, 0)], {
      sourceGameId: `${BRANCH_SOURCE_PREFIX}${parentKey}:5`,
      familyId: parentKey,
    });
    expect(familyIdFor(parent)).toBe(parentKey);
    expect(familyIdFor(branch1)).toBe(parentKey);
    expect(familyIdFor(branch2)).toBe(parentKey);
  });

  it("familyId が無くても sourceGameId から親の鍵を復元できる", () => {
    const branch = record([sample(9, 0)], { sourceGameId: `${BRANCH_SOURCE_PREFIX}abc123:4` });
    expect(familyIdFor(branch)).toBe("abc123");
  });

  it("★刻まれた familyId は再計算より優先される (間引き後も親と繋がったままにするため)", () => {
    const original = record([sample(7, 0), sample(3, 1), sample(2, 2)]);
    const stamped = contentFamilyKey(original);
    // clean がサンプルを間引いた後の姿。中身が変わったので再計算値は別物になる。
    const thinned = record([sample(3, 1)], { familyId: stamped });
    expect(contentFamilyKey(thinned)).not.toBe(stamped);
    expect(familyIdFor(thinned)).toBe(stamped);
  });

  it("familyId が null でも内容ハッシュへ落ちる (通常の自己対戦はこの経路)", () => {
    // playOneGame は分岐でない対局にも familyId: null を書き込む。
    const plain = record([sample(7, 0)], { familyId: null, sourceGameId: null });
    expect(familyIdFor(plain)).toBe(contentFamilyKey(plain));
  });

  it("分岐ではない対局は自分の内容ハッシュを返す", () => {
    const plain = record([sample(7, 0)], { sourceGameId: "human-game-42" });
    expect(familyIdFor(plain)).toBe(contentFamilyKey(plain));
  });
});
