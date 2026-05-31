// Issue #193 / PR3-1 C-1: heuristics.ts 新規 phase 判定ヘルパの境界テスト。
//
// 計画 md docs/plans/issue-193-pr3-1-card-calibration.md 5.1 / 4.1.3 章。
// 新規定数の数値妥当性は bench で検証するため、本ファイルでは挙動 (境界条件) のみ確認。

import { describe, it, expect } from "vitest";
import {
  computePhaseStage,
  ENDGAME_THRESHOLD,
  EARLY_GAME_THRESHOLD,
  getDrawValue,
  DRAW_VALUE_BASE,
  DRAW_HAND_THRESHOLD,
  DRAW_HAND_PENALTY_PER_CARD,
  DRAW_MANA_SURPLUS_THRESHOLD,
  DRAW_MANA_SURPLUS_COEF,
  DRAW_PHASE_MID_BONUS,
  DRAW_PHASE_END_BONUS,
} from "../heuristics";
import { createInitialGameState } from "../../../board";
import { CARD_SHOGI_VARIANT } from "../../../variants/card-shogi";
import { createInitialCardState } from "../../../cards/state";
import type { GameState, Player } from "../../../types";
import type { CardGameState, CardInstance } from "../../../cards/types";

describe("computePhaseStage (PR3-1)", () => {
  function makeState(moveCount: number): GameState {
    return { ...createInitialGameState(CARD_SHOGI_VARIANT), moveCount };
  }

  it("ply=0 (初期局面) は 0=序盤", () => {
    expect(computePhaseStage(makeState(0))).toBe(0);
  });

  it("EARLY_GAME_THRESHOLD-1 はまだ 0=序盤 (境界手前)", () => {
    expect(computePhaseStage(makeState(EARLY_GAME_THRESHOLD - 1))).toBe(0);
  });

  it("EARLY_GAME_THRESHOLD で 1=中盤に切り替わる (境界)", () => {
    expect(computePhaseStage(makeState(EARLY_GAME_THRESHOLD))).toBe(1);
  });

  it("ENDGAME_THRESHOLD-1 はまだ 1=中盤 (境界手前)", () => {
    expect(computePhaseStage(makeState(ENDGAME_THRESHOLD - 1))).toBe(1);
  });

  it("ENDGAME_THRESHOLD で 2=終盤に切り替わる (境界)", () => {
    expect(computePhaseStage(makeState(ENDGAME_THRESHOLD))).toBe(2);
  });

  it("ply=300 (長期戦) も 2=終盤", () => {
    expect(computePhaseStage(makeState(300))).toBe(2);
  });

  it("EARLY_GAME_THRESHOLD < ENDGAME_THRESHOLD であること (順序整合性)", () => {
    expect(EARLY_GAME_THRESHOLD).toBeLessThan(ENDGAME_THRESHOLD);
  });
});

describe("getDrawValue (PR3-1 C-2 動的ドロー価値)", () => {
  function makeState(moveCount: number): GameState {
    return { ...createInitialGameState(CARD_SHOGI_VARIANT), moveCount };
  }

  function makeCardState(opts: {
    handSize: number;
    mana: number;
    goteMana?: number;
    goteHandSize?: number;
  }): CardGameState {
    const mkHand = (n: number): CardInstance[] =>
      Array.from({ length: n }, (_, i) => ({
        instanceId: `test-${i}`,
        defId: "pawn_return",
      }));
    return {
      mana: { sente: opts.mana, gote: opts.goteMana ?? opts.mana },
      manaCap: 20,
      hand: {
        sente: mkHand(opts.handSize),
        gote: mkHand(opts.goteHandSize ?? opts.handSize),
      },
      deck: { sente: [], gote: [] },
      graveyard: { sente: [], gote: [] },
      trap: { sente: null, gote: null },
      pendingCard: null,
      lastTurnStartedAt: { sente: null, gote: null },
      noPromoteMarks: { sente: [], gote: [] },
      drawProgress: { sente: 0, gote: 0 },
    };
  }

  const SENTE: Player = "sente";
  const GOTE: Player = "gote";

  it("序盤 (phase=0) + 手札 0 + マナしきい値以下: BASE のみ (bonus/penalty 0)", () => {
    const state = makeState(0); // phase=0
    const cs = makeCardState({ handSize: 0, mana: DRAW_MANA_SURPLUS_THRESHOLD });
    expect(getDrawValue(state, SENTE, cs)).toBe(DRAW_VALUE_BASE);
  });

  it("中盤 (phase=1) + マナ余剰 + 手札しきい値以下: BASE + manaBonus + midBonus", () => {
    const state = makeState(EARLY_GAME_THRESHOLD); // phase=1
    const surplus = 4;
    const cs = makeCardState({
      handSize: DRAW_HAND_THRESHOLD,
      mana: DRAW_MANA_SURPLUS_THRESHOLD + surplus,
    });
    const expected =
      DRAW_VALUE_BASE + surplus * DRAW_MANA_SURPLUS_COEF + DRAW_PHASE_MID_BONUS;
    expect(getDrawValue(state, SENTE, cs)).toBe(expected);
  });

  it("終盤 (phase=2) + 手札過多: BASE + manaBonus + endBonus - handPenalty", () => {
    const state = makeState(ENDGAME_THRESHOLD); // phase=2
    const handOver = 3;
    const manaOver = 2;
    const cs = makeCardState({
      handSize: DRAW_HAND_THRESHOLD + handOver,
      mana: DRAW_MANA_SURPLUS_THRESHOLD + manaOver,
    });
    const expected =
      DRAW_VALUE_BASE +
      manaOver * DRAW_MANA_SURPLUS_COEF +
      DRAW_PHASE_END_BONUS -
      handOver * DRAW_HAND_PENALTY_PER_CARD;
    expect(getDrawValue(state, SENTE, cs)).toBe(expected);
  });

  it("sente / gote 対称: 同条件 cardState なら同値", () => {
    const state = makeState(60); // phase=1
    const cs = makeCardState({ handSize: 3, mana: 12 });
    expect(getDrawValue(state, SENTE, cs)).toBe(getDrawValue(state, GOTE, cs));
  });

  it("マナしきい値以下では manaBonus = 0", () => {
    const state = makeState(0);
    const cs1 = makeCardState({ handSize: 0, mana: DRAW_MANA_SURPLUS_THRESHOLD - 1 });
    const cs2 = makeCardState({ handSize: 0, mana: 0 });
    // どちらも BASE のみ (序盤 + 手札しきい値以下 + マナしきい値以下)
    expect(getDrawValue(state, SENTE, cs1)).toBe(DRAW_VALUE_BASE);
    expect(getDrawValue(state, SENTE, cs2)).toBe(DRAW_VALUE_BASE);
  });

  it("手札しきい値以下では handPenalty = 0", () => {
    const state = makeState(0);
    const cs1 = makeCardState({ handSize: DRAW_HAND_THRESHOLD - 1, mana: 0 });
    const cs2 = makeCardState({ handSize: 0, mana: 0 });
    expect(getDrawValue(state, SENTE, cs1)).toBe(DRAW_VALUE_BASE);
    expect(getDrawValue(state, SENTE, cs2)).toBe(DRAW_VALUE_BASE);
  });

  it("createInitialCardState (デフォルトデッキ) でも例外なく算出可能", () => {
    const state = makeState(0);
    const cs = createInitialCardState([
      { defId: "pawn_return" as const, count: 4 },
    ]);
    // 初期マナ・手札は決まっており、エラーなく数値が返れば OK
    const v = getDrawValue(state, SENTE, cs);
    expect(typeof v).toBe("number");
    expect(Number.isFinite(v)).toBe(true);
  });
});
