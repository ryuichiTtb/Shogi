import { describe, expect, it } from "vitest";

import { getWorldLegalActions } from "@/lib/shogi/ai/search";
import type { WorldState } from "@/lib/shogi/kernel/world-kernel";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";

import { playOneGame } from "../selfplay";

const DECK = [
  { defId: "pawn_return" as const, count: 2 },
  { defId: "mana_up" as const, count: 2 },
];

// 常に最初の合法手 (move-only) を指す決定的ダミー AI (実 AI 非依存・高速)。
function firstMoveChooser(world: WorldState) {
  const actions = getWorldLegalActions(world, CARD_SHOGI_VARIANT, false);
  return actions[0] ?? null;
}

describe("playOneGame", () => {
  it("ダミーAIで 1 局を回し、per-decision サンプルと勝敗ラベルを生成する", () => {
    const rec = playOneGame({
      chooseAction: firstMoveChooser,
      deckSpec: DECK,
      senteDifficulty: "beginner",
      goteDifficulty: "beginner",
      maxMoves: 12,
    });

    expect(rec.samples.length).toBeGreaterThan(0);
    expect(rec.samples.length).toBeLessThanOrEqual(12);
    rec.samples.forEach((s, i) => {
      expect(s.plyIndex).toBe(i);
      expect(s.action).toBeTruthy();
      expect(s.boardState).toBeTruthy();
      expect(s.cardState).toBeTruthy();
    });
    expect(rec.game.source).toBe("self_play");
    expect(rec.game.variantId).toBe(CARD_SHOGI_VARIANT.id);
    expect(["sente", "gote", "draw"]).toContain(rec.game.winner);
    expect(rec.game.deckSpecSente).toEqual(DECK);
  });

  it("chooseAction が即 null → 空の試合 (samples 0、引き分け)", () => {
    const rec = playOneGame({ chooseAction: () => null, deckSpec: DECK, maxMoves: 12 });
    expect(rec.samples).toHaveLength(0);
    expect(rec.game.winner).toBe("draw");
    expect(rec.game.finalStatus).toBe("active");
  });

  it("maxMoves でサンプル数が有界", () => {
    const rec = playOneGame({ chooseAction: firstMoveChooser, deckSpec: DECK, maxMoves: 4 });
    expect(rec.samples.length).toBeLessThanOrEqual(4);
  });
});
