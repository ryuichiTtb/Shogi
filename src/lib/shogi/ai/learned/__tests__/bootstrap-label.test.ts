import { describe, expect, it } from "vitest";

import { DEFAULT_BOOTSTRAP_PARAMS, squashBootstrapLabel } from "../bootstrap-label";

const P = (alpha: number) => ({ alpha, cpRef: 1000, cpScale: 1000 });

describe("squashBootstrapLabel", () => {
  it("常に [-1, 1] に収まる (tanh の値域、大入力は float 飽和で ±1)", () => {
    for (const s of [-100000, -500, 0, 250, 90000]) {
      for (const z of [-1, 0, 1]) {
        for (const a of [0, 0.5, 1]) {
          const y = squashBootstrapLabel(s, z, P(a));
          expect(y).toBeGreaterThanOrEqual(-1);
          expect(y).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("詰み search-score (±90000) は α に依らず ±1 に飽和する (確定値の錨)", () => {
    for (const a of [0.3, 0.5, 0.7, 1]) {
      // outcome が矛盾 (z=-1) でも search の詰みが桁支配して +1 へ
      expect(squashBootstrapLabel(90000, -1, P(a))).toBeGreaterThan(0.999);
      expect(squashBootstrapLabel(-90000, 1, P(a))).toBeLessThan(-0.999);
    }
  });

  it("α=0 は search を無視し outcome のみを squash する", () => {
    // tanh(z * cpRef / cpScale) = tanh(±1)
    expect(squashBootstrapLabel(99999, 1, P(0))).toBeCloseTo(Math.tanh(1), 10);
    expect(squashBootstrapLabel(-99999, -1, P(0))).toBeCloseTo(Math.tanh(-1), 10);
    expect(squashBootstrapLabel(12345, 0, P(0))).toBeCloseTo(0, 10);
  });

  it("α=1 は outcome を無視し search のみを squash する", () => {
    expect(squashBootstrapLabel(500, 1, P(1))).toBeCloseTo(Math.tanh(0.5), 10);
    expect(squashBootstrapLabel(-500, -1, P(1))).toBeCloseTo(Math.tanh(-0.5), 10);
  });

  it("cp 空間で線形混合してから squash する (mix→squash の順序)", () => {
    // 期待値を独立計算: tanh((0.5*200 + 0.5*1*1000)/1000) = tanh(0.6)
    expect(squashBootstrapLabel(200, 1, P(0.5))).toBeCloseTo(Math.tanh((0.5 * 200 + 0.5 * 1000) / 1000), 10);
  });

  it("固定 α (>0) で search-score について単調増加", () => {
    let prev = -Infinity;
    for (const s of [-90000, -1000, -100, 0, 100, 1000, 90000]) {
      const y = squashBootstrapLabel(s, 0, P(0.5));
      expect(y).toBeGreaterThan(prev);
      prev = y;
    }
  });

  it("既定パラメータは α=0.5 / cpRef=cpScale=CP_SCALE", () => {
    expect(DEFAULT_BOOTSTRAP_PARAMS.alpha).toBe(0.5);
    expect(DEFAULT_BOOTSTRAP_PARAMS.cpRef).toBe(DEFAULT_BOOTSTRAP_PARAMS.cpScale);
  });
});
