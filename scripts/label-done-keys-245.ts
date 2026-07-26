// Issue #245 Stage 2: 既済ラベル試合の識別ハッシュ一覧を作る (label-search-score-245.ts の
// LABEL_DONE_KEYS 用)。
//
// 背景: ラベル生成を複数ワーカーで分散するとき、各ワーカーは自分の OUT にしか書かないため
// 「他ワーカーが採点済みの試合」を自力では判定できない。全 OUT を毎回 parse させると
// 数百 MB × ワーカー数の無駄になるので、事前に 1 度だけハッシュ化して小さな一覧にしておく。
//
// 併せて各行の健全性 (JSON として読めるか / 全サンプルに searchScore があるか) を検査し、
// 壊れた行があれば件数を報告する (取り込み前の点検を兼ねる)。
//
// 使い方 (リポジトリルートで):
//   DONE_IN="local-data/training/labeled-348-D5.shard0.jsonl,..." \
//     DONE_OUT=local-data/training/labeled-348-D5.done-keys.txt \
//     npx tsx scripts/label-done-keys-245.ts
//
// env:
//   DONE_IN   既済 JSONL (カンマ区切りで複数可)。読めないファイルは警告して skip。
//   DONE_OUT  出力先 (1 行 1 ハッシュ。先頭に # コメント行)。

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { parseTrainingRecordLine } from "@/lib/shogi/training/jsonl";

import { labelKeyHash } from "./utils/label-identity";

const IN = (process.env.DONE_IN ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const OUT = process.env.DONE_OUT ?? "local-data/training/label-done-keys.txt";

function main() {
  if (IN.length === 0) {
    console.error("DONE_IN が未指定です (カンマ区切りで既済 JSONL を指定してください)");
    process.exit(1);
  }

  const hashes = new Set<string>();
  let lines = 0;
  let broken = 0;
  let missingScore = 0;

  for (const file of IN) {
    let raw: string;
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      console.warn(`[done-keys] 読めません (skip): ${file}`);
      continue;
    }
    let ok = 0;
    for (const line of raw.split("\n")) {
      if (line.trim().length === 0) continue;
      lines += 1;
      let record;
      try {
        record = parseTrainingRecordLine(line);
      } catch {
        broken += 1;
        continue;
      }
      if (record.samples.some((s) => s.searchScore === undefined)) missingScore += 1;
      hashes.add(labelKeyHash(record));
      ok += 1;
    }
    console.log(`  ${file}: ${ok} 試合`);
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(
    OUT,
    `# label-search-score-245.ts の LABEL_DONE_KEYS 用。既済 ${hashes.size} 試合。\n` +
      [...hashes].join("\n") +
      "\n",
  );

  console.log(`\n入力 ${lines} 行 → ユニーク ${hashes.size} 試合 -> ${OUT}`);
  if (lines !== hashes.size) {
    console.log(`  (重複 ${lines - broken - hashes.size} 行 = 複数ワーカーの成果を結合した場合に発生しうる)`);
  }
  if (broken > 0) console.warn(`  ⚠ JSON として読めない行: ${broken}`);
  if (missingScore > 0) console.warn(`  ⚠ searchScore 欠落を含む試合: ${missingScore}`);
}

main();
