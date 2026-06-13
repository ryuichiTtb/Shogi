// Issue #235 S4c-2a: card-zobrist computeCardFold の correctness テスト (誤 hit ゼロ + fold 網羅性)。
// TT key = boardHash ^ cardFold ゆえ、cardFold が「探索挙動を変える slice」を漏れなく区別し、
// 「探索無関係 slice (evalIrrelevant)」を同一視することを検証する (R-3 誤 hit 防止)。
import { describe, it, expect } from "vitest";
import { computeCardFold, CARD_IDS } from "../card-zobrist";
import { CARD_STATE_FOLD_POLICY } from "../tt-fold-policy";
import { MANA_CAP } from "../../cards/card-system-config";
import type { CardGameState, CardId, CardInstance } from "../../cards/types";

let _idSeq = 0;
function ci(defId: CardId): CardInstance {
  return { instanceId: `i${_idSeq++}`, defId };
}
function cs(over: Partial<CardGameState> = {}): CardGameState {
  return {
    mana: { sente: 10, gote: 10 },
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
const eq = (a: { lo: number; hi: number }, b: { lo: number; hi: number }) =>
  a.lo === b.lo && a.hi === b.hi;

describe("S4c-2a: computeCardFold 決定性", () => {
  it("同一 cardState は同一 fold を返す (決定的)", () => {
    const a = cs({ hand: { sente: [ci("pawn_return"), ci("mana_up")], gote: [] }, mana: { sente: 7, gote: 9 } });
    // 同内容を別インスタンスで再構築 (instanceId は異なるが defId 多重集合は同一)
    _idSeq = 0;
    const b = cs({ hand: { sente: [{ instanceId: "x", defId: "pawn_return" }, { instanceId: "y", defId: "mana_up" }], gote: [] }, mana: { sente: 7, gote: 9 } });
    expect(eq(computeCardFold(a), computeCardFold(b))).toBe(true);
  });
});

describe("S4c-2a: fold slice は key を変える (区別される)", () => {
  const base = cs();
  it("mana 差は別 key", () => {
    expect(eq(computeCardFold(base), computeCardFold(cs({ mana: { sente: 5, gote: 10 } })))).toBe(false);
  });
  it("hand defId 差は別 key (i: 異種カード)", () => {
    const a = cs({ hand: { sente: [ci("pawn_return")], gote: [] } });
    const b = cs({ hand: { sente: [ci("mana_up")], gote: [] } });
    expect(eq(computeCardFold(a), computeCardFold(b))).toBe(false);
  });
  it("hand 枚数差は別 key (同 defId 1 vs 2)", () => {
    const a = cs({ hand: { sente: [ci("pawn_return")], gote: [] } });
    const b = cs({ hand: { sente: [ci("pawn_return"), ci("pawn_return")], gote: [] } });
    expect(eq(computeCardFold(a), computeCardFold(b))).toBe(false);
  });
  it("hand は多重集合 = 順序非依存で同一 key", () => {
    const a = cs({ hand: { sente: [ci("pawn_return"), ci("mana_up")], gote: [] } });
    const b = cs({ hand: { sente: [ci("mana_up"), ci("pawn_return")], gote: [] } });
    expect(eq(computeCardFold(a), computeCardFold(b))).toBe(true);
  });
  it("trap defId 差は別 key", () => {
    const a = cs({ trap: { sente: { instanceId: "t", defId: "check_break", owner: "sente" }, gote: null } });
    const b = cs({ trap: { sente: { instanceId: "t", defId: "no_promote", owner: "sente" }, gote: null } });
    expect(eq(computeCardFold(a), computeCardFold(b))).toBe(false);
    // trap あり vs なしも別 key
    expect(eq(computeCardFold(base), computeCardFold(a))).toBe(false);
  });
  it("noPromoteMarks の position 差は別 key (ii: count 同じでも座標違いは区別)", () => {
    const a = cs({ noPromoteMarks: { sente: [{ row: 2, col: 3 }], gote: [] } });
    const b = cs({ noPromoteMarks: { sente: [{ row: 4, col: 5 }], gote: [] } });
    expect(eq(computeCardFold(a), computeCardFold(b))).toBe(false); // count 1 同士、座標違い
  });
  it("drawProgress 差は別 key", () => {
    expect(eq(computeCardFold(base), computeCardFold(cs({ drawProgress: { sente: 2, gote: 0 } })))).toBe(false);
  });
  it("プレイヤー対称性: sente の差と gote の差は別 key (sente/gote を取り違えない)", () => {
    const a = cs({ mana: { sente: 5, gote: 10 } });
    const b = cs({ mana: { sente: 10, gote: 5 } });
    expect(eq(computeCardFold(a), computeCardFold(b))).toBe(false);
  });
});

describe("S4c-2a: deck は foldLength (length のみ区別)", () => {
  it("deck length 差は別 key (v)", () => {
    const a = cs({ deck: { sente: [ci("pawn_return")], gote: [] } });
    const b = cs({ deck: { sente: [ci("pawn_return"), ci("mana_up")], gote: [] } });
    expect(eq(computeCardFold(a), computeCardFold(b))).toBe(false);
  });
  it("deck 内容差・同 length は同一 key (iv)", () => {
    const a = cs({ deck: { sente: [ci("pawn_return"), ci("mana_up")], gote: [] } });
    const b = cs({ deck: { sente: [ci("check_break"), ci("no_promote")], gote: [] } });
    expect(eq(computeCardFold(a), computeCardFold(b))).toBe(true);
  });
});

describe("S4c-2a: evalIrrelevant slice は key を変えない (同一視)", () => {
  const base = cs();
  it("graveyard 差は同一 key (iii)", () => {
    const g = cs({ graveyard: { sente: [ci("pawn_return"), ci("mana_up")], gote: [ci("check_break")] } });
    expect(eq(computeCardFold(base), computeCardFold(g))).toBe(true);
  });
  it("manaCap 差は同一 key", () => {
    expect(eq(computeCardFold(base), computeCardFold(cs({ manaCap: MANA_CAP + 5 })))).toBe(true);
  });
  it("pendingCard 差は同一 key", () => {
    const p = cs({ pendingCard: { instance: ci("pawn_return"), player: "sente", phase: "confirm" } });
    expect(eq(computeCardFold(base), computeCardFold(p))).toBe(true);
  });
  it("lastTurnStartedAt 差は同一 key (探索 spectatorMode=true 前提)", () => {
    expect(eq(computeCardFold(base), computeCardFold(cs({ lastTurnStartedAt: { sente: 12345, gote: 67890 } })))).toBe(true);
  });
});

describe("S4c-2a: fold 網羅性ガード (CARD_STATE_FOLD_POLICY との突き合わせ)", () => {
  it("CARD_IDS は CardId union を網羅 (hand/trap キー表の次元)", () => {
    // CARD_STATE_FOLD_POLICY のキーは CardGameState slice 名であって CardId ではないが、
    // CARD_IDS の網羅は computeCardFold の hand/trap が全 defId を区別する前提。
    // CardId 追加時にここが落ちるよう件数を pin (定義追加を強制検知)。
    expect(CARD_IDS.length).toBe(7);
    expect(new Set(CARD_IDS).size).toBe(CARD_IDS.length); // 重複なし
  });

  it("fold/foldLength の全 slice を computeCardFold が区別する (網羅性)", () => {
    const base = cs();
    // 各 fold/foldLength slice に「key を変える変異」を与え、key 変化を確認。
    const mutators: Partial<Record<keyof CardGameState, (s: CardGameState) => CardGameState>> = {
      mana: (s) => ({ ...s, mana: { sente: 3, gote: s.mana.gote } }),
      hand: (s) => ({ ...s, hand: { sente: [ci("pawn_return")], gote: s.hand.gote } }),
      trap: (s) => ({ ...s, trap: { sente: { instanceId: "t", defId: "check_break", owner: "sente" }, gote: s.trap.gote } }),
      noPromoteMarks: (s) => ({ ...s, noPromoteMarks: { sente: [{ row: 1, col: 1 }], gote: s.noPromoteMarks.gote } }),
      drawProgress: (s) => ({ ...s, drawProgress: { sente: 3, gote: s.drawProgress.gote } }),
      deck: (s) => ({ ...s, deck: { sente: [ci("pawn_return")], gote: s.deck.gote } }),
    };
    for (const key of Object.keys(CARD_STATE_FOLD_POLICY) as (keyof CardGameState)[]) {
      const policy = CARD_STATE_FOLD_POLICY[key];
      if (policy === "fold" || policy === "foldLength") {
        const mutate = mutators[key];
        expect(mutate, `fold slice "${key}" に変異 mutator が無い (computeCardFold 反映漏れ?)`).toBeDefined();
        if (mutate) {
          expect(eq(computeCardFold(base), computeCardFold(mutate(base)))).toBe(false);
        }
      }
    }
  });

  it("evalIrrelevant の全 slice を computeCardFold が無視する (網羅性)", () => {
    const base = cs();
    const mutators: Partial<Record<keyof CardGameState, (s: CardGameState) => CardGameState>> = {
      graveyard: (s) => ({ ...s, graveyard: { sente: [ci("pawn_return")], gote: s.graveyard.gote } }),
      manaCap: (s) => ({ ...s, manaCap: s.manaCap + 5 }),
      pendingCard: (s) => ({ ...s, pendingCard: { instance: ci("pawn_return"), player: "sente", phase: "confirm" } }),
      lastTurnStartedAt: (s) => ({ ...s, lastTurnStartedAt: { sente: 999, gote: s.lastTurnStartedAt.gote } }),
    };
    for (const key of Object.keys(CARD_STATE_FOLD_POLICY) as (keyof CardGameState)[]) {
      if (CARD_STATE_FOLD_POLICY[key] === "evalIrrelevant") {
        const mutate = mutators[key];
        expect(mutate, `evalIrrelevant slice "${key}" の mutator が無い`).toBeDefined();
        if (mutate) {
          expect(eq(computeCardFold(base), computeCardFold(mutate(base)))).toBe(true);
        }
      }
    }
  });
});
