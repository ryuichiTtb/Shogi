// Issue #193 / PR1d-4: 人間 vs AI bench (案A=測定+ログのみ、baseline 比較は将来)。
//
// 設計 (G-4 = bench の CI 対象外分離):
// - describe.skipIf(!RUN_PERF_BENCH) で通常 test:ci では skip。計画 md L1408 の
//   SKIP_IN_CI = CI || SKIP_PERF_BENCH はローカル test:ci でも実行されてしまい
//   G-4 趣旨「通常テスト実行で bench を走らせない」に反するため、RUN_PERF_BENCH=true
//   明示時のみ実行する方式に変更 (ZZ 反映)。
// - npm run test:perf-bench:human で RUN_PERF_BENCH=true を設定して実行。
// - 案A (ギャップ2): baseline 比較 (計画 md L1430-1431) はコメントアウト維持、
//   depthCompleted / nodes / elapsedMs を測定・ログ出力のみ。将来 baseline
//   確立時に閾値比較を有効化。
//
// 計画 md docs/plans/issue-193-pr1d.md PR1d-4 詳細 / perf-bench.test.ts 整備 参照。

import { describe, test, expect } from "vitest";
import { findBestMoveWithStats } from "../engine";
import { createInitialGameState, applyMoveForSearch } from "@/lib/shogi/board";
import { createInitialCardState } from "@/lib/shogi/cards/state";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";
import { getFullLegalMoves } from "@/lib/shogi/moves";
import type { Difficulty, GameState, Player } from "@/lib/shogi/types";

const RUN_PERF_BENCH = process.env.RUN_PERF_BENCH === "true";

const BENCH_DECK = [
  { defId: "pawn_return" as const, count: 4 },
  { defId: "double_move" as const, count: 4 },
  { defId: "no_promote" as const, count: 4 },
  // Issue #196: 乱撃を bench デッキに含める。AI 評価は O(盤上駒数) + root 1 アクションのみ
  // で探索コストへの寄与は軽微 (案A=測定のみ・baseline 比較は無効)。
  { defId: "wild_strike" as const, count: 2 },
];

// bench 用局面群: 初期局面 + sente/gote 交互に数手進めた代表局面。
// 案A=測定+ログのみのため厳密 50 局面 fixture は将来 baseline 確立時に整備
// (計画 md L1400「50 局面」と差異、ZZ 反映)。
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

describe.skipIf(!RUN_PERF_BENCH)("perf-bench 人間 vs AI (案A=測定+ログのみ)", () => {
  const difficulties: Difficulty[] = [
    "beginner",
    "intermediate",
    "advanced",
    "expert",
  ];
  const positions = makeBenchPositions();
  const cardState = createInitialCardState(BENCH_DECK);

  for (const difficulty of difficulties) {
    test(`${difficulty}: depthCompleted / nodes を測定 (baseline 比較は案A でコメントアウト)`, () => {
      let sumDepth = 0;
      let sumNodes = 0;
      let sumMs = 0;
      for (const pos of positions) {
        const result = findBestMoveWithStats(
          pos.state,
          pos.player,
          difficulty,
          CARD_SHOGI_VARIANT,
          { cardState },
        );
        sumDepth += result.stats.depthCompleted;
        sumNodes += result.stats.nodes;
        sumMs += result.stats.elapsedMs;
        // 探索が機能している最小検証 (move か action のいずれか非 null)
        expect(result.move !== null || result.action !== null).toBe(true);
      }
      const n = positions.length;
      // 案A: baseline 比較 (計画 md L1430-1431) はコメントアウト維持。
      // 将来 baseline 確立時に以下を有効化:
      //   expect(sumDepth / n).toBeGreaterThanOrEqual(baseline.depthCompleted * 0.9);
      console.log(
        `[perf-bench] ${difficulty}: avgDepth=${(sumDepth / n).toFixed(2)} ` +
          `avgNodes=${(sumNodes / n).toFixed(0)} avgMs=${(sumMs / n).toFixed(0)} positions=${n}`,
      );
      expect(n).toBeGreaterThan(0);
    });
  }
});
