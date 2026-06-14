// 学習データの DB → JSONL エクスポート (Issue #245 フェーズ1 P1-0)。
//
// Neon の TrainingGame / TrainingSample を読み取り、1 行 = 1 試合 (TrainingGameRecord) の
// JSONL へ書き出す。自己対戦 (scripts/selfplay-245.ts) が吐く JSONL と同一形式へ収束させ、
// 人間対局 (DB) と自己対戦 (DB or JSONL) を 1 つの学習入力ストリームに統一する。
// 変換は純関数 toTrainingGameRecord (src/lib/shogi/training/db-record.ts) に委譲し、
// 本スクリプトは Prisma 取得 (カーソルページング = メモリ有界) + fs 書き出しの I/O のみを担う。
//
// 読み取り専用 (DB への書き込みは一切しない)。中断対局 (winner=null) は既定で学習除外する。
//
// 使い方 (リポジトリルートで。worktree に .env が無い場合は DOTENV_CONFIG_PATH を指定):
//   npx tsx scripts/export-training-245.ts
//   EXPORT_OUT=docs/training-data/all.jsonl EXPORT_SOURCE=human \
//     DOTENV_CONFIG_PATH=/abs/path/.env npx tsx scripts/export-training-245.ts
//
// env:
//   EXPORT_OUT             出力先 (既定 /tmp/training-export-245.jsonl)
//   EXPORT_SOURCE          "human" | "self_play" | "all" (既定 all)
//   EXPORT_INCLUDE_NULL_WINNER  "1" で中断対局 (winner=null) も含める (既定: 除外)
//   EXPORT_BATCH           1 クエリで取得する試合数 (既定 100、メモリ/往復のトレードオフ)

import "dotenv/config";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { prisma } from "../src/lib/prisma";
import { toTrainingGameRecord } from "@/lib/shogi/training/db-record";
import { trainingRecordToJsonl } from "@/lib/shogi/training/jsonl";

const OUT = process.env.EXPORT_OUT ?? "/tmp/training-export-245.jsonl";
const SOURCE = (process.env.EXPORT_SOURCE ?? "all").toLowerCase();
const INCLUDE_NULL_WINNER = process.env.EXPORT_INCLUDE_NULL_WINNER === "1";
const BATCH = Math.max(1, Number(process.env.EXPORT_BATCH ?? "100") || 100);

async function main() {
  // フィルタ: source 指定 + 中断対局 (winner=null) は既定で学習除外。
  const where = {
    ...(SOURCE === "human" || SOURCE === "self_play" ? { source: SOURCE } : {}),
    ...(INCLUDE_NULL_WINNER ? {} : { winner: { not: null } }),
  };

  const total = await prisma.trainingGame.count({ where });
  console.log(`=== 学習データ export (source=${SOURCE}, 中断含む=${INCLUDE_NULL_WINNER}) ===`);
  console.log(`対象 TrainingGame: ${total} 試合 → ${OUT}`);

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, ""); // truncate

  let exported = 0;
  let totalSamples = 0;
  const winners: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  let cursorId: string | undefined;

  // カーソルページング (id 昇順)。全件を一度にメモリへ載せず、BATCH 単位で取得・書き出す。
  for (;;) {
    const games = await prisma.trainingGame.findMany({
      where,
      orderBy: { id: "asc" },
      take: BATCH,
      ...(cursorId ? { skip: 1, cursor: { id: cursorId } } : {}),
      include: { samples: { orderBy: { plyIndex: "asc" } } },
    });
    if (games.length === 0) break;

    let chunk = "";
    for (const g of games) {
      const rec = toTrainingGameRecord(g, g.samples);
      chunk += trainingRecordToJsonl(rec) + "\n";
      exported += 1;
      totalSamples += rec.samples.length;
      const w = rec.game.winner ?? "null";
      winners[w] = (winners[w] ?? 0) + 1;
      bySource[rec.game.source] = (bySource[rec.game.source] ?? 0) + 1;
    }
    appendFileSync(OUT, chunk);

    cursorId = games[games.length - 1].id;
    console.log(`  ... ${exported}/${total} 試合 書き出し`);
    if (games.length < BATCH) break;
  }

  console.log(`\nDone. ${exported} 試合 / ${totalSamples} サンプル -> ${OUT}`);
  console.log(`  source 内訳: ${JSON.stringify(bySource)}`);
  console.log(`  winner 内訳: ${JSON.stringify(winners)}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[export-training-245] 失敗:", e);
    process.exit(1);
  });
