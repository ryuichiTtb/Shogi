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
//   MERGE_EXPECT_IN 照合元 (= ラベル付けの入力 JSONL)。指定時、採点対象 (winner≠null) の試合を
//                   **1 対 1 で**突き合わせ (件数でなく識別子の集合)、欠け・余りがあれば非ゼロ終了する
//
// 終了コード: 0=正常 / 1=レシピ混在・入力不正・件数不一致 (いずれも成果物は使わないこと)
// ★入力は読み取り専用。出力が入力と同じパスになる指定は拒否する。

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { parseTrainingRecordLine } from "@/lib/shogi/training/jsonl";

import { labelIdentityKey } from "./utils/label-identity";
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

// 採点対象になる試合の**識別子の集合** (winner=null の中断対局はラベル付けが除外するので外す)。
//
// ★件数ではなく集合で比べる。件数だけだと「A が欠けて B が二重に入った」が
//   同数になって素通りし、欠けたまま学習まで進んでしまう。
function scorableKeys(file: string): Set<string> {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    die(`MERGE_EXPECT_IN が読めません: ${file}`);
  }
  const keys = new Set<string>();
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      const record = parseTrainingRecordLine(line);
      if (record.game.winner != null) keys.add(labelIdentityKey(record));
    } catch {
      // 壊れた行は期待値に数えない
    }
  }
  return keys;
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
    const expected = scorableKeys(EXPECT_IN);
    // 結合結果の側も同じ鍵で引く (labelIdentityKey は searchScore と labelMeta を除くので、
    // 「採点前の入力行」と「採点後の出力行」が同じ鍵になる)。
    const got = new Set<string>();
    for (const line of kept) {
      try {
        got.add(labelIdentityKey(parseTrainingRecordLine(line)));
      } catch {
        // 壊れた行は既に stats.broken で報告済み
      }
    }
    const missing = [...expected].filter((k) => !got.has(k));
    const extra = [...got].filter((k) => !expected.has(k));
    if (missing.length === 0 && extra.length === 0) {
      console.log(`  ✅ 全 ${expected.size} 試合そろいました (入力と 1 対 1 で一致)`);
    } else {
      process.exitCode = 1;
      if (missing.length > 0) {
        console.warn(
          `  ⚠ ${missing.length} 試合が採点されていません (${got.size} / ${expected.size})。` +
            `ラベル付けをもう一度実行してください (LABEL_RESUME=1 で未採点だけ拾えます)`,
        );
      }
      if (extra.length > 0) {
        console.warn(
          `  ⚠ 入力に無い試合が ${extra.length} 件混ざっています。` +
            `MERGE_IN に別の教材の成果 (別ラウンドの part 出力など) が入っていないか確認してください`,
        );
      }
    }
  }
}

main();
