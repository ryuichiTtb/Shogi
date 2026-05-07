// Issue #176: AI ベンチマーク (Phase 0 ベースライン → Stage A/B/C 比較用)。
//
// 目的:
//   - difficulty × variant × phase ごとに elapsed の分布 (p50 / p95 / max) を取得
//   - 計画 md に記録した「最大5秒・平均1〜3秒」目標との差分を可視化
//   - Stage A (deadline 厳格化) / Stage B (Route Handler 化) / Stage C
//     (per-request 隔離) 後の比較ベースラインにする
//
// 実行: `npx tsx scripts/bench-ai.ts [--runs=N] [--out=path]`
//   - 出力先デフォルト: `bench-results/<timestamp>.json` (gitignore 対象)
//   - --runs はケースあたりの試行回数 (デフォルト 3)
//
// 局面 fixture:
//   - opening: createInitialGameState (moveCount=0)
//   - midgame_30: deterministic legal-move walk で 30 手進めた局面

import { performance } from "node:perf_hooks";
import fs from "node:fs/promises";
import path from "node:path";

import { findBestMoveWithStats, DIFFICULTY_PARAMS } from "@/lib/shogi/ai/engine";
import { applyMove, createInitialGameState } from "@/lib/shogi/board";
import { getFullLegalMoves } from "@/lib/shogi/moves";
import { STANDARD_VARIANT } from "@/lib/shogi/variants/standard";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";
import type {
  Difficulty,
  GameState,
  Player,
  RuleVariant,
} from "@/lib/shogi/types";

const DIFFICULTIES: Difficulty[] = [
  "beginner",
  "intermediate",
  "advanced",
  "expert",
];

interface BenchCase {
  fixtureName: string;
  variantName: "standard" | "card-shogi";
  variant: RuleVariant;
  difficulty: Difficulty;
  state: GameState;
  player: Player;
}

interface CaseResult {
  fixtureName: string;
  variantName: string;
  difficulty: Difficulty;
  moveCount: number;
  currentPlayer: Player;
  runs: number;
  elapsedMs: number[];
  p50: number;
  p95: number;
  max: number;
  min: number;
  mean: number;
  moveReturnedCount: number;
}

interface BenchOutput {
  generatedAt: string;
  runsPerCase: number;
  difficultyParams: Record<Difficulty, { maxDepth: number; timeLimitMs: number }>;
  results: CaseResult[];
}

// ===== fixture builders =====

// 与えた variant の初期局面を返す。
function buildOpeningFixture(variant: RuleVariant): GameState {
  return createInitialGameState(variant);
}

// deterministic に N 手進めた局面を作る。
// Phase 0 ベンチ用なので「現実的な中盤局面」であれば良く、最善手を選ぶ必要は
// ない。`getFullLegalMoves` の先頭から (moveCount * 7919) % len 番目の合法手を
// 採用することで、再現性を保ちつつ多様な手順を生む。
function buildMoveCountFixture(
  variant: RuleVariant,
  moveCount: number,
): GameState {
  let state = createInitialGameState(variant);
  for (let i = 0; i < moveCount; i++) {
    if (state.status !== "active") break;
    const moves = getFullLegalMoves(state, state.currentPlayer, variant);
    if (moves.length === 0) break;
    const idx = (state.moveCount * 7919) % moves.length;
    state = applyMove(state, moves[idx]);
  }
  return state;
}

function buildCases(runsPerCase: number): BenchCase[] {
  const variants: Array<{ name: "standard" | "card-shogi"; variant: RuleVariant }> = [
    { name: "standard", variant: STANDARD_VARIANT },
    { name: "card-shogi", variant: CARD_SHOGI_VARIANT },
  ];
  const fixtures = [
    { name: "opening", build: (v: RuleVariant) => buildOpeningFixture(v) },
    { name: "midgame_30", build: (v: RuleVariant) => buildMoveCountFixture(v, 30) },
  ];

  const cases: BenchCase[] = [];
  for (const v of variants) {
    for (const f of fixtures) {
      const state = f.build(v.variant);
      for (const difficulty of DIFFICULTIES) {
        cases.push({
          fixtureName: f.name,
          variantName: v.name,
          variant: v.variant,
          difficulty,
          state,
          player: state.currentPlayer,
        });
      }
    }
  }
  void runsPerCase;
  return cases;
}

// ===== 統計関数 =====

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1);
  return sorted[Math.max(0, idx)];
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

// ===== ベンチ本体 =====

async function runBench(runsPerCase: number, outPath: string): Promise<void> {
  const cases = buildCases(runsPerCase);
  const results: CaseResult[] = [];

  console.log(`Bench: ${cases.length} cases × ${runsPerCase} runs`);
  console.log("");

  for (const c of cases) {
    const elapsedMs: number[] = [];
    let moveReturnedCount = 0;

    for (let i = 0; i < runsPerCase; i++) {
      const t0 = performance.now();
      const { move } = findBestMoveWithStats(c.state, c.player, c.difficulty, c.variant);
      const t1 = performance.now();
      const elapsed = t1 - t0;
      elapsedMs.push(elapsed);
      if (move !== null) moveReturnedCount += 1;
    }

    const result: CaseResult = {
      fixtureName: c.fixtureName,
      variantName: c.variantName,
      difficulty: c.difficulty,
      moveCount: c.state.moveCount,
      currentPlayer: c.player,
      runs: runsPerCase,
      elapsedMs,
      p50: percentile(elapsedMs, 0.5),
      p95: percentile(elapsedMs, 0.95),
      max: Math.max(...elapsedMs),
      min: Math.min(...elapsedMs),
      mean: mean(elapsedMs),
      moveReturnedCount,
    };
    results.push(result);

    console.log(
      `[${c.variantName}/${c.fixtureName}/${c.difficulty}] ` +
        `mean=${result.mean.toFixed(0)}ms p50=${result.p50.toFixed(0)}ms ` +
        `p95=${result.p95.toFixed(0)}ms max=${result.max.toFixed(0)}ms ` +
        `(moves=${moveReturnedCount}/${runsPerCase})`,
    );
  }

  // engine 側の現行 difficulty params を出力に含める (ベースライン解釈用)
  const difficultyParams: BenchOutput["difficultyParams"] = {
    beginner: { maxDepth: DIFFICULTY_PARAMS.beginner.maxDepth, timeLimitMs: DIFFICULTY_PARAMS.beginner.timeLimitMs },
    intermediate: { maxDepth: DIFFICULTY_PARAMS.intermediate.maxDepth, timeLimitMs: DIFFICULTY_PARAMS.intermediate.timeLimitMs },
    advanced: { maxDepth: DIFFICULTY_PARAMS.advanced.maxDepth, timeLimitMs: DIFFICULTY_PARAMS.advanced.timeLimitMs },
    expert: { maxDepth: DIFFICULTY_PARAMS.expert.maxDepth, timeLimitMs: DIFFICULTY_PARAMS.expert.timeLimitMs },
  };

  const output: BenchOutput = {
    generatedAt: new Date().toISOString(),
    runsPerCase,
    difficultyParams,
    results,
  };

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(output, null, 2), "utf8");
  console.log("");
  console.log(`Wrote: ${outPath}`);
}

// ===== CLI =====

function parseArgs(argv: string[]): { runs: number; out: string } {
  let runs = 3;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  let out = path.join("bench-results", `${ts}.json`);
  for (const a of argv) {
    if (a.startsWith("--runs=")) runs = Math.max(1, Number(a.slice(7)) || 3);
    else if (a.startsWith("--out=")) out = a.slice(6);
  }
  return { runs, out };
}

const { runs, out } = parseArgs(process.argv.slice(2));
runBench(runs, out).catch((err) => {
  console.error(err);
  process.exit(1);
});
