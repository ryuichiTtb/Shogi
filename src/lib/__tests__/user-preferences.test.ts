// Issue #250: 「盤デザインが未設定 (DB が NULL) なら常にコード既定を適用する」という
// セマンティクスを守る回帰テスト。
//
// ★DEFAULT_BOARD_LAYOUT_ID の具体値 ("dark-2" 等) は固定しない。#250 のバグは「定数の値が
// 間違っていた」ではなく「正しい定数値が DB 既定に上書きされていた」ものなので、値を pin する
// テストはバグを 1 件も検出できないうえ、正当な既定変更 (#250 の目的そのもの) を邪魔する。
// 代わりに不変条件 (既定はカタログに存在する / 未設定・未知値は既定に落ちる / schema が
// 既定値を持たない) を検証する。
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  BOARD_LAYOUTS,
  findBoardLayout,
} from "@/components/board-layout/options";
import {
  DEFAULT_BOARD_LAYOUT_ID,
  DEFAULT_CARD_BACK_STYLE,
  DEFAULT_THEME,
  isValidBoardLayoutId,
  normalizeBoardLayoutId,
  normalizeCardBackStyle,
  normalizeThemePreference,
} from "@/lib/user-preferences";

describe("盤デザイン設定の既定解決 (Issue #250)", () => {
  it("未設定 (null / undefined) は既定へ落ちる", () => {
    expect(isValidBoardLayoutId(null)).toBe(false);
    expect(isValidBoardLayoutId(undefined)).toBe(false);
    expect(normalizeBoardLayoutId(null)).toBe(DEFAULT_BOARD_LAYOUT_ID);
    expect(normalizeBoardLayoutId(undefined)).toBe(DEFAULT_BOARD_LAYOUT_ID);
  });

  it("カタログ外の値も既定へ落ちる (DB に残った旧 ID / 想定外の型の吸収)", () => {
    for (const bad of ["", "light-3", "dark", 2, { id: "dark-2" }]) {
      expect(isValidBoardLayoutId(bad)).toBe(false);
      expect(normalizeBoardLayoutId(bad)).toBe(DEFAULT_BOARD_LAYOUT_ID);
    }
  });

  it("採用 4 種はそのまま通す (明示選択を既定で潰さない)", () => {
    for (const layout of BOARD_LAYOUTS) {
      expect(isValidBoardLayoutId(layout.id)).toBe(true);
      expect(normalizeBoardLayoutId(layout.id)).toBe(layout.id);
    }
  });

  it("既定 ID は必ずカタログに存在する (既定を変えたのに素材/カタログ追加を忘れた事故の防止)", () => {
    expect(isValidBoardLayoutId(DEFAULT_BOARD_LAYOUT_ID)).toBe(true);
    expect(BOARD_LAYOUTS.some((l) => l.id === DEFAULT_BOARD_LAYOUT_ID)).toBe(true);
  });

  it("findBoardLayout は未知の ID に対して既定レイアウトを返す (フォールバックの一元化)", () => {
    expect(findBoardLayout("light-3").id).toBe(DEFAULT_BOARD_LAYOUT_ID);
    expect(findBoardLayout("").id).toBe(DEFAULT_BOARD_LAYOUT_ID);
  });

  it("findBoardLayout は既知の ID をそのまま解決する", () => {
    for (const layout of BOARD_LAYOUTS) {
      expect(findBoardLayout(layout.id)).toEqual(layout);
    }
  });
});

describe("theme / cardBackStyle の正規化", () => {
  it("未設定・不正値は既定へ落ち、妥当な値はそのまま通す", () => {
    expect(normalizeThemePreference(null)).toBe(DEFAULT_THEME);
    expect(normalizeThemePreference("sepia")).toBe(DEFAULT_THEME);
    expect(normalizeThemePreference("dark")).toBe("dark");

    expect(normalizeCardBackStyle(undefined)).toBe(DEFAULT_CARD_BACK_STYLE);
    expect(normalizeCardBackStyle("gold")).toBe(DEFAULT_CARD_BACK_STYLE);
    expect(normalizeCardBackStyle("kurenai")).toBe("kurenai");
  });
});

// #250 の真の再発経路 = schema.prisma に @default を戻す / nullable を外すこと。
// 純関数のテストでは検出できないので、その 1 行自体を固定する。
describe("prisma schema の boardLayout 定義 (Issue #250 の再発防止)", () => {
  it("boardLayout は nullable かつ @default を持たない", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const line = schema
      .split("\n")
      .find((l) => /^\s*boardLayout\s/.test(l));

    expect(line, "schema.prisma に boardLayout フィールドが見つからない").toBeDefined();
    // String? = 未設定を NULL で表現できる (= コード既定を常に適用できる)。
    expect(line).toMatch(/\bString\?/);
    // @default があると DB 既定が既存行・新規行を埋め続け、既定変更が誰にも届かなくなる。
    expect(line).not.toMatch(/@default/);
  });
});
