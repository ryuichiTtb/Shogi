// Issue #245 派生 (エンジン選択): resolveWantsLearned の特性化。
// ★最重要 = env OFF (production) では request の engine が何であれ false = bolt-on 固定 (バイト不変)。

import { describe, it, expect } from "vitest";

import { resolveWantsLearned } from "../engine-flags";

describe("resolveWantsLearned", () => {
  it("env OFF (production): engine が何であれ常に false (無回帰の核心)", () => {
    expect(resolveWantsLearned(false, undefined)).toBe(false);
    expect(resolveWantsLearned(false, "legacy")).toBe(false);
    expect(resolveWantsLearned(false, "learned")).toBe(false);
  });

  it("env ON (Preview): 未指定 / learned は学習エンジン (後方互換 = 現 Preview 挙動)", () => {
    expect(resolveWantsLearned(true, undefined)).toBe(true);
    expect(resolveWantsLearned(true, "learned")).toBe(true);
  });

  it("env ON + legacy 明示指定のみ旧版 bolt-on へ", () => {
    expect(resolveWantsLearned(true, "legacy")).toBe(false);
  });
});
