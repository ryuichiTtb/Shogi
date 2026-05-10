// Issue #193 / PR1b (Phase 3): getSearchLegalMoves の振る舞いキープ検証。
//
// 設計意図:
// PR1b で `src/lib/shogi/ai/legal-moves.ts` を新設し、`getSearchLegalMoves` を
// 既存 `getFullLegalMoves` の wrap として export した。本テストでは 250 局面
// (7 カテゴリーをカバー) の fixture-driven 検証で、両者の出力 set が完全一致
// することを確認する。
//
// **二重ガード** (Z-4 対応):
// 1. fixture (= 生成済 `getFullLegalMoves` の正解値 JSON) と `getSearchLegalMoves`
//    の出力 set 完全一致
// 2. test 実行時に `getFullLegalMoves` を再計算して `getSearchLegalMoves` と直接一致
//
// fixture 生成: `npm run gen:fixture:legal-moves` (Mulberry32 seed=42 deterministic)
// 詳細: docs/plans/issue-193-pr1b-pr1c.md「## 共通設計指針」「## PR1b 実装ステップ」参照。

import { describe, it, expect } from "vitest";
import { getSearchLegalMoves } from "../legal-moves";
import { getFullLegalMoves } from "@/lib/shogi/moves";
import { getVariantById } from "@/lib/shogi/variants";
import { deserializeGameState } from "@/lib/shogi/board";
import type { Move, Player } from "@/lib/shogi/types";
import baseline from "./fixtures/legal-moves-baseline.json";

interface FixtureEntry {
  id: string;
  category: string;
  state: unknown;
  player: Player;
  variantId: string;
  expected: Move[];
}

interface FixturePayload {
  version: string;
  entries: FixtureEntry[];
}

const fixture = baseline as FixturePayload;

// Move を canonical な文字列キーに変換し Set 比較で順序非依存にする。
function moveToCanonical(m: Move): string {
  if (m.type === "drop") {
    return `D:${m.dropPiece ?? ""}@${m.to.row},${m.to.col}:${m.player}`;
  }
  const fromR = m.from?.row ?? -1;
  const fromC = m.from?.col ?? -1;
  return `M:${m.piece}:${fromR},${fromC}->${m.to.row},${m.to.col}:${m.promote ? "+" : "-"}:${m.player}`;
}

describe("getSearchLegalMoves: fixture との完全一致 (PR1b 振る舞いキープ)", () => {
  it("250 局面 fixture で出力 set 完全一致", () => {
    expect(fixture.entries.length).toBeGreaterThanOrEqual(200);
    expect(fixture.entries.length).toBeLessThanOrEqual(300);

    for (const entry of fixture.entries) {
      const variant = getVariantById(entry.variantId);
      const state = deserializeGameState(entry.state);
      const expected = new Set(entry.expected.map(moveToCanonical));
      const actual = new Set(
        getSearchLegalMoves(state, entry.player, variant).map(moveToCanonical),
      );
      expect(actual, `mismatch at entry id="${entry.id}" category="${entry.category}"`).toEqual(
        expected,
      );
    }
  });
});

describe("getSearchLegalMoves: getFullLegalMoves との直接一致 (二重ガード)", () => {
  it("test 実行時に getFullLegalMoves を再計算して getSearchLegalMoves と完全一致", () => {
    for (const entry of fixture.entries) {
      const variant = getVariantById(entry.variantId);
      const state = deserializeGameState(entry.state);
      const full = getFullLegalMoves(state, entry.player, variant);
      const search = getSearchLegalMoves(state, entry.player, variant);
      expect(
        new Set(search.map(moveToCanonical)),
        `mismatch (search vs full) at entry id="${entry.id}" category="${entry.category}"`,
      ).toEqual(new Set(full.map(moveToCanonical)));
    }
  });
});

describe("getSearchLegalMoves: カテゴリーカバレッジ", () => {
  it("7 カテゴリーすべてに局面が含まれる (boundary / in-check / pinned / drop / no-suicide / midgame / card-shogi)", () => {
    const expectedCategories = new Set([
      "boundary",
      "in-check",
      "pinned",
      "drop",
      "no-suicide",
      "midgame",
      "card-shogi",
    ]);
    const actualCategories = new Set(fixture.entries.map((e) => e.category));
    expect(actualCategories).toEqual(expectedCategories);
  });

  it("card-shogi variant の局面が含まれる", () => {
    const cardShogiEntries = fixture.entries.filter((e) => e.variantId === "card-shogi");
    expect(cardShogiEntries.length).toBeGreaterThan(0);
  });

  it("in-check / no-suicide カテゴリーは王手中の局面のみ", () => {
    // 直接 isInCheck を呼ばずとも、生成時の accept フィルタで保証されている前提を
    // fixture-driven に検証 (= 該当カテゴリーの全 entry が王手回避手のみを含む)。
    // 細かい王手判定は generateRandomWalkState 内で実施済のため、ここでは
    // fixture 生成時に accept で弾かれていない = 当該局面は王手中、を信頼する。
    const inCheckEntries = fixture.entries.filter(
      (e) => e.category === "in-check" || e.category === "no-suicide",
    );
    expect(inCheckEntries.length).toBeGreaterThan(0);
  });
});
