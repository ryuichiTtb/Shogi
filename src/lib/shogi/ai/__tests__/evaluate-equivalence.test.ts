// Issue #193 / PR1c (Phase 4 足場): evaluate の byte-level equality 検証。
//
// 設計意図:
// PR1c で `evaluate.ts` の 5 関数を export 化 + `evaluateWithBreakdown` を新設したが、
// 本体 `evaluate(state, variant)` の戻り値は **1 cp も変わらない** ことを最重要 DoD とする。
// 1000 局面 fixture (standard 800 + card-shogi 200) で byte-level equality を検証する。
//
// `evaluateWithBreakdown(state, variant).total === evaluate(state, variant)` も
// 同一 fixture で検証 (内訳合計が evaluate 本体と一致)。
//
// **本 fixture の用途と限界 (M-2 対応、第 4 次レビューで明確化)**:
//
// - 本 fixture は **PR1c 完成後の `evaluate`** で生成される (`npm run gen:fixture:evaluate`
//   実行時の `evaluate` の戻り値を JSON に固定保存)。test 実行時は同じ PR1c 版の
//   `evaluate` で fixture と一致を検証する。
// - そのため、**「PR1c の export 化前後で 1 cp も変わらない」を直接検証する fixture
//   ではない** (= 同じ実装で fixture 生成 + 検証なので、定義上必ず一致する構造)。
// - **「PR1c 前後の振る舞いキープ」の保証手段は手動の Vercel preview 動作確認**
//   (= AI 指し手が PR1a 時点と同じことを観察する) で担保される。
// - **本 fixture の主用途**: PR1c 完成時点の `evaluate` 戻り値を **baseline として固定**
//   し、後続 PR (PR1c-2 / PR1d / PR2) で `evaluate` の戻り値が変わった際のデグレを
//   自動検知すること。後続 PR で意図して評価式を変えた場合は `npm run gen:fixture:evaluate`
//   で再生成し、新基準として固定する。
//
// CI 取り扱い (M-5 対応):
// 本 fixture は CI 対象。1000 局面 × evaluate 呼出は数秒程度の見込み (bench 系
// = 3.5 秒 × 50 局面 × 4 難易度 ≒ 数分と比べて軽量)。実行時間が CI 全体で目立つ
// ようになった場合は別カテゴリ (`@perf` 等) に分離検討。
//
// fixture 生成: `npm run gen:fixture:evaluate` (Mulberry32 seed=42 deterministic)
// 詳細: docs/plans/issue-193-pr1b-pr1c.md「## 共通設計指針」「## PR1c 実装ステップ」参照。

import { describe, it, expect } from "vitest";
import { evaluate, evaluateWithBreakdown } from "../evaluate";
import { getVariantById } from "@/lib/shogi/variants";
import { deserializeGameState } from "@/lib/shogi/board";
import baseline from "./fixtures/evaluate-baseline.json";

interface FixtureEntry {
  id: string;
  category: string;
  state: unknown;
  variantId: string;
  expected: number;
}

interface FixturePayload {
  version: string;
  entries: FixtureEntry[];
}

const fixture = baseline as FixturePayload;

describe("evaluate: byte-level equality (PR1c 振る舞いキープ)", () => {
  it("1000 局面 fixture で evaluate(state, variant) が完全一致", () => {
    expect(fixture.entries.length).toBe(1000);

    for (const entry of fixture.entries) {
      const variant = getVariantById(entry.variantId);
      const state = deserializeGameState(entry.state);
      const actual = evaluate(state, variant);
      expect(
        actual,
        `mismatch at entry id="${entry.id}" category="${entry.category}" variant="${entry.variantId}"`,
      ).toBe(entry.expected);
    }
  });

  it("evaluateWithBreakdown(state, variant).total が evaluate と一致", () => {
    for (const entry of fixture.entries) {
      const variant = getVariantById(entry.variantId);
      const state = deserializeGameState(entry.state);
      const breakdown = evaluateWithBreakdown(state, variant);
      expect(
        breakdown.total,
        `breakdown.total != evaluate at entry id="${entry.id}" category="${entry.category}"`,
      ).toBe(entry.expected);
    }
  });
});

describe("evaluateWithBreakdown: 内訳合計と total の整合", () => {
  it("各成分の合計が total と一致 (active 局面)", () => {
    // status === "active" の局面 (= fixture の全 entry) でのみ成立。
    // checkmate / stalemate 等の特殊状態では breakdown 内訳は 0 で total のみが
    // ±100000 / 0 を返すため対象外 (本 fixture は active 局面のみ含む)。
    for (const entry of fixture.entries) {
      const variant = getVariantById(entry.variantId);
      const state = deserializeGameState(entry.state);
      const b = evaluateWithBreakdown(state, variant);
      const sum =
        b.material + b.hand + b.kingSafety + b.rookFiles + b.pieceSafety + b.promotionThreats + b.tempo;
      expect(
        sum,
        `breakdown sum != total at entry id="${entry.id}"`,
      ).toBe(b.total);
    }
  });

  it("tempo は ±15 (sente=15 / gote=-15)", () => {
    for (const entry of fixture.entries) {
      const variant = getVariantById(entry.variantId);
      const state = deserializeGameState(entry.state);
      const b = evaluateWithBreakdown(state, variant);
      expect([15, -15]).toContain(b.tempo);
    }
  });
});

describe("evaluate-equivalence: variant カバレッジ", () => {
  it("standard variant 800 局面 / card-shogi variant 200 局面の比率", () => {
    const standard = fixture.entries.filter((e) => e.variantId === "standard").length;
    const cardShogi = fixture.entries.filter((e) => e.variantId === "card-shogi").length;
    expect(standard).toBe(800);
    expect(cardShogi).toBe(200);
  });

  it("4 phase (opening / midgame / endgame / random) すべてに局面が含まれる", () => {
    const expectedCategories = new Set(["opening", "midgame", "endgame", "random"]);
    const actualCategories = new Set(fixture.entries.map((e) => e.category));
    expect(actualCategories).toEqual(expectedCategories);
  });
});
