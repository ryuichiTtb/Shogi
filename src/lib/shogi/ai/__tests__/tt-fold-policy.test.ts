// Issue #235 S4b-1b: CARD_STATE_FOLD_POLICY の網羅性ガード。
// CardGameState への slice 追加時に分類漏れを検出する (Record 型強制 = コンパイル時の第一防御 +
// 本テスト = 実行時に実 CardGameState インスタンスとキー集合を突き合わせる第二防御)。
import { describe, it, expect } from "vitest";
import { CARD_STATE_FOLD_POLICY, type FoldPolicy } from "../tt-fold-policy";
import { createInitialCardState } from "@/lib/shogi/cards/state";

describe("S4b: CARD_STATE_FOLD_POLICY 網羅性", () => {
  it("実 CardGameState の全 slice が policy に宣言され、余剰キーもない", () => {
    const cs = createInitialCardState([]);
    const stateKeys = Object.keys(cs).sort();
    const policyKeys = Object.keys(CARD_STATE_FOLD_POLICY).sort();
    expect(policyKeys).toEqual(stateKeys);
  });

  it("各 policy 値は FoldPolicy の 3 値のいずれか", () => {
    const allowed: ReadonlySet<FoldPolicy> = new Set([
      "fold",
      "foldLength",
      "evalIrrelevant",
    ]);
    for (const [slice, policy] of Object.entries(CARD_STATE_FOLD_POLICY)) {
      expect(allowed.has(policy), `${slice} → ${policy}`).toBe(true);
    }
  });

  it("foldLength は deck 専用 (配列 length のみ畳む特例)", () => {
    const foldLengthKeys = Object.entries(CARD_STATE_FOLD_POLICY)
      .filter(([, policy]) => policy === "foldLength")
      .map(([slice]) => slice);
    expect(foldLengthKeys).toEqual(["deck"]);
  });

  it("確定分類の固定 (M1 確定表からのドリフト検出)", () => {
    expect(CARD_STATE_FOLD_POLICY).toEqual({
      mana: "fold",
      hand: "fold",
      trap: "fold",
      noPromoteMarks: "fold",
      drawProgress: "fold",
      deck: "foldLength",
      graveyard: "evalIrrelevant",
      manaCap: "evalIrrelevant",
      pendingCard: "evalIrrelevant",
      lastTurnStartedAt: "evalIrrelevant",
    });
  });
});
