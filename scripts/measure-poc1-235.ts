#!/usr/bin/env node
// Issue #235 S4b-2b: PoC-1 再検証ハーネス (same-engine control 比)。
//
// 目的 (計画 doc issue-235-s4-search-engine.md §11 / epic §8.4.5):
//   WorldState (TurnAction) 探索に selector を載せ、「カードを木に入れる枝刈り余地が
//   実エンジン (LMR/null-move/futility/quiescence 込み) へ転移するか」を再検証する。
//   合否 = **same-engine control 比**: 同一 move 上限 M のもとで
//     control = K=0 (move-only WorldState、カード非展開)
//     test    = K (card 上位 K + draw を展開)
//   の depthCompleted を比較し、test/control >= 1 - BAND (既定 0.10) なら「カード追加の
//   純コスト < BAND」= PASS (epic §8.4.5 が明文訂正した PoC-1 基準の実エンジン版)。
//
//   ※ flag OFF 直接比較 (production move-only deep vs WorldState) は探索構造もコストも
//      非対称ゆえ一次ゲートにしない (計画 §11 [BLOCKER] 反映)。production 絶対比は S4e 棋力ゲート。
//   ※ S4b-2a の WorldState 探索は TT 無し (S4c) ゆえ絶対深さは低めだが、control/test 双方が
//      同条件のため ratio は交絡相殺される (TT 無しは保守的 = PASS すれば TT 込みでも通る)。
//
// 使い方 (s4 worktree の repo ルートで):
//   npx tsx scripts/measure-poc1-235.ts [runs]
//   POC_M=10 POC_K=2 POC_TIME=2000 POC_BAND=0.10 POC_OUT=/tmp/poc1.json npx tsx scripts/measure-poc1-235.ts 3

import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { findBestMove } from "@/lib/shogi/ai/search";
import { createSearchContext } from "@/lib/shogi/ai/search-context";
import { computeCardDigest } from "@/lib/shogi/ai/cards/digest";
import {
  createInitialGameState,
  applyMoveForSearch,
} from "@/lib/shogi/board";
import { createInitialCardState } from "@/lib/shogi/cards/state";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";
import { getFullLegalMoves } from "@/lib/shogi/moves";
import type { GameState, Player } from "@/lib/shogi/types";
import type { CardGameState } from "@/lib/shogi/cards/types";

const RUNS = Math.max(1, Number(process.argv[2] ?? "3") || 3);
const M = Number(process.env.POC_M ?? "10");
const K = Number(process.env.POC_K ?? "2");
const TIME_MS = Number(process.env.POC_TIME ?? "2000");
const BAND = Number(process.env.POC_BAND ?? "0.10");
const OUT = process.env.POC_OUT ?? "/tmp/poc1-235.json";

const POC_DECK = [
  { defId: "pawn_return" as const, count: 4 },
  { defId: "mana_up" as const, count: 4 },
  { defId: "no_promote" as const, count: 4 },
];

// realistic な perf 局面 (perf-bench makeBenchPositions と同じ生成: initial + 8 ply)。
function makeBenchPositions(): { label: string; state: GameState; player: Player }[] {
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

// 両側の手札にカードを付与 (pawn_return/mana_up/no_promote 各1) + マナ充足。
// 注: 手番側のみに付与すると cardDigest が非対称になり eval が偏り depth が異常膨張するため、
// 両側対称に付与して realistic な balanced 局面にする (PoC ratio の交絡回避)。
function attachCards(): CardGameState {
  const cs = createInitialCardState(POC_DECK);
  const hand = (suffix: string) => [
    { instanceId: `poc-pr-${suffix}`, defId: "pawn_return" as const },
    { instanceId: `poc-mu-${suffix}`, defId: "mana_up" as const },
    { instanceId: `poc-np-${suffix}`, defId: "no_promote" as const },
  ];
  cs.hand.sente = hand("s");
  cs.hand.gote = hand("g");
  cs.mana.sente = 15;
  cs.mana.gote = 15;
  return cs;
}

// WorldState 探索を 1 回走らせ depthCompleted / nodes を返す。
function searchWorld(
  state: GameState,
  cardState: CardGameState,
  player: Player,
  selectorK: number,
): { depth: number; nodes: number } {
  const ctx = createSearchContext({
    timeLimitMs: TIME_MS,
    useTurnActionSearch: true,
    spectatorMode: true,
    selectorM: M,
    selectorK,
    cardDigest: computeCardDigest(cardState),
  });
  findBestMove(
    state,
    player,
    { maxDepth: 64, timeLimitMs: TIME_MS, addNoise: 0, nearEqualThreshold: 0 },
    CARD_SHOGI_VARIANT,
    ctx,
    cardState,
  );
  return { depth: ctx.depthCompleted, nodes: ctx.nodes };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function commitSha(): string {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "unknown";
  }
}

const positions = makeBenchPositions();

interface PosResult {
  label: string;
  ctrlDepth: number[];
  testDepth: number[];
  ratio: number; // median(test)/median(ctrl)
}

const results: PosResult[] = [];

console.log(
  `[poc1] M=${M} K=${K} time=${TIME_MS}ms band=${BAND} runs=${RUNS} commit=${commitSha()}`,
);

for (const pos of positions) {
  const cardState = attachCards();
  const ctrlDepth: number[] = [];
  const testDepth: number[] = [];
  for (let r = 0; r < RUNS; r++) {
    const ctrl = searchWorld(pos.state, cardState, pos.player, 0); // move-only control
    const test = searchWorld(pos.state, cardState, pos.player, K); // +card
    ctrlDepth.push(ctrl.depth);
    testDepth.push(test.depth);
  }
  const mCtrl = median(ctrlDepth);
  const mTest = median(testDepth);
  const ratio = mCtrl > 0 ? mTest / mCtrl : 1;
  results.push({ label: pos.label, ctrlDepth, testDepth, ratio });
  console.log(
    `[poc1]   ${pos.label.padEnd(8)}: ctrl(K=0) depth med=${mCtrl} ${JSON.stringify(ctrlDepth)} | ` +
      `test(K=${K}) depth med=${mTest} ${JSON.stringify(testDepth)} | ratio=${(ratio * 100).toFixed(0)}%`,
  );
}

const ratios = results.map((r) => r.ratio);
const medianRatio = median(ratios);
const minRatio = Math.min(...ratios);
const pass = medianRatio >= 1 - BAND;

console.log(
  `[poc1] === median ratio=${(medianRatio * 100).toFixed(1)}% / min=${(minRatio * 100).toFixed(1)}% / ` +
    `合否 (median >= ${((1 - BAND) * 100).toFixed(0)}%) = ${pass ? "PASS" : "FAIL"} ===`,
);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify(
    { params: { M, K, TIME_MS, BAND, RUNS, commit: commitSha() }, results, medianRatio, minRatio, pass },
    null,
    2,
  ),
);
console.log(`[poc1] wrote ${OUT}`);
