// Issue #193 / PR1d-1: cardDigest 計算・評価の data integrity 検証。
//
// 設計意図:
// - computeCardDigest が sente 絶対視点で正しく計算されることを検証 (W-2 反映)
// - evaluateCardDigest の variant ガード (standard で 0 / card-shogi で評価値) を検証 (W-3 反映)
// - 単調減衰関数 handValue の境界値・数式整合を検証 (F-5 仮基準)
// - sente / gote 入れ替えで manaDelta が符号反転 (sente 絶対視点の整合性、W-2)
//
// 本テストは構造妥当性検証のみ (CI 高速、ホットパス影響なし)。
// 実探索との統合検証は PR1c-2 strategy-baseline fixture (動的検証) で補完。
//
// 詳細: docs/plans/issue-193-pr1d.md「PR1d-1 詳細」参照。

import { describe, it, expect } from "vitest";
import {
  computeCardDigest,
  evaluateCardDigest,
  type CardDigest,
} from "../cards/digest";
import {
  MANA_DELTA_COEFFICIENT,
  HAND_VALUE_BASE,
  HAND_VALUE_DECAY,
  DRAW_PROGRESS_COEFFICIENT,
  TRAP_VALUE_NO_PROMOTE,
  TRAP_VALUE_CHECK_BREAK,
  NO_PROMOTE_MARK_COEFFICIENT,
  DEAD_MANA_THRESHOLD,
  DEAD_MANA_PENALTY_COEF,
} from "../cards/heuristics";
import { createInitialCardState } from "@/lib/shogi/cards/state";
import { INITIAL_MANA, MANA_CAP } from "@/lib/shogi/cards/definitions";
import { STANDARD_VARIANT } from "@/lib/shogi/variants/standard";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";

// テスト用の最小デッキ (Fisher-Yates シャッフルあるが、結果に影響しない構造のみ)。
const SAMPLE_DECK = [{ defId: "pawn_return" as const, count: 10 }];

describe("computeCardDigest (W-2: sente 絶対視点)", () => {
  it("初期 cardState の manaDelta は INITIAL_MANA.sente - INITIAL_MANA.gote (= -1)", () => {
    const cardState = createInitialCardState(SAMPLE_DECK);
    const digest = computeCardDigest(cardState);
    expect(digest.manaDelta).toBe(INITIAL_MANA.sente - INITIAL_MANA.gote);
    expect(digest.manaCap).toBe(MANA_CAP);
    // 初期手札は両者 2 枚なので handValueDelta = 0
    expect(digest.handValueDelta).toBe(0);
    expect(digest.drawProgressDelta).toBe(0);
  });

  it("sente がマナ多い → manaDelta > 0", () => {
    const cardState = createInitialCardState(SAMPLE_DECK);
    cardState.mana.sente = 10;
    cardState.mana.gote = 5;
    const digest = computeCardDigest(cardState);
    expect(digest.manaDelta).toBe(5);
  });

  it("gote がマナ多い → manaDelta < 0 (sente 絶対視点)", () => {
    const cardState = createInitialCardState(SAMPLE_DECK);
    cardState.mana.sente = 3;
    cardState.mana.gote = 8;
    const digest = computeCardDigest(cardState);
    expect(digest.manaDelta).toBe(-5);
  });

  it("gote が sente より手札多い → handValueDelta < 0", () => {
    const cardState = createInitialCardState(SAMPLE_DECK);
    // gote の手札を 2 枚追加 (合計 4 枚) して sente との差を作る
    const drawn1 = cardState.deck.gote.pop();
    const drawn2 = cardState.deck.gote.pop();
    expect(drawn1).toBeDefined();
    expect(drawn2).toBeDefined();
    cardState.hand.gote.push(drawn1!, drawn2!);
    const digest = computeCardDigest(cardState);
    expect(digest.handValueDelta).toBeLessThan(0);
  });

  it("drawProgress 差は drawProgressDelta = sente - gote", () => {
    const cardState = createInitialCardState(SAMPLE_DECK);
    cardState.drawProgress.sente = 3;
    cardState.drawProgress.gote = 1;
    const digest = computeCardDigest(cardState);
    expect(digest.drawProgressDelta).toBe(2);
  });

  it("sente/gote 入れ替えで manaDelta が符号反転 (sente 絶対視点の整合)", () => {
    const cs1 = createInitialCardState(SAMPLE_DECK);
    cs1.mana.sente = 10;
    cs1.mana.gote = 5;
    cs1.drawProgress.sente = 4;
    cs1.drawProgress.gote = 1;
    const d1 = computeCardDigest(cs1);

    const cs2 = createInitialCardState(SAMPLE_DECK);
    cs2.mana.sente = 5;
    cs2.mana.gote = 10;
    cs2.drawProgress.sente = 1;
    cs2.drawProgress.gote = 4;
    const d2 = computeCardDigest(cs2);

    // 足し算検証で +0/-0 の Object.is 差異を回避 (= 数学的に同値であることを確認)
    expect(d1.manaDelta + d2.manaDelta).toBe(0);
    expect(d1.drawProgressDelta + d2.drawProgressDelta).toBe(0);
  });
});

describe("evaluateCardDigest (W-3: variant ガード + W-2: sente 絶対視点)", () => {
  const sampleDigest: CardDigest = {
    manaDelta: 3,
    manaCap: MANA_CAP,
    handValueDelta: 5,
    drawProgressDelta: 2,
    trapPresence: { sente: null, gote: null },
    noPromoteMarkCountDelta: 0,
    // PR3-1: 両者 DEAD_MANA_THRESHOLD 以下に設定し、死にマナペナルティ=0 で
    // 既存アサーションの数式 (manaDelta×COEF + handValueDelta + drawProgressDelta×COEF) を維持。
    manaAbsolute: { sente: 10, gote: 7 },
  };

  it("variant.id === 'standard' は常に 0 を返す (W-3 反映)", () => {
    const value = evaluateCardDigest(sampleDigest, STANDARD_VARIANT);
    expect(value).toBe(0);
  });

  it("variant.id === 'card-shogi' は cp 単位の評価値を返す", () => {
    const value = evaluateCardDigest(sampleDigest, CARD_SHOGI_VARIANT);
    const expected =
      sampleDigest.manaDelta * MANA_DELTA_COEFFICIENT +
      sampleDigest.handValueDelta +
      sampleDigest.drawProgressDelta * DRAW_PROGRESS_COEFFICIENT;
    expect(value).toBe(expected);
  });

  it("空 digest (全 0) → 評価値も 0", () => {
    const emptyDigest: CardDigest = {
      manaDelta: 0,
      manaCap: MANA_CAP,
      handValueDelta: 0,
      drawProgressDelta: 0,
      trapPresence: { sente: null, gote: null },
      noPromoteMarkCountDelta: 0,
      manaAbsolute: { sente: 0, gote: 0 },
    };
    expect(evaluateCardDigest(emptyDigest, CARD_SHOGI_VARIANT)).toBe(0);
  });

  it("manaDelta の符号反転で評価値が MANA_DELTA_COEFFICIENT 倍だけ変動", () => {
    const positive: CardDigest = { ...sampleDigest, manaDelta: 5 };
    const negative: CardDigest = { ...sampleDigest, manaDelta: -5 };
    const v1 = evaluateCardDigest(positive, CARD_SHOGI_VARIANT);
    const v2 = evaluateCardDigest(negative, CARD_SHOGI_VARIANT);
    // 残りのフィールドは同じなので、差分が manaDelta 由来のみ
    expect(v1 - v2).toBe(10 * MANA_DELTA_COEFFICIENT); // (5 - (-5)) * 10 = 100
  });
});

describe("handValue 単調減衰関数 (F-5 仮基準)", () => {
  it("両者の手札が空 → handValueDelta = 0", () => {
    const cardState = createInitialCardState(SAMPLE_DECK);
    cardState.hand.sente = [];
    cardState.hand.gote = [];
    const digest = computeCardDigest(cardState);
    expect(digest.handValueDelta).toBe(0);
  });

  it("sente の手札を 1 枚増やすと handValueDelta は数式と一致", () => {
    const cardState = createInitialCardState(SAMPLE_DECK);
    cardState.hand.gote = [];
    cardState.hand.sente = [cardState.deck.sente.pop()!]; // 1 枚
    const digest = computeCardDigest(cardState);
    const expected = HAND_VALUE_BASE * (1 - Math.exp(-1 / HAND_VALUE_DECAY));
    expect(digest.handValueDelta).toBeCloseTo(expected, 5);
  });

  it("handSize 単調増加で handValueDelta も単調増加", () => {
    const cardState = createInitialCardState(SAMPLE_DECK);
    cardState.hand.sente = [];
    cardState.hand.gote = [];
    const deltas: number[] = [];
    for (let i = 0; i < 4; i++) {
      const card = cardState.deck.sente.pop();
      if (card) cardState.hand.sente.push(card);
      const digest = computeCardDigest(cardState);
      deltas.push(digest.handValueDelta);
    }
    // 0, 1, 2, 3 枚目のすべてで単調増加 (gote = 0 のまま)
    for (let i = 1; i < deltas.length; i++) {
      expect(deltas[i]).toBeGreaterThan(deltas[i - 1]);
    }
  });

  it("handSize が増えるほど追加 1 枚の限界価値が逓減 (単調減衰の特性)", () => {
    const cardState = createInitialCardState(SAMPLE_DECK);
    cardState.hand.sente = [];
    cardState.hand.gote = [];
    const deltas: number[] = [];
    for (let i = 0; i < 5; i++) {
      const card = cardState.deck.sente.pop();
      if (card) cardState.hand.sente.push(card);
      const digest = computeCardDigest(cardState);
      deltas.push(digest.handValueDelta);
    }
    // 増分 (i+1 枚目 - i 枚目) が逓減
    const increments: number[] = [];
    for (let i = 1; i < deltas.length; i++) {
      increments.push(deltas[i] - deltas[i - 1]);
    }
    for (let i = 1; i < increments.length; i++) {
      expect(increments[i]).toBeLessThanOrEqual(increments[i - 1]);
    }
  });
});

describe("computeCardDigest PR1d-4 拡張 (trapPresence / noPromoteMarkCountDelta)", () => {
  it("初期 cardState は trapPresence={sente:null,gote:null} / noPromoteMarkCountDelta=0", () => {
    const cardState = createInitialCardState(SAMPLE_DECK);
    const digest = computeCardDigest(cardState);
    expect(digest.trapPresence).toEqual({ sente: null, gote: null });
    expect(digest.noPromoteMarkCountDelta).toBe(0);
  });

  it("sente 盤上トラップは trapPresence.sente に defId 反映、gote は null", () => {
    const cardState = createInitialCardState(SAMPLE_DECK);
    cardState.trap.sente = {
      instanceId: "t-s1",
      defId: "check_break",
      owner: "sente",
    };
    const digest = computeCardDigest(cardState);
    expect(digest.trapPresence.sente).toBe("check_break");
    expect(digest.trapPresence.gote).toBeNull();
  });

  it("両者盤上トラップは sente/gote それぞれの defId を保持", () => {
    const cardState = createInitialCardState(SAMPLE_DECK);
    cardState.trap.sente = { instanceId: "t-s", defId: "no_promote", owner: "sente" };
    cardState.trap.gote = { instanceId: "t-g", defId: "check_break", owner: "gote" };
    const digest = computeCardDigest(cardState);
    expect(digest.trapPresence).toEqual({
      sente: "no_promote",
      gote: "check_break",
    });
  });

  it("noPromoteMarkCountDelta は sente 数 - gote 数 (ギャップ1=案A: 玉位置非依存)", () => {
    const cardState = createInitialCardState(SAMPLE_DECK);
    cardState.noPromoteMarks.sente = [
      { row: 6, col: 0 },
      { row: 6, col: 1 },
    ];
    cardState.noPromoteMarks.gote = [{ row: 2, col: 8 }];
    const digest = computeCardDigest(cardState);
    expect(digest.noPromoteMarkCountDelta).toBe(2 - 1);
  });

  it("noPromoteMarkCountDelta は gote 優勢で負 (sente 絶対視点 W-2 整合)", () => {
    const cardState = createInitialCardState(SAMPLE_DECK);
    cardState.noPromoteMarks.sente = [];
    cardState.noPromoteMarks.gote = [
      { row: 2, col: 0 },
      { row: 2, col: 1 },
      { row: 2, col: 2 },
    ];
    const digest = computeCardDigest(cardState);
    expect(digest.noPromoteMarkCountDelta).toBe(0 - 3);
  });

  it("PR1d-4 コミット 2: sente 盤上 check_break trap は +TRAP_VALUE_CHECK_BREAK", () => {
    const base = createInitialCardState(SAMPLE_DECK);
    const withTrap = createInitialCardState(SAMPLE_DECK);
    withTrap.trap.sente = { instanceId: "t", defId: "check_break", owner: "sente" };
    const baseScore = evaluateCardDigest(
      computeCardDigest(base),
      CARD_SHOGI_VARIANT,
    );
    const trapScore = evaluateCardDigest(
      computeCardDigest(withTrap),
      CARD_SHOGI_VARIANT,
    );
    expect(trapScore - baseScore).toBe(TRAP_VALUE_CHECK_BREAK);
  });

  it("PR1d-4 コミット 2: gote 盤上 no_promote trap は -TRAP_VALUE_NO_PROMOTE (sente 絶対視点)", () => {
    const base = createInitialCardState(SAMPLE_DECK);
    const withTrap = createInitialCardState(SAMPLE_DECK);
    withTrap.trap.gote = { instanceId: "t", defId: "no_promote", owner: "gote" };
    const baseScore = evaluateCardDigest(
      computeCardDigest(base),
      CARD_SHOGI_VARIANT,
    );
    const trapScore = evaluateCardDigest(
      computeCardDigest(withTrap),
      CARD_SHOGI_VARIANT,
    );
    expect(trapScore - baseScore).toBe(-TRAP_VALUE_NO_PROMOTE);
  });

  it("PR1d-4 コミット 2: noPromoteMarkCountDelta × NO_PROMOTE_MARK_COEFFICIENT が評価に反映", () => {
    const base = createInitialCardState(SAMPLE_DECK);
    const withMarks = createInitialCardState(SAMPLE_DECK);
    withMarks.noPromoteMarks.sente = [
      { row: 6, col: 0 },
      { row: 6, col: 1 },
    ];
    withMarks.noPromoteMarks.gote = [{ row: 2, col: 8 }];
    const baseScore = evaluateCardDigest(
      computeCardDigest(base),
      CARD_SHOGI_VARIANT,
    );
    const markScore = evaluateCardDigest(
      computeCardDigest(withMarks),
      CARD_SHOGI_VARIANT,
    );
    expect(markScore - baseScore).toBe((2 - 1) * NO_PROMOTE_MARK_COEFFICIENT);
  });

  it("PR1d-4 コミット 2: standard variant はトラップ価値も 0 (W-3 ガード維持)", () => {
    const withTrap = createInitialCardState(SAMPLE_DECK);
    withTrap.trap.sente = { instanceId: "t", defId: "check_break", owner: "sente" };
    withTrap.noPromoteMarks.sente = [{ row: 6, col: 0 }];
    expect(
      evaluateCardDigest(computeCardDigest(withTrap), STANDARD_VARIANT),
    ).toBe(0);
  });
});

describe("PR3-1 manaAbsolute + 死にマナペナルティ", () => {
  it("computeCardDigest が manaAbsolute (sente/gote) を生マナで保持する", () => {
    const cs = createInitialCardState(SAMPLE_DECK);
    cs.mana.sente = 13;
    cs.mana.gote = 18;
    const d = computeCardDigest(cs);
    expect(d.manaAbsolute).toEqual({ sente: 13, gote: 18 });
  });

  it("両者しきい値以下では penalty = 0 (差分計算が不要なケース)", () => {
    const base = createInitialCardState(SAMPLE_DECK);
    base.mana.sente = DEAD_MANA_THRESHOLD;
    base.mana.gote = DEAD_MANA_THRESHOLD - 5;
    const v = evaluateCardDigest(computeCardDigest(base), CARD_SHOGI_VARIANT);
    // manaDelta=5 が COEF=10 で +50 のみ加算され、penalty 項は 0
    expect(v).toBe(5 * MANA_DELTA_COEFFICIENT);
  });

  it("sente だけが過剰 → sente にとってマイナス (機会損失)", () => {
    const base = createInitialCardState(SAMPLE_DECK);
    base.mana.sente = DEAD_MANA_THRESHOLD - 1;
    base.mana.gote = DEAD_MANA_THRESHOLD - 1;
    const overflow = 3;
    const high = createInitialCardState(SAMPLE_DECK);
    high.mana.sente = DEAD_MANA_THRESHOLD + overflow;
    high.mana.gote = DEAD_MANA_THRESHOLD - 1;
    const baseScore = evaluateCardDigest(computeCardDigest(base), CARD_SHOGI_VARIANT);
    const highScore = evaluateCardDigest(computeCardDigest(high), CARD_SHOGI_VARIANT);
    // sente が高い分 manaDelta も増えるので、その寄与を除いた差分を確認:
    //   (高 manaDelta - 低 manaDelta) × COEF + (- overflow × PENALTY_COEF)
    const baseDelta = base.mana.sente - base.mana.gote;
    const highDelta = high.mana.sente - high.mana.gote;
    const manaDeltaContribution = (highDelta - baseDelta) * MANA_DELTA_COEFFICIENT;
    const penaltyContribution = -overflow * DEAD_MANA_PENALTY_COEF;
    expect(highScore - baseScore).toBe(manaDeltaContribution + penaltyContribution);
  });

  it("gote だけが過剰 → sente にとってプラス (相手の機会損失)", () => {
    const a = createInitialCardState(SAMPLE_DECK);
    a.mana.sente = 5;
    a.mana.gote = DEAD_MANA_THRESHOLD - 1;
    const b = createInitialCardState(SAMPLE_DECK);
    b.mana.sente = 5;
    const overflow = 4;
    b.mana.gote = DEAD_MANA_THRESHOLD + overflow;
    const aScore = evaluateCardDigest(computeCardDigest(a), CARD_SHOGI_VARIANT);
    const bScore = evaluateCardDigest(computeCardDigest(b), CARD_SHOGI_VARIANT);
    // manaDelta 差は実状態から算出 (gote が 15 → 20 で +5 増えるが overflow=4 と異なるため)。
    // penalty は a.gote=15 (overflow=0) → b.gote=20 (overflow=4) で +overflow×PENALTY_COEF。
    const aDelta = a.mana.sente - a.mana.gote;
    const bDelta = b.mana.sente - b.mana.gote;
    const manaDeltaContribution = (bDelta - aDelta) * MANA_DELTA_COEFFICIENT;
    const penaltyContribution = overflow * DEAD_MANA_PENALTY_COEF;
    expect(bScore - aScore).toBe(manaDeltaContribution + penaltyContribution);
  });

  it("両者同時に過剰 → penalty は対称 (差分で打ち消し) + manaDelta は変化しない", () => {
    const base = createInitialCardState(SAMPLE_DECK);
    base.mana.sente = 10;
    base.mana.gote = 10;
    const both = createInitialCardState(SAMPLE_DECK);
    both.mana.sente = DEAD_MANA_THRESHOLD + 3;
    both.mana.gote = DEAD_MANA_THRESHOLD + 3;
    const baseScore = evaluateCardDigest(computeCardDigest(base), CARD_SHOGI_VARIANT);
    const bothScore = evaluateCardDigest(computeCardDigest(both), CARD_SHOGI_VARIANT);
    // 両者同じ増分なら manaDelta は変化なし。penalty も sente/gote で打ち消し合って 0。
    expect(bothScore - baseScore).toBe(0);
  });

  it("standard variant は死にマナペナルティも 0 (W-3 ガード維持)", () => {
    const cs = createInitialCardState(SAMPLE_DECK);
    cs.mana.sente = MANA_CAP;
    cs.mana.gote = 0;
    expect(
      evaluateCardDigest(computeCardDigest(cs), STANDARD_VARIANT),
    ).toBe(0);
  });
});
