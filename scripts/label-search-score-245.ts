// Issue #245 Stage 2 P2-0: search-score ラベル生成 (Pass 1)。
// 設計: docs/plans/issue-245-stage2-learned-eval-design.md §3.1 / §6 P2-0。
//
// 収集済み対局 JSONL の各サンプル局面を World 探索 (findBestMoveWorld) で深さ D まで読み、
// **move-only backed-up score (先手絶対視点 cp)** を searchScore として各サンプルへ付与した
// 「拡張対局 JSONL」を書き出す。α 混合 + tanh squash は encode 段 (encode-training-245.ts、
// 安価・α 再校正で再実行可) が行う。本 Pass は α 非依存ゆえ 1 度だけ走らせてキャッシュする。
//
// ★iteration-0 のラベルは **move-only** (rootMoveScores の max)。理由:
//  - Stage 1 で判明した真因 = 盤面評価 pieceSafety の 1 手先しか見ない浅さ。move-only の深読み
//    (D≥4) が「飛車が深入りして捕まる」を解決し、その backed-up 値が過大評価を排除する (本丸)。
//  - draw を採点に含めない = 山札順序 (encoder 非符号化の隠れ状態) への label 依存を断つ (M1 MAJOR)。
//  - カード価値は leaf cardDigest (手札がリーフ評価に効く) + encoder 特徴で label に残る。
//  - card 行動を探索木で展開して採点するのは Stage 2 で評価が改善されてから (§4.4 deep-node と対)。
//
// ★重い (局面数 × D 探索)。smoke で 1 局あたりの所要を実測し D を 4↔5 で確定する (§8)。
//
// 使い方 (リポジトリルートで):
//   LABEL_IN=local-data/training/human-245.jsonl LABEL_OUT=local-data/training/labeled-human-D4.jsonl \
//     LABEL_DEPTH=4 LABEL_MAX_GAMES=1 npx tsx scripts/label-search-score-245.ts
//
// env:
//   LABEL_IN        入力対局 JSONL (既定 local-data/training/human-245.jsonl)
//   LABEL_OUT       出力拡張 JSONL (既定 local-data/training/labeled-245.jsonl)
//   LABEL_DEPTH     探索深さ D (既定 4)
//   LABEL_TIME_MS   1 局面あたりの安全網時間上限 (既定 600000 = 探索が D で完了し切れる十分大)
//   LABEL_MAX_GAMES 処理する試合数の上限 (既定 = 全件。smoke では 1〜2)

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { evaluatePositionWorldMoveOnly } from "@/lib/shogi/ai/search";
import { createSearchContext } from "@/lib/shogi/ai/search-context";
import { deserializeGameState } from "@/lib/shogi/board";
import { deserializeCardState } from "@/lib/shogi/cards/state";
import { parseTrainingRecordLine, trainingRecordToJsonl } from "@/lib/shogi/training/jsonl";
import type { GameState } from "@/lib/shogi/types";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";

const IN = process.env.LABEL_IN ?? "local-data/training/human-245.jsonl";
const OUT = process.env.LABEL_OUT ?? "local-data/training/labeled-245.jsonl";
const DEPTH = Number(process.env.LABEL_DEPTH ?? "4");
const TIME_MS = Number(process.env.LABEL_TIME_MS ?? "600000");
const MAX_GAMES = Number(process.env.LABEL_MAX_GAMES ?? String(Number.MAX_SAFE_INTEGER));

// 学習用 boardState は moveHistory / positionHistory を除外している (serializeBoardForTraining)。
// 探索は両者を参照しうる (千日手検出等) ため空配列で補って GameState を復元する。局面を独立採点
// するゆえ履歴空でも採点の妥当性は保たれる (千日手は発火しないだけ)。
function reconstructState(boardState: unknown): GameState {
  return deserializeGameState({
    ...(boardState as Record<string, unknown>),
    moveHistory: [],
    positionHistory: [],
  });
}

function main() {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, ""); // truncate (Pass 1 は α 非依存ゆえ毎回作り直しでよい)

  const content = readFileSync(IN, "utf8");
  const lines = content.split("\n").filter((l) => l.trim().length > 0);

  let games = 0;
  let samples = 0;
  const startedAll = performance.now();

  for (const line of lines) {
    if (games >= MAX_GAMES) break;
    const record = parseTrainingRecordLine(line);
    const gStart = performance.now();

    for (const sample of record.samples) {
      const state = reconstructState(sample.boardState);
      const cardState = deserializeCardState(sample.cardState);
      const ctx = createSearchContext({ timeLimitMs: TIME_MS, useLearnedEval: false });
      // move-only backed-up 評価値 (先手絶対視点 cp)。終局/合法手なしでも negamaxWorld が確定値を返す
      // (詰み ±MATE / ステールメイト 0) ため null にはならない。
      const score = evaluatePositionWorldMoveOnly(state, cardState, DEPTH, CARD_SHOGI_VARIANT, ctx);
      sample.searchScore = score;
      samples += 1;
    }

    appendFileSync(OUT, trainingRecordToJsonl(record) + "\n");
    games += 1;
    const gMs = performance.now() - gStart;
    console.log(
      `game ${games}: ${record.samples.length} samples, ${(gMs / 1000).toFixed(1)}s ` +
        `(${(gMs / record.samples.length).toFixed(0)} ms/局面), source=${record.game.source}`,
    );
  }

  const totalMs = performance.now() - startedAll;
  console.log(`\nDone. ${games} 試合 / ${samples} サンプル -> ${OUT}`);
  console.log(`  depth=${DEPTH}, 総時間 ${(totalMs / 1000).toFixed(1)}s, 平均 ${(totalMs / Math.max(1, samples)).toFixed(0)} ms/局面`);
}

main();
