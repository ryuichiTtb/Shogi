import { describe, expect, it } from "vitest";

import {
  createModel,
  deserializeModel,
  predict,
  predictSparse,
  serializeModel,
  z1Dense,
  z1Sparse,
} from "../mlp";

function denseFromSparse(dim: number, idx: number[], val: number[]): Float32Array {
  const x = new Float32Array(dim);
  for (let k = 0; k < idx.length; k++) x[idx[k]] = val[k];
  return x;
}

describe("createModel", () => {
  it("seed が同じなら同一の重み (決定的)", () => {
    const a = serializeModel(createModel(16, 8, 42));
    const b = serializeModel(createModel(16, 8, 42));
    expect(a).toEqual(b);
  });
  it("seed が違えば重みが変わる", () => {
    const a = serializeModel(createModel(16, 8, 1));
    const b = serializeModel(createModel(16, 8, 2));
    expect(a.w1).not.toEqual(b.w1);
  });
  it("形状が正しい", () => {
    const m = createModel(16, 8, 1);
    expect(m.w1.length).toBe(16 * 8);
    expect(m.b1.length).toBe(8);
    expect(m.w2.length).toBe(8);
  });
});

describe("forward", () => {
  it("出力は tanh で [-1,1] に収まる", () => {
    const m = createModel(32, 8, 3);
    const x = denseFromSparse(32, [0, 5, 31], [1, 0.5, 0.2]);
    const y = predict(m, x);
    expect(y).toBeGreaterThanOrEqual(-1);
    expect(y).toBeLessThanOrEqual(1);
  });

  it("同一入力は同一出力 (決定的)", () => {
    const m = createModel(32, 8, 3);
    const x = denseFromSparse(32, [1, 2, 3], [1, 1, 1]);
    expect(predict(m, x)).toBe(predict(m, x));
  });

  // 実パイプラインでは dense (推論) も sparse (学習) も同じ encodePosition の Float32Array 由来 =
  // 同一 float32 値ゆえ厳密一致する。テストも同一 Float32Array から両表現を導出して忠実に検証する。
  function sparseFromDense(x: Float32Array): { idx: number[]; val: number[] } {
    const idx: number[] = [];
    const val: number[] = [];
    for (let i = 0; i < x.length; i++) {
      if (x[i] !== 0) {
        idx.push(i);
        val.push(x[i]);
      }
    }
    return { idx, val };
  }

  it("★z1Dense と z1Sparse が一致する (疎/密 forward の等価性)", () => {
    const m = createModel(64, 16, 9);
    const dense = new Float32Array(64);
    dense[1] = 0.5;
    dense[4] = 1;
    dense[7] = 0.3;
    dense[40] = 0.25;
    const { idx, val } = sparseFromDense(dense);
    const zd = Array.from(z1Dense(m, dense));
    const zs = Array.from(z1Sparse(m, idx, val));
    for (let i = 0; i < zd.length; i++) expect(zs[i]).toBeCloseTo(zd[i], 10);
  });

  it("★predict と predictSparse が一致する (スキューゼロ)", () => {
    const m = createModel(64, 16, 11);
    const dense = new Float32Array(64);
    dense[2] = 1;
    dense[9] = 0.5;
    dense[50] = 0.7;
    const { idx, val } = sparseFromDense(dense);
    expect(predictSparse(m, idx, val)).toBeCloseTo(predict(m, dense), 10);
  });
});

describe("serialize / deserialize", () => {
  it("往復で predict が一致する", () => {
    const m = createModel(48, 12, 21);
    const restored = deserializeModel(serializeModel(m));
    const x = denseFromSparse(48, [3, 7, 47], [1, 0.4, 0.9]);
    expect(predict(restored, x)).toBeCloseTo(predict(m, x), 10);
  });

  it("JSON 文字列化しても復元できる", () => {
    const m = createModel(16, 4, 5);
    const restored = deserializeModel(JSON.parse(JSON.stringify(serializeModel(m))));
    expect(serializeModel(restored)).toEqual(serializeModel(m));
  });
});
