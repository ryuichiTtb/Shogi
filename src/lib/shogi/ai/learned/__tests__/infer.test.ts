import { afterEach, describe, expect, it } from "vitest";

import { createInitialGameState } from "@/lib/shogi/board";
import { createInitialCardState } from "@/lib/shogi/cards/state";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";

import { createModel, serializeModel } from "../mlp";
import {
  CP_SCALE,
  evaluateLearned,
  getLearnedModel,
  hasLearnedModel,
  loadLearnedModel,
} from "../infer";

function gs() {
  return createInitialGameState(CARD_SHOGI_VARIANT);
}
function cs() {
  return createInitialCardState([{ defId: "pawn_return", count: 4 }]);
}

afterEach(() => {
  loadLearnedModel(null); // シングルトンをテスト間でリセット
});

describe("loadLearnedModel / hasLearnedModel", () => {
  it("ロード/アンロードで has が切り替わる", () => {
    expect(hasLearnedModel()).toBe(false);
    loadLearnedModel(serializeModel(createModel(2478, 8, 1)));
    expect(hasLearnedModel()).toBe(true);
    expect(getLearnedModel()).not.toBeNull();
    loadLearnedModel(null);
    expect(hasLearnedModel()).toBe(false);
  });
});

describe("evaluateLearned", () => {
  it("モデル未ロードなら例外 (静かな 0 評価で探索が壊れるのを防ぐ)", () => {
    expect(() => evaluateLearned(gs(), cs())).toThrow();
  });

  it("active 局面は cp スケール内 (|out| ≤ CP_SCALE = tanh∈[-1,1] × CP_SCALE)", () => {
    loadLearnedModel(serializeModel(createModel(2478, 16, 3)));
    const v = evaluateLearned(gs(), cs());
    expect(Number.isFinite(v)).toBe(true);
    expect(Math.abs(v)).toBeLessThanOrEqual(CP_SCALE);
  });

  it("checkmate は ±100000 (evaluate と同一規約、探索 mate 判定と整合)", () => {
    loadLearnedModel(serializeModel(createModel(2478, 8, 1)));
    const base = gs();
    expect(evaluateLearned({ ...base, status: "checkmate", winner: "sente" }, cs())).toBe(100000);
    expect(evaluateLearned({ ...base, status: "checkmate", winner: "gote" }, cs())).toBe(-100000);
  });

  it("非 active (詰み以外の終局) は 0", () => {
    loadLearnedModel(serializeModel(createModel(2478, 8, 1)));
    expect(evaluateLearned({ ...gs(), status: "repetition" }, cs())).toBe(0);
  });

  it("同一モデル・同一局面は同一評価 (決定的)", () => {
    loadLearnedModel(serializeModel(createModel(2478, 16, 5)));
    expect(evaluateLearned(gs(), cs())).toBe(evaluateLearned(gs(), cs()));
  });
});
