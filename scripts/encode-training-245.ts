// 対局 JSONL → 学習用特徴 JSONL への変換 (Issue #245 フェーズ1 P1-1→P1-2 連結)。
//
// 収集済みの対局 (1 行 = 1 試合 TrainingGameRecord) を読み、各サンプルを encodePosition で
// 疎特徴 + 勝敗ラベル (先手絶対視点 z) へ変換して特徴 JSONL (1 行 = 1 サンプル) を書き出す。
// 学習側 (Python) はこの特徴 JSONL を読むだけで、encoder を再実装しない (スキューゼロ)。
//
// 変換は純関数 gameToSparseRows (learned/feature-export.ts) に委譲し、本スクリプトは I/O のみ。
// 出力と同名 + .meta.json に featureDim / 件数 / ラベル分布を書く (Python が密次元を知るため)。
//
// 使い方 (リポジトリルートで):
//   ENCODE_IN=local-data/training/human-245.jsonl,local-data/training/selfplay-advanced-245.jsonl \
//     ENCODE_OUT=local-data/training/features-245.jsonl npx tsx scripts/encode-training-245.ts
//
// env:
//   ENCODE_IN   入力 JSONL (カンマ区切り、既定 local-data/training/human-245.jsonl)
//   ENCODE_OUT  出力特徴 JSONL (既定 local-data/training/features-245.jsonl)

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { FEATURE_DIM } from "@/lib/shogi/ai/learned/encoder";
import { gameToSparseRows } from "@/lib/shogi/ai/learned/feature-export";
import { parseTrainingRecordLine } from "@/lib/shogi/training/jsonl";

const IN = (process.env.ENCODE_IN ?? "local-data/training/human-245.jsonl")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const OUT = process.env.ENCODE_OUT ?? "local-data/training/features-245.jsonl";

function main() {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, ""); // truncate

  let games = 0;
  let samples = 0;
  let skippedGames = 0; // winner=null 等で行ゼロの試合
  let gameIndex = 0; // 出力試合への連番 (試合単位 train/val 分割キー)、全入力ファイル横断で一意。
  const labelCounts: Record<string, number> = { "1": 0, "0": 0, "-1": 0 };
  const sources: Record<string, number> = {};

  for (const file of IN) {
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      console.warn(`[encode-training-245] 入力が読めません (skip): ${file}`);
      continue;
    }
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    let chunk = "";
    for (const line of lines) {
      const record = parseTrainingRecordLine(line);
      // gameIndex は「行を生成した試合」へ一意採番 (試合単位 train/val 分割のキー)。
      // 中断などで空配列の試合には採番せず、出力試合に連番を振る。
      const rows = gameToSparseRows(record, gameIndex);
      games += 1;
      if (rows.length === 0) {
        skippedGames += 1;
        continue;
      }
      gameIndex += 1;
      sources[record.game.source] = (sources[record.game.source] ?? 0) + 1;
      for (const r of rows) {
        chunk += JSON.stringify(r) + "\n";
        samples += 1;
        labelCounts[String(r.label)] = (labelCounts[String(r.label)] ?? 0) + 1;
      }
    }
    if (chunk) appendFileSync(OUT, chunk);
    console.log(`  読込: ${file}`);
  }

  const meta = { featureDim: FEATURE_DIM, sampleCount: samples, games, skippedGames, labelCounts, sources };
  writeFileSync(`${OUT}.meta.json`, JSON.stringify(meta, null, 2));

  console.log(`\nDone. ${games} 試合 (除外 ${skippedGames}) / ${samples} サンプル -> ${OUT}`);
  console.log(`  featureDim: ${FEATURE_DIM}`);
  console.log(`  label 分布 (先手+1/引分0/後手-1): ${JSON.stringify(labelCounts)}`);
  console.log(`  source 内訳: ${JSON.stringify(sources)}`);
}

main();
