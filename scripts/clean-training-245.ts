// Issue #245 Stage 2: 学習教材のクリーニング (重複除去 + 低品質試合の除外)。
//
// 背景 (2026-07-26 の教材多様性測定で判明した事実):
// - 348 試合中 **68 試合 (19.5%) が全行動列まで完全に同一** (最大クラスタは 35 試合が
//   25 手の同一千日手)。distinct な棋譜は 280 本しかなく、試合数が水増しされていた。
// - **千日手が 120 試合 (34.5%)・8,076 サンプル (22.5%)**。これは「双方最善で互角」ではなく
//   「決定的な AI 同士が進展手を見つけられずループした」局面で、search-score bootstrapping の
//   ラベル源としては停滞そのものを教えることになる。
// - 試合を跨いで完全一致する局面が 6,830 サンプル (19.0%)。序盤に集中する。
//
// 重複判定は **エンコーダが実際に見る入力** (sampleToSparseRow の idx/val) で行う。盤面が同じでも
// マナ・手札・トラップが違えば別入力なので学習上は別サンプルであり、そこを潰すと情報が減るため。
// 逆に idx/val が完全一致するサンプルは、モデルから見て区別不能な同じ入力 = 重み増しでしかない。
//
// 使い方 (リポジトリルートで):
//   CLEAN_IN=local-data/training/labeled-348-D5.jsonl \
//     CLEAN_OUT=local-data/training/labeled-clean-D5.jsonl \
//     npx tsx scripts/clean-training-245.ts
//
// env:
//   CLEAN_IN         入力 JSONL (カンマ区切りで複数可)
//   CLEAN_OUT        出力 JSONL
//   CLEAN_DROP_STATUS 除外する finalStatus (カンマ区切り、既定 "repetition")。"" で無効
//   CLEAN_DEDUP_GAMES     "1" (既定) で全行動列が既出の試合を落とす
//   CLEAN_DEDUP_POSITIONS "1" (既定) でエンコーダ入力が既出のサンプルを落とす
//   CLEAN_ALLOW_MIXED_RECIPE "1" でラベル生成レシピの混在を許して続行する (既定 "0" = 停止)
//   ★入力は読み取り専用。出力は必ず別ファイル (生成に丸一日かかった教材を壊さないため)。

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { sampleToSparseRow } from "@/lib/shogi/ai/learned/feature-export";
import { parseTrainingRecordLine, trainingRecordToJsonl } from "@/lib/shogi/training/jsonl";
import type { TrainingGameRecord } from "@/lib/shogi/training/types";

import { recipeKey } from "./utils/label-identity";

const IN = (process.env.CLEAN_IN ?? "local-data/training/labeled-348-D5.jsonl")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const OUT = process.env.CLEAN_OUT ?? "local-data/training/labeled-clean-D5.jsonl";
const DROP_STATUS = new Set(
  (process.env.CLEAN_DROP_STATUS ?? "repetition")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
const DEDUP_GAMES = (process.env.CLEAN_DEDUP_GAMES ?? "1") === "1";
const DEDUP_POSITIONS = (process.env.CLEAN_DEDUP_POSITIONS ?? "1") === "1";
const ALLOW_MIXED_RECIPE = (process.env.CLEAN_ALLOW_MIXED_RECIPE ?? "0") === "1";

function sha(s: string): string {
  return createHash("sha1").update(s).digest("hex").slice(0, 20);
}

/** 試合の同一性 = 全行動列。盤面は行動列から一意に決まるので action だけで足りる。 */
function gameActionHash(record: TrainingGameRecord): string {
  return sha(JSON.stringify(record.samples.map((s) => s.action)));
}

/** サンプルの同一性 = エンコーダが実際に見る入力 (非ゼロ特徴の索引と値)。 */
function encoderInputHash(record: TrainingGameRecord, index: number): string {
  const row = sampleToSparseRow(record.samples[index], 0, 0);
  return sha(`${row.idx.join(",")}|${row.val.map((v) => v.toFixed(4)).join(",")}`);
}

function main() {
  const lines: string[] = [];
  for (const file of IN) {
    try {
      lines.push(...readFileSync(file, "utf8").split("\n").filter((l) => l.trim().length > 0));
    } catch {
      console.warn(`[clean] 読めません (skip): ${file}`);
    }
  }

  let inGames = 0;
  let inSamples = 0;
  let droppedStatusGames = 0;
  let droppedStatusSamples = 0;
  let droppedDupGames = 0;
  let droppedDupGameSamples = 0;
  let droppedDupSamples = 0;
  let droppedEmptyGames = 0;
  const statusBreakdown = new Map<string, number>();

  const seenGameHashes = new Set<string>();
  const seenInputHashes = new Set<string>();
  const out: string[] = [];
  // 複数ファイルを連結する地点なので、ラベル生成レシピの混在をここでも見張る (段1)。
  // 新フローでは clean をラベルの前に回すため通常はすべて未刻印 (legacy) になる。
  const recipes = new Map<string, number>();

  for (const line of lines) {
    const record = parseTrainingRecordLine(line);
    inGames += 1;
    inSamples += record.samples.length;
    const rk = recipeKey(record.game.labelMeta);
    recipes.set(rk, (recipes.get(rk) ?? 0) + 1);
    const status = record.game.finalStatus ?? "(unknown)";
    statusBreakdown.set(status, (statusBreakdown.get(status) ?? 0) + 1);

    // ① 低品質な終局理由の試合を丸ごと除外 (既定は千日手)。
    if (DROP_STATUS.has(status)) {
      droppedStatusGames += 1;
      droppedStatusSamples += record.samples.length;
      continue;
    }

    // ② 全行動列が既出の試合 = 情報ゼロの複製なので落とす。
    if (DEDUP_GAMES) {
      const h = gameActionHash(record);
      if (seenGameHashes.has(h)) {
        droppedDupGames += 1;
        droppedDupGameSamples += record.samples.length;
        continue;
      }
      seenGameHashes.add(h);
    }

    // ③ エンコーダから見て同一入力のサンプルを 1 件に畳む。
    if (DEDUP_POSITIONS) {
      const kept = record.samples.filter((_, i) => {
        const h = encoderInputHash(record, i);
        if (seenInputHashes.has(h)) {
          droppedDupSamples += 1;
          return false;
        }
        seenInputHashes.add(h);
        return true;
      });
      record.samples = kept;
    }

    if (record.samples.length === 0) {
      droppedEmptyGames += 1;
      continue;
    }
    out.push(trainingRecordToJsonl(record));
  }

  // ★複数ファイルを連結する地点なので、レシピ混在は書き出す**前**に止める。
  //   「警告は出したが混在ファイルは作った」状態にすると、後段でそれを掴んでしまう。
  if (recipes.size > 1 && !ALLOW_MIXED_RECIPE) {
    const detail = [...recipes].map(([k, v]) => `${k}: ${v} 試合`).join(" / ");
    console.error(
      `✗ ラベル生成レシピが混在しています [${detail}]。\n` +
        `  混ざったまま学習へ渡すと、同じ局面に別々の正解を教えることになります。\n` +
        `  レシピごとに分けて clean するか、意図的な場合のみ CLEAN_ALLOW_MIXED_RECIPE=1 を指定してください。`,
    );
    process.exit(1);
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, out.length > 0 ? out.join("\n") + "\n" : "");

  const outSamples = out.reduce((n, l) => n + parseTrainingRecordLine(l).samples.length, 0);
  const pct = (n: number, d: number) => (d > 0 ? ((n / d) * 100).toFixed(1) : "0.0");

  console.log("=== 入力 ===");
  console.log(`  ${inGames} 試合 / ${inSamples} サンプル`);
  console.log("  finalStatus 内訳: " + [...statusBreakdown].map(([k, v]) => `${k}:${v}`).join(" / "));
  console.log("  ラベルのレシピ内訳: " + [...recipes].map(([k, v]) => `${k}:${v}`).join(" / "));
  if (recipes.size > 1) {
    console.warn("  ⚠ レシピ混在を CLEAN_ALLOW_MIXED_RECIPE=1 で許可して出力しました (encode 段で停止します)");
  }
  console.log("\n=== 除外 ===");
  console.log(
    `  ① 終局理由 [${[...DROP_STATUS].join(",") || "なし"}]: -${droppedStatusGames} 試合 / -${droppedStatusSamples} サンプル (${pct(droppedStatusSamples, inSamples)}%)`,
  );
  console.log(
    `  ② 完全重複試合: -${droppedDupGames} 試合 / -${droppedDupGameSamples} サンプル (${pct(droppedDupGameSamples, inSamples)}%)`,
  );
  console.log(
    `  ③ 同一エンコーダ入力: -${droppedDupSamples} サンプル (${pct(droppedDupSamples, inSamples)}%)`,
  );
  if (droppedEmptyGames > 0) console.log(`  ④ 残サンプル 0 になった試合: -${droppedEmptyGames} 試合`);
  console.log("\n=== 出力 ===");
  console.log(`  ${out.length} 試合 / ${outSamples} サンプル -> ${OUT}`);
  console.log(
    `  残存率: 試合 ${pct(out.length, inGames)}% / サンプル ${pct(outSamples, inSamples)}%`,
  );
}

main();
