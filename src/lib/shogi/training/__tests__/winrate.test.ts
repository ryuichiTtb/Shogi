import { describe, expect, it } from "vitest";

import { getWorldLegalActions } from "@/lib/shogi/ai/search";
import type { WorldState } from "@/lib/shogi/kernel/world-kernel";
import type { TurnAction } from "@/lib/shogi/kernel/turn-action-types";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";

import { bySide, playPair, runMatch, tally, type WinrateGameResult } from "../winrate";

const DECK = [
  { defId: "pawn_return" as const, count: 2 },
  { defId: "mana_up" as const, count: 2 },
];

// 常に最初の合法手 (move-only) を指す決定的ダミー AI (実 AI 非依存・高速、selfplay.test と同型)。
function firstMoveChooser(world: WorldState) {
  const actions = getWorldLegalActions(world, CARD_SHOGI_VARIANT, false);
  return actions[0] ?? null;
}

describe("bySide (手番別 chooser 合成)", () => {
  it("learnedSide の手番は learned、相手手番は opponent を呼ぶ", () => {
    // 参照等価で判別するため中身は問わない別オブジェクト 2 個。
    const learnedAction = { kind: "draw" } as TurnAction;
    const opponentAction = { kind: "draw" } as TurnAction;
    const chooser = bySide("sente", () => learnedAction, () => opponentAction);
    const w = {} as WorldState; // bySide は player のみ見る
    expect(chooser(w, "sente")).toBe(learnedAction);
    expect(chooser(w, "gote")).toBe(opponentAction);
  });

  it("learnedSide=gote なら分岐が逆になる", () => {
    const a = { kind: "draw" } as TurnAction;
    const b = { kind: "draw" } as TurnAction;
    const chooser = bySide("gote", () => a, () => b);
    const w = {} as WorldState;
    expect(chooser(w, "gote")).toBe(a);
    expect(chooser(w, "sente")).toBe(b);
  });
});

describe("playPair (先後入替ペア対局)", () => {
  it("2 局返り、learnedSide は sente/gote 各 1 (手番バイアス相殺)", () => {
    const results = playPair({
      learned: firstMoveChooser,
      opponent: firstMoveChooser,
      deckSpec: DECK,
      maxMoves: 6,
    });
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.learnedSide).sort()).toEqual(["gote", "sente"]);
    results.forEach((r) => {
      expect(["sente", "gote", "draw"]).toContain(r.winner);
      expect(r.moveCount).toBeGreaterThanOrEqual(0);
    });
  });
});

describe("runMatch", () => {
  it("N ペア = 2N 局", () => {
    const results = runMatch(3, {
      learned: firstMoveChooser,
      opponent: firstMoveChooser,
      deckSpec: DECK,
      maxMoves: 4,
    });
    expect(results).toHaveLength(6);
  });
});

describe("tally (勝率集計)", () => {
  it("勝/負/分・勝率[除外]・スコア率[0.5]・先後内訳を正しく集計", () => {
    const results: WinrateGameResult[] = [
      { learnedSide: "sente", winner: "sente", moveCount: 50 }, // win
      { learnedSide: "gote", winner: "sente", moveCount: 60 }, // loss (相手=sente 勝ち)
      { learnedSide: "sente", winner: "draw", moveCount: 200 }, // draw
      { learnedSide: "gote", winner: "gote", moveCount: 40 }, // win
    ];
    const t = tally(results);
    expect(t.games).toBe(4);
    expect(t.overall).toEqual({ wins: 2, losses: 1, draws: 1 });
    expect(t.winRateExclDraws).toBeCloseTo(2 / 3); // 2勝 / (2勝 + 1敗)
    expect(t.scoreRate).toBeCloseTo((2 + 0.5) / 4); // (2 + 0.5×1) / 4
    expect(t.drawRate).toBeCloseTo(1 / 4);
    expect(t.asSente).toEqual({ wins: 1, losses: 0, draws: 1 });
    expect(t.asGote).toEqual({ wins: 1, losses: 1, draws: 0 });
    expect(t.avgMoveCount).toBeCloseTo((50 + 60 + 200 + 40) / 4);
  });

  it("全局 draw なら winRateExclDraws は null (0 除算回避)、スコア率は 0.5", () => {
    const results: WinrateGameResult[] = [{ learnedSide: "sente", winner: "draw", moveCount: 200 }];
    const t = tally(results);
    expect(t.winRateExclDraws).toBeNull();
    expect(t.scoreRate).toBeCloseTo(0.5);
    expect(t.drawRate).toBeCloseTo(1);
  });

  it("空配列でも例外なし", () => {
    const t = tally([]);
    expect(t.games).toBe(0);
    expect(t.winRateExclDraws).toBeNull();
    expect(t.scoreRate).toBe(0);
    expect(t.avgMoveCount).toBe(0);
  });
});
