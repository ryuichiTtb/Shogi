#!/usr/bin/env node
// 対戦勝率ハーネス CLI (Issue #245 Stage 2 P2-2a)。
//
// 学習評価 AI (World 探索 + useLearnedEval ON) を対戦相手と N ペア対戦させ、勝率を集計する。
// cutover ゲート (P2-3) の単一情報源。純粋ロジックは src/lib/shogi/training/winrate.ts。
// 設計正本: docs/plans/issue-245-p2-2a-winrate-harness.md。
//
// 使い方 (リポジトリルートで):
//   WINRATE_MODEL=local-data/training/model-bootstrap-small.json WINRATE_PAIRS=10 \
//   WINRATE_OPPONENT=control WINRATE_MODE=depth WINRATE_MAXDEPTH=4 \
//   npx tsx scripts/winrate-245.ts
//
// env:
//   WINRATE_MODEL      学習モデル JSON (必須。{ model: SerializedMlp } 形式)
//   WINRATE_PAIRS      ペア数 N (既定 10 = 20 局)
//   WINRATE_DIFFICULTY 難易度 (既定 advanced。addNoise≈0 の advanced/expert 推奨、§3.6)
//   WINRATE_OPPONENT   control (same-engine=評価だけ人手, 主指標) | bolt-on (現行 production 経路, 副)
//   WINRATE_MODE       depth (同 maxDepth=評価純粋比較, 既定) | time (同時間予算=実運用)
//   WINRATE_MAXDEPTH   depth モードの読み深さ (既定 4)
//   WINRATE_MS         time モードの 1 手予算 ms (既定 2000)

import { readFileSync } from "node:fs";

import { findBestMoveWithStats } from "@/lib/shogi/ai/engine";
import {
  getInferenceCount,
  hasLearnedModel,
  loadLearnedModel,
  resetInferenceCount,
} from "@/lib/shogi/ai/learned/infer";
import type { WorldState } from "@/lib/shogi/kernel/world-kernel";
import { type ChooseAction } from "@/lib/shogi/training/selfplay";
import { runMatch, tally, type SideTally } from "@/lib/shogi/training/winrate";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";
import type { Difficulty, Player } from "@/lib/shogi/types";

const MODEL = process.env.WINRATE_MODEL;
const PAIRS = Math.max(1, Number(process.env.WINRATE_PAIRS ?? "10") || 10);
const DIFFICULTY = (process.env.WINRATE_DIFFICULTY ?? "advanced") as Difficulty;
const OPPONENT = (process.env.WINRATE_OPPONENT ?? "control") as "control" | "bolt-on";
const MODE = (process.env.WINRATE_MODE ?? "depth") as "depth" | "time";
const MAXDEPTH = Math.max(1, Number(process.env.WINRATE_MAXDEPTH ?? "4") || 4);
const MS = Math.max(200, Number(process.env.WINRATE_MS ?? "2000") || 2000);

// production 同等のデッキ構成 (perf-bench / selfplay と整合)。
const DECK = [
  { defId: "pawn_return" as const, count: 4 },
  { defId: "no_promote" as const, count: 4 },
  { defId: "double_pawn" as const, count: 4 },
];

// mode 依存の探索条件: depth = maxDepth 固定 (CPU 速度非依存の同深さ比較、engine が timeLimit を
// 無効化)、time = 時間予算 (実運用条件)。両 chooser に同一適用して公平性を保つ (§5)。
function searchOptions() {
  return MODE === "depth"
    ? { maxDepth: MAXDEPTH }
    : { timeLimitMs: MS, spectator: true as const };
}

// 学習 eval AI chooser: World 経路 (useTurnActionSearch) + 学習 NN (useLearnedEval)。
const learnedChooser: ChooseAction = (world: WorldState, player: Player) => {
  const r = findBestMoveWithStats(world.gameState, player, DIFFICULTY, CARD_SHOGI_VARIANT, {
    cardState: world.cardState,
    useKernelSearch: true,
    useTurnActionSearch: true,
    useLearnedEval: true,
    ...searchOptions(),
  });
  return r.action ?? (r.move ? { kind: "move", move: r.move } : null);
};

// 対戦相手 chooser。
// control (主): 同 World 経路で評価だけ人手 (useLearnedEval OFF) = 「評価関数の差」を分離 (§3.3)。
// bolt-on (副): 現行 production 経路 (useTurnActionSearch OFF = move-only deep + bolt-on) = 実運用差分。
const opponentChooser: ChooseAction = (world: WorldState, player: Player) => {
  const r = findBestMoveWithStats(world.gameState, player, DIFFICULTY, CARD_SHOGI_VARIANT, {
    cardState: world.cardState,
    useKernelSearch: true,
    useTurnActionSearch: OPPONENT === "control", // control のみ world 経路。useLearnedEval は付けない。
    ...searchOptions(),
  });
  return r.action ?? (r.move ? { kind: "move", move: r.move } : null);
};

function pct(x: number | null): string {
  return x === null ? "N/A" : `${(x * 100).toFixed(1)}%`;
}
function fmtSide(s: SideTally): string {
  return `${s.wins}勝 ${s.losses}敗 ${s.draws}分`;
}

function main() {
  if (!MODEL) {
    console.error("FAIL: WINRATE_MODEL (学習モデル JSON) が必須です。");
    process.exit(1);
  }
  const payload = JSON.parse(readFileSync(MODEL, "utf8"));
  loadLearnedModel(payload.model);
  // silent fallback 誤 PASS 対策 (§3.4): ロード成功を assert。
  if (!hasLearnedModel()) {
    console.error(`FAIL: モデルのロードに失敗しました (${MODEL} の { model } を確認)。`);
    process.exit(1);
  }
  resetInferenceCount();

  console.log(
    `=== 勝率ハーネス (学習 vs ${OPPONENT}, ${PAIRS}ペア=${PAIRS * 2}局, ${DIFFICULTY}, mode=${MODE}${
      MODE === "depth" ? ` D=${MAXDEPTH}` : ` ${MS}ms`
    }) ===`,
  );
  console.log(
    `model: ${MODEL} (hidden=${payload.model.hidden}, featureDim=${payload.model.featureDim})`,
  );

  const results = runMatch(PAIRS, {
    learned: learnedChooser,
    opponent: opponentChooser,
    deckSpec: DECK,
    difficulty: DIFFICULTY,
  });

  // silent fallback 誤 PASS 対策 (§3.4): 学習経路が実際に NN を呼んだことを assert。
  const nnCalls = getInferenceCount();
  if (nnCalls === 0) {
    console.error(
      "FAIL: NN 推論が 1 度も呼ばれていません (人手 eval へ silent fallback したまま)。モデル/flag を確認してください。",
    );
    process.exit(1);
  }

  const t = tally(results);
  console.log("\n結果 (学習 AI 視点):");
  console.log(`  総合: ${fmtSide(t.overall)} / ${t.games}局`);
  console.log(
    `  勝率[draw除外]: ${pct(t.winRateExclDraws)}  スコア率[draw0.5]: ${pct(t.scoreRate)}  draw率: ${pct(t.drawRate)}`,
  );
  console.log(`  先手時: ${fmtSide(t.asSente)}   後手時: ${fmtSide(t.asGote)}`);
  console.log(`  平均手数: ${t.avgMoveCount.toFixed(1)}   NN推論総数: ${nnCalls.toLocaleString()}`);
  console.log(
    "\n注: 主指標 = same-engine control (評価だけの差)。val MSE でなく本勝率 + カード行動 (P2-2b) で cutover を判定する。",
  );
}

main();
