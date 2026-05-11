// Issue #193 / PR1c-2 Phase A: strategy fixture 生成スクリプト。
//
// 目的:
// PR1c-2 Phase B (engine.ts の DIFFICULTY_PARAMS 直接参照を Strategy 経由参照に切替)
// の振る舞いキープを fixture-driven に検証するため、refactor 前の現 main 動作で
// 180 局面 (standard 100 + card-shogi 80) × 2 difficulty (advanced/expert) + 観戦
// モード 4 シナリオ × 50 手の baseline を生成し、JSON に書き出す。
//
// 役割分担方式 (MM-2 / 第 2 次レビュー Phase 3 ユーザー確定):
// - Strategy fixture (本 script): 「Phase B refactor の関数呼出経路の整合性検証」
//   に役割を絞り、maxDepth=8 の軽量検証 (CPU 速度非依存)
// - 深い検証: PR1d 以降の perf-bench.test.ts + Vercel preview 実機確認で補完
//
// 生成パターン (本フェーズ計画 md L356-414 / JSON スキーマ準拠):
//   - standard variant: 100 局面 (opening 30 / midgame 40 / endgame 30)
//   - card-shogi variant: 80 局面 (midgame 40 / endgame 40)
//   - 各局面で advanced/expert の 2 difficulty 分の expected.move を生成 = 360 entries
//   - 観戦モード 4 シナリオ (advanced/expert の組合せ各 50 手):
//     * advanced vs advanced / expert vs expert / advanced vs expert / expert vs advanced
//
// 二段ガード (PR1b/PR1c から踏襲):
//   1. random walk で生成 (詰み・千日手・ステールメイトに到達したら破棄)
//   2. state.status === "active" filter (二重ガード)
//
// CPU 速度非依存 (M-2 反映):
//   - findBestMoveWithStats({ maxDepth: STRATEGY_FIXTURE_MAX_DEPTH=8 }) で実行
//   - engine 内で options.maxDepth !== undefined 検出時に
//     effectiveTimeLimitMs = Number.MAX_SAFE_INTEGER に内部設定 (= timeLimitMs 経路無効化)
//   - 必ず maxDepth=8 まで到達するため reproducible
//
// 出力:
//   - src/lib/shogi/ai/__tests__/fixtures/strategy-baseline.json
//   - src/lib/shogi/ai/__tests__/fixtures/strategy-baseline.meta.json
//   - src/lib/shogi/ai/__tests__/fixtures/spectator-baseline.json
//   - src/lib/shogi/ai/__tests__/fixtures/spectator-baseline.meta.json
//
// 使い方:
//   npm run gen:fixture:strategy
//   npm run gen:fixture:strategy -- --seed=123
//
// 再生成タイミング:
//   - Phase B (refactor) 完了後は再生成不要 (= refactor 前の baseline として固定)
//   - PR1d で Strategy 別ロジック分岐を入れて意図的に振る舞いを変える場合に再生成
//   - production 動作 (maxDepth 24) と乖離するため、深い検証は PR1d perf-bench.test.ts で補完

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInitialGameState, applyMove, serializeGameState } from "@/lib/shogi/board";
import { getFullLegalMoves } from "@/lib/shogi/moves";
import { evaluateGameEnd } from "@/lib/shogi/rules";
import { findBestMoveWithStats } from "@/lib/shogi/ai/engine";
import { STANDARD_VARIANT } from "@/lib/shogi/variants/standard";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";
import type { Difficulty, GameState, Move, Player, RuleVariant } from "@/lib/shogi/types";
import { STRATEGY_FIXTURE_MAX_DEPTH } from "@/lib/shogi/ai/strategy/fixture-constants";
import { mulberry32, randomChoice, parseSeedFromArgv } from "./utils/prng";

// ----- 出力先 (process.cwd() = リポジトリ root 前提) -----
const REPO_ROOT = process.cwd();
const STRATEGY_FIXTURE_PATH = resolve(
  REPO_ROOT,
  "src/lib/shogi/ai/__tests__/fixtures/strategy-baseline.json",
);
const STRATEGY_META_PATH = resolve(
  REPO_ROOT,
  "src/lib/shogi/ai/__tests__/fixtures/strategy-baseline.meta.json",
);
const SPECTATOR_FIXTURE_PATH = resolve(
  REPO_ROOT,
  "src/lib/shogi/ai/__tests__/fixtures/spectator-baseline.json",
);
const SPECTATOR_META_PATH = resolve(
  REPO_ROOT,
  "src/lib/shogi/ai/__tests__/fixtures/spectator-baseline.meta.json",
);

// ----- 局面ジェネレータ (PR1b の gen-fixture-legal-moves.ts と同じ手法) -----

interface StrategyFixtureEntry {
  id: string;
  category: string;
  state: object;
  player: Player;
  variantId: string;
  difficulty: Difficulty;
  expected: { move: Move | null };
}

interface SpectatorScenarioStep {
  ply: number;
  player: Player;
  move: Move | null;
}

interface SpectatorScenario {
  id: string;
  senteDifficulty: Difficulty;
  goteDifficulty: Difficulty;
  moves: SpectatorScenarioStep[];
}

interface CategorySpec {
  id: string;
  variant: RuleVariant;
  variantId: string;
  count: number;
  walkMin: number;
  walkMax: number;
}

// random walk で局面生成 (詰み・千日手・ステールメイトに到達したら破棄)。
function generateRandomWalkState(
  variant: RuleVariant,
  rng: () => number,
  targetPly: number,
): GameState | null {
  let state = createInitialGameState(variant);
  for (let ply = 0; ply < targetPly; ply++) {
    state = evaluateGameEnd(state, variant);
    if (state.status !== "active") return null;
    const moves = getFullLegalMoves(state, state.currentPlayer, variant);
    if (moves.length === 0) return null;
    const chosen = randomChoice(rng, moves);
    if (!chosen) return null;
    state = applyMove(state, chosen);
  }
  state = evaluateGameEnd(state, variant);
  if (state.status !== "active") return null;
  return state;
}

// 指定カテゴリーの局面を採取する (1 件生成)。
function generateCategoryState(
  spec: CategorySpec,
  rng: () => number,
): GameState | null {
  const MAX_TRIES = 200;
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const targetPly =
      spec.walkMin + Math.floor(rng() * (spec.walkMax - spec.walkMin + 1));
    const state = generateRandomWalkState(spec.variant, rng, targetPly);
    if (state) return state;
  }
  return null;
}

// ----- 採取するカテゴリー定義 (合計 180 局面、本フェーズ計画 md L356-414 準拠) -----

const CATEGORY_SPECS: CategorySpec[] = [
  // standard variant: 100 局面
  { id: "standard-opening", variant: STANDARD_VARIANT, variantId: "standard", count: 30, walkMin: 0, walkMax: 15 },
  { id: "standard-midgame", variant: STANDARD_VARIANT, variantId: "standard", count: 40, walkMin: 15, walkMax: 50 },
  { id: "standard-endgame", variant: STANDARD_VARIANT, variantId: "standard", count: 30, walkMin: 50, walkMax: 100 },
  // card-shogi variant: 80 局面 (中盤・終盤のみ、openingBook 範囲は意図的に除外)
  { id: "card-shogi-midgame", variant: CARD_SHOGI_VARIANT, variantId: "card-shogi", count: 40, walkMin: 15, walkMax: 50 },
  { id: "card-shogi-endgame", variant: CARD_SHOGI_VARIANT, variantId: "card-shogi", count: 40, walkMin: 50, walkMax: 100 },
];

// fixture 生成対象の difficulty (addNoise=0 / nearEqualThreshold=0 で deterministic な 2 つ)。
const FIXTURE_DIFFICULTIES: Difficulty[] = ["advanced", "expert"];

// 観戦モード 4 シナリオ (advanced/expert の組合せ各 50 手)。
const SPECTATOR_SCENARIOS: Array<{ id: string; sente: Difficulty; gote: Difficulty }> = [
  { id: "advanced-vs-advanced", sente: "advanced", gote: "advanced" },
  { id: "expert-vs-expert", sente: "expert", gote: "expert" },
  { id: "advanced-vs-expert", sente: "advanced", gote: "expert" },
  { id: "expert-vs-advanced", sente: "expert", gote: "advanced" },
];

const SPECTATOR_PLIES_PER_SCENARIO = 50;

// ----- メインエントリー -----

function generateStrategyFixture(rng: () => number): {
  entries: StrategyFixtureEntry[];
  categoryCounts: Record<string, number>;
} {
  const entries: StrategyFixtureEntry[] = [];
  const categoryCounts: Record<string, number> = {};

  for (const spec of CATEGORY_SPECS) {
    let collected = 0;
    let index = 0;
    const MAX_ATTEMPTS = spec.count * 50;
    let attempts = 0;
    while (collected < spec.count && attempts < MAX_ATTEMPTS) {
      attempts++;
      const state = generateCategoryState(spec, rng);
      if (!state) continue;
      const id = `${spec.id}-${String(index).padStart(3, "0")}`;
      // 同じ state で 2 difficulty 分の expected.move を生成
      for (const difficulty of FIXTURE_DIFFICULTIES) {
        const result = findBestMoveWithStats(
          state,
          state.currentPlayer,
          difficulty,
          spec.variant,
          { maxDepth: STRATEGY_FIXTURE_MAX_DEPTH },
        );
        entries.push({
          id,
          category: spec.id,
          state: serializeGameState(state),
          player: state.currentPlayer,
          variantId: spec.variantId,
          difficulty,
          expected: { move: result.move },
        });
      }
      index++;
      collected++;
    }
    categoryCounts[spec.id] = collected;
    if (collected < spec.count) {
      console.warn(
        `[gen-fixture-strategy] category "${spec.id}": collected ${collected}/${spec.count} (max attempts reached)`,
      );
    }
  }

  return { entries, categoryCounts };
}

function generateSpectatorScenario(
  senteDifficulty: Difficulty,
  goteDifficulty: Difficulty,
  scenarioId: string,
): SpectatorScenario {
  let state = createInitialGameState(CARD_SHOGI_VARIANT);
  const moves: SpectatorScenarioStep[] = [];
  for (let ply = 1; ply <= SPECTATOR_PLIES_PER_SCENARIO; ply++) {
    state = evaluateGameEnd(state, CARD_SHOGI_VARIANT);
    if (state.status !== "active") break;
    const currentPlayer = state.currentPlayer;
    const difficulty = currentPlayer === "sente" ? senteDifficulty : goteDifficulty;
    const result = findBestMoveWithStats(
      state,
      currentPlayer,
      difficulty,
      CARD_SHOGI_VARIANT,
      { maxDepth: STRATEGY_FIXTURE_MAX_DEPTH, spectator: true },
    );
    moves.push({ ply, player: currentPlayer, move: result.move });
    if (!result.move) break;
    state = applyMove(state, result.move);
  }
  return {
    id: scenarioId,
    senteDifficulty,
    goteDifficulty,
    moves,
  };
}

function main() {
  const seed = parseSeedFromArgv(process.argv);
  const rng = mulberry32(seed);

  console.log(`[gen-fixture-strategy] seed=${seed}, STRATEGY_FIXTURE_MAX_DEPTH=${STRATEGY_FIXTURE_MAX_DEPTH}`);

  // ----- Strategy fixture -----
  console.log("[gen-fixture-strategy] generating strategy-baseline.json (180 局面 × 2 difficulty)...");
  const startStrategy = Date.now();
  const { entries: strategyEntries, categoryCounts } = generateStrategyFixture(rng);
  const elapsedStrategy = ((Date.now() - startStrategy) / 1000).toFixed(1);

  mkdirSync(dirname(STRATEGY_FIXTURE_PATH), { recursive: true });

  const strategyPayload = {
    version: "1.0",
    entries: strategyEntries,
  };
  writeFileSync(STRATEGY_FIXTURE_PATH, JSON.stringify(strategyPayload, null, 2) + "\n", "utf8");

  const strategyMeta = {
    generatedAt: new Date().toISOString(),
    seed,
    maxDepth: STRATEGY_FIXTURE_MAX_DEPTH,
    totalEntries: strategyEntries.length,
    categoryCounts,
    difficulties: FIXTURE_DIFFICULTIES,
    elapsedSeconds: parseFloat(elapsedStrategy),
    note:
      "strategy baseline fixture generated by scripts/gen-fixture-strategy.ts. " +
      "Re-generate when intentionally changing AI move logic for advanced/expert " +
      "(PR1d Strategy 別ロジック分岐等). PR1c-2 Phase B refactor では再生成不要 " +
      "(= 振る舞いキープ baseline として固定)。",
  };
  writeFileSync(STRATEGY_META_PATH, JSON.stringify(strategyMeta, null, 2) + "\n", "utf8");

  console.log(`[gen-fixture-strategy] generated ${strategyEntries.length} strategy entries (${elapsedStrategy}s):`);
  for (const [id, count] of Object.entries(categoryCounts)) {
    console.log(`  - ${id}: ${count} 局面 × ${FIXTURE_DIFFICULTIES.length} difficulty = ${count * FIXTURE_DIFFICULTIES.length} entries`);
  }

  // ----- Spectator fixture -----
  console.log("[gen-fixture-strategy] generating spectator-baseline.json (4 シナリオ × 50 ply)...");
  const startSpectator = Date.now();
  const spectatorScenarios: SpectatorScenario[] = [];
  for (const spec of SPECTATOR_SCENARIOS) {
    console.log(`  - ${spec.id} (sente=${spec.sente}, gote=${spec.gote})...`);
    const scenario = generateSpectatorScenario(spec.sente, spec.gote, spec.id);
    spectatorScenarios.push(scenario);
    console.log(`    完了 ${scenario.moves.length} 手`);
  }
  const elapsedSpectator = ((Date.now() - startSpectator) / 1000).toFixed(1);

  const spectatorPayload = {
    version: "1.0",
    scenarios: spectatorScenarios,
  };
  writeFileSync(SPECTATOR_FIXTURE_PATH, JSON.stringify(spectatorPayload, null, 2) + "\n", "utf8");

  const spectatorMeta = {
    generatedAt: new Date().toISOString(),
    seed,
    maxDepth: STRATEGY_FIXTURE_MAX_DEPTH,
    spectator: true,
    totalScenarios: spectatorScenarios.length,
    pliesPerScenario: SPECTATOR_PLIES_PER_SCENARIO,
    elapsedSeconds: parseFloat(elapsedSpectator),
    note:
      "spectator baseline fixture generated by scripts/gen-fixture-strategy.ts. " +
      "data integrity 検証のみ test:ci 対象、動的検証は npm run verify:strategy-fixture (CI 外) で実施。",
  };
  writeFileSync(SPECTATOR_META_PATH, JSON.stringify(spectatorMeta, null, 2) + "\n", "utf8");

  console.log(`[gen-fixture-strategy] generated ${spectatorScenarios.length} spectator scenarios (${elapsedSpectator}s)`);
  console.log(`  fixture: ${STRATEGY_FIXTURE_PATH}`);
  console.log(`  meta:    ${STRATEGY_META_PATH}`);
  console.log(`  fixture: ${SPECTATOR_FIXTURE_PATH}`);
  console.log(`  meta:    ${SPECTATOR_META_PATH}`);
  console.log(`[gen-fixture-strategy] total elapsed: ${(parseFloat(elapsedStrategy) + parseFloat(elapsedSpectator)).toFixed(1)}s`);
}

main();
