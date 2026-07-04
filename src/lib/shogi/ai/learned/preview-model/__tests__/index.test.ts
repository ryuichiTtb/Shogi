// Issue #245 Preview 配線: 複製した学習重みとローダのスモーク。
// ★B-1 回帰防止: 複製 JSON が { model, meta } ラッパでなくフラット SerializedMlp であること
//   (ラッパのまま loadLearnedModel に渡すと deserializeModel が壊れる)。
// ★N-1 回帰防止: featureDim が encoder の FEATURE_DIM と一致 (encoder 変更後の陳腐化検知)。

import { describe, it, expect, afterEach } from "vitest";

import { FEATURE_DIM } from "../../encoder";
import { hasLearnedModel, loadLearnedModel } from "../../infer";
import bootstrapModel from "../bootstrap-small.json";
import { ensureLearnedModelLoaded } from "../index";

// 他テストへ漏らさないようロード状態をリセット (infer の LEARNED_MODEL シングルトン)。
afterEach(() => loadLearnedModel(null));

describe("Preview 配線: 複製重み + ensureLearnedModelLoaded", () => {
  it("複製重みはフラット SerializedMlp で featureDim が encoder と一致 (B-1/N-1)", () => {
    // ラッパ形式でないこと (B-1)。
    expect(bootstrapModel).not.toHaveProperty("model");
    expect(bootstrapModel).not.toHaveProperty("meta");
    // フラット SerializedMlp のキーが揃っていること。
    expect(bootstrapModel).toHaveProperty("featureDim");
    expect(bootstrapModel).toHaveProperty("hidden");
    expect(bootstrapModel).toHaveProperty("w1");
    expect(bootstrapModel).toHaveProperty("b1");
    expect(bootstrapModel).toHaveProperty("w2");
    expect(bootstrapModel).toHaveProperty("b2");
    // featureDim スキュー無し (N-1)。
    expect((bootstrapModel as { featureDim: number }).featureDim).toBe(FEATURE_DIM);
  });

  it("ensureLearnedModelLoaded で hasLearnedModel が true になる (冪等)", () => {
    ensureLearnedModelLoaded();
    expect(hasLearnedModel()).toBe(true);
    // 2 回目呼出は no-op (attempted ガード) だが hasLearnedModel は true のまま。
    ensureLearnedModelLoaded();
    expect(hasLearnedModel()).toBe(true);
  });
});
