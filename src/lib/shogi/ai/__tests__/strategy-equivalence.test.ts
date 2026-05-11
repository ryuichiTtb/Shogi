// Issue #193 / PR1a 段階9 + PR1c-2 Phase A: SearchStrategy 抽象の等価性テスト。
//
// PR1a 段階で「Strategy アダプタが DIFFICULTY_PARAMS パススルーとして構造的に正しく
// 動作する」最低限の検証を確立。PR1c-2 Phase A で以下 2 種の data integrity 検証を追加:
//
// - Strategy fixture (strategy-baseline.json、360 entries = 180 局面 × 2 difficulty)
//   の data integrity 確認 (JSON 構造妥当性、entry スキーマ妥当性)
// - Spectator fixture (spectator-baseline.json、4 シナリオ × 25 ply) の
//   data integrity 確認
//
// 動的検証 (= 360 entries で findBestMoveWithStats を再実行して完全一致確認) は
// CI 不可能 (= 8 秒/entry × 360 = 48 分) のため別 script に分離:
//   - npm run verify:strategy-fixture (リリース前手動実行)
// → 計画 md S-3 反映の観戦 fixture 検証方式を Strategy fixture にも拡張。
//
// 動的検証の主用途:
// - Phase B (refactor/#193-pr1c-2) マージ前にローカル実行で完全一致確認
// - PR1d 以降の意図的な AI 動作変更時に fixture 再生成
//
// fixture 生成: npm run gen:fixture:strategy (Mulberry32 seed=42, maxDepth=6 deterministic)

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
import { STRATEGY_FIXTURE_MAX_DEPTH } from "@/lib/shogi/ai/strategy/fixture-constants";
import strategyBaselineRaw from "./fixtures/strategy-baseline.json";
import spectatorBaselineRaw from "./fixtures/spectator-baseline.json";

// fixture JSON の型定義 (gen-fixture-strategy.ts と整合)。
interface StrategyFixtureEntry {
  id: string;
  category: string;
  state: unknown;
  player: "sente" | "gote";
  variantId: string;
  difficulty: "beginner" | "intermediate" | "advanced" | "expert";
  expected: { move: unknown };
}

interface StrategyFixturePayload {
  version: string;
  entries: StrategyFixtureEntry[];
}

interface SpectatorScenarioStep {
  ply: number;
  player: "sente" | "gote";
  move: unknown;
}

interface SpectatorScenario {
  id: string;
  senteDifficulty: "advanced" | "expert";
  goteDifficulty: "advanced" | "expert";
  moves: SpectatorScenarioStep[];
}

interface SpectatorFixturePayload {
  version: string;
  scenarios: SpectatorScenario[];
}

const strategyBaseline = strategyBaselineRaw as StrategyFixturePayload;
const spectatorBaseline = spectatorBaselineRaw as SpectatorFixturePayload;

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

// ----- PR1c-2 Phase A 追加: Strategy fixture data integrity 検証 -----

describe("Strategy fixture: data integrity (PR1c-2 Phase A)", () => {
  it("strategy-baseline.json の version は '1.0'", () => {
    expect(strategyBaseline.version).toBe("1.0");
  });

  it("360 entries = 180 局面 × 2 difficulty (advanced/expert)", () => {
    expect(strategyBaseline.entries.length).toBe(360);
  });

  it("各 entry が必須フィールドを持つ", () => {
    for (const entry of strategyBaseline.entries) {
      expect(entry.id).toBeTypeOf("string");
      expect(entry.category).toBeTypeOf("string");
      expect(entry.state).toBeTypeOf("object");
      expect(["sente", "gote"]).toContain(entry.player);
      expect(["standard", "card-shogi"]).toContain(entry.variantId);
      expect(["advanced", "expert"]).toContain(entry.difficulty);
      expect(entry.expected).toBeTypeOf("object");
      expect(entry.expected).toHaveProperty("move");
    }
  });

  it("5 カテゴリーすべて存在 (standard 3 phase + card-shogi 2 phase)", () => {
    const categories = new Set(strategyBaseline.entries.map((e) => e.category));
    expect(categories).toEqual(
      new Set([
        "standard-opening",
        "standard-midgame",
        "standard-endgame",
        "card-shogi-midgame",
        "card-shogi-endgame",
      ]),
    );
  });

  it("各カテゴリーの entries 数が想定通り (× 2 difficulty)", () => {
    const counts: Record<string, number> = {};
    for (const e of strategyBaseline.entries) {
      counts[e.category] = (counts[e.category] ?? 0) + 1;
    }
    expect(counts["standard-opening"]).toBe(30 * 2);
    expect(counts["standard-midgame"]).toBe(40 * 2);
    expect(counts["standard-endgame"]).toBe(30 * 2);
    expect(counts["card-shogi-midgame"]).toBe(40 * 2);
    expect(counts["card-shogi-endgame"]).toBe(40 * 2);
  });

  it("advanced/expert の entry 数が均等 (180 + 180)", () => {
    const advancedCount = strategyBaseline.entries.filter(
      (e) => e.difficulty === "advanced",
    ).length;
    const expertCount = strategyBaseline.entries.filter(
      (e) => e.difficulty === "expert",
    ).length;
    expect(advancedCount).toBe(180);
    expect(expertCount).toBe(180);
  });

  it("expected.move が null でないもの (= 終局でない局面で AI が手を返した) が大多数", () => {
    // random walk + accept フィルタで status === "active" 局面のみを採取しているため、
    // 全 entry で move が null でないことが期待される。
    const nonNullMoves = strategyBaseline.entries.filter(
      (e) => e.expected.move !== null,
    );
    expect(nonNullMoves.length).toBe(strategyBaseline.entries.length);
  });
});

// ----- PR1c-2 Phase A 追加: Spectator fixture data integrity 検証 -----

describe("Spectator fixture: data integrity (PR1c-2 Phase A、S-3 反映)", () => {
  it("spectator-baseline.json の version は '1.0'", () => {
    expect(spectatorBaseline.version).toBe("1.0");
  });

  it("4 シナリオ存在 (advanced/expert の組合せ)", () => {
    expect(spectatorBaseline.scenarios.length).toBe(4);
    const ids = new Set(spectatorBaseline.scenarios.map((s) => s.id));
    expect(ids).toEqual(
      new Set([
        "advanced-vs-advanced",
        "expert-vs-expert",
        "advanced-vs-expert",
        "expert-vs-advanced",
      ]),
    );
  });

  it("各シナリオが必須フィールドを持つ", () => {
    for (const scenario of spectatorBaseline.scenarios) {
      expect(scenario.id).toBeTypeOf("string");
      expect(["advanced", "expert"]).toContain(scenario.senteDifficulty);
      expect(["advanced", "expert"]).toContain(scenario.goteDifficulty);
      expect(Array.isArray(scenario.moves)).toBe(true);
      expect(scenario.moves.length).toBeGreaterThan(0);
    }
  });

  it("各シナリオの moves が ply 順で連続し sente/gote が交互", () => {
    for (const scenario of spectatorBaseline.scenarios) {
      for (let i = 0; i < scenario.moves.length; i++) {
        const step = scenario.moves[i];
        expect(step.ply).toBe(i + 1);
        // ply 1 が sente、ply 2 が gote、... と交互
        const expectedPlayer = i % 2 === 0 ? "sente" : "gote";
        expect(step.player).toBe(expectedPlayer);
      }
    }
  });

  it("各シナリオで終局到達までの move は null でない", () => {
    for (const scenario of spectatorBaseline.scenarios) {
      // 最終 step を除いた move はすべて非 null (= 移動成功して次の手番に進んだ)。
      // 最終 step も生成スクリプト上は非 null を保証しているが、念のため確認。
      const nullMoves = scenario.moves.filter((m) => m.move === null);
      expect(nullMoves.length).toBe(0);
    }
  });
});

// ----- PR1c-2 Phase A 追加: STRATEGY_FIXTURE_MAX_DEPTH 整合性 -----

describe("STRATEGY_FIXTURE_MAX_DEPTH (PR1c-2 Phase A NN-1 反映)", () => {
  it("名前付き定数として 6 が定義されている", () => {
    expect(STRATEGY_FIXTURE_MAX_DEPTH).toBe(6);
  });

  it("DIFFICULTY_PARAMS.advanced.maxDepth (16) より小さい (= 軽量検証)", () => {
    expect(STRATEGY_FIXTURE_MAX_DEPTH).toBeLessThan(
      DIFFICULTY_PARAMS.advanced.maxDepth,
    );
  });

  it("DIFFICULTY_PARAMS.expert.maxDepth (24) より小さい (= 軽量検証)", () => {
    expect(STRATEGY_FIXTURE_MAX_DEPTH).toBeLessThan(
      DIFFICULTY_PARAMS.expert.maxDepth,
    );
  });
});
