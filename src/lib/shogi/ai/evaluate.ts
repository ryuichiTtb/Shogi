import type { GameState, RuleVariant } from "../types";
import { STANDARD_VARIANT } from "../variants/standard";
import { evaluateCardDigest, type CardDigest } from "./cards/digest";

import { PIECE_VALUES, computeMaterial } from "./evaluators/material";
import { computeHandValue } from "./evaluators/hand-value";
import { evaluateKingSafety } from "./evaluators/king-safety";
import { evaluateRookFiles } from "./evaluators/piece-activity";
import { evaluatePieceSafety } from "./evaluators/piece-safety";
import { evaluatePromotionThreats } from "./evaluators/promotion-threat";

// 局面評価関数 (合成ルート)
// 正の値 = 先手有利、負の値 = 後手有利
//
// Issue #193 / PR2: 936 行に同居していた評価ロジック (material / pst / hand-value /
// king-safety / piece-activity / promotion-threat / piece-safety) を evaluators/ 配下の
// 役割別モジュールへ分離した。本ファイルは各モジュールを束ねる「合成ルート」と
// なり、`evaluate` / `evaluateWithBreakdown` / `scoreMoveForOrdering` を組み立てる。
//
// 既存 consumer (search.ts / engine.ts / テスト等) の import 互換のため、各
// モジュールが公開する評価部品も後方互換で re-export する。

// --- 後方互換 re-export (PR1c で export 化した部品を含む) ---
// 既存 import パス `./evaluate` を壊さないため、分離先モジュールの公開 API を
// 本ファイルから再公開する。
export { evaluateKingSafety, evaluateCastle } from "./evaluators/king-safety";
export { evaluateRookFiles } from "./evaluators/piece-activity";
export { evaluatePieceSafety, getLeastAttackerValue } from "./evaluators/piece-safety";
export { evaluatePromotionThreats } from "./evaluators/promotion-threat";

// メイン評価関数
//
// Issue #193 / PR1d-1: cardDigest? optional 引数を追加 (W-1 / W-3 反映)。
// - 未渡時は cardDigest 加算 skip (= 既存挙動完全保持、PR1c の 1000 局面 evaluate fixture の
//   byte-level equality を維持)
// - 渡時 + variant.id === "card-shogi" のときのみ evaluateCardDigest を加算 (1 op、
//   ホットパス影響無視可、root スカラー方式で再計算を構造的に禁止)
export function evaluate(
  state: GameState,
  variant: RuleVariant = STANDARD_VARIANT,
  cardDigest?: CardDigest,
): number {
  if (state.status === "checkmate") {
    return state.winner === "sente" ? 100000 : -100000;
  }
  if (state.status !== "active") return 0;

  let score = 0;

  // 盤上の駒の評価 (駒価値 + 配置ボーナス)
  score += computeMaterial(state, variant);

  // 手駒の評価
  score += computeHandValue(state);

  // 玉の安全度（囲いパターン込み）
  score += evaluateKingSafety(state, "sente", variant);
  score -= evaluateKingSafety(state, "gote", variant);

  // 飛車オープンファイル
  score += evaluateRookFiles(state, "sente", variant);
  score -= evaluateRookFiles(state, "gote", variant);

  // 駒安全性（タダ取り・駒損交換の検知）
  score += evaluatePieceSafety(state, "sente", variant);
  score -= evaluatePieceSafety(state, "gote", variant);

  // 成り込み脅威
  score += evaluatePromotionThreats(state, "sente", variant);
  score -= evaluatePromotionThreats(state, "gote", variant);

  // テンポボーナス（手番側に小さなボーナス）
  score += state.currentPlayer === "sente" ? 15 : -15;

  // Issue #193 / PR1d-1: cardDigest 加算 (W-1 / W-3 反映)。
  // cardDigest 未渡時は加算 skip → byte-level equality 保持。
  // evaluateCardDigest 側で variant.id === "card-shogi" のガード済 (W-3 二重ガード)。
  if (cardDigest !== undefined) {
    score += evaluateCardDigest(cardDigest, variant);
  }

  return score;
}

// Issue #193 / PR1c (Phase 4 足場): debug 専用の評価値内訳ヘルパ。
//
// 用途:
// - 親計画 md L386 PR2 セクションの「breakdown を本番有効化 (debug build /
//   DEBUG_AI_EVAL env で出力)」の足場
// - debug 時に「どの成分でどれだけ評価が動いたか」を可視化する
// - 本番探索ホットパス (negamax / quiescence 内の評価呼出) では呼ばれない
//   (= 計算コスト 2 倍化を許容)
//
// 設計原則:
// - `evaluate` 本体と **完全に同じ計算順序** で各成分を加算する
// - `total === evaluate(state, variant)` を 1000 局面 fixture で検証する
// - 1 cp ずれ厳禁 (PR1c の最重要 DoD)
//
// 詳細: docs/plans/issue-193-pr1b-pr1c.md「## PR1c 実装ステップ」参照。
export interface EvaluationBreakdown {
  total: number;
  material: number; // 盤上駒価値 + PST
  hand: number; // 手駒価値
  kingSafety: number; // 玉安全度差 (sente - gote)
  rookFiles: number; // 飛車オープンファイル差
  pieceSafety: number; // タダ取り・損な交換差
  promotionThreats: number; // 成り込み脅威差
  tempo: number; // 手番ボーナス (currentPlayer == sente ? +15 : -15)
}

export function evaluateWithBreakdown(
  state: GameState,
  variant: RuleVariant = STANDARD_VARIANT
): EvaluationBreakdown {
  // checkmate / 非 active のとき evaluate は ±100000 / 0 を返す。breakdown では
  // 内訳を持たないため total に統合した値だけ返し、他成分は 0 とする。
  if (state.status === "checkmate") {
    const total = state.winner === "sente" ? 100000 : -100000;
    return {
      total,
      material: 0,
      hand: 0,
      kingSafety: 0,
      rookFiles: 0,
      pieceSafety: 0,
      promotionThreats: 0,
      tempo: 0,
    };
  }
  if (state.status !== "active") {
    return {
      total: 0,
      material: 0,
      hand: 0,
      kingSafety: 0,
      rookFiles: 0,
      pieceSafety: 0,
      promotionThreats: 0,
      tempo: 0,
    };
  }

  // 盤上の駒の評価 (material) — evaluate と同一の computeMaterial を共有し、
  // 計算順序・係数・丸めの一致を構造的に担保する。
  const material = computeMaterial(state, variant);

  // 手駒の評価 (hand) — evaluate と同一の computeHandValue を共有する。
  const hand = computeHandValue(state);

  // 玉の安全度
  const kingSafety =
    evaluateKingSafety(state, "sente", variant) -
    evaluateKingSafety(state, "gote", variant);

  // 飛車オープンファイル
  const rookFiles =
    evaluateRookFiles(state, "sente", variant) -
    evaluateRookFiles(state, "gote", variant);

  // 駒安全性
  const pieceSafety =
    evaluatePieceSafety(state, "sente", variant) -
    evaluatePieceSafety(state, "gote", variant);

  // 成り込み脅威
  const promotionThreats =
    evaluatePromotionThreats(state, "sente", variant) -
    evaluatePromotionThreats(state, "gote", variant);

  // テンポボーナス
  const tempo = state.currentPlayer === "sente" ? 15 : -15;

  const total =
    material + hand + kingSafety + rookFiles + pieceSafety + promotionThreats + tempo;

  return {
    total,
    material,
    hand,
    kingSafety,
    rookFiles,
    pieceSafety,
    promotionThreats,
    tempo,
  };
}

// 評価値に基づく手のソート（alpha-beta探索のための手の順序付け）
export function scoreMoveForOrdering(move: import("../types").Move): number {
  let score = 0;

  // 取り駒優先
  if (move.captured) {
    score += PIECE_VALUES[move.captured] ?? 0;
    score -= (PIECE_VALUES[move.piece] ?? 0) * 0.1;
  }

  // 成り優先
  if (move.promote) score += 200;

  return score;
}
