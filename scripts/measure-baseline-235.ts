#!/usr/bin/env node
// Issue #235 S0: before-baseline 計測ハーネス (standalone tsx 版)。
//
// canonical main (PR3-3 マージ済) の depthCompleted / nodes / カード使用率を
// 全4難易度 (beginner / intermediate / advanced / expert) で RUNS 回計測し、
// 中央値を docs/bench-results/issue-235-before-baseline.json に保存する。
// 設計 doc docs/plans/issue-235-card-shogi-ai-redesign.md §8.2 準拠。
//
// なぜ standalone tsx か (前セッションの教訓):
//   旧 .mjs 案 (= bench テストの console.log テレメトリを parse) は不可だった:
//     ① perf-bench.test.ts は test() に timeout 未指定 (vitest 既定 5000ms) のため、
//        intermediate(~13s)/advanced(~18s)/expert(~25s) が timeout 失敗し計測値が欠落する。
//     ② vitest は「合格した」テストの console.log を既定で非表示にするため、beginner の
//        perf 値や card-usage 値 (assert を通過する) が回収できない。
//   本ハーネスは findBestMoveWithStats を直接呼び、bench fixture (makeBenchPositions /
//   makeScenarios) のロジックを再現する。vitest 非依存なので全4難易度を確実に計測できる。
//
// fixture の正本 (sync 注意):
//   - perf 局面: src/lib/shogi/ai/__tests__/perf-bench.test.ts makeBenchPositions()
//   - card シナリオ: src/lib/shogi/ai/__tests__/perf-bench-card-usage.test.ts makeScenarios()
//   これらを変更したら本ハーネスの fixture も追従させること。
//   本ハーネスは scripts 配下の S0 計測専用ツールで production コードは一切変更しない。
//
// 計測条件の留意 (設計 doc §8.2):
//   - depthCompleted は time-budget 探索のため計測機の CPU 性能に依存する。
//     各段/PoC の ±10% 比較は同一機・同一条件で取得すること (本ファイルの commitSHA・
//     conditions に固定保存する)。
//   - beginner/intermediate は addNoise / 初級タダ捨て確率許容により非決定性がある
//     (特に card-usage の breakdown)。よって RUNS 回計測し中央値で集約する。
//
// 使い方 (design worktree の repo ルートで):
//   npx tsx scripts/measure-baseline-235.ts [runs]      (既定 runs=3、全4難易度)
//   BASELINE_ONLY=beginner BASELINE_OUT=/tmp/smoke.json npx tsx scripts/measure-baseline-235.ts 1
//     → smoke 用: 難易度・出力先を絞って高速にハーネスの健全性を検証する。

import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import {
  findBestMoveWithStats,
  DIFFICULTY_PARAMS,
} from "@/lib/shogi/ai/engine";
import {
  createInitialGameState,
  applyMoveForSearch,
} from "@/lib/shogi/board";
import { createInitialCardState } from "@/lib/shogi/cards/state";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";
import { getFullLegalMoves } from "@/lib/shogi/moves";
import type { Difficulty, GameState, Player } from "@/lib/shogi/types";
import type {
  CardGameState,
  CardInstance,
  CardId,
} from "@/lib/shogi/cards/types";
import type { TurnAction } from "@/lib/shogi/ai/turn/types";

const RUNS = Math.max(1, Number(process.argv[2] ?? "3") || 3);
const OUT = process.env.BASELINE_OUT ?? "docs/bench-results/issue-235-before-baseline.json";
const ALL_DIFFICULTIES: Difficulty[] = [
  "beginner",
  "intermediate",
  "advanced",
  "expert",
];
// smoke 用に難易度を絞れる (BASELINE_ONLY=beginner,intermediate)。
const DIFFICULTIES: Difficulty[] = process.env.BASELINE_ONLY
  ? (process.env.BASELINE_ONLY.split(",").map((s) => s.trim()) as Difficulty[])
  : ALL_DIFFICULTIES;

// ===== perf-bench fixture 再現 (perf-bench.test.ts makeBenchPositions) =====

const PERF_DECK = [
  { defId: "pawn_return" as const, count: 4 },
  { defId: "double_move" as const, count: 4 },
  { defId: "no_promote" as const, count: 4 },
];

function makeBenchPositions(): {
  label: string;
  state: GameState;
  player: Player;
}[] {
  const positions: { label: string; state: GameState; player: Player }[] = [];
  let gs = createInitialGameState(CARD_SHOGI_VARIANT);
  positions.push({ label: "initial", state: gs, player: "sente" });
  for (let i = 0; i < 8; i++) {
    const mover: Player = i % 2 === 0 ? "sente" : "gote";
    const moves = getFullLegalMoves(gs, mover, CARD_SHOGI_VARIANT);
    if (moves.length === 0) break;
    gs = applyMoveForSearch(gs, moves[0]);
    const next: Player = mover === "sente" ? "gote" : "sente";
    positions.push({ label: `ply-${i + 1}`, state: gs, player: next });
  }
  return positions;
}

// ===== card-usage fixture 再現 (perf-bench-card-usage.test.ts makeScenarios) =====

const CARD_DECK = [
  { defId: "pawn_return" as const, count: 4 },
  { defId: "double_pawn" as const, count: 4 },
  { defId: "no_promote" as const, count: 4 },
];

type ActionKind =
  | "move"
  | "draw"
  | "playCard:trap"
  | "playCard:board"
  | "playCard:double_move";

// perf-bench-card-usage.test.ts classifyAction と同一ロジック。
function classifyAction(action: TurnAction | null): ActionKind | "none" {
  if (action === null) return "none";
  if (action.kind === "move") return "move";
  if (action.kind === "draw") return "draw";
  if (action.defId === "double_move") return "playCard:double_move";
  if (action.defId === "no_promote" || action.defId === "check_break") {
    return "playCard:trap";
  }
  return "playCard:board";
}

function mkHand(n: number, defId: CardId): CardInstance[] {
  return Array.from({ length: n }, (_, i) => ({
    instanceId: `bench-${defId}-${i}`,
    defId,
  }));
}

interface BenchScenario {
  label: string;
  state: GameState;
  player: Player;
  cardState: CardGameState;
}

function makeScenarios(): BenchScenario[] {
  const initial = createInitialGameState(CARD_SHOGI_VARIANT);
  const midState: GameState = { ...initial, moveCount: 50 }; // phase=1
  const endState: GameState = { ...initial, moveCount: 120 }; // phase=2

  const buildPawnReturnHand = (
    handSize: number,
    manaSente: number,
    manaGote: number,
  ): CardGameState => {
    const cs = createInitialCardState(CARD_DECK);
    cs.hand.sente = mkHand(handSize, "pawn_return");
    cs.mana.sente = manaSente;
    cs.mana.gote = manaGote;
    return cs;
  };

  const buildLimitedHand = (
    handCards: CardInstance[],
    manaSente: number,
    manaGote: number,
    emptyDeck = false,
  ): CardGameState => {
    const cs = createInitialCardState(CARD_DECK);
    cs.hand.sente = handCards;
    if (emptyDeck) cs.deck.sente = [];
    cs.mana.sente = manaSente;
    cs.mana.gote = manaGote;
    return cs;
  };

  return [
    {
      label: "midgame-mana-surplus",
      state: midState,
      player: "sente",
      cardState: buildPawnReturnHand(3, 15, 13),
    },
    {
      label: "midgame-mana-cap",
      state: midState,
      player: "sente",
      cardState: buildPawnReturnHand(3, 19, 16),
    },
    {
      label: "endgame-hand-surplus",
      state: endState,
      player: "sente",
      cardState: buildPawnReturnHand(5, 12, 10),
    },
    {
      label: "midgame-hand-pressure",
      state: midState,
      player: "sente",
      cardState: buildPawnReturnHand(4, 10, 8),
    },
    {
      label: "calib-empty-hand-mana-surplus",
      state: midState,
      player: "sente",
      cardState: buildLimitedHand([], 15, 8),
    },
    {
      label: "calib-trap-only-no-draw",
      state: midState,
      player: "sente",
      cardState: buildLimitedHand(mkHand(2, "no_promote"), 19, 12, true),
    },
    {
      label: "calib-endgame-empty-hand-mana-mid",
      state: endState,
      player: "sente",
      cardState: buildLimitedHand([], 14, 10),
    },
  ];
}

// ===== 計測 =====

interface PerfMetric {
  avgDepth: number;
  avgNodes: number;
  avgMs: number;
  positions: number;
  perPositionDepth: number[];
}

interface CardMetric {
  cardCount: number;
  totalScenarios: number;
  ratePct: number;
  breakdown: string;
}

interface RunResult {
  perf: Partial<Record<Difficulty, PerfMetric>>;
  card: Partial<Record<Difficulty, CardMetric>>;
}

function measurePerf(difficulty: Difficulty): PerfMetric {
  // bench と同様 cardState は 1 回生成して全局面で共有する。
  const cardState = createInitialCardState(PERF_DECK);
  const positions = makeBenchPositions();
  let sumDepth = 0;
  let sumNodes = 0;
  let sumMs = 0;
  const perPositionDepth: number[] = [];
  for (const pos of positions) {
    const r = findBestMoveWithStats(
      pos.state,
      pos.player,
      difficulty,
      CARD_SHOGI_VARIANT,
      { cardState },
    );
    sumDepth += r.stats.depthCompleted;
    sumNodes += r.stats.nodes;
    sumMs += r.stats.elapsedMs;
    perPositionDepth.push(r.stats.depthCompleted);
  }
  const n = positions.length;
  return {
    avgDepth: round2(sumDepth / n),
    avgNodes: Math.round(sumNodes / n),
    avgMs: Math.round(sumMs / n),
    positions: n,
    perPositionDepth,
  };
}

function measureCard(difficulty: Difficulty): CardMetric {
  const scenarios = makeScenarios();
  let cardCount = 0;
  const breakdown: string[] = [];
  for (const sc of scenarios) {
    const r = findBestMoveWithStats(
      sc.state,
      sc.player,
      difficulty,
      CARD_SHOGI_VARIANT,
      { cardState: sc.cardState },
    );
    const kind = classifyAction(r.action);
    const summary =
      kind === "none"
        ? "none"
        : kind === "move"
          ? "move"
          : kind === "draw"
            ? "draw"
            : `${kind}(${
                r.action?.kind === "playCard" ? r.action.defId : "?"
              })`;
    breakdown.push(`${sc.label}=${summary}`);
    if (kind !== "move" && kind !== "none") cardCount++;
  }
  return {
    cardCount,
    totalScenarios: scenarios.length,
    ratePct: Math.round((cardCount / scenarios.length) * 100),
    breakdown: breakdown.join(", "),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const m = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  return round2(m);
}

// ===== main =====

const runs: RunResult[] = [];
for (let i = 0; i < RUNS; i++) {
  process.stderr.write(`\n[measure] run ${i + 1}/${RUNS} ...\n`);
  const run: RunResult = { perf: {}, card: {} };
  for (const d of DIFFICULTIES) {
    const t0 = performance.now();
    run.perf[d] = measurePerf(d);
    run.card[d] = measureCard(d);
    const dt = ((performance.now() - t0) / 1000).toFixed(1);
    const p = run.perf[d]!;
    const c = run.card[d]!;
    process.stderr.write(
      `[measure]   ${d}: perf avgDepth=${p.avgDepth} avgNodes=${p.avgNodes} ` +
        `avgMs=${p.avgMs} | card rate=${c.ratePct}% (${c.cardCount}/${c.totalScenarios}) ` +
        `[${dt}s]\n`,
    );
  }
  runs.push(run);
}

// 中央値集約 (RUNS 回の avgDepth / avgNodes / avgMs / cardCount / ratePct を median)。
const perfMedian: Partial<
  Record<Difficulty, { avgDepth: number; avgNodes: number; avgMs: number; positions: number }>
> = {};
const cardMedian: Partial<
  Record<
    Difficulty,
    { cardCount: number; ratePct: number; totalScenarios: number; breakdownPerRun: string[] }
  >
> = {};

for (const d of DIFFICULTIES) {
  const perfs = runs.map((r) => r.perf[d]).filter(Boolean) as PerfMetric[];
  const cards = runs.map((r) => r.card[d]).filter(Boolean) as CardMetric[];
  if (perfs.length > 0) {
    perfMedian[d] = {
      avgDepth: median(perfs.map((p) => p.avgDepth)),
      avgNodes: median(perfs.map((p) => p.avgNodes)),
      avgMs: median(perfs.map((p) => p.avgMs)),
      positions: perfs[0].positions,
    };
  }
  if (cards.length > 0) {
    cardMedian[d] = {
      cardCount: median(cards.map((c) => c.cardCount)),
      ratePct: median(cards.map((c) => c.ratePct)),
      totalScenarios: cards[0].totalScenarios,
      breakdownPerRun: cards.map((c) => c.breakdown),
    };
  }
}

const commitSHA = execSync("git rev-parse HEAD").toString().trim();
const difficultyParams = Object.fromEntries(
  ALL_DIFFICULTIES.map((d) => [
    d,
    { maxDepth: DIFFICULTY_PARAMS[d].maxDepth, timeLimitMs: DIFFICULTY_PARAMS[d].timeLimitMs },
  ]),
);

const result = {
  schema: "issue-235-before-baseline/v1",
  description:
    "Issue #235 S0 before-baseline: canonical main (PR3-3 マージ済) の探索性能・カード使用率。" +
    "以降の全段 DoD はこの中央値を基準に判定する。",
  measuredAt: new Date().toISOString(),
  commitSHA,
  runs: RUNS,
  difficulties: DIFFICULTIES,
  aggregation: "median",
  conditions: {
    harness: "scripts/measure-baseline-235.ts (standalone tsx、vitest 非依存)",
    command: `npx tsx scripts/measure-baseline-235.ts ${RUNS}`,
    difficultyParams,
    note:
      "findBestMoveWithStats を直接呼び bench fixture を再現。depthCompleted は time-budget " +
      "探索のため計測機 CPU 性能依存 → 各段/PoC の ±10% 比較は同一機・同一条件で取得すること。",
    metrics: {
      perfBench:
        "makeBenchPositions() の 9 局面 (initial + 8 ply) を全難易度で探索し、" +
        "stats.depthCompleted / nodes / elapsedMs の局面平均。",
      cardUsage:
        "makeScenarios() の isolation 局面 7 シナリオで action 種別を集計。" +
        "cardCount = move/none 以外 (draw / playCard) の件数、ratePct = cardCount/7。",
      scope:
        "S0 before-baseline は depthCompleted / nodes / card-usage の三軸。rootMoveScore 等の " +
        "棋力スコア指標は本段では scope 外 (PoC-1 以降で必要に応じ engine 拡張)。",
    },
  },
  perfBench: perfMedian,
  cardUsage: cardMedian,
  rawRuns: runs,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(result, null, 2) + "\n");
process.stderr.write(`\n[measure] wrote ${OUT}\n`);
console.log(JSON.stringify({ perfBench: perfMedian, cardUsage: cardMedian }, null, 2));
