// 学習型評価の小型 MLP モデル (Issue #245 フェーズ1 P1-2)。
//
// 1 隠れ層 MLP: 入力 (FEATURE_DIM) → 隠れ (hidden, ReLU) → 出力スカラー (tanh)。
// 出力 tanh ∈ [-1,1] = 先手絶対視点の勝敗見込み (学習ターゲット z∈{-1,0,1})。
// 推論時 (P1-3) は cp スケール換算する (= M1 MAJOR-1 のスケール較正、cp 前提の futility/delta と整合)。
//
// ★forward は学習 (train.ts) と推論 (infer.ts, P1-3) で共有する = スキューゼロ。
// 入力は密 (推論: encodePosition の Float32Array) と疎 (学習: SparseFeatureRow の idx/val) の
// 両経路を持つが、第1層の z1 計算のみ分岐し上位層 (forwardFromZ1) は共有 → 等価性をテストで保証。
//
// 純粋・依存ゼロ (Python/外部 ML ライブラリ不要)。重みは JSON で直列化し infer/train が共有する。

// 1 隠れ層 MLP のパラメータ。行列は row-major の Float32Array。
export interface MlpModel {
  featureDim: number;
  hidden: number;
  w1: Float32Array; // hidden × featureDim: w1[h * featureDim + i]
  b1: Float32Array; // hidden
  w2: Float32Array; // hidden (出力スカラーゆえ 1 × hidden)
  b2: number;
}

// 決定的 PRNG (mulberry32)。重み初期化・シャッフルを seed で再現可能にする (決定性 = 計画 §6)。
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 標準正規乱数 (Box-Muller)。
function randn(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// He 初期化 (W1) + 小さめ初期化 (W2)。バイアスは 0。
export function createModel(featureDim: number, hidden: number, seed = 12345): MlpModel {
  const rng = mulberry32(seed);
  const w1 = new Float32Array(hidden * featureDim);
  const std1 = Math.sqrt(2 / featureDim); // He (ReLU 向け)
  for (let i = 0; i < w1.length; i++) w1[i] = randn(rng) * std1;
  const w2 = new Float32Array(hidden);
  const std2 = Math.sqrt(1 / hidden); // Xavier 系 (出力スカラー)
  for (let i = 0; i < w2.length; i++) w2[i] = randn(rng) * std2;
  return { featureDim, hidden, w1, b1: new Float32Array(hidden), w2, b2: 0 };
}

function relu(v: number): number {
  return v > 0 ? v : 0;
}

// 第1層 z1 = W1·x + b1 (密入力)。推論経路 (encodePosition の Float32Array)。
export function z1Dense(model: MlpModel, x: Float32Array): Float32Array {
  const { hidden, featureDim, w1, b1 } = model;
  const z1 = new Float32Array(hidden);
  for (let h = 0; h < hidden; h++) {
    let s = b1[h];
    const base = h * featureDim;
    for (let i = 0; i < featureDim; i++) s += w1[base + i] * x[i];
    z1[h] = s;
  }
  return z1;
}

// 第1層 z1 = W1·x + b1 (疎入力)。学習経路 (SparseFeatureRow の idx/val)。
// 非ゼロ要素のみ走査するため O(hidden × nnz) (= NNUE 流の高速化、計画 §3 論点F)。
// ★累積は float64 (acc) で行い最後に 1 回だけ float32 化する = z1Dense (float64 ローカルで
// 累積し 1 回丸め) と数値的に一致させる (中間丸めの差による dense/sparse 乖離を防ぐ)。
export function z1Sparse(model: MlpModel, idx: number[], val: number[]): Float32Array {
  const { hidden, featureDim, w1, b1 } = model;
  const acc = new Float64Array(hidden);
  for (let h = 0; h < hidden; h++) acc[h] = b1[h];
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k];
    const v = val[k];
    for (let h = 0; h < hidden; h++) acc[h] += w1[h * featureDim + i] * v;
  }
  return Float32Array.from(acc);
}

// z1 から上位層を計算 (学習・推論で共有)。h=relu(z1), y=tanh(w2·h + b2)。
// backprop 用に中間 (h, z2) も返す。
export function forwardFromZ1(
  model: MlpModel,
  z1: Float32Array,
): { y: number; h: Float32Array; z2: number } {
  const { hidden, w2, b2 } = model;
  const h = new Float32Array(hidden);
  let z2 = b2;
  for (let j = 0; j < hidden; j++) {
    const a = relu(z1[j]);
    h[j] = a;
    z2 += w2[j] * a;
  }
  return { y: Math.tanh(z2), h, z2 };
}

// 推論: 密入力 → tanh 出力スカラー。
export function predict(model: MlpModel, x: Float32Array): number {
  return forwardFromZ1(model, z1Dense(model, x)).y;
}

// 推論 (疎入力版)。predict(dense) と等価 (テストで保証)。
export function predictSparse(model: MlpModel, idx: number[], val: number[]): number {
  return forwardFromZ1(model, z1Sparse(model, idx, val)).y;
}

// 直列化 (JSON 化可能な数値配列へ)。infer/train が同形式を共有する。
export interface SerializedMlp {
  featureDim: number;
  hidden: number;
  w1: number[];
  b1: number[];
  w2: number[];
  b2: number;
}

export function serializeModel(model: MlpModel): SerializedMlp {
  return {
    featureDim: model.featureDim,
    hidden: model.hidden,
    w1: Array.from(model.w1),
    b1: Array.from(model.b1),
    w2: Array.from(model.w2),
    b2: model.b2,
  };
}

export function deserializeModel(obj: SerializedMlp): MlpModel {
  return {
    featureDim: obj.featureDim,
    hidden: obj.hidden,
    w1: Float32Array.from(obj.w1),
    b1: Float32Array.from(obj.b1),
    w2: Float32Array.from(obj.w2),
    b2: obj.b2,
  };
}
