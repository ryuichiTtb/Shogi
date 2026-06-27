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

  it("validate 指定で最良 val の重みを採用し復元する (早期停止)", () => {
    const train = makeRows();
    const val = makeRows();
    const model = createModel(8, 16, 1);
    const valFn = () => {
      let s = 0;
      for (const r of val) {
        const d = predictSparse(model, r.idx, r.val) - r.label;
        s += d * d;
      }
      return s / val.length;
    };
    const res = trainModel(model, train, { epochs: 40, seed: 2, validate: valFn });
    expect(res.valHistory.length).toBe(40);
    expect(res.bestEpoch).not.toBeNull();
    expect(res.bestValLoss).toBeCloseTo(Math.min(...res.valHistory), 10);
    // 最良重みが復元されている = 最終モデルの val == bestValLoss。
    expect(valFn()).toBeCloseTo(res.bestValLoss!, 10);
  });

  it("patience で改善が止まると早期打ち切りする", () => {
    // val を「4,3,2,1,0(最良),1,2,...」と動かし、patience=2 で底の 2 エポック後に打ち切る。
    let c = 0;
    const res = trainModel(createModel(8, 8, 1), makeRows(), {
      epochs: 200,
      seed: 3,
      patience: 2,
      validate: () => {
        c += 1;
        return Math.abs(c - 5); // c=5 (epoch4) で 0 = 最良
      },
    });
    expect(res.bestEpoch).toBe(4);
    expect(res.lossHistory.length).toBe(7); // epoch 0..6 で打ち切り (200 まで回らない)
  });
});
