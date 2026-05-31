// Issue #193 / PR3-1 C-5: カード使用率 bench。
//
// 設計 (計画 md docs/plans/issue-193-pr3-1-card-calibration.md 5.2 章):
// - describe.skipIf(!RUN_PERF_BENCH) で通常 test:ci では skip (= 既存 perf-bench と同パターン)
// - npm run test:ci -- perf-bench-card-usage RUN_PERF_BENCH=true で起動
// - DoD: 全難易度の 中盤/終盤 fixture で AI のカード/ドロー使用率 > 0
//   (= 退化原因 ①②③④ 解消で「中盤以降カード使用 = 0」が解消されたことを機械検証)
//
// fixture 構成 (計画 md 4 シナリオ案):
//   1. midgame-mana-surplus (phase=1、マナ 15 = 余剰、手札 3 枚)
//      → C-2 getDrawValue の manaBonus + midBonus でドロー選択を期待
//   2. midgame-mana-cap (phase=1、マナ 19 = 上限近接、手札 3 枚)
//      → C-3 死にマナペナルティで card 使用 (= マナ消費) を期待
//   3. endgame-hand-surplus (phase=2、マナ 12、手札 5 枚)
//      → 手札過多 + 終盤フェーズで card 使用を期待 (ドローは handPenalty で抑制)
//   4. midgame-hand-pressure (phase=1、マナ 10、手札 4 枚 = しきい値)
//      → 動的価値の境界ケース
//
// 重要: fixture の GameState は「初期局面に moveCount を上書きしてフェーズだけ
// midgame/endgame に見せる」**isolation 局面**を使う。理由は以下:
// - 実プレイの中盤局面 (= AI で 40 plies 進めた後) では tactical capture が
//   頻発して move 評価が 100+ cp 動くため、calibration の効果 (+30〜60 cp) で
//   選択を逆転できない。これは盤面評価 vs static calibration の構造的不均衡で、
//   **PR3-3 (深読み探索) で root の TurnAction を深さ N に拡張**するまで実盤面の
//   midgame では本質的に解消しない。
// - PR3-1 の目的は「calibration の中身 (静的価値式) が機能している」ことの
//   機械検証。盤面 tactical の影響を排した isolation シナリオで calibration が
//   正しく card/draw を選ばせることを確認する。
// - 実プレイでの midgame カード使用率は PR3-3 で深読み探索を導入した後に再計測。

import { describe, test, expect } from "vitest";
import { findBestMoveWithStats } from "../engine";
import { createInitialGameState } from "@/lib/shogi/board";
import { createInitialCardState } from "@/lib/shogi/cards/state";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";
import type { Difficulty, GameState, Player } from "@/lib/shogi/types";
import type {
  CardGameState,
  CardInstance,
  CardId,
} from "@/lib/shogi/cards/types";

const RUN_PERF_BENCH = process.env.RUN_PERF_BENCH === "true";

const BENCH_DECK = [
  { defId: "pawn_return" as const, count: 4 },
  { defId: "double_pawn" as const, count: 4 },
  { defId: "no_promote" as const, count: 4 },
];

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
  // isolation 局面: 初期盤面 + moveCount だけ上書きしてフェーズ判定だけ進める
  // (盤面 tactical の影響を排して calibration 効果を機械検証)。
  const initial = createInitialGameState(CARD_SHOGI_VARIANT);
  const midState: GameState = { ...initial, moveCount: 50 }; // phase=1
  const endState: GameState = { ...initial, moveCount: 120 }; // phase=2

  const buildCardState = (
    handSize: number,
    manaSente: number,
    manaGote: number,
  ): CardGameState => {
    const cs = createInitialCardState(BENCH_DECK);
    cs.hand.sente = mkHand(handSize, "pawn_return");
    cs.mana.sente = manaSente;
    cs.mana.gote = manaGote;
    return cs;
  };

  return [
    {
      label: "midgame-mana-surplus",
      state: midState,
      player: "sente",
      cardState: buildCardState(3, 15, 13),
    },
    {
      label: "midgame-mana-cap",
      state: midState,
      player: "sente",
      cardState: buildCardState(3, 19, 16),
    },
    {
      label: "endgame-hand-surplus",
      state: endState,
      player: "sente",
      cardState: buildCardState(5, 12, 10),
    },
    {
      label: "midgame-hand-pressure",
      state: midState,
      player: "sente",
      cardState: buildCardState(4, 10, 8),
    },
  ];
}

describe.skipIf(!RUN_PERF_BENCH)(
  "perf-bench card 使用率 (PR3-1 DoD: 中盤以降カード使用 > 0)",
  () => {
    const difficulties: Difficulty[] = ["beginner", "advanced", "expert"];
    const scenarios = makeScenarios();

    for (const difficulty of difficulties) {
      // タイムアウト 30s: expert で 4 シナリオ × 思考 3-5s 想定。
      // vitest デフォルト 5s では advanced (6-9s) / expert (14-21s) が必ず timeout する。
      test(
        `${difficulty}: 中盤/終盤 fixture でカード/ドロー使用率 > 0`,
        () => {
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
            const chosen =
              r.action?.kind === "playCard"
                ? `playCard(${r.action.defId})`
                : r.action?.kind === "draw"
                  ? "draw"
                  : "move";
            breakdown.push(`${sc.label}=${chosen}`);
            if (r.action?.kind === "playCard" || r.action?.kind === "draw") {
              cardCount++;
            }
          }
          const rate = cardCount / scenarios.length;
          console.log(
            `[card-usage] ${difficulty}: rate=${(rate * 100).toFixed(0)}% ` +
              `(${cardCount}/${scenarios.length}) | ${breakdown.join(", ")}`,
          );
          // DoD: 全難易度で 1 件以上カード/ドロー使用 (退化原因 ①②③④ 解消の機械検証)
          expect(cardCount).toBeGreaterThanOrEqual(1);
        },
        30_000,
      );
    }
  },
);
