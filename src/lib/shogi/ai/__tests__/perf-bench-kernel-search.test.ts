// Issue #235 S1b: useKernelSearch OFF vs ON の bench 比較 (計画 §5 S1b-5)。
//
// 目的: AI root カード/ドロー評価を kernel applyTurnAction 経由 (ON) に切替えたときの
//   ① root カード評価フェーズの overhead (= 全体 elapsedMs の OFF/ON 差。findBestMove は
//      move-only で本変更の影響を受けないため、差分が概ね root カード評価フェーズの増分)、
//   ② カード使用率 (usedCardAction) の変化 (DP-1 lazy drawProgress / manaCharge / cost 正確消費
//      / 終局 mate score の是正がアクション選択に与える影響)
//   を測定・記録する。ユーザー確認済 (2026-06-07): 逸脱は記録に留め、係数再校正は S3。
//
// 実行: npm run test:ci -- perf-bench-kernel-search でも skip。RUN_PERF_BENCH=true で起動:
//   RUN_PERF_BENCH=true npx vitest run src/lib/shogi/ai/__tests__/perf-bench-kernel-search.test.ts
//
// 公平性 (計画 F-6):
//   - maxDepth 固定 → depthCompleted は CPU 非依存で OFF/ON 同値 (findBestMove 非改変の sanity)。
//   - spectator=true → ON の makeMoveWithEffects manaCharge を早指し非依存 (決定的) + beginner の
//     Math.random ノイズを避けるため難易度は advanced/expert のみ。

import { describe, test, expect } from "vitest";
import { findBestMoveWithStats } from "../engine";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";
import { createInitialGameState, applyMove } from "@/lib/shogi/board";
import { MANA_CAP } from "@/lib/shogi/cards/definitions";
import type { Difficulty, GameState, Move, Player } from "@/lib/shogi/types";
import type { CardGameState, CardId, CardInstance } from "@/lib/shogi/cards/types";

const RUN_PERF_BENCH = process.env.RUN_PERF_BENCH === "true";

function instances(defIds: CardId[], prefix: string): CardInstance[] {
  return defIds.map((defId, i) => ({ instanceId: `${prefix}-${defId}-${i}`, defId }));
}

function cardState(over: Partial<CardGameState> = {}): CardGameState {
  return {
    mana: { sente: 14, gote: 14 },
    manaCap: MANA_CAP,
    hand: { sente: [], gote: [] },
    deck: { sente: [], gote: [] },
    graveyard: { sente: [], gote: [] },
    trap: { sente: null, gote: null },
    pendingCard: null,
    lastTurnStartedAt: { sente: null, gote: null },
    noPromoteMarks: { sente: [], gote: [] },
    drawProgress: { sente: 0, gote: 0 },
    ...over,
  };
}

// 初手をいくつか進めた midgame 風局面を作る (決定的な手列)。
function playMoves(state: GameState, moves: Move[]): GameState {
  let s = state;
  for (const m of moves) s = applyMove(s, m);
  return s;
}

interface Scenario {
  label: string;
  state: GameState;
  player: Player;
  cardState: CardGameState;
}

function makeScenarios(): Scenario[] {
  const init = createInitialGameState(CARD_SHOGI_VARIANT);
  // 数手進めた局面 (先手番) を 1 つ用意。
  const midMoves: Move[] = [
    { type: "move", from: { row: 6, col: 6 }, to: { row: 5, col: 6 }, piece: "pawn", player: "sente" },
    { type: "move", from: { row: 2, col: 2 }, to: { row: 3, col: 2 }, piece: "pawn", player: "gote" },
  ];
  const mid = playMoves(init, midMoves); // currentPlayer = sente

  const fullHand: CardId[] = ["pawn_return", "piece_return", "double_pawn", "no_promote", "check_break", "double_move"];

  return [
    {
      label: "init_fullhand",
      state: init,
      player: "sente",
      cardState: cardState({ hand: { sente: instances(fullHand, "s"), gote: instances(fullHand, "g") } }),
    },
    {
      label: "mid_fullhand",
      state: mid,
      player: "sente",
      cardState: cardState({ hand: { sente: instances(fullHand, "s"), gote: instances(fullHand, "g") } }),
    },
    {
      label: "mid_traps",
      state: mid,
      player: "sente",
      cardState: cardState({ hand: { sente: instances(["check_break", "no_promote", "pawn_return"], "s"), gote: [] } }),
    },
    {
      label: "mid_drawboundary",
      state: mid,
      player: "sente",
      cardState: cardState({
        hand: { sente: instances(["pawn_return", "double_move"], "s"), gote: [] },
        deck: { sente: instances(["pawn_return", "double_pawn", "piece_return"], "sd"), gote: [] },
        drawProgress: { sente: 4, gote: 0 }, // auto-draw 境界
      }),
    },
  ];
}

describe.skipIf(!RUN_PERF_BENCH)("perf-bench: useKernelSearch OFF vs ON", () => {
  const difficulties: Difficulty[] = ["advanced", "expert"];
  const scenarios = makeScenarios();
  const MAX_DEPTH = 4; // 決定的 depth (CPU 非依存)。

  for (const difficulty of difficulties) {
    test(
      `${difficulty}: OFF/ON の elapsedMs・depthCompleted・カード使用率を測定`,
      () => {
        let offCardCount = 0;
        let onCardCount = 0;
        const rows: string[] = [];
        for (const sc of scenarios) {
          const optsBase = {
            cardState: sc.cardState,
            spectator: true,
            maxDepth: MAX_DEPTH,
          } as const;

          const t0 = performance.now();
          const off = findBestMoveWithStats(sc.state, sc.player, difficulty, CARD_SHOGI_VARIANT, {
            ...optsBase,
            useKernelSearch: false,
          });
          const tOff = performance.now() - t0;

          const t1 = performance.now();
          const on = findBestMoveWithStats(sc.state, sc.player, difficulty, CARD_SHOGI_VARIANT, {
            ...optsBase,
            useKernelSearch: true,
          });
          const tOn = performance.now() - t1;

          const offKind = off.action?.kind === "playCard" ? `card(${off.action.defId})` : off.action?.kind ?? "none";
          const onKind = on.action?.kind === "playCard" ? `card(${on.action.defId})` : on.action?.kind ?? "none";
          if (off.stats.usedCardAction) offCardCount++;
          if (on.stats.usedCardAction) onCardCount++;

          rows.push(
            `${sc.label}: OFF=${offKind}/d${off.stats.depthCompleted}/${tOff.toFixed(0)}ms ` +
              `ON=${onKind}/d${on.stats.depthCompleted}/${tOn.toFixed(0)}ms`,
          );

          // sanity: 両者とも合法アクションを返す。
          expect(off.action).not.toBeNull();
          expect(on.action).not.toBeNull();
          // F-4: depthCompleted は findBestMove (move-only、本変更非影響) が決めるため OFF/ON 同値
          // (maxDepth 固定で CPU 非依存)。kernel 切替が深い探索に影響しないことの sanity。
          expect(on.stats.depthCompleted).toBe(off.stats.depthCompleted);
        }
        console.log(
          `[kernel-search] ${difficulty}: cardRate OFF=${offCardCount}/${scenarios.length} ` +
            `ON=${onCardCount}/${scenarios.length}\n  ` +
            rows.join("\n  "),
        );
      },
      60_000,
    );
  }
});
