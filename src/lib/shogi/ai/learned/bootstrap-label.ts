// Issue #245 Stage 2 (search-score bootstrapping) のラベル計算 (純関数)。
// 設計: docs/plans/issue-245-stage2-learned-eval-design.md §3.4 / §6 P2-0。
//
// 中核 = 「先読み評価値 (search-score, cp) と最終勝敗 (outcome, z∈{+1,0,-1}) を **cp 空間で
// 混合してから** tanh で [-1,1] へ squash する」。
// なぜ squash が要るか (M1 BLOCKER): NN 出力は `tanh(z2) ∈ [-1,1]` (mlp.ts)、学習 target は MSE
// ゆえ label が [-1,1] 外だと tanh が飽和し勾配 `(1−y²)` が消失して学習が破綻する。search-score は
// cp (材料 ±数百〜詰み ±90000) なので、そのままでは target にできない。
// なぜ mix→squash の順序か: 詰み search-score=±90000 は混合段で `±90000α` と桁支配し、矛盾する
// noisy な outcome を上書きする → squash 後 `tanh(±90000α/cpScale)≈±1` で **確定値が α に依らず
// ±1 に錨**される (§3.3(a) 確定値の錨の数学的実装)。squash→mix だと outcome が詰みを希釈する。
//
// search-score (= 先手絶対視点 cp の backed-up 値) の生成は探索側 (search.ts の
// evaluatePositionWorldMoveOnly、scripts/label-search-score-245.ts が駆動) が担う。本モジュールは
// 探索非依存で「混合 + squash」のみを担当する。

import { CP_SCALE } from "./infer";

export interface BootstrapLabelParams {
  // search-score の混合比 α (0..1)。1 = 純 search、0 = 純 outcome。§8 ユーザー決定 = 0.5 起点。
  alpha: number;
  // outcome z∈{+1,0,-1} を cp へ写す重み。§3.4 起点 = CP_SCALE (= 勝勢 ≈ +1000cp)。
  // cpRef を cpScale より大きくすると「勝った試合」が ±1 へ近づく (詰みとの差を詰めたいとき)。
  cpRef: number;
  // squash 温度 (cp)。infer の `y × CP_SCALE` (推論の逆写像) と 0 近傍で一致するよう CP_SCALE を共有。
  cpScale: number;
}

// §8 ユーザー決定 (2026-06-28): α=0.5 起点。cpRef = cpScale = CP_SCALE (§3.4 起点、P2-1 で校正)。
export const DEFAULT_BOOTSTRAP_PARAMS: BootstrapLabelParams = {
  alpha: 0.5,
  cpRef: CP_SCALE,
  cpScale: CP_SCALE,
};

// search-score (先手絶対視点 cp) と outcome (先手絶対視点 z) を cp 空間で混合 → tanh squash → [-1,1]。
export function squashBootstrapLabel(
  searchScoreCp: number,
  outcomeZ: number,
  params: BootstrapLabelParams = DEFAULT_BOOTSTRAP_PARAMS,
): number {
  const { alpha, cpRef, cpScale } = params;
  const outcomeCp = outcomeZ * cpRef;
  const mixedCp = alpha * searchScoreCp + (1 - alpha) * outcomeCp;
  return Math.tanh(mixedCp / cpScale);
}
