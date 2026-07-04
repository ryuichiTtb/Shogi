// Issue #245 Stage 2 P2-2b: カード行動診断の純粋ロジック (cardgap.ts) の端境検証。
// ダミー rootActionScores で card 無し / move 無し / draw 混在 / tie / 符号を決定的に確認する。

import { describe, it, expect } from "vitest";

import type { TurnAction } from "@/lib/shogi/kernel/turn-action-types";
import type { CardId } from "@/lib/shogi/cards/types";
import type { Move } from "@/lib/shogi/types";

import { computeCardGap, aggregateCardGap } from "../cardgap";

// ダミー move (座標は評価に無関係、gap ロジックは kind とスコアのみ見る)。
const mv = (from: [number, number], to: [number, number]): TurnAction => ({
  kind: "move",
  move: {
    type: "move",
    from: { row: from[0], col: from[1] },
    to: { row: to[0], col: to[1] },
    piece: "pawn",
    promote: false,
  } as Move,
});
const card = (defId: CardId): TurnAction => ({
  kind: "playCard",
  cardInstanceId: `i-${defId}`,
  defId,
});
const draw = (): TurnAction => ({ kind: "draw" });

const row = (action: TurnAction, score: number) => ({ action, score });

describe("computeCardGap", () => {
  it("move + playCard + draw 混在: 各最善スコアと gap を分離する", () => {
    const r = computeCardGap([
      row(mv([6, 0], [5, 0]), 30),
      row(mv([6, 1], [5, 1]), 50), // bestMove = 50
      row(card("pawn_return"), 88), // bestCard = 88 (card 最善)
      row(card("no_promote"), 40),
      row(draw(), 10), // bestDraw = 10
    ]);
    expect(r.bestMoveScore).toBe(50);
    expect(r.bestCardScore).toBe(88);
    expect(r.bestDrawScore).toBe(10);
    expect(r.cardGap).toBe(38); // 88 - 50 > 0 = card 過大評価の疑い
    expect(r.drawGap).toBe(-40); // 10 - 50
    expect(r.topKind).toBe("playCard");
    expect(r.topCardDefId).toBe("pawn_return");
    expect(r.counts).toEqual({ move: 2, playCard: 2, draw: 1 });
  });

  it("card 無し局面: bestCardScore/cardGap は null (move のみ)", () => {
    const r = computeCardGap([row(mv([6, 0], [5, 0]), 20), row(mv([6, 1], [5, 1]), 35)]);
    expect(r.bestMoveScore).toBe(35);
    expect(r.bestCardScore).toBeNull();
    expect(r.cardGap).toBeNull();
    expect(r.topKind).toBe("move");
    expect(r.topCardDefId).toBeNull();
  });

  it("move 無し局面 (詰み間際等): bestMoveScore/cardGap は null", () => {
    const r = computeCardGap([row(card("pawn_return"), 12), row(draw(), 5)]);
    expect(r.bestMoveScore).toBeNull();
    expect(r.bestCardScore).toBe(12);
    expect(r.cardGap).toBeNull(); // move が無いと gap は算出不能
    expect(r.topKind).toBe("playCard");
  });

  it("空配列: 全 null", () => {
    const r = computeCardGap([]);
    expect(r.bestMoveScore).toBeNull();
    expect(r.bestCardScore).toBeNull();
    expect(r.topKind).toBeNull();
    expect(r.counts).toEqual({ move: 0, playCard: 0, draw: 0 });
  });

  it("tie は strict > で先勝ち (argmax 規約): 同点 move と card は先に出た move を top に", () => {
    const r = computeCardGap([row(mv([6, 0], [5, 0]), 50), row(card("pawn_return"), 50)]);
    expect(r.cardGap).toBe(0); // 同点 = 過大評価ではない
    expect(r.topKind).toBe("move"); // 先に出た方 (strict >)
  });

  it("負スコア局面でも gap の符号は正しい (手番視点相対)", () => {
    // 後手不利局面などで全スコアが負でも、card - move の相対差は保たれる。
    const r = computeCardGap([row(mv([6, 0], [5, 0]), -120), row(card("pawn_return"), -90)]);
    expect(r.bestMoveScore).toBe(-120);
    expect(r.bestCardScore).toBe(-90);
    expect(r.cardGap).toBe(30); // -90 - (-120) = +30 > 0 = card がまだマシ = card 選好
    expect(r.topKind).toBe("playCard");
  });
});

describe("aggregateCardGap", () => {
  it("card 選好割合・平均 gap・move 側平均を集計する", () => {
    const results = [
      computeCardGap([row(mv([6, 0], [5, 0]), 50), row(card("pawn_return"), 88)]), // cardGap +38, card 選好
      computeCardGap([row(mv([6, 0], [5, 0]), 60), row(card("pawn_return"), 40)]), // cardGap -20, 非選好
      computeCardGap([row(mv([6, 0], [5, 0]), 20)]), // card 無し (gap 集計除外)
    ];
    const agg = aggregateCardGap(results);
    expect(agg.n).toBe(3);
    expect(agg.cardPreferredFrac).toBeCloseTo(1 / 3); // 3 局面中 1 局面が card 選好
    expect(agg.meanCardGap).toBeCloseTo((38 + -20) / 2); // card を持つ 2 局面の平均
    expect(agg.meanBestMoveScore).toBeCloseTo((50 + 60 + 20) / 3);
    expect(agg.topKindCounts.playCard).toBe(1);
    expect(agg.topKindCounts.move).toBe(2);
  });

  it("空集合: frac 0 / mean null", () => {
    const agg = aggregateCardGap([]);
    expect(agg.n).toBe(0);
    expect(agg.cardPreferredFrac).toBe(0);
    expect(agg.meanCardGap).toBeNull();
  });
});
