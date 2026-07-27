// Issue #245 教材多様化 段4: 既存教材から「どの局面でどの行動を何回選んだか」の索引を作る。
//
// なぜ要るか: 多様化は「まだ選んでいない手を優先する」仕組みなので、**過去の教材で何を選んだか**を
// 知らないと、新しい生成でも同じ手を選び直してしまう。教材 JSONL は 131MB あり、生成ワーカー全員が
// 毎回 parse するのは現実的でないので、1 度だけ「posKey actKey」の行ファイルへ落としておく
// (この形式なら並列ワーカーが read-modify-write なしで追記できる)。
//
// キーの作り方は src/lib/shogi/training/diversify.ts の 1 実装に寄せる
// (ここで独自に書くと、生成側と索引側で「同じ局面」の定義がズレて多様化が空振りする)。
//
// 使い方 (リポジトリルートで):
//   SEEN_IN=local-data/training/snap-selfplay.jsonl \
//     SEEN_OUT=local-data/training/seen-index.txt \
//     npx tsx scripts/build-seen-index-245.ts
//
// env:
//   SEEN_IN     教材 JSONL (カンマ区切りで複数可)
//   SEEN_OUT    出力する行ファイル (1 行 = 1 出現)
//   SEEN_APPEND "1" で既存 SEEN_OUT へ追記 (既定 "0" = 作り直す)
//   ★入力は読み取り専用。

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { formatSeenLine, seenKeysFromSample } from "@/lib/shogi/training/diversify";
import { parseTrainingRecordLine } from "@/lib/shogi/training/jsonl";

const IN = (process.env.SEEN_IN ?? "local-data/training/snap-selfplay.jsonl")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const OUT = process.env.SEEN_OUT ?? "local-data/training/seen-index.txt";
const APPEND = process.env.SEEN_APPEND === "1";

// 数万行を一度に書くとメモリと I/O が跳ねるのでまとめて流す。
const FLUSH_LINES = 20000;

function main() {
  mkdirSync(dirname(OUT), { recursive: true });
  if (!APPEND) writeFileSync(OUT, "");

  let games = 0;
  let samples = 0;
  let broken = 0;
  const positions = new Set<string>();
  let buffer: string[] = [];

  const flush = () => {
    if (buffer.length === 0) return;
    appendFileSync(OUT, buffer.join("\n") + "\n");
    buffer = [];
  };

  for (const file of IN) {
    let raw: string;
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      console.warn(`[seen-index] 読めません (skip): ${file}`);
      continue;
    }
    for (const line of raw.split("\n")) {
      if (line.trim().length === 0) continue;
      let record;
      try {
        record = parseTrainingRecordLine(line);
      } catch {
        broken += 1;
        continue;
      }
      games += 1;
      for (const sample of record.samples) {
        const { posKey, actKey } = seenKeysFromSample(sample);
        positions.add(posKey);
        buffer.push(formatSeenLine(posKey, actKey));
        samples += 1;
        if (buffer.length >= FLUSH_LINES) flush();
      }
    }
    console.log(`  読込: ${file}`);
  }
  flush();

  console.log(`\nDone. ${games} 試合 / ${samples} 出現 -> ${OUT}`);
  console.log(`  ユニーク局面: ${positions.size} (全出現の ${((positions.size / Math.max(1, samples)) * 100).toFixed(1)}%)`);
  if (broken > 0) console.warn(`  ⚠ JSON として読めない行: ${broken}`);
}

main();
