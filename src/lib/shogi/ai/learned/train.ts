// 小型 MLP 評価ネットの学習 (Issue #245 フェーズ1 P1-2)。
//
// 教師あり回帰: 疎特徴 (SparseFeatureRow) → 先手絶対視点ラベル z∈{-1,0,1} を MSE で学習。
// 最適化は Adam (学習率調整に頑健 = 非専門ユーザー向け PoC に適する)。第1層の forward/backward は
// 疎入力の非ゼロのみ走査 (O(hidden × nnz)) で高速化する。
//
// 純粋・依存ゼロ・決定的 (seed 指定でシャッフル・初期化を再現)。Node/Python 非依存。
// 実 I/O (JSONL 読込・重み書き出し) は scripts/train-245.ts が担う。

import type { SparseFeatureRow } from "./feature-export";
import { forwardFromZ1, mulberry32, z1Sparse, type MlpModel } from "./mlp";

export interface TrainOptions {
  epochs?: number; // 既定 100
  batchSize?: number; // 既定 32
  lr?: number; // 既定 1e-3
  weightDecay?: number; // AdamW 流の decoupled L2 (既定 0)
  seed?: number; // シャッフルの決定性 (既定 7)
  onEpoch?: (epoch: number, loss: number) => void; // エポックごとの平均損失コールバック
}

export interface TrainResult {
  model: MlpModel;
  lossHistory: number[]; // エポックごとの平均 MSE
}

const B1 = 0.9;
const B2 = 0.999;
const EPS = 1e-8;

// model を in-place 学習し、損失履歴を返す。呼び出し側は createModel で初期化済みモデルを渡す。
export function trainModel(
  model: MlpModel,
  rows: SparseFeatureRow[],
  opts: TrainOptions = {},
): TrainResult {
  const epochs = opts.epochs ?? 100;
  const batchSize = Math.max(1, opts.batchSize ?? 32);
  const lr = opts.lr ?? 1e-3;
  const wd = opts.weightDecay ?? 0;
  const rng = mulberry32(opts.seed ?? 7);

  const { hidden, featureDim } = model;

  // Adam モーメント (パラメータごと)。
  const mW1 = new Float32Array(hidden * featureDim);
  const vW1 = new Float32Array(hidden * featureDim);
  const mB1 = new Float32Array(hidden);
  const vB1 = new Float32Array(hidden);
  const mW2 = new Float32Array(hidden);
  const vW2 = new Float32Array(hidden);
  let mB2 = 0;
  let vB2 = 0;

  // 勾配アキュムレータ (バッチごとに 0 クリア)。
  const gW1 = new Float32Array(hidden * featureDim);
  const gB1 = new Float32Array(hidden);
  const gW2 = new Float32Array(hidden);

  const n = rows.length;
  const order = Array.from({ length: n }, (_, i) => i);
  const lossHistory: number[] = [];
  let step = 0;

  for (let epoch = 0; epoch < epochs; epoch++) {
    // Fisher-Yates シャッフル (seed 決定的)。
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }

    let epochLoss = 0;
    for (let start = 0; start < n; start += batchSize) {
      const end = Math.min(start + batchSize, n);
      const bs = end - start;

      gW1.fill(0);
      gB1.fill(0);
      gW2.fill(0);
      let gB2 = 0;

      for (let s = start; s < end; s++) {
        const row = rows[order[s]];
        const z1 = z1Sparse(model, row.idx, row.val);
        const { y, h } = forwardFromZ1(model, z1);
        const diff = y - row.label;
        epochLoss += diff * diff;

        // 逆伝播 (tanh 出力 + MSE)。
        const dz2 = 2 * diff * (1 - y * y); // dL/dy * tanh'
        gB2 += dz2;
        for (let j = 0; j < hidden; j++) {
          gW2[j] += dz2 * h[j];
          // dh -> dz1 (ReLU')。z1[j]<=0 のユニットは勾配 0。
          if (z1[j] > 0) gB1[j] += dz2 * model.w2[j];
        }
        // 第1層: 疎入力ゆえ非ゼロ列のみ更新。dz1[j] = dz2 * w2[j] * relu'(z1[j])。
        for (let k = 0; k < row.idx.length; k++) {
          const i = row.idx[k];
          const v = row.val[k];
          const colBase = i;
          for (let j = 0; j < hidden; j++) {
            if (z1[j] > 0) gW1[j * featureDim + colBase] += dz2 * model.w2[j] * v;
          }
        }
      }

      // バッチ平均勾配 → Adam 更新。
      step++;
      const inv = 1 / bs;
      const bc1 = 1 - Math.pow(B1, step);
      const bc2 = 1 - Math.pow(B2, step);

      adamStepArray(model.w1, gW1, mW1, vW1, inv, lr, wd, bc1, bc2);
      adamStepArray(model.b1, gB1, mB1, vB1, inv, lr, 0, bc1, bc2); // bias は weight decay 対象外
      adamStepArray(model.w2, gW2, mW2, vW2, inv, lr, wd, bc1, bc2);

      // b2 (スカラー)。
      const gb2 = gB2 * inv;
      mB2 = B1 * mB2 + (1 - B1) * gb2;
      vB2 = B2 * vB2 + (1 - B2) * gb2 * gb2;
      model.b2 -= lr * (mB2 / bc1) / (Math.sqrt(vB2 / bc2) + EPS);
    }

    const avg = epochLoss / Math.max(1, n);
    lossHistory.push(avg);
    opts.onEpoch?.(epoch, avg);
  }

  return { model, lossHistory };
}

// Adam 更新 (配列パラメータ)。grad は accumulator (バッチ合計)、inv=1/batchSize で平均化。
// wd>0 のとき decoupled weight decay (AdamW): p -= lr*wd*p。
function adamStepArray(
  p: Float32Array,
  g: Float32Array,
  m: Float32Array,
  v: Float32Array,
  inv: number,
  lr: number,
  wd: number,
  bc1: number,
  bc2: number,
): void {
  for (let i = 0; i < p.length; i++) {
    const grad = g[i] * inv;
    m[i] = B1 * m[i] + (1 - B1) * grad;
    v[i] = B2 * v[i] + (1 - B2) * grad * grad;
    let update = lr * (m[i] / bc1) / (Math.sqrt(v[i] / bc2) + EPS);
    if (wd > 0) update += lr * wd * p[i];
    p[i] -= update;
  }
}
