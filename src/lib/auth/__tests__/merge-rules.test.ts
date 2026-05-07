import { describe, expect, it } from "vitest";

import {
  isPristineGuestPreference,
  mergedCardCount,
  mergedStats,
  shouldUseGuestPreference,
} from "@/lib/auth/merge-rules";
import {
  DEFAULT_CARD_BACK_STYLE,
  DEFAULT_THEME,
} from "@/lib/user-preferences";

describe("guest account merge rules", () => {
  it("keeps the larger owned-card count instead of adding duplicates", () => {
    expect(mergedCardCount(undefined, 3)).toBe(3);
    expect(mergedCardCount(10, 3)).toBe(10);
    expect(mergedCardCount(2, 7)).toBe(7);
  });

  it("moves guest stats into account stats by summing outcomes and keeping max rating", () => {
    expect(
      mergedStats(
        { rating: 1510, wins: 2, losses: 3, draws: 4 },
        { rating: 1600, wins: 5, losses: 6, draws: 7 },
      ),
    ).toEqual({
      rating: 1600,
      wins: 7,
      losses: 9,
      draws: 11,
    });

    expect(
      mergedStats(null, { rating: 1420, wins: 1, losses: 2, draws: 3 }),
    ).toEqual({
      rating: 1500,
      wins: 1,
      losses: 2,
      draws: 3,
    });
  });

  it("uses the newer guest preference only when it is newer than account data", () => {
    const oldDate = new Date("2026-05-01T00:00:00.000Z");
    const newDate = new Date("2026-05-02T00:00:00.000Z");

    expect(shouldUseGuestPreference(null, { updatedAt: oldDate })).toBe(true);
    expect(
      shouldUseGuestPreference({ updatedAt: oldDate }, { updatedAt: newDate }),
    ).toBe(true);
    expect(
      shouldUseGuestPreference({ updatedAt: newDate }, { updatedAt: oldDate }),
    ).toBe(false);
  });

  it("classifies a guest preference as pristine only when both fields are at default", () => {
    // Issue #160: 別端末で保存済の account preference を、PC 新規アクセス時に
    // 自動生成された pristine ゲスト preference (DEFAULT_THEME / DEFAULT_CARD_BACK_STYLE)
    // で上書きしない判定。
    expect(
      isPristineGuestPreference({
        theme: DEFAULT_THEME,
        cardBackStyle: DEFAULT_CARD_BACK_STYLE,
      }),
    ).toBe(true);

    expect(
      isPristineGuestPreference({
        theme: "light",
        cardBackStyle: DEFAULT_CARD_BACK_STYLE,
      }),
    ).toBe(false);

    expect(
      isPristineGuestPreference({
        theme: DEFAULT_THEME,
        cardBackStyle: "kurenai",
      }),
    ).toBe(false);

    expect(
      isPristineGuestPreference({ theme: "dark", cardBackStyle: "kurenai" }),
    ).toBe(false);
  });
});
