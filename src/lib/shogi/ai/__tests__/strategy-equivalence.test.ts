// Issue #193 / PR1a 段階9: SearchStrategy 抽象の構造的等価性テスト。
//
// PR1a の最重要 DoD: PR1a 前後で findBestMoveWithStats の返却 move が完全一致 (= 振る舞いキープ)。
// 100 局面 × standard variant + 80 局面 × card-shogi 中盤・終盤 の本格 fixture は
// PR1c-2 着手前に scripts/gen-fixture-strategy.ts で生成する想定。
//
// 本テストは PR1a 段階で「Strategy アダプタが DIFFICULTY_PARAMS パススルーとして
// 構造的に正しく動作する」最低限の検証に留める (高速で CI 内で実行可)。
// 振る舞いキープの本格検証 (= 実際に findBestMoveWithStats を 180 局面で呼ぶ) は
// PR1c-2 で fixture-driven に拡張する。

import { describe, it, expect } from "vitest";
import { DIFFICULTY_PARAMS } from "@/lib/shogi/ai/engine";
import {
  createStrategy,
  GennoStrategy,
  MusashiStrategy,
  RyuouStrategy,
  SakuraStrategy,
  SPECTATOR_TIME_LIMIT_MS,
} from "@/lib/shogi/ai/strategy";

describe("SearchStrategy: createStrategy factory", () => {
  it("各 Difficulty に対応するキャラインスタンスを返す", () => {
    expect(createStrategy("beginner").characterId).toBe("sakura");
    expect(createStrategy("intermediate").characterId).toBe("musashi");
    expect(createStrategy("advanced").characterId).toBe("genno");
    expect(createStrategy("expert").characterId).toBe("ryuou");
  });

  it("各 Strategy のインスタンスは LegacyStrategyAdapter のサブクラス", () => {
    expect(createStrategy("beginner")).toBeInstanceOf(SakuraStrategy);
    expect(createStrategy("intermediate")).toBeInstanceOf(MusashiStrategy);
    expect(createStrategy("advanced")).toBeInstanceOf(GennoStrategy);
    expect(createStrategy("expert")).toBeInstanceOf(RyuouStrategy);
  });
});

describe("SearchStrategy: targetReadingPly (Issue #193 本文の棋力目安)", () => {
  it("さくら=1 / 武蔵=3 / 玄翁老師=5 / 龍王=6", () => {
    expect(createStrategy("beginner").targetReadingPly).toBe(1);
    expect(createStrategy("intermediate").targetReadingPly).toBe(3);
    expect(createStrategy("advanced").targetReadingPly).toBe(5);
    expect(createStrategy("expert").targetReadingPly).toBe(6);
  });
});

describe("SearchStrategy: DIFFICULTY_PARAMS パススルー (PR1a 振る舞いキープ)", () => {
  it("通常モード (spectator=false) では DIFFICULTY_PARAMS と完全一致", () => {
    for (const difficulty of [
      "beginner",
      "intermediate",
      "advanced",
      "expert",
    ] as const) {
      const s = createStrategy(difficulty);
      const params = DIFFICULTY_PARAMS[difficulty];
      expect(s.maxSearchDepth).toBe(params.maxDepth);
      expect(s.timeLimitMs).toBe(params.timeLimitMs);
      expect(s.addNoise).toBe(params.addNoise);
      expect(s.nearEqualThreshold).toBe(params.nearEqualThreshold);
      expect(s.useBook).toBe(params.useBook);
      expect(s.spectator).toBe(false);
    }
  });
});

describe("SearchStrategy: 観戦モード timeLimitMs 短縮 (β-3)", () => {
  it("spectator=true で expert (3500ms) は SPECTATOR_TIME_LIMIT_MS=1500ms に短縮", () => {
    const expert = createStrategy("expert", { spectator: true });
    expect(expert.timeLimitMs).toBe(SPECTATOR_TIME_LIMIT_MS);
    expect(expert.spectator).toBe(true);
  });

  it("spectator=true で beginner (800ms) は元値より短い → 元のまま (Math.min)", () => {
    const beginner = createStrategy("beginner", { spectator: true });
    // beginner の DIFFICULTY_PARAMS.timeLimitMs は 800ms で SPECTATOR_TIME_LIMIT_MS=1500 より小さい
    // Math.min(800, 1500) = 800 なので元のまま
    expect(beginner.timeLimitMs).toBe(DIFFICULTY_PARAMS.beginner.timeLimitMs);
  });

  it("addNoise / nearEqualThreshold / useBook は spectator フラグに影響されない", () => {
    const expertSpec = createStrategy("expert", { spectator: true });
    const expertNormal = createStrategy("expert");
    expect(expertSpec.addNoise).toBe(expertNormal.addNoise);
    expect(expertSpec.nearEqualThreshold).toBe(expertNormal.nearEqualThreshold);
    expect(expertSpec.useBook).toBe(expertNormal.useBook);
  });
});
