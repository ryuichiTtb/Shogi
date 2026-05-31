// Issue #193 / PR3-1 C-1: heuristics.ts 新規 phase 判定ヘルパの境界テスト。
//
// 計画 md docs/plans/issue-193-pr3-1-card-calibration.md 5.1 / 4.1.3 章。
// 新規定数の数値妥当性は bench で検証するため、本ファイルでは挙動 (境界条件) のみ確認。

import { describe, it, expect } from "vitest";
import {
  computePhaseStage,
  ENDGAME_THRESHOLD,
  EARLY_GAME_THRESHOLD,
} from "../heuristics";
import { createInitialGameState } from "../../../board";
import { CARD_SHOGI_VARIANT } from "../../../variants/card-shogi";
import type { GameState } from "../../../types";

describe("computePhaseStage (PR3-1)", () => {
  function makeState(moveCount: number): GameState {
    return { ...createInitialGameState(CARD_SHOGI_VARIANT), moveCount };
  }

  it("ply=0 (初期局面) は 0=序盤", () => {
    expect(computePhaseStage(makeState(0))).toBe(0);
  });

  it("EARLY_GAME_THRESHOLD-1 はまだ 0=序盤 (境界手前)", () => {
    expect(computePhaseStage(makeState(EARLY_GAME_THRESHOLD - 1))).toBe(0);
  });

  it("EARLY_GAME_THRESHOLD で 1=中盤に切り替わる (境界)", () => {
    expect(computePhaseStage(makeState(EARLY_GAME_THRESHOLD))).toBe(1);
  });

  it("ENDGAME_THRESHOLD-1 はまだ 1=中盤 (境界手前)", () => {
    expect(computePhaseStage(makeState(ENDGAME_THRESHOLD - 1))).toBe(1);
  });

  it("ENDGAME_THRESHOLD で 2=終盤に切り替わる (境界)", () => {
    expect(computePhaseStage(makeState(ENDGAME_THRESHOLD))).toBe(2);
  });

  it("ply=300 (長期戦) も 2=終盤", () => {
    expect(computePhaseStage(makeState(300))).toBe(2);
  });

  it("EARLY_GAME_THRESHOLD < ENDGAME_THRESHOLD であること (順序整合性)", () => {
    expect(EARLY_GAME_THRESHOLD).toBeLessThan(ENDGAME_THRESHOLD);
  });
});
