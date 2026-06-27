// 学習評価の速度ベンチ (Issue #245 フェーズ1 P1-3/P1-4 速度検証)。
//
// World 探索 (useTurnActionSearch ON) のリーフ評価を「人手 evaluate (useLearnedEval OFF)」と
// 「学習 NN (useLearnedEval ON)」で切替え、同一局面・同一時間予算で depthCompleted / nodes /
// nodes/sec を比較する。★最大リスク=推論速度の定量化: NN 評価で先読みがどれだけ浅くなるか。
//
// 使い方 (リポジトリルートで):
//   BENCH_MODEL=local-data/training/model-245.json BENCH_MS=2000 npx tsx scripts/bench-learned-245.ts
//
// env: BENCH_MODEL(model JSON) / BENCH_MS(1手の時間予算 ms, 既定2000) / BENCH_RUNS(各条件の試行, 既定3)

import { readFileSync } from "node:fs";

import { createInitialGameState } from "@/lib/shogi/board";
import { createInitialCardState } from "@/lib/shogi/cards/state";
import type { CardGameState } from "@/lib/shogi/cards/types";
import { loadLearnedModel } from "@/lib/shogi/ai/learned/infer";
import { findBestMove } from "@/lib/shogi/ai/search";
import { createSearchContext } from "@/lib/shogi/ai/search-context";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";

const MODEL = process.env.BENCH_MODEL ?? "local-data/training/model-245.json";
const MS = Math.max(200, Number(process.env.BENCH_MS ?? "2000") || 2000);
const RUNS = Math.max(1, Number(process.env.BENCH_RUNS ?? "3") || 3);

// 序盤局面 + マナ 12 (カードを探索木に乗せるため)。決定論 (addNoise=0)。
function fixture(): { state: ReturnType<typeof createInitialGameState>; cardState: CardGameState } {
  const state = createInitialGameState(CARD_SHOGI_VARIANT);
  const base = createInitialCardState([
    { defId: "pawn_return", count: 4 },
    { defId: "no_promote", count: 4 },
    { defId: "double_pawn", count: 4 },
  ]);
  const cardState: CardGameState = { ...base, mana: { sente: 12, gote: 12 } };
  return { state, cardState };
}

const OPTIONS = { maxDepth: 30, timeLimitMs: MS, addNoise: 0, nearEqualThreshold: 0 };

function runOnce(useLearnedEval: boolean) {
  const { state, cardState } = fixture();
  const ctx = createSearchContext({
    timeLimitMs: MS,
    useTurnActionSearch: true, // World 経路
    spectatorMode: true,
    selectorK: 1, // production 想定の selector (M=∞/K=1)
    useLearnedEval,
  });
  const t0 = performance.now();
  findBestMove(state, "sente", OPTIONS, CARD_SHOGI_VARIANT, ctx, cardState);
  const elapsed = performance.now() - t0;
  return { depth: ctx.depthCompleted, nodes: ctx.nodes, elapsed };
}

function summarize(label: string, useLearnedEval: boolean) {
  let depth = 0;
  let nodes = 0;
  let elapsed = 0;
  for (let i = 0; i < RUNS; i++) {
    const r = runOnce(useLearnedEval);
    depth += r.depth;
    nodes += r.nodes;
    elapsed += r.elapsed;
  }
  const avgDepth = depth / RUNS;
  const avgNodes = nodes / RUNS;
  const avgElapsed = elapsed / RUNS;
  const nps = avgNodes / (avgElapsed / 1000);
  console.log(
    `  ${label.padEnd(22)} depthCompleted ${avgDepth.toFixed(2)} | nodes ${Math.round(avgNodes)} | ${avgElapsed.toFixed(0)}ms | ${Math.round(nps).toLocaleString()} nodes/s`,
  );
  return { avgDepth, avgNodes, nps };
}

function main() {
  const payload = JSON.parse(readFileSync(MODEL, "utf8"));
  loadLearnedModel(payload.model);
  console.log(`=== 学習評価 速度ベンチ (World 経路, ${MS}ms × ${RUNS}run, 序盤+マナ12) ===`);
  console.log(`model: ${MODEL} (hidden=${payload.model.hidden}, featureDim=${payload.model.featureDim})`);

  const hand = summarize("人手 evaluate (OFF)", false);
  const nn = summarize("学習 NN (ON)", true);

  const depthDrop = ((nn.avgDepth - hand.avgDepth) / hand.avgDepth) * 100;
  const npsRatio = (nn.nps / hand.nps) * 100;
  console.log(`\n比較: NN は人手比で depthCompleted ${depthDrop.toFixed(1)}% / nodes/s ${npsRatio.toFixed(1)}%`);
  console.log(`(depth が大きく落ちる/nps が大きく下がるほど NN 評価が探索のボトルネック)`);
}

main();
