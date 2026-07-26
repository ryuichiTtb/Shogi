// Issue #245 教材多様化 段1: ラベルの同一性キー / レシピ正規化の pin。
//
// ここが壊れると「数十時間かけた採点を取りこぼす」「別レシピの成果を既済扱いして混ぜる」という
// 高コストな事故に直結するため、不変条件を明示的に固定する。

import { describe, expect, it } from "vitest";

import type { LabelMeta, TrainingGameRecord } from "@/lib/shogi/training/types";

import {
  CURRENT_LABEL_RECIPE_VERSION,
  LEGACY_RECIPE_KEY,
  labelIdentityKey,
  labelKeyHash,
  recipeKey,
} from "../label-identity";

const RECIPE: LabelMeta = {
  version: CURRENT_LABEL_RECIPE_VERSION,
  depth: 5,
  expandCards: false,
  expandDraw: false,
};

// 生 (未採点) の入力行に相当するレコード。ラベル付けはここへ searchScore と labelMeta を後付けする。
function rawRecord(): TrainingGameRecord {
  return {
    game: {
      source: "self_play",
      variantId: "card-shogi",
      senteDifficulty: "advanced",
      goteDifficulty: "advanced",
      winner: "sente",
      finalStatus: "checkmate",
      moveCount: 42,
    },
    samples: [
      {
        plyIndex: 0,
        moveCount: 0,
        sideToMove: "sente",
        boardState: { a: 1 },
        cardState: { b: 2 },
        action: { kind: "draw" },
        events: [],
      },
      {
        plyIndex: 1,
        moveCount: 1,
        sideToMove: "gote",
        boardState: { a: 2 },
        cardState: { b: 3 },
        action: { kind: "draw" },
        events: [],
      },
    ],
  };
}

// ラベル付け後の出力行に相当するレコード (searchScore + labelMeta が付いた状態)。
function labeledRecord(recipe: LabelMeta = RECIPE): TrainingGameRecord {
  const r = rawRecord();
  return {
    game: { ...r.game, labelMeta: recipe },
    samples: r.samples.map((s, i) => ({ ...s, searchScore: i === 0 ? 123 : null })),
  };
}

describe("labelIdentityKey (入力行 ↔ 出力行 の同一性)", () => {
  it("searchScore の有無・値では変わらない", () => {
    const raw = rawRecord();
    const scored = rawRecord();
    scored.samples[0].searchScore = 999;
    scored.samples[1].searchScore = null;
    expect(labelIdentityKey(scored)).toBe(labelIdentityKey(raw));
  });

  it("labelMeta の有無・内容では変わらない (= 採点済み出力行が入力行と突合できる)", () => {
    expect(labelIdentityKey(labeledRecord())).toBe(labelIdentityKey(rawRecord()));
    // 別レシピで採点し直した行も、内容キーとしては同一 (レシピ差は labelKeyHash が担当)。
    expect(labelIdentityKey(labeledRecord({ ...RECIPE, depth: 4 }))).toBe(
      labelIdentityKey(rawRecord()),
    );
  });

  it("試合メタの実内容が違えば変わる", () => {
    const other = rawRecord();
    other.game.moveCount = 43;
    expect(labelIdentityKey(other)).not.toBe(labelIdentityKey(rawRecord()));
  });

  it("サンプルの実内容が違えば変わる", () => {
    const other = rawRecord();
    other.samples[1].boardState = { a: 99 };
    expect(labelIdentityKey(other)).not.toBe(labelIdentityKey(rawRecord()));
  });
});

describe("recipeKey (レシピの正規形)", () => {
  it("未刻印 (undefined / null) は legacy", () => {
    expect(recipeKey(undefined)).toBe(LEGACY_RECIPE_KEY);
    expect(recipeKey(null)).toBe(LEGACY_RECIPE_KEY);
  });

  it("キーの並び順に依存しない", () => {
    const reordered: LabelMeta = {
      expandDraw: RECIPE.expandDraw,
      depth: RECIPE.depth,
      expandCards: RECIPE.expandCards,
      version: RECIPE.version,
    };
    expect(recipeKey(reordered)).toBe(recipeKey(RECIPE));
  });

  it("version / depth / expandCards / expandDraw のどれが違っても別キー", () => {
    const base = recipeKey(RECIPE);
    expect(recipeKey({ ...RECIPE, version: RECIPE.version + 1 })).not.toBe(base);
    expect(recipeKey({ ...RECIPE, depth: 4 })).not.toBe(base);
    expect(recipeKey({ ...RECIPE, expandCards: true })).not.toBe(base);
    expect(recipeKey({ ...RECIPE, expandDraw: true })).not.toBe(base);
  });

  it("JSON 往復で安定する (JSONL に書いて読み直しても同じキー)", () => {
    const roundTripped = JSON.parse(JSON.stringify(RECIPE)) as LabelMeta;
    expect(recipeKey(roundTripped)).toBe(recipeKey(RECIPE));
  });

  // ★LabelMeta にフィールドを足したのに recipeKey へ足し忘れると、意味の違うレシピが
  //   同一キーになり混在検査をすり抜ける。フィールド数を pin して足し忘れを機械的に検出する。
  it("LabelMeta の全フィールドが recipeKey に反映されている (足し忘れ検出)", () => {
    expect(Object.keys(RECIPE).length).toBe(4);
  });
});

describe("labelKeyHash (内容 × レシピ)", () => {
  it("同一内容・同一レシピなら一致する (入力行と採点済み出力行が同じキーになる)", () => {
    expect(labelKeyHash(rawRecord(), RECIPE)).toBe(
      labelKeyHash(labeledRecord(), labeledRecord().game.labelMeta),
    );
  });

  it("レシピが違えば別ハッシュ (= 旧レシピの成果を既済扱いしない)", () => {
    const base = labelKeyHash(rawRecord(), RECIPE);
    expect(labelKeyHash(rawRecord(), { ...RECIPE, depth: 4 })).not.toBe(base);
    expect(labelKeyHash(rawRecord(), { ...RECIPE, expandCards: true })).not.toBe(base);
    expect(labelKeyHash(rawRecord(), undefined)).not.toBe(base); // legacy 成果も別扱い
  });

  it("内容が違えば別ハッシュ", () => {
    const other = rawRecord();
    other.game.winner = "gote";
    expect(labelKeyHash(other, RECIPE)).not.toBe(labelKeyHash(rawRecord(), RECIPE));
  });

  it("16 hex 固定長", () => {
    expect(labelKeyHash(rawRecord(), RECIPE)).toMatch(/^[0-9a-f]{16}$/);
  });
});
