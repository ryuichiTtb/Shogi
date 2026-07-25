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
//   LABEL_IN        入力対局 JSONL (カンマ区切りで複数可、既定 local-data/training/human-245.jsonl)
//   LABEL_DEPTH     探索深さ D (既定 4)
//   LABEL_TIME_MS   1 局面あたりの安全網時間上限 (既定 600000 = 探索が D で完了し切れる十分大)
//   LABEL_MAX_GAMES 処理する試合数の上限 (全入力横断・shard 適用前に先頭から切出。既定 = 全件)
//   LABEL_SHARD_COUNT / LABEL_SHARD_INDEX  並列分散 (8 コア活用)。COUNT 分割の INDEX 番目の試合のみ
//     処理する (試合 i を i%COUNT===INDEX のシャードが担当)。既定 1/0 = 分散なし。各シャードは別 OUT
//     を指定し、完了後に concat する (シェルの起動側が担う)。production 非依存のデータ準備スクリプト。
//   LABEL_RESUME    "1" で再開モード (既定 "0" = 従来どおり OUT を作り直す)。
//     ★D=5 は 1 局に数十分かかりうる長時間バッチのため、途中停止 (kill / マシン再起動) から
//     「済んだ試合を採点し直さずに続ける」手段が必要。OUT を truncate せず追記し、既に OUT に
//     入っている試合をスキップする。突合は **searchScore を除いた行の正規形 (内容キー)** で行うので、
//     行番号や shard 設定に依存しない (= 入力順序が変わっても既済判定が壊れない)。
//     同一内容の試合が入力に複数ある場合も多重集合で数を合わせるため取りこぼさない。
//     途中 kill で最終行が途切れている場合はその行を破棄してから再開する (壊れた行の再利用防止)。
//     OUT 全行を parse するので巨大 OUT (数百 MB) では起動が数秒〜数十秒重くなる。再開時のみ有効化する。
//   ★winner=null (中断) の試合は採点せず除外する (encode 段でも除外され学習に使われないため、
//     高コストな探索を無駄打ちしない)。

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { evaluatePositionWorldMoveOnly } from "@/lib/shogi/ai/search";
import { createSearchContext } from "@/lib/shogi/ai/search-context";
import { deserializeGameState } from "@/lib/shogi/board";
import { deserializeCardState } from "@/lib/shogi/cards/state";
import { parseTrainingRecordLine, trainingRecordToJsonl } from "@/lib/shogi/training/jsonl";
import type { TrainingGameRecord } from "@/lib/shogi/training/types";
import type { GameState } from "@/lib/shogi/types";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";

const IN = (process.env.LABEL_IN ?? "local-data/training/human-245.jsonl")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const OUT = process.env.LABEL_OUT ?? "local-data/training/labeled-245.jsonl";
const DEPTH = Number(process.env.LABEL_DEPTH ?? "4");
const TIME_MS = Number(process.env.LABEL_TIME_MS ?? "600000");
const MAX_GAMES = Number(process.env.LABEL_MAX_GAMES ?? String(Number.MAX_SAFE_INTEGER));
const SHARD_COUNT = Math.max(1, Number(process.env.LABEL_SHARD_COUNT ?? "1"));
const SHARD_INDEX = Math.max(0, Number(process.env.LABEL_SHARD_INDEX ?? "0"));
const RESUME = (process.env.LABEL_RESUME ?? "0") === "1";

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

// 出力行 ↔ 入力行の同一性キー (再開用)。searchScore は本スクリプトが後付けする唯一のフィールドゆえ、
// それを除けば出力行は入力行と同一内容になる。入力側・出力側を同じ関数で正規化するので、
// キー順や空白の差では不一致にならない。
function labelIdentityKey(record: TrainingGameRecord): string {
  return JSON.stringify({
    game: record.game,
    samples: record.samples.map(({ searchScore: _score, ...rest }) => rest),
  });
}

// 既存 OUT を読み、既済試合の内容キー多重集合 (キー -> 残件数) を返す。
// 途中 kill で最終行が JSON 途切れになっている場合はその行以降を破棄して OUT を書き戻す。
function loadCompletedKeys(): Map<string, number> {
  const done = new Map<string, number>();
  let raw: string;
  try {
    raw = readFileSync(OUT, "utf8");
  } catch {
    return done; // OUT 未作成 = 既済ゼロ (初回相当)
  }
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  const kept: string[] = [];
  for (const line of lines) {
    let record: TrainingGameRecord;
    try {
      record = parseTrainingRecordLine(line);
    } catch {
      // 不完全行 (kill で書き込み途中)。以降の行も信用できないので打ち切り、ここまでを残す。
      break;
    }
    const key = labelIdentityKey(record);
    done.set(key, (done.get(key) ?? 0) + 1);
    kept.push(line);
  }
  if (kept.length !== lines.length) {
    writeFileSync(OUT, kept.length > 0 ? kept.join("\n") + "\n" : "");
    console.warn(
      `[label] 不完全な末尾 ${lines.length - kept.length} 行を破棄して再開します: ${OUT}`,
    );
  }
  return done;
}

function main() {
  mkdirSync(dirname(OUT), { recursive: true });
  // 再開モードでは OUT を残して追記する。通常モードは Pass 1 が α 非依存ゆえ毎回作り直してよい。
  const completed = RESUME ? loadCompletedKeys() : new Map<string, number>();
  if (!RESUME) writeFileSync(OUT, ""); // truncate

  // 全入力ファイルの行を結合 → MAX_GAMES で先頭から切出 (shard 適用前) → このシャード担当行のみ抽出。
  // 全シャードが同じ「先頭 MAX_GAMES 試合」の窓を見るよう、切出はシャード分割の前に行う。
  let allLines: string[] = [];
  for (const file of IN) {
    try {
      allLines.push(...readFileSync(file, "utf8").split("\n").filter((l) => l.trim().length > 0));
    } catch {
      console.warn(`[label-search-score-245] 入力が読めません (skip): ${file}`);
    }
  }
  if (Number.isFinite(MAX_GAMES)) allLines = allLines.slice(0, MAX_GAMES);
  const myLines = allLines.filter((_, i) => i % SHARD_COUNT === SHARD_INDEX);
  console.log(
    `shard ${SHARD_INDEX}/${SHARD_COUNT}: 全 ${allLines.length} 試合中 ${myLines.length} 試合を担当`,
  );

  let games = 0;
  let samples = 0;
  let skipped = 0; // winner=null (中断) で採点除外した試合
  let resumed = 0; // 再開モードで既済としてスキップした試合
  let nearTimeout = 0; // 時間上限に迫った局面 (= 深さ D まで読み切れず浅いラベルの疑い)
  const startedAll = performance.now();

  for (const line of myLines) {
    const record = parseTrainingRecordLine(line);
    // winner=null (中断) は encode 段でも除外される → 高コストな探索を無駄打ちせず skip。
    if (record.game.winner == null) {
      skipped += 1;
      continue;
    }
    if (RESUME) {
      const key = labelIdentityKey(record);
      const left = completed.get(key) ?? 0;
      if (left > 0) {
        completed.set(key, left - 1); // 同一内容の試合が複数あっても件数分だけスキップする
        resumed += 1;
        continue;
      }
    }
    const gStart = performance.now();

    for (const sample of record.samples) {
      const state = reconstructState(sample.boardState);
      const cardState = deserializeCardState(sample.cardState);
      const ctx = createSearchContext({ timeLimitMs: TIME_MS, useLearnedEval: false });
      // move-only backed-up 評価値 (先手絶対視点 cp)。終局/合法手なしでも negamaxWorld が確定値を返す
      // (詰み ±MATE / ステールメイト 0) ため null にはならない。
      const pStart = performance.now();
      const score = evaluatePositionWorldMoveOnly(state, cardState, DEPTH, CARD_SHOGI_VARIANT, ctx);
      // 時間上限に達すると反復深化が D 未満で打ち切られ、ラベルが静かに浅くなる。
      // 検知できるよう上限の 90% を超えた局面を数え、最後に警告する (計測コストは 1 回の now())。
      if (performance.now() - pStart >= TIME_MS * 0.9) nearTimeout += 1;
      sample.searchScore = score;
      samples += 1;
    }

    appendFileSync(OUT, trainingRecordToJsonl(record) + "\n");
    games += 1;
    const gMs = performance.now() - gStart;
    console.log(
      `game ${resumed + games}: ${record.samples.length} samples, ${(gMs / 1000).toFixed(1)}s ` +
        `(${(gMs / record.samples.length).toFixed(0)} ms/局面), source=${record.game.source}`,
    );
  }

  const totalMs = performance.now() - startedAll;
  console.log(`\nDone (shard ${SHARD_INDEX}/${SHARD_COUNT}). ${games} 試合 / ${samples} サンプル (中断除外 ${skipped}) -> ${OUT}`);
  console.log(`  depth=${DEPTH}, 総時間 ${(totalMs / 1000).toFixed(1)}s, 平均 ${(totalMs / Math.max(1, samples)).toFixed(0)} ms/局面`);
  if (RESUME) {
    const orphans = [...completed.values()].reduce((a, b) => a + b, 0);
    console.log(`  再開: 既済 ${resumed} 試合をスキップ (このシャード担当分の通算 ${resumed + games} 試合)`);
    if (orphans > 0) {
      console.warn(
        `  ⚠ OUT に入力側と対応しない ${orphans} 行があります。LABEL_IN / LABEL_SHARD_* の取り違えを確認してください`,
      );
    }
  }
  if (nearTimeout > 0) {
    console.warn(
      `  ⚠ ${nearTimeout} 局面が時間上限 (${TIME_MS} ms) の 90% を超えました = 深さ ${DEPTH} 未達の疑い。LABEL_TIME_MS を上げて再採点を検討してください`,
    );
  }
}

main();
