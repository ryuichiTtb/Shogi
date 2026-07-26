// Issue #245 教材多様化 段1: ラベル付けワーカーの出力を 1 ファイルへ結合する (重複排除つき)。
//
// 背景: 取り合い方式では 8 ワーカーが別々の OUT へ書き、取りこぼし検査パスがさらに別ファイルを作る。
// 最後にそれらを結合する必要があるが、**重複判定を結合側で書き直すと同一性の定義が二重管理になる**。
// 実際、段1 で試合メタに labelMeta (レシピ) を刻むようになったため、素朴に「行の全内容」で
// 重複判定すると同じ対局の旧レシピ行と新レシピ行が両方残り、完了判定が誤報する。
// → 判定は正本 (scripts/utils/merge-labeled.ts + label-identity.ts) の 1 実装に寄せる。
// 本ファイルは fs I/O と検査結果の報告だけを担う。
//
// 併せて「1 ファイルにレシピが混ざっていないか」を検査する。混在は学習を静かに壊すので、
// 結合の時点で止める (encode 段でも止まるが、20 時間走らせた後に気づくより早いほうがよい)。
//
// 使い方 (リポジトリルートで):
//   MERGE_IN="$(ls local-data/training/labeled-348-D5.part*.jsonl | paste -sd,)" \
//     MERGE_OUT=local-data/training/labeled-348-D5.jsonl \
//     MERGE_EXPECT_IN=local-data/training/snap-selfplay.jsonl \
//     npx tsx scripts/merge-labeled-245.ts
//
// env:
//   MERGE_IN        結合元 JSONL (カンマ区切り)。1 つでも読めなければエラー終了する
//                   (typo が「静かに一部欠落した結合結果」になるのを防ぐため)
//   MERGE_OUT       出力 JSONL
//   MERGE_EXPECT_IN 期待件数の照合元 (= ラベル付けの入力 JSONL)。指定時、採点対象 (winner≠null) の
//                   試合数と結合結果を突き合わせ、食い違えば非ゼロ終了する
//
// 終了コード: 0=正常 / 1=レシピ混在・入力不正・件数不一致 (いずれも成果物は使わないこと)
// ★入力は読み取り専用。出力が入力と同じパスになる指定は拒否する。

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { parseTrainingRecordLine } from "@/lib/shogi/training/jsonl";

import { mergeLabeledRecords } from "./utils/merge-labeled";

const IN = (process.env.MERGE_IN ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const OUT = process.env.MERGE_OUT ?? "";
const EXPECT_IN = process.env.MERGE_EXPECT_IN ?? "";

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

// 採点対象になる試合数 (winner=null の中断対局はラベル付けが除外するので期待値から外す)。
function countScorableGames(file: string): number {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    die(`MERGE_EXPECT_IN が読めません: ${file}`);
  }
  let n = 0;
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      if (parseTrainingRecordLine(line).game.winner != null) n += 1;
    } catch {
      // 壊れた行は期待値に数えない
    }
  }
  return n;
}

function main() {
  if (IN.length === 0 || !OUT) {
    die("MERGE_IN (カンマ区切り) と MERGE_OUT を指定してください");
  }
  // パスを正規化してから比較する (local-data/x.jsonl と ./local-data/x.jsonl を同一と見る)。
  const outAbs = resolve(OUT);
  if (IN.some((f) => resolve(f) === outAbs)) {
    die(`MERGE_OUT が MERGE_IN に含まれています (自分を読みながら上書きします): ${OUT}`);
  }

  const lines: string[] = [];
  for (const file of IN) {
    let raw: string;
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      die(`MERGE_IN が読めません: ${file}\n  結合元の指定 (typo / glob の取りこぼし) を確認してください`);
    }
    const own = raw.split("\n").filter((l) => l.trim().length > 0);
    lines.push(...own);
    console.log(`  ${file}: ${own.length} 行`);
  }

  const { lines: kept, stats } = mergeLabeledRecords(lines);

  if (stats.recipes.size > 1) {
    const detail = [...stats.recipes].map(([k, n]) => `${k}: ${n} 行`).join(" / ");
    die(
      `\n✗ ラベル生成レシピが混在しています [${detail}]。\n` +
        `  新旧のラベルを 1 ファイルにまとめると学習が静かに壊れます。レシピごとに別ファイルへ結合してください。`,
    );
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, kept.length > 0 ? kept.join("\n") + "\n" : "");

  console.log(
    `\n結合: ${kept.length} 試合 (入力 ${stats.totalLines} 行 / 重複除外 ${stats.dup} / 壊れた行 ${stats.broken}) -> ${OUT}`,
  );
  console.log(`  レシピ: ${[...stats.recipes.keys()].join(",") || "なし"}`);
  if (stats.replaced > 0) {
    console.log(`  重複のうち ${stats.replaced} 件は、採点がより揃っている方へ差し替えました`);
  }
  if (stats.missingGames > 0) console.warn(`  ⚠ 未採点 (searchScore キーなし) を含む試合: ${stats.missingGames}`);
  if (stats.unscoredGames > 0) console.warn(`  ⚠ 採点不能 (searchScore=null) を含む試合: ${stats.unscoredGames}`);
  if (stats.broken > 0) console.warn(`  ⚠ JSON として読めない行: ${stats.broken}`);

  if (EXPECT_IN) {
    const expected = countScorableGames(EXPECT_IN);
    if (kept.length === expected) {
      console.log(`  ✅ 全 ${expected} 試合そろいました`);
    } else if (kept.length < expected) {
      process.exitCode = 1;
      console.warn(
        `  ⚠ ${expected - kept.length} 試合ぶん不足しています (${kept.length} / ${expected})。ラベル付けをもう一度実行してください`,
      );
    } else {
      process.exitCode = 1;
      console.warn(
        `  ⚠ 期待より ${kept.length - expected} 試合多いです (${kept.length} / ${expected})。` +
          `MERGE_IN に別の教材の成果が混ざっていないか確認してください`,
      );
    }
  }
}

main();
