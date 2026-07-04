// カード行動診断の純粋ロジック (Issue #245 Stage 2 P2-2b)。
//
// World 探索の rootActionScores (root 全 TurnAction の深読みスコア、search.ts:552) から
// 「カード手 (playCard) が駒指し (move) より高評価されているか」の gap を取り出す。
// 過大評価 (Stage 1 で特定した pieceSafety +85 による無意味な歩戻し) が学習評価で
// 解消したかを、hand-eval / learned-eval の gap 比較で診断するための素材。
//
// ★符号・視点 (P2-2b M1 MINOR-1): rootActionScores[].score は -negamaxWorld = 着手側
//   (手番プレイヤー) 視点であり先手絶対 cp ではない。gap は同一探索呼出・同一 root ノード内の
//   2 スコアの差ゆえ両者の手番視点が揃い、後手番局面でも「その手番にとって card が move より
//   良いか」を正しく表す。よって複数局面の集計は "その手番から見た gap" のまま行う (絶対視点への
//   符号反転は不要・むしろ誤り)。
//
// React / DB / AI ライブラリ非依存 (rootActionScores 配列を受け取るだけ)。テストはダミー配列で
// 端境 (card 無し / move 無し / draw 混在 / tie) を決定的に検証する (#109 疎結合)。
//
// 設計正本: docs/plans/issue-245-p2-2b-verification.md §3.1

import type { TurnAction } from "@/lib/shogi/kernel/turn-action-types";

export interface CardGapResult {
  bestMoveScore: number | null; // move アクション中の最大スコア (無ければ null)
  bestCardScore: number | null; // playCard アクション中の最大スコア (無ければ null)
  bestDrawScore: number | null; // draw アクションのスコア (無ければ null)
  // gap = カード/ドローが move よりどれだけ高評価か (>0 = カード/ドローが最善視 = 過大評価の疑い)。
  cardGap: number | null; // bestCardScore - bestMoveScore (両方非 null のとき)
  drawGap: number | null; // bestDrawScore - bestMoveScore (両方非 null のとき)
  topKind: "move" | "playCard" | "draw" | null; // 全アクション中の argmax の種別 (strict >、先勝ち)
  topCardDefId: string | null; // 最善 playCard の defId (どのカードが過大評価かの内訳)
  counts: { move: number; playCard: number; draw: number };
}

// rootActionScores から move/playCard/draw 別の最善スコアと gap を取り出す。
export function computeCardGap(
  rootActionScores: { action: TurnAction; score: number }[],
): CardGapResult {
  let bestMoveScore: number | null = null;
  let bestCardScore: number | null = null;
  let bestDrawScore: number | null = null;
  let topCardDefId: string | null = null;
  let topKind: CardGapResult["topKind"] = null;
  let topScore = -Infinity;
  const counts = { move: 0, playCard: 0, draw: 0 };

  for (const { action, score } of rootActionScores) {
    switch (action.kind) {
      case "move":
        counts.move += 1;
        if (bestMoveScore === null || score > bestMoveScore) bestMoveScore = score;
        break;
      case "playCard":
        counts.playCard += 1;
        if (bestCardScore === null || score > bestCardScore) {
          bestCardScore = score;
          topCardDefId = action.defId;
        }
        break;
      case "draw":
        counts.draw += 1;
        if (bestDrawScore === null || score > bestDrawScore) bestDrawScore = score;
        break;
    }
    // 全アクション中の argmax (strict > = 先に出た同点を保持、search の argmax と同規約)。
    if (score > topScore) {
      topScore = score;
      topKind = action.kind;
    }
  }

  return {
    bestMoveScore,
    bestCardScore,
    bestDrawScore,
    cardGap:
      bestCardScore !== null && bestMoveScore !== null ? bestCardScore - bestMoveScore : null,
    drawGap:
      bestDrawScore !== null && bestMoveScore !== null ? bestDrawScore - bestMoveScore : null,
    topKind,
    topCardDefId,
    counts,
  };
}

export interface CardGapAggregate {
  n: number; // 集計した局面数
  cardPreferredFrac: number; // cardGap > 0 の割合 (card が move より高評価な局面の割合)
  drawPreferredFrac: number; // drawGap > 0 の割合
  meanCardGap: number | null; // cardGap を持つ局面の平均 (card 無し局面は除外)
  meanBestMoveScore: number | null; // bestMoveScore の平均 (move 側が鈍ったか切り分け用)
  topKindCounts: { move: number; playCard: number; draw: number }; // argmax の種別分布
}

// 複数局面の CardGapResult を集計する (hand/learned の分布比較に使う)。
// ★手番視点のまま集計してよい (MINOR-1)。局面ごとに視点は揃っている。
export function aggregateCardGap(results: CardGapResult[]): CardGapAggregate {
  const n = results.length;
  let cardPreferred = 0;
  let drawPreferred = 0;
  let cardGapSum = 0;
  let cardGapCount = 0;
  let moveScoreSum = 0;
  let moveScoreCount = 0;
  const topKindCounts = { move: 0, playCard: 0, draw: 0 };

  for (const r of results) {
    if (r.cardGap !== null) {
      cardGapSum += r.cardGap;
      cardGapCount += 1;
      if (r.cardGap > 0) cardPreferred += 1;
    }
    if (r.drawGap !== null && r.drawGap > 0) drawPreferred += 1;
    if (r.bestMoveScore !== null) {
      moveScoreSum += r.bestMoveScore;
      moveScoreCount += 1;
    }
    if (r.topKind !== null) topKindCounts[r.topKind] += 1;
  }

  return {
    n,
    cardPreferredFrac: n > 0 ? cardPreferred / n : 0,
    drawPreferredFrac: n > 0 ? drawPreferred / n : 0,
    meanCardGap: cardGapCount > 0 ? cardGapSum / cardGapCount : null,
    meanBestMoveScore: moveScoreCount > 0 ? moveScoreSum / moveScoreCount : null,
    topKindCounts,
  };
}
