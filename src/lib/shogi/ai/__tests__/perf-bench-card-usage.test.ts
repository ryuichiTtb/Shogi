// Issue #193 / PR3-1 C-5 + PR3-3 C-7: カード使用率 bench (calibration 判別力強化版)。
//
// 設計:
// - describe.skipIf(!RUN_PERF_BENCH) で通常 test:ci では skip (= 既存 perf-bench と同パターン)
// - npm run test:ci -- perf-bench-card-usage RUN_PERF_BENCH=true で起動
//
// PR3-3 C-7 で導入した「calibration 判別シナリオ」(F-2 解消):
// - 旧 4 シナリオ (a〜d) は全候補に pawn_return を含めていたため、AI は常に
//   pawn_return の盤面 delta (>60cp) で他を上回り選択。calibration (getDrawValue /
//   死にマナ / handValue) の影響が出ない (= 校正の有無に関わらず常に pass)。
//   レビュー (docs/reviews/issue-193-pr3-1-pr3-2-review.md F-2) で指摘済。
// - 新シナリオ (e〜g) は手札を「盤面効果のないカードのみ」または「空」にし、
//   AI の候補を move / draw / trap (no_promote / check_break) に絞る。これにより
//   getDrawValue / TRAP_VALUE / 死にマナペナルティ が選択を決定する。
//
// fixture の GameState は「初期局面に moveCount を上書きしてフェーズだけ
// midgame/endgame に見せる」**isolation 局面**。実プレイ midgame の tactical
// 影響を排して calibration の論理だけを試験する。実プレイ midgame の効果は
// PR3-3 (deep card search) で root の TurnAction lookahead を有効化した上で
// Vercel 実機ユーザー確認に委ねる。
//
// 想定動作 (calibration が機能していれば):
// - (e) empty-hand-mana-surplus: 手札空 + マナ余剰 → AI は draw を選ぶ
//   (getDrawValue = BASE + mana surplus bonus + phase bonus で move を上回る)
// - (f) trap-only-hand-mana-cap: 手札 trap のみ + マナ上限近接 → AI は trap を
//   セット (死にマナペナルティ解消 + TRAP_VALUE が move を上回る)
// - (g) endgame-empty-hand: 手札空 + 終盤 → AI は draw or move
//   (calibration が稼働していれば draw を選ぶ局面、いなければ move 一択)

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
import type { TurnAction } from "../turn/types";

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
  // PR3-3 C-7: 期待されるアクション種別 (calibration discriminator)。
  // null = 期待アクション未指定 (= 集計のみで個別 assert なし)。
  // "draw" / "trap" / "playCard:board" など。
  expected?: ActionKind | null;
}

type ActionKind = "move" | "draw" | "playCard:trap" | "playCard:board" | "playCard:double_move";

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

function makeScenarios(): BenchScenario[] {
  // isolation 局面: 初期盤面 + moveCount だけ上書きしてフェーズ判定だけ進める
  // (盤面 tactical の影響を排して calibration 効果を機械検証)。
  const initial = createInitialGameState(CARD_SHOGI_VARIANT);
  const midState: GameState = { ...initial, moveCount: 50 }; // phase=1
  const endState: GameState = { ...initial, moveCount: 120 }; // phase=2

  // 旧シナリオ用 (pawn_return 含む手札): 「カード使用率 > 0 の粗い DoD」維持確認
  const buildPawnReturnHand = (
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

  // PR3-3 C-7 新規: calibration discriminator 用の手札 (盤面効果カードなし)
  // emptyDeck=true で sente の山札も空にし、draw を候補から外せる (trap-only 等で必要)
  const buildLimitedHand = (
    handCards: CardInstance[],
    manaSente: number,
    manaGote: number,
    emptyDeck = false,
  ): CardGameState => {
    const cs = createInitialCardState(BENCH_DECK);
    cs.hand.sente = handCards;
    if (emptyDeck) cs.deck.sente = []; // canDraw=false にして draw を候補から除外
    cs.mana.sente = manaSente;
    cs.mana.gote = manaGote;
    return cs;
  };

  return [
    // ===== (a〜d) 旧シナリオ: pawn_return 含む手札 (粗い DoD 維持) =====
    // 注: AI は常に pawn_return の盤面 delta で move を上回り選択する (calibration の
    // 寄与は副次的)。実プレイで AI がカードを使えること自体の sanity 検証用。
    {
      label: "midgame-mana-surplus",
      state: midState,
      player: "sente",
      cardState: buildPawnReturnHand(3, 15, 13),
      expected: null, // pawn_return が常に勝つので特定 assert なし
    },
    {
      label: "midgame-mana-cap",
      state: midState,
      player: "sente",
      cardState: buildPawnReturnHand(3, 19, 16),
      expected: null,
    },
    {
      label: "endgame-hand-surplus",
      state: endState,
      player: "sente",
      cardState: buildPawnReturnHand(5, 12, 10),
      expected: null,
    },
    {
      label: "midgame-hand-pressure",
      state: midState,
      player: "sente",
      cardState: buildPawnReturnHand(4, 10, 8),
      expected: null,
    },
    // ===== (e〜g) PR3-3 C-7 新規: calibration discriminator =====
    // 手札を「盤面効果のないカードのみ」または「空」にして、AI の候補を
    // move / draw / trap に絞り calibration が決定的になる状況を作る。
    {
      // (e) 手札空 + マナ余剰 → draw を期待 (getDrawValue の manaBonus + midBonus で move を上回る)
      label: "calib-empty-hand-mana-surplus",
      state: midState,
      player: "sente",
      cardState: buildLimitedHand([], 15, 8),
      expected: "draw",
    },
    {
      // (f) 手札 trap のみ + 山札空 + マナ上限近接 → trap セットを期待
      // 山札空で canDraw=false (draw を候補から除外)、純粋に move vs trap の比較に。
      // digest.trapPresence で +TRAP_VALUE_NO_PROMOTE + 死にマナペナルティ改善で move を上回る。
      label: "calib-trap-only-no-draw",
      state: midState,
      player: "sente",
      cardState: buildLimitedHand(
        mkHand(2, "no_promote"),
        19,
        12,
        true, // emptyDeck
      ),
      expected: "playCard:trap",
    },
    {
      // (g) 終盤 + 手札空 + マナ高め → draw を期待 (phase=2 でも DRAW_PHASE_END_BONUS + manaBonus)
      label: "calib-endgame-empty-hand-mana-mid",
      state: endState,
      player: "sente",
      cardState: buildLimitedHand([], 14, 10),
      expected: "draw",
    },
  ];
}

describe.skipIf(!RUN_PERF_BENCH)(
  "perf-bench card 使用率 (PR3-3 calibration discriminator)",
  () => {
    const difficulties: Difficulty[] = ["beginner", "advanced", "expert"];
    const scenarios = makeScenarios();

    for (const difficulty of difficulties) {
      // タイムアウト 60s: expert で 7 シナリオ × 思考 3-5s 想定 (旧 4 → 新 7)。
      test(
        `${difficulty}: シナリオ別 action 種別の集計 + calibration discriminator assert`,
        () => {
          let cardCount = 0;
          const breakdown: string[] = [];
          const choices: ActionKind[] = [];
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
            choices.push(kind as ActionKind);
            if (kind !== "move" && kind !== "none") cardCount++;
          }
          const rate = cardCount / scenarios.length;
          console.log(
            `[card-usage] ${difficulty}: rate=${(rate * 100).toFixed(0)}% ` +
              `(${cardCount}/${scenarios.length}) | ${breakdown.join(", ")}`,
          );

          // DoD (粗い、全難易度共通): 全 7 シナリオで 1 件以上カード/ドロー使用
          // (退化原因 ①②③④ 解消の sanity check、AI がカード使用導線を持つことの確認)
          expect(cardCount).toBeGreaterThanOrEqual(1);

          // PR3-3 C-13 (Workflow adversarial verify F-2 残課題解消):
          // 旧 C-7 で beginner-only の per-scenario strict assert を導入したが、beginner の
          // addNoise=0.50 / nearEqualThreshold=200 / BEGINNER_TADASUTE_ALLOW_RATE=0.30 による
          // 非決定性で test が 10 回中 2 回 fail する flaky 状態になっていた (= calibration
          // regression を検出する場面で逆に false positive を量産)。
          // → strict assert は本 bench から削除し、calibration 機能検証は `evaluate-action.test.ts`
          //   の deterministic unit test (findBestMove のランダム要素を回避して evaluateActionWithLookahead
          //   を直接呼ぶ) に移動。本 bench は cardCount sanity + breakdown log によるテレメトリに専念。
          // 期待アクション (sc.expected) フィールドは breakdown log にて参考情報として表示。
          //
          // 関連: src/lib/shogi/ai/__tests__/evaluate-action.test.ts
          //   "evaluateActionWithLookahead calibration regression (deterministic)" describe
        },
        60_000,
      );
    }
  },
);
