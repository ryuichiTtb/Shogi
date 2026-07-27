import { describe, expect, it } from "vitest";

import { getWorldLegalActions } from "@/lib/shogi/ai/search";
import type { WorldState } from "@/lib/shogi/kernel/world-kernel";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";

import { playOneGame, replayToPly } from "../selfplay";

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

// Issue #245 教材多様化 段5: 分岐生成のためのリプレイ。
// 保存済みサンプルから直接復元すると positionHistory が無く千日手を検出できないため、
// 行動列を先頭から再生する必要がある (計画書 §2 B-3)。ここではその再生が
// 「各 ply で保存値と一致する」ことと「履歴が積まれる」ことを固定する。
describe("replayToPly (段5 分岐生成)", () => {
  // 決定的な chooser で 1 局作り、それを再生する。
  const record = playOneGame({
    chooseAction: (world) => {
      const actions = getWorldLegalActions(world, CARD_SHOGI_VARIANT, false);
      return actions.length > 0 ? actions[0] : null;
    },
    deckSpec: [{ defId: "pawn_return", count: 4 }],
    maxMoves: 12,
  });

  it("全 ply で保存値と一致する (突合が通る)", () => {
    expect(record.samples.length).toBeGreaterThan(2);
    for (let ply = 0; ply < record.samples.length; ply++) {
      const r = replayToPly(record, ply);
      expect(r.mismatchPly).toBeUndefined();
      expect(r.world).not.toBeNull();
      // 再生した局面が、その ply のサンプルと同じ手番・手数であること。
      expect(r.world!.gameState.currentPlayer).toBe(record.samples[ply].sideToMove);
      expect(r.world!.gameState.moveCount).toBe(record.samples[ply].moveCount);
    }
  });

  it("再生した局面は positionHistory を先頭から積んでいる (千日手が検出できる)", () => {
    const last = replayToPly(record, record.samples.length - 1);
    const g = last.world!.gameState;
    // 初期局面 1 + 指した手数ぶん = 分岐前の反復を漏れなく数えられる状態。
    expect(g.positionHistory.length).toBe(g.moveCount + 1);
  });

  it("カード状態が食い違う試合も弾く (盤に出ないドリフトを素通ししない)", () => {
    const broken = {
      ...record,
      samples: record.samples.map((s, i) => {
        if (i !== 2) return s;
        const cs = s.cardState as { mana: { sente: number; gote: number } };
        return { ...s, cardState: { ...cs, mana: { ...cs.mana, sente: cs.mana.sente + 5 } } };
      }),
    };
    const r = replayToPly(broken, broken.samples.length - 1);
    expect(r.world).toBeNull();
    expect(r.mismatchPly).toBe(2);
  });

  it("範囲外の ply は null", () => {
    expect(replayToPly(record, -1).world).toBeNull();
    expect(replayToPly(record, record.samples.length).world).toBeNull();
  });

  it("行動列が食い違う試合は mismatchPly を返して分岐に使わせない", () => {
    // 2 手目のサンプルの手番を反転させる = 再生結果と合わなくなる。
    const broken = {
      ...record,
      samples: record.samples.map((s, i) => {
        if (i !== 2) return s;
        const b = s.boardState as { currentPlayer: string };
        return {
          ...s,
          boardState: { ...b, currentPlayer: b.currentPlayer === "sente" ? "gote" : "sente" },
        };
      }),
    };
    const r = replayToPly(broken, broken.samples.length - 1);
    expect(r.world).toBeNull();
    expect(r.mismatchPly).toBe(2);
  });
});

// 分岐生成は「途中局面から指し継ぐ」ので、初期 world の差し替えと増分手数の上限が要る。
describe("playOneGame の initialWorld / maxAdditionalMoves (段5)", () => {
  const base = playOneGame({
    chooseAction: (world) => {
      const actions = getWorldLegalActions(world, CARD_SHOGI_VARIANT, false);
      return actions.length > 0 ? actions[0] : null;
    },
    deckSpec: [{ defId: "pawn_return", count: 4 }],
    maxMoves: 12,
  });

  it("initialWorld から指し継ぎ、maxAdditionalMoves で増分を打ち切る", () => {
    const mid = replayToPly(base, 4).world!;
    const startCount = mid.gameState.moveCount;
    const branched = playOneGame({
      chooseAction: (world) => {
        const actions = getWorldLegalActions(world, CARD_SHOGI_VARIANT, false);
        return actions.length > 0 ? actions[actions.length - 1] : null; // 別の手を選ぶ
      },
      deckSpec: [{ defId: "pawn_return", count: 4 }],
      initialWorld: mid,
      maxAdditionalMoves: 3,
    });
    // 分岐後のサンプルだけを持つ (前半は元対局が持っている)。
    expect(branched.samples[0].moveCount).toBe(startCount);
    expect(branched.game.moveCount).toBeLessThanOrEqual(startCount + 3);
    expect(branched.game.moveCount).toBeGreaterThan(startCount);
  });

  it("initialWorld 未指定なら従来どおり初期盤面から始まる (既存呼出は無改変)", () => {
    expect(base.samples[0].moveCount).toBe(0);
  });
});
