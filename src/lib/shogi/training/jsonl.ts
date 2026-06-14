// 学習データの JSONL 形式 (Issue #245 フェーズ0 P0-4)。1 行 = 1 試合 (TrainingGameRecord)。
//
// Node fs に依存しない純粋関数。自己対戦の書き出し (scripts/selfplay-245.ts) と
// 将来の DB 取り込み (import スクリプト) が同じ形式を共有するため、ここに一元化する。
// 1 試合 1 行にすることで DB の TrainingGame + TrainingSample 構造と 1:1 対応し、
// ストリーム処理 (行ごと読み込み) も容易にする。

import type { TrainingGameRecord } from "./types";

export function trainingRecordToJsonl(record: TrainingGameRecord): string {
  return JSON.stringify(record);
}

export function parseTrainingRecordLine(line: string): TrainingGameRecord {
  const obj = JSON.parse(line) as unknown;
  if (
    !obj ||
    typeof obj !== "object" ||
    !("game" in obj) ||
    !("samples" in obj) ||
    !Array.isArray((obj as TrainingGameRecord).samples)
  ) {
    throw new Error("Invalid training JSONL line: missing game / samples");
  }
  return obj as TrainingGameRecord;
}
