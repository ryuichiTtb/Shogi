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
  updateCardDigest,
  type CardDigest,
} from "../cards/digest";
import {
  MANA_DELTA_COEFFICIENT,
  HAND_VALUE_BASE,
  HAND_VALUE_DECAY,
  DRAW_PROGRESS_COEFFICIENT,
  DEAD_MANA_THRESHOLD,
  DEAD_MANA_PENALTY_COEF,
} from "../cards/heuristics";
import { CARD_SPECS } from "@/lib/shogi/cards/card-spec-server";
import { createInitialCardState } from "@/lib/shogi/cards/state";
import { moveNoPromoteMark } from "@/lib/shogi/cards/effects";
import { evaluate } from "@/lib/shogi/ai/evaluate";
import { INITIAL_MANA, MANA_CAP } from "@/lib/shogi/cards/definitions";
import { STANDARD_VARIANT } from "@/lib/shogi/variants/standard";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";
import type { Board, GameState, Piece } from "@/lib/shogi/types";

// テスト用の最小デッキ (Fisher-Yates シャッフルあるが、結果に影響しない構造のみ)。
const SAMPLE_DECK = [{ defId: "pawn_return" as const, count: 10 }];

// Issue #235 S3b: トラップの局面依存価値 (valueModel) を決定論化する最小盤面。
// 両玉を安全位置に配置 (check_break=自玉露出度0 / no_promote=相手成り脅威0 → 各カード下限値)。
// トラップ価値の符号・wiring 検証用。期待値は CARD_SPECS[id].valueModel(GS, player) で算出する
// (固定定数をハードコードせず、valueModel との一致を pin)。
function makeGameState(): GameState {
  const board: Board = Array.from({ length: 9 }, () => Array<Piece | null>(9).fill(null));
  board[8][4] = { type: "king", owner: "sente" };
  board[0][4] = { type: "king", owner: "gote" };
  return {
    board,
    hand: { sente: {}, gote: {} },
    currentPlayer: "sente",
    moveHistory: [],
    positionHistory: [],
    status: "active",
    moveCount: 0,
  };
}
const GS = makeGameState();
// 期待トラップ価値 (sente 絶対視点: sente トラップ +、gote トラップ -)。
const CHECK_BREAK_VM_SENTE = CARD_SPECS.check_break.valueModel(GS, "sente");
const NO_PROMOTE_VM_GOTE = CARD_SPECS.no_promote.valueModel(GS, "gote");

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
    trap: { sente: null, gote: null },
    noPromoteMarks: null,
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
      trap: { sente: null, gote: null },
      noPromoteMarks: null,
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

describe("computeCardDigest / evaluate トラップ (S4d-4 board 由来化)", () => {
  it("トラップなし・マークなし → trap={null,null} / noPromoteMarks=null", () => {
    const cardState = createInitialCardState(SAMPLE_DECK);
    const digest = computeCardDigest(cardState);
    expect(digest.trap).toEqual({ sente: null, gote: null });
    expect(digest.noPromoteMarks).toBeNull();
  });

  it("S4d-4: computeCardDigest は trap の defId を帯同 (価値でなく defId)", () => {
    const cardState = createInitialCardState(SAMPLE_DECK);
    cardState.trap.sente = { instanceId: "t-s1", defId: "check_break", owner: "sente" };
    const digest = computeCardDigest(cardState);
    expect(digest.trap.sente).toBe("check_break");
    expect(digest.trap.gote).toBeNull();
  });

  it("S4d-4: evaluate が sente 盤上トラップ価値を leaf で board 由来算出 (+valueModel(sente))", () => {
    const base = createInitialCardState(SAMPLE_DECK);
    const withTrap = createInitialCardState(SAMPLE_DECK);
    withTrap.trap.sente = { instanceId: "t-s1", defId: "check_break", owner: "sente" };
    const baseScore = evaluate(GS, CARD_SHOGI_VARIANT, computeCardDigest(base));
    const trapScore = evaluate(GS, CARD_SHOGI_VARIANT, computeCardDigest(withTrap));
    expect(trapScore - baseScore).toBe(CHECK_BREAK_VM_SENTE);
    expect(CHECK_BREAK_VM_SENTE).toBeGreaterThan(0); // gross 値は常に正
  });

  it("S4d-4: evaluate 両者盤上トラップは +valueModel(sente) - valueModel(gote) (sente 絶対視点)", () => {
    const base = createInitialCardState(SAMPLE_DECK);
    const withTrap = createInitialCardState(SAMPLE_DECK);
    withTrap.trap.sente = { instanceId: "t-s", defId: "no_promote", owner: "sente" };
    withTrap.trap.gote = { instanceId: "t-g", defId: "check_break", owner: "gote" };
    const baseScore = evaluate(GS, CARD_SHOGI_VARIANT, computeCardDigest(base));
    const trapScore = evaluate(GS, CARD_SHOGI_VARIANT, computeCardDigest(withTrap));
    const expected =
      CARD_SPECS.no_promote.valueModel(GS, "sente") -
      CARD_SPECS.check_break.valueModel(GS, "gote");
    expect(trapScore - baseScore).toBe(expected);
  });

  it("S4d-3: 両者マーク有り → noPromoteMarks に両者 slice を帯同 (参照流用)", () => {
    const cardState = createInitialCardState(SAMPLE_DECK);
    cardState.noPromoteMarks.sente = [
      { row: 6, col: 0 },
      { row: 6, col: 1 },
    ];
    cardState.noPromoteMarks.gote = [{ row: 2, col: 8 }];
    const digest = computeCardDigest(cardState);
    expect(digest.noPromoteMarks).not.toBeNull();
    // 毎ノード copy せず slice 参照を流用 (= reference equality)。
    expect(digest.noPromoteMarks!.sente).toBe(cardState.noPromoteMarks.sente);
    expect(digest.noPromoteMarks!.gote).toBe(cardState.noPromoteMarks.gote);
  });

  it("S4d-3: 片側のみマーク有り → noPromoteMarks 非 null (両者 slice を帯同)", () => {
    const cardState = createInitialCardState(SAMPLE_DECK);
    cardState.noPromoteMarks.sente = [];
    cardState.noPromoteMarks.gote = [
      { row: 2, col: 0 },
      { row: 2, col: 1 },
      { row: 2, col: 2 },
    ];
    const digest = computeCardDigest(cardState);
    expect(digest.noPromoteMarks).not.toBeNull();
    expect(digest.noPromoteMarks!.gote).toHaveLength(3);
    expect(digest.noPromoteMarks!.sente).toHaveLength(0);
  });

  it("S4d-4: gote 盤上 no_promote trap は evaluate に -valueModel(gote) (sente 絶対視点)", () => {
    const base = createInitialCardState(SAMPLE_DECK);
    const withTrap = createInitialCardState(SAMPLE_DECK);
    withTrap.trap.gote = { instanceId: "t", defId: "no_promote", owner: "gote" };
    const baseScore = evaluate(GS, CARD_SHOGI_VARIANT, computeCardDigest(base));
    const trapScore = evaluate(GS, CARD_SHOGI_VARIANT, computeCardDigest(withTrap));
    expect(trapScore - baseScore).toBe(-NO_PROMOTE_VM_GOTE);
  });

  it("S4d-3: evaluateCardDigest はマーク有無に依存しない (no_promote 評価は leaf per-piece へ移行)", () => {
    // 旧 noPromoteMarkCountDelta × 係数 (符号逆バグ) を撤去。マーク数差は evaluateCardDigest に
    // 寄与しない (= digest スカラー加算ゼロ)。no_promote の評価寄与は evaluate の per-piece modifier
    // (material 減価 + 成り脅威割引) が board 由来で算出する (evaluators/ のテストで pin)。
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
    expect(markScore - baseScore).toBe(0);
  });

  it("S4d-4: standard variant はトラップ価値も 0 (W-3 ガード維持)", () => {
    const withTrap = createInitialCardState(SAMPLE_DECK);
    withTrap.trap.sente = { instanceId: "t", defId: "check_break", owner: "sente" };
    withTrap.noPromoteMarks.sente = [{ row: 6, col: 0 }];
    // standard では evaluateCardDigest=0 + evaluate の leaf trap も variant ガードで非加算。
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

describe("PR3-2 updateCardDigest (増分更新)", () => {
  // cardState の deep clone (各テストで mutate するため)
  function clone(cs: ReturnType<typeof createInitialCardState>) {
    return {
      mana: { sente: cs.mana.sente, gote: cs.mana.gote },
      manaCap: cs.manaCap,
      hand: {
        sente: [...cs.hand.sente],
        gote: [...cs.hand.gote],
      },
      deck: {
        sente: [...cs.deck.sente],
        gote: [...cs.deck.gote],
      },
      graveyard: {
        sente: [...cs.graveyard.sente],
        gote: [...cs.graveyard.gote],
      },
      trap: { sente: cs.trap.sente, gote: cs.trap.gote },
      pendingCard: cs.pendingCard,
      lastTurnStartedAt: {
        sente: cs.lastTurnStartedAt.sente,
        gote: cs.lastTurnStartedAt.gote,
      },
      noPromoteMarks: {
        sente: [...cs.noPromoteMarks.sente],
        gote: [...cs.noPromoteMarks.gote],
      },
      drawProgress: {
        sente: cs.drawProgress.sente,
        gote: cs.drawProgress.gote,
      },
    };
  }

  it("変化なし (deep equal な cardState) → digest 全フィールド prev と同値", () => {
    const cs = createInitialCardState(SAMPLE_DECK);
    const prev = computeCardDigest(cs);
    const csNew = clone(cs);
    const updated = updateCardDigest(prev, cs, csNew);
    expect(updated).toEqual(prev);
    // 変化なしフィールドはオブジェクトを参照流用 (再生成なし) で性能寄与
    expect(updated.manaAbsolute).toBe(prev.manaAbsolute);
    expect(updated.trap).toBe(prev.trap);
  });

  it("マナのみ変化 → manaDelta / manaAbsolute 更新、他は prev 流用", () => {
    const cs = createInitialCardState(SAMPLE_DECK);
    const prev = computeCardDigest(cs);
    const csNew = clone(cs);
    csNew.mana.sente = cs.mana.sente + 5;
    const updated = updateCardDigest(prev, cs, csNew);
    expect(updated.manaDelta).toBe(csNew.mana.sente - csNew.mana.gote);
    expect(updated.manaAbsolute).toEqual({ sente: csNew.mana.sente, gote: cs.mana.gote });
    // 他フィールドは prev と reference equality
    expect(updated.trap).toBe(prev.trap);
    expect(updated.handValueDelta).toBe(prev.handValueDelta);
    expect(updated.drawProgressDelta).toBe(prev.drawProgressDelta);
    expect(updated.noPromoteMarks).toBe(prev.noPromoteMarks);
  });

  it("手札増加 (draw 想定) → handValueDelta 更新、mana/trap は流用", () => {
    const cs = createInitialCardState(SAMPLE_DECK);
    const prev = computeCardDigest(cs);
    const csNew = clone(cs);
    const drawn = csNew.deck.sente.pop()!;
    csNew.hand.sente.push(drawn);
    const updated = updateCardDigest(prev, cs, csNew);
    expect(updated.handValueDelta).toBeGreaterThan(prev.handValueDelta);
    // mana / trap / drawProgress / marks は変化なし
    expect(updated.manaAbsolute).toBe(prev.manaAbsolute);
    expect(updated.trap).toBe(prev.trap);
    expect(updated.drawProgressDelta).toBe(prev.drawProgressDelta);
    expect(updated.noPromoteMarks).toBe(prev.noPromoteMarks);
  });

  it("S4d-4: トラップ設置 (gote: check_break) → trap.gote defId 更新", () => {
    const cs = createInitialCardState(SAMPLE_DECK);
    const prev = computeCardDigest(cs);
    const csNew = clone(cs);
    csNew.trap.gote = {
      instanceId: "tg-1",
      defId: "check_break",
      owner: "gote",
    };
    const updated = updateCardDigest(prev, cs, csNew);
    expect(updated.trap.gote).toBe("check_break");
    expect(updated.trap.sente).toBeNull();
    // 他は流用
    expect(updated.manaAbsolute).toBe(prev.manaAbsolute);
    expect(updated.handValueDelta).toBe(prev.handValueDelta);
  });

  it("S4d-4: トラップ解除 (gote: check_break → null) → trap.gote defId が null へ", () => {
    const cs = createInitialCardState(SAMPLE_DECK);
    cs.trap.gote = {
      instanceId: "tg-1",
      defId: "check_break",
      owner: "gote",
    };
    const prev = computeCardDigest(cs);
    const csNew = clone(cs);
    csNew.trap.gote = null;
    const updated = updateCardDigest(prev, cs, csNew);
    expect(updated.trap.gote).toBeNull();
  });

  it("noPromote マーク追加 → noPromoteMarks 更新 (参照変化で検知)", () => {
    const cs = createInitialCardState(SAMPLE_DECK);
    const prev = computeCardDigest(cs); // マーク空 → null
    const csNew = clone(cs);
    csNew.noPromoteMarks.sente.push({ row: 6, col: 0 });
    csNew.noPromoteMarks.sente.push({ row: 6, col: 1 });
    const updated = updateCardDigest(prev, cs, csNew);
    expect(updated.noPromoteMarks).not.toBeNull();
    expect(updated.noPromoteMarks!.sente).toHaveLength(2);
  });

  it("S4d-3 (M1 B-1): follow (length 不変・position 変化) を参照比較で検知し marks を更新する", () => {
    // length 比較では検知漏れする follow を、参照比較が正しく拾うことの回帰 anchor。
    const cs = createInitialCardState(SAMPLE_DECK);
    cs.noPromoteMarks.sente = [{ row: 6, col: 0 }];
    const prev = computeCardDigest(cs);
    // 駒が (6,0)→(5,0) へ追従移動 (length 不変、新参照を返す)。
    const csNew = moveNoPromoteMark(cs, "sente", { row: 6, col: 0 }, { row: 5, col: 0 });
    expect(csNew.noPromoteMarks.sente).not.toBe(cs.noPromoteMarks.sente); // 新参照
    expect(csNew.noPromoteMarks.sente).toHaveLength(cs.noPromoteMarks.sente.length); // length 不変
    const updated = updateCardDigest(prev, cs, csNew);
    expect(updated.noPromoteMarks!.sente).toEqual([{ row: 5, col: 0 }]); // 追従後の座標
  });

  it("drawProgress 変化 → drawProgressDelta 更新、他流用", () => {
    const cs = createInitialCardState(SAMPLE_DECK);
    const prev = computeCardDigest(cs);
    const csNew = clone(cs);
    csNew.drawProgress.sente = 3;
    csNew.drawProgress.gote = 1;
    const updated = updateCardDigest(prev, cs, csNew);
    expect(updated.drawProgressDelta).toBe(2);
    expect(updated.manaAbsolute).toBe(prev.manaAbsolute);
  });

  it("複数フィールド同時変化 (playCard 想定: mana-2 + hand-1) も正しく更新", () => {
    const cs = createInitialCardState(SAMPLE_DECK);
    const prev = computeCardDigest(cs);
    const csNew = clone(cs);
    csNew.mana.sente = cs.mana.sente - 2;
    csNew.hand.sente.pop(); // hand -1
    const updated = updateCardDigest(prev, cs, csNew);
    expect(updated.manaDelta).toBe(csNew.mana.sente - csNew.mana.gote);
    expect(updated.manaAbsolute).toEqual({ sente: csNew.mana.sente, gote: cs.mana.gote });
    expect(updated.handValueDelta).toBeLessThan(prev.handValueDelta);
    // 変化なしフィールドは流用
    expect(updated.trap).toBe(prev.trap);
    expect(updated.drawProgressDelta).toBe(prev.drawProgressDelta);
  });

  it("manaCap は常に prev 流用 (現状静的 MANA_CAP=20 固定)", () => {
    const cs = createInitialCardState(SAMPLE_DECK);
    const prev = computeCardDigest(cs);
    const csNew = clone(cs);
    csNew.mana.sente += 5; // 別フィールド変化
    const updated = updateCardDigest(prev, cs, csNew);
    expect(updated.manaCap).toBe(prev.manaCap);
  });
});

describe("PR3-2 updateCardDigest 等価性 fixture (= computeCardDigest と byte-level 一致)", () => {
  // cardState の deep clone (再利用)
  function clone(cs: ReturnType<typeof createInitialCardState>) {
    return {
      mana: { sente: cs.mana.sente, gote: cs.mana.gote },
      manaCap: cs.manaCap,
      hand: {
        sente: [...cs.hand.sente],
        gote: [...cs.hand.gote],
      },
      deck: {
        sente: [...cs.deck.sente],
        gote: [...cs.deck.gote],
      },
      graveyard: {
        sente: [...cs.graveyard.sente],
        gote: [...cs.graveyard.gote],
      },
      trap: { sente: cs.trap.sente, gote: cs.trap.gote },
      pendingCard: cs.pendingCard,
      lastTurnStartedAt: {
        sente: cs.lastTurnStartedAt.sente,
        gote: cs.lastTurnStartedAt.gote,
      },
      noPromoteMarks: {
        sente: [...cs.noPromoteMarks.sente],
        gote: [...cs.noPromoteMarks.gote],
      },
      drawProgress: {
        sente: cs.drawProgress.sente,
        gote: cs.drawProgress.gote,
      },
    };
  }

  // 各遷移シナリオ: (label, mutate) で prev → new を生成し、
  // updateCardDigest(computeCardDigest(prev), prev, new) === computeCardDigest(new)
  // を全フィールドで toEqual 検証する。
  const scenarios: {
    label: string;
    mutate: (cs: ReturnType<typeof clone>) => void;
  }[] = [
    {
      label: "no-op (deep clone のみ)",
      mutate: () => {},
    },
    {
      label: "draw 想定 (mana-2 + hand+1 + drawProgress reset)",
      mutate: (cs) => {
        cs.mana.sente -= 2;
        cs.hand.sente.push(cs.deck.sente.pop()!);
        cs.drawProgress.sente = 0;
      },
    },
    {
      label: "playCard 想定 (mana-2 + hand-1)",
      mutate: (cs) => {
        cs.mana.gote -= 2;
        cs.hand.gote.pop();
      },
    },
    {
      label: "トラップ設置 (sente: no_promote)",
      mutate: (cs) => {
        cs.mana.sente -= 3;
        cs.hand.sente.pop();
        cs.trap.sente = {
          instanceId: "ts-1",
          defId: "no_promote",
          owner: "sente",
        };
      },
    },
    {
      label: "トラップ発動 (gote: check_break → null + 持ち駒化は別フィールドで未反映)",
      mutate: (cs) => {
        cs.trap.gote = null;
      },
    },
    {
      label: "no_promote マーク追加 (両者)",
      mutate: (cs) => {
        cs.noPromoteMarks.sente.push({ row: 6, col: 0 });
        cs.noPromoteMarks.gote.push({ row: 2, col: 8 });
        cs.noPromoteMarks.gote.push({ row: 2, col: 7 });
      },
    },
    {
      label: "マナ上限到達 (両者 MANA_CAP)",
      mutate: (cs) => {
        cs.mana.sente = MANA_CAP;
        cs.mana.gote = MANA_CAP;
      },
    },
    {
      label: "drawProgress 増加 (両者)",
      mutate: (cs) => {
        cs.drawProgress.sente = 4;
        cs.drawProgress.gote = 2;
      },
    },
    {
      label: "複合: mana 変化 + hand 変化 + trap 設置 + マーク追加",
      mutate: (cs) => {
        cs.mana.sente -= 4;
        cs.mana.gote += 2;
        cs.hand.sente.push(cs.deck.sente.pop()!);
        cs.hand.gote.pop();
        cs.trap.sente = {
          instanceId: "ts-x",
          defId: "check_break",
          owner: "sente",
        };
        cs.noPromoteMarks.gote.push({ row: 3, col: 4 });
      },
    },
  ];

  for (const sc of scenarios) {
    it(`等価性: ${sc.label}`, () => {
      // prev = ある程度成熟した cardState (初期 + 既存トラップ + マークあり) で出発し、
      // sc.mutate で更にバリエーション。エッジを広く突くため。
      const prev = createInitialCardState(SAMPLE_DECK);
      prev.trap.gote = {
        instanceId: "tg-base",
        defId: "check_break",
        owner: "gote",
      };
      prev.noPromoteMarks.sente.push({ row: 6, col: 4 });

      const next = clone(prev);
      sc.mutate(next);

      // S4d-4: digest は gameState 非依存 (trap は defId 帯同のみ、価値は evaluate leaf 算出)。
      // updateCardDigest の増分結果が computeCardDigest 全再計算と完全一致する等価性を検証する
      // (prev は check_break トラップ defId を保有)。
      const prevDigest = computeCardDigest(prev);
      const updated = updateCardDigest(prevDigest, prev, next);
      const recomputed = computeCardDigest(next);

      // byte-level 一致 (各フィールドが厳密に同値)
      expect(updated).toEqual(recomputed);
      // 浮動小数点 (handValueDelta) も含めて完全一致を確認
      expect(updated.handValueDelta).toBe(recomputed.handValueDelta);
    });
  }
});

// PR3-3 C-8 (F-5 解消): evaluateCardDigest 数値固定 assert
// レビュー指摘: 既存テスト (L141-148) は expected を `(5-(-5)) * MANA_DELTA_COEFFICIENT` のように
// 実装定数で組み立てており、定数を変えても自動追従して regression を見逃す。
// 本セクションでは特定 input で実値を hard-code し、定数変更時に意図的に更新する運用に。
describe("PR3-3 C-8 evaluateCardDigest 数値固定 (F-5 解消)", () => {
  it("数値固定: 純粋 manaDelta のみ (sente +3 manaDelta、他全 0) → 30 cp", () => {
    // MANA_DELTA_COEFFICIENT=10 が変われば fail する
    const d: CardDigest = {
      manaDelta: 3,
      manaCap: MANA_CAP,
      handValueDelta: 0,
      drawProgressDelta: 0,
      trap: { sente: null, gote: null },
      noPromoteMarks: null,
      manaAbsolute: { sente: 10, gote: 7 }, // 両者しきい値以下で dead mana penalty=0
    };
    expect(evaluateCardDigest(d, CARD_SHOGI_VARIANT)).toBe(30);
  });

  it("S4d-4: trap defId は evaluateCardDigest に寄与しない (価値は evaluate leaf へ移行)", () => {
    // 旧 trapValueDelta スカラー加算を撤去。トラップ価値は evaluate の leaf で getCardValue(defId,
    // state, player) として board 由来算出する (digest スカラーには乗らない)。
    const d: CardDigest = {
      manaDelta: 0,
      manaCap: MANA_CAP,
      handValueDelta: 0,
      drawProgressDelta: 0,
      trap: { sente: "check_break", gote: null },
      noPromoteMarks: null,
      manaAbsolute: { sente: 10, gote: 10 },
    };
    expect(evaluateCardDigest(d, CARD_SHOGI_VARIANT)).toBe(0);
  });

  it("数値固定: 純粋 dead mana sente=20 (上限) → sente 過剰 4 で -4*4 = -16 cp", () => {
    // DEAD_MANA_THRESHOLD=16, DEAD_MANA_PENALTY_COEF=4 が変われば fail
    const d: CardDigest = {
      manaDelta: 0, // manaDelta は 0 にして dead mana 効果のみ抽出
      manaCap: MANA_CAP,
      handValueDelta: 0,
      drawProgressDelta: 0,
      trap: { sente: null, gote: null },
      noPromoteMarks: null,
      manaAbsolute: { sente: 20, gote: 16 }, // sente overflow=4, gote overflow=0
    };
    // (gote 0 - sente 4) * 4 = -16
    expect(evaluateCardDigest(d, CARD_SHOGI_VARIANT)).toBe(-16);
  });

  it("相対: manaDelta が増えれば evaluate も単調増加 (MANA_DELTA_COEFFICIENT > 0 の確認)", () => {
    const base: CardDigest = {
      manaDelta: 0,
      manaCap: MANA_CAP,
      handValueDelta: 0,
      drawProgressDelta: 0,
      trap: { sente: null, gote: null },
      noPromoteMarks: null,
      manaAbsolute: { sente: 10, gote: 10 },
    };
    const v0 = evaluateCardDigest(base, CARD_SHOGI_VARIANT);
    const v3 = evaluateCardDigest({ ...base, manaDelta: 3 }, CARD_SHOGI_VARIANT);
    const v5 = evaluateCardDigest({ ...base, manaDelta: 5 }, CARD_SHOGI_VARIANT);
    expect(v3).toBeGreaterThan(v0);
    expect(v5).toBeGreaterThan(v3);
  });
});
