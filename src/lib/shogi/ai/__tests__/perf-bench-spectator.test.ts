// Issue #193 / PR1d-4: 観戦モード bench (デバッグ目的、両者対称性確認、案A)。
//
// W-4 反映の 2 層検証のうち deterministic 層 (advanced/expert、addNoise=0):
// 初期局面 (左右対称) で sente/gote 両視点の探索が対称的に機能していることを
// data integrity として確認 (案A=測定+ログ主体、厳密一致は局面対称性依存の
// ため depthCompleted 差分上限で許容)。beginner/intermediate (addNoise>0) の
// 観戦 50 局統計検証 (計画 md L1507) は将来 baseline 確立時に整備 (ZZ 反映)。
//
// G-4: describe.skipIf(!RUN_PERF_BENCH) で通常 test:ci では skip。
// npm run test:perf-bench:spectator で RUN_PERF_BENCH=true を設定して実行。

import { describe, test, expect } from "vitest";
import { findBestMoveWithStats } from "../engine";
import { createInitialGameState } from "@/lib/shogi/board";
import { createInitialCardState } from "@/lib/shogi/cards/state";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";
import type { Difficulty } from "@/lib/shogi/types";

const RUN_PERF_BENCH = process.env.RUN_PERF_BENCH === "true";

const BENCH_DECK = [
  { defId: "pawn_return" as const, count: 4 },
  { defId: "double_move" as const, count: 4 },
];

describe.skipIf(!RUN_PERF_BENCH)(
  "perf-bench-spectator 観戦モード両者対称性 (案A)",
  () => {
    // deterministic 難易度 (addNoise=0) で両者対称性を確認
    const deterministicDifficulties: Difficulty[] = ["advanced", "expert"];

    for (const difficulty of deterministicDifficulties) {
      test(`${difficulty}: 観戦モードで sente/gote 両視点の探索が対称的に機能`, () => {
        const state = createInitialGameState(CARD_SHOGI_VARIANT);
        const cardState = createInitialCardState(BENCH_DECK);
        const senteResult = findBestMoveWithStats(
          state,
          "sente",
          difficulty,
          CARD_SHOGI_VARIANT,
          { cardState, spectator: true },
        );
        const goteResult = findBestMoveWithStats(
          state,
          "gote",
          difficulty,
          CARD_SHOGI_VARIANT,
          { cardState, spectator: true },
        );
        expect(
          senteResult.move !== null || senteResult.action !== null,
        ).toBe(true);
        expect(goteResult.move !== null || goteResult.action !== null).toBe(
          true,
        );
        console.log(
          `[perf-bench-spectator] ${difficulty}: ` +
            `sente depth=${senteResult.stats.depthCompleted} ` +
            `gote depth=${goteResult.stats.depthCompleted}`,
        );
        // 両者対称性: 初期局面は左右対称 + deterministic なので depthCompleted
        // の差は小さい (data integrity、厳密一致は局面対称性に依存するため
        // 差分上限 2 で許容)。
        expect(
          Math.abs(
            senteResult.stats.depthCompleted -
              goteResult.stats.depthCompleted,
          ),
        ).toBeLessThanOrEqual(2);
      });
    }
  },
);
