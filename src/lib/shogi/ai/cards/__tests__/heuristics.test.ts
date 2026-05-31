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

// PR3-3 C-8 (F-5 解消): 数値固定 / 相対 assert で calibration 定数変更を検出可能化
//
// レビュー指摘: 既存テストは expected を実装式そのまま組み立てる (e.g.,
// `BASE + surplus*COEF + ...`) ため、定数を変えても expected が追従して常に緑となり
// regression を検出できない。本セクションでは:
// - 数値固定 assert: 特定 input で実値を hard-code (constant が動けば fail)
// - 相対 assert: f(x) > f(y) 等の単調性で「設計意図 (= 因果方向)」を担保
//
// 仮値変更時は数値固定 assert の値を意図的に更新する運用 (= 校正コミットでテスト数値も
// 同時更新、レビュー時に両方の整合性を確認可能)。
describe("PR3-3 C-8 getDrawValue 数値固定 / 相対 assert (F-5 解消)", () => {
  function makeState(moveCount: number): GameState {
    return { ...createInitialGameState(CARD_SHOGI_VARIANT), moveCount };
  }

  function makeCS(opts: { handSize: number; mana: number; goteMana?: number }): CardGameState {
    const mkHand = (n: number): CardInstance[] =>
      Array.from({ length: n }, (_, i) => ({
        instanceId: `t-${i}`,
        defId: "pawn_return",
      }));
    return {
      mana: { sente: opts.mana, gote: opts.goteMana ?? opts.mana },
      manaCap: 20,
      hand: { sente: mkHand(opts.handSize), gote: [] },
      deck: { sente: [], gote: [] },
      graveyard: { sente: [], gote: [] },
      trap: { sente: null, gote: null },
      pendingCard: null,
      lastTurnStartedAt: { sente: null, gote: null },
      noPromoteMarks: { sente: [], gote: [] },
      drawProgress: { sente: 0, gote: 0 },
    };
  }

  // 数値固定: 現行定数 (BASE=20, MANA_SURPLUS_COEF=3, PHASE_MID_BONUS=15,
  //   HAND_PENALTY_PER_CARD=8, MANA_SURPLUS_THRESHOLD=8, HAND_THRESHOLD=4) における実値。
  // 定数が変われば fail する → calibration regression を機械検出。
  it("数値固定: mana=19, hand=3, phase=mid → 20 + (19-8)*3 + 15 - 0 = 68", () => {
    const v = getDrawValue(
      makeState(50), // phase=1 (mid)
      "sente",
      makeCS({ handSize: 3, mana: 19 }),
    );
    expect(v).toBe(68);
  });

  it("数値固定: mana=20 (cap), hand=5, phase=end → 20 + (20-8)*3 + 5 - (5-4)*8 = 53", () => {
    const v = getDrawValue(
      makeState(120), // phase=2 (end)
      "sente",
      makeCS({ handSize: 5, mana: 20 }),
    );
    expect(v).toBe(53);
  });

  it("数値固定: mana=2, hand=0, phase=opening → BASE のみ = 20", () => {
    const v = getDrawValue(
      makeState(0), // phase=0
      "sente",
      makeCS({ handSize: 0, mana: 2 }),
    );
    expect(v).toBe(20);
  });

  // 相対: 単調性で因果方向を担保 (定数値が変わっても方向性は保たれるべき)
  it("相対: 同条件下では mana が多いほど getDrawValue は単調増加 (manaBonus の符号)", () => {
    const state = makeState(50);
    const v15 = getDrawValue(state, "sente", makeCS({ handSize: 2, mana: 15 }));
    const v19 = getDrawValue(state, "sente", makeCS({ handSize: 2, mana: 19 }));
    expect(v19).toBeGreaterThan(v15);
  });

  it("相対: 同条件下では hand が多いほど getDrawValue は単調減少 (handPenalty の符号)", () => {
    const state = makeState(50);
    const v4 = getDrawValue(state, "sente", makeCS({ handSize: 4, mana: 10 }));
    const v7 = getDrawValue(state, "sente", makeCS({ handSize: 7, mana: 10 }));
    expect(v7).toBeLessThan(v4);
  });

  it("相対: 同条件下で phase 進行 (序盤→中盤→終盤) で getDrawValue は midgame が最大", () => {
    const open = getDrawValue(makeState(0), "sente", makeCS({ handSize: 2, mana: 10 }));
    const mid = getDrawValue(makeState(50), "sente", makeCS({ handSize: 2, mana: 10 }));
    const end = getDrawValue(makeState(120), "sente", makeCS({ handSize: 2, mana: 10 }));
    // 設計: 中盤 = +15 (最大)、終盤 = +5、序盤 = 0
    expect(mid).toBeGreaterThan(end);
    expect(end).toBeGreaterThan(open);
  });
});
