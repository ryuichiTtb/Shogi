import { describe, expect, it } from "vitest";

import type { SparseFeatureRow } from "../feature-export";
import { createModel, predictSparse } from "../mlp";
import { trainModel } from "../train";

// 合成データ: 特徴の活性パターンでラベルが決まる学習可能な小タスク。
function makeRows(): SparseFeatureRow[] {
  return [
    { label: 1, sideToMove: "sente", game: 0, idx: [0], val: [1] },
    { label: -1, sideToMove: "gote", game: 1, idx: [1], val: [1] },
    { label: 0, sideToMove: "sente", game: 2, idx: [2], val: [1] },
    { label: 1, sideToMove: "sente", game: 3, idx: [0, 3], val: [1, 1] },
    { label: -1, sideToMove: "gote", game: 4, idx: [1, 4], val: [1, 1] },
  ];
}

describe("trainModel", () => {
  it("★微小データを過学習でき、損失が大幅に下がる (逆伝播の正しさ)", () => {
    const rows = makeRows();
    const model = createModel(8, 16, 123);
    const { lossHistory } = trainModel(model, rows, { epochs: 400, batchSize: 5, lr: 0.02, seed: 1 });

    const first = lossHistory[0];
    const last = lossHistory[lossHistory.length - 1];
    expect(last).toBeLessThan(first); // 単調でなくても下がる
    expect(last).toBeLessThan(first * 0.1); // 大幅に低下 = 学習が進んでいる
    expect(last).toBeLessThan(0.05); // ほぼ過学習
  });

  it("学習後の予測がラベルへ近づく", () => {
    const rows = makeRows();
    const model = createModel(8, 16, 123);
    trainModel(model, rows, { epochs: 400, batchSize: 5, lr: 0.02, seed: 1 });

    for (const r of rows) {
      const p = predictSparse(model, r.idx, r.val);
      expect(Math.abs(p - r.label)).toBeLessThan(0.3);
    }
  });

  it("seed が同じなら損失履歴が完全一致 (決定的)", () => {
    const a = trainModel(createModel(8, 16, 123), makeRows(), { epochs: 30, seed: 4 });
    const b = trainModel(createModel(8, 16, 123), makeRows(), { epochs: 30, seed: 4 });
    expect(a.lossHistory).toEqual(b.lossHistory);
  });

  it("onEpoch コールバックがエポック数だけ呼ばれる", () => {
    const seen: number[] = [];
    trainModel(createModel(8, 8, 1), makeRows(), {
      epochs: 5,
      onEpoch: (e) => seen.push(e),
    });
    expect(seen).toEqual([0, 1, 2, 3, 4]);
  });
});
