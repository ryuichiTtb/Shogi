// 小型 MLP 評価ネットの学習実行 (Issue #245 フェーズ1 P1-2)。
//
// 特徴 JSONL (scripts/encode-training-245.ts 出力) を読み、trainModel で学習し、重みを JSON で
// 書き出す。学習・検証分割で過学習を監視し、損失曲線を表示する。純 TS・依存ゼロ・無料 CPU。
// 書き出した重み JSON は P1-3 の推論 (infer.ts) が deserializeModel で読み込む。
//
// 使い方 (リポジトリルートで):
//   TRAIN_IN=local-data/training/features-245.jsonl TRAIN_OUT=local-data/training/model-245.json \
//     TRAIN_HIDDEN=64 TRAIN_EPOCHS=200 npx tsx scripts/train-245.ts
//
// env: TRAIN_IN / TRAIN_OUT / TRAIN_HIDDEN(64) / TRAIN_EPOCHS(200) / TRAIN_LR(1e-3) /
//      TRAIN_BATCH(32) / TRAIN_SEED(7) / TRAIN_VAL_FRAC(0.15) / TRAIN_WD(1e-4)

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { FEATURE_DIM } from "@/lib/shogi/ai/learned/encoder";
import type { SparseFeatureRow } from "@/lib/shogi/ai/learned/feature-export";
import { createModel, mulberry32, predictSparse, serializeModel } from "@/lib/shogi/ai/learned/mlp";
import { trainModel } from "@/lib/shogi/ai/learned/train";

const IN = process.env.TRAIN_IN ?? "local-data/training/features-245.jsonl";
const OUT = process.env.TRAIN_OUT ?? "local-data/training/model-245.json";
const HIDDEN = Math.max(1, Number(process.env.TRAIN_HIDDEN ?? "64") || 64);
const EPOCHS = Math.max(1, Number(process.env.TRAIN_EPOCHS ?? "200") || 200);
const LR = Number(process.env.TRAIN_LR ?? "0.001") || 0.001;
const BATCH = Math.max(1, Number(process.env.TRAIN_BATCH ?? "32") || 32);
const SEED = Math.max(0, Number(process.env.TRAIN_SEED ?? "7") || 7);
const VAL_FRAC = Math.min(0.9, Math.max(0, Number(process.env.TRAIN_VAL_FRAC ?? "0.15") || 0.15));
const WD = Number(process.env.TRAIN_WD ?? "0.0001") || 0;

function mse(rows: SparseFeatureRow[], model: ReturnType<typeof createModel>): number {
  if (rows.length === 0) return 0;
  let s = 0;
  for (const r of rows) {
    const d = predictSparse(model, r.idx, r.val) - r.label;
    s += d * d;
  }
  return s / rows.length;
}

function main() {
  const content = readFileSync(IN, "utf8");
  const rows: SparseFeatureRow[] = content
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as SparseFeatureRow);

  if (rows.length === 0) {
    console.error(`[train-245] 特徴が空: ${IN}`);
    process.exit(1);
  }

  // ★試合単位の train/val 分割 (データリーク防止)。1 試合の全サンプルは同一ラベルを共有するため、
  // サンプル単位で分けると「どの試合か」を覚えるだけで val を当てられ、val 損失が楽観的に過小評価
  // される。試合 (row.game) ごと丸ごと train か val に振り分け、未知の試合への汎化を正しく測る。
  const rng = mulberry32(SEED);
  const gameIds = Array.from(new Set(rows.map((r) => r.game)));
  for (let i = gameIds.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [gameIds[i], gameIds[j]] = [gameIds[j], gameIds[i]];
  }
  // 検証用の試合数 (最低 1、ただし全試合を val にしない)。
  const nValGames = Math.min(
    Math.max(gameIds.length > 1 ? 1 : 0, Math.floor(gameIds.length * VAL_FRAC)),
    Math.max(0, gameIds.length - 1),
  );
  const valGameSet = new Set(gameIds.slice(0, nValGames));
  const valRows = rows.filter((r) => valGameSet.has(r.game));
  const trainRows = rows.filter((r) => !valGameSet.has(r.game));

  const labelDist = rows.reduce<Record<string, number>>((a, r) => {
    a[String(r.label)] = (a[String(r.label)] ?? 0) + 1;
    return a;
  }, {});

  console.log(`=== 学習 (P1-2) ===`);
  console.log(
    `入力: ${IN} | 試合 ${gameIds.length} (val ${nValGames}) | サンプル ${rows.length} (train ${trainRows.length} / val ${valRows.length})`,
  );
  console.log(`featureDim=${FEATURE_DIM} hidden=${HIDDEN} epochs=${EPOCHS} lr=${LR} batch=${BATCH} wd=${WD}`);
  console.log(`label 分布 (先手+1/引分0/後手-1): ${JSON.stringify(labelDist)}`);

  const model = createModel(FEATURE_DIM, HIDDEN, SEED);
  const logEvery = Math.max(1, Math.floor(EPOCHS / 10));
  // ★早期停止: 毎エポック val を評価し、最良 val のモデル重みを採用する (P1-4 で過学習が判明、
  // val はごく初期に底打ちし以降上昇するため、最終重みでなく汎化最良点を保存する)。
  const { lossHistory, valHistory, bestValLoss, bestEpoch } = trainModel(model, trainRows, {
    epochs: EPOCHS,
    batchSize: BATCH,
    lr: LR,
    weightDecay: WD,
    seed: SEED + 1,
    validate: () => mse(valRows, model),
  });

  for (let e = 0; e < lossHistory.length; e += logEvery) {
    console.log(`  epoch ${e}: train MSE ${lossHistory[e].toFixed(4)} | val MSE ${valHistory[e].toFixed(4)}`);
  }
  console.log(`  best: epoch ${bestEpoch} | val MSE ${(bestValLoss ?? 0).toFixed(4)} (この重みを採用)`);

  // trainModel が最良 val の重みを復元済 → finalVal は最良 val と一致する。
  const finalTrain = lossHistory[bestEpoch ?? lossHistory.length - 1];
  const finalVal = mse(valRows, model);

  mkdirSync(dirname(OUT), { recursive: true });
  const payload = {
    model: serializeModel(model),
    meta: {
      featureDim: FEATURE_DIM,
      hidden: HIDDEN,
      epochs: EPOCHS,
      lr: LR,
      batch: BATCH,
      weightDecay: WD,
      seed: SEED,
      samples: rows.length,
      games: gameIds.length,
      valGames: nValGames,
      trainSamples: trainRows.length,
      valSamples: valRows.length,
      finalTrainMse: finalTrain,
      finalValMse: finalVal,
      labelDist,
    },
  };
  writeFileSync(OUT, JSON.stringify(payload));

  console.log(`\nDone. train MSE ${finalTrain.toFixed(4)} | val MSE ${finalVal.toFixed(4)} -> ${OUT}`);
}

main();
