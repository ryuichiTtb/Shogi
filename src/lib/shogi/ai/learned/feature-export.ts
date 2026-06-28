// 学習特徴の書き出しブリッジ (Issue #245 フェーズ1 P1-1→P1-2 連結)。
//
// 収集済みの対局 (TrainingGameRecord) を、学習側 (Python) が読む「特徴ベクトル + 勝敗ラベル」へ
// 変換する。★符号化は learned/encoder.ts の encodePosition を**そのまま**使う = Python 側で
// encoder を再実装しない (train/inference スキューを構造的に防ぐ、計画 §3 論点B / M1)。
//
// 出力は疎表現 (非ゼロのみ idx/val)。盤面 one-hot 等で特徴の大半は 0 ゆえ、密 (FEATURE_DIM≈数千)
// より桁違いに小さく、Python 側で FEATURE_DIM から密へ復元できる (オーダー量・I/O の最小化)。
//
// 純関数のみ (Node fs / Python 非依存)。実 I/O は scripts/encode-training-245.ts が担う。

import { deserializeCardState } from "@/lib/shogi/cards/state";
import type { Player } from "@/lib/shogi/types";
import type { TrainingGameRecord, TrainingSampleData } from "@/lib/shogi/training/types";

import { squashBootstrapLabel, type BootstrapLabelParams } from "./bootstrap-label";
import { encodePosition, type EncoderPosition } from "./encoder";

// 勝敗 → 先手絶対視点のラベル z ∈ {+1, 0, -1} (encoder/評価の「正=先手有利」規約に一致)。
// winner=null (中断) は学習対象外 → null を返し、呼び出し側が除外する。
export function winnerToLabel(winner: Player | "draw" | null | undefined): number | null {
  switch (winner) {
    case "sente":
      return 1;
    case "gote":
      return -1;
    case "draw":
      return 0;
    default:
      return null;
  }
}

// 疎な特徴行 (非ゼロのみ)。dense は FEATURE_DIM 次元のゼロ配列に idx→val を書けば復元できる。
export interface SparseFeatureRow {
  label: number; // 先手絶対視点 z (= ゲーム結果。全サンプル共通)
  sideToMove: Player; // 補助情報 (将来の手番視点正規化・分析用)
  game: number; // 試合インデックス。★試合単位の train/val 分割でデータリークを防ぐためのキー。
  idx: number[]; // 非ゼロ特徴の索引 (昇順)
  val: number[]; // idx に対応する値
}

// 1 サンプル (行動前局面) → 疎特徴行。
// boardState は serializeBoardForTraining 出力 = 構造的に EncoderPosition を満たす。
// cardState は serializeCardState 出力 → deserializeCardState で CardGameState へ復元。
export function sampleToSparseRow(
  sample: TrainingSampleData,
  label: number,
  game = 0,
): SparseFeatureRow {
  const pos = sample.boardState as EncoderPosition;
  const card = deserializeCardState(sample.cardState);
  const f = encodePosition(pos, card);
  const idx: number[] = [];
  const val: number[] = [];
  for (let i = 0; i < f.length; i++) {
    if (f[i] !== 0) {
      idx.push(i);
      val.push(f[i]);
    }
  }
  return { label, sideToMove: sample.sideToMove, game, idx, val };
}

// 1 試合 → 特徴行列 (ゲーム結果ラベルを全サンプルへ付与)。
// winner=null (中断) の試合は学習対象外ゆえ空配列を返す。
// game (試合インデックス) は呼び出し側が一意に採番し、試合単位の train/val 分割キーとして使う。
export function gameToSparseRows(record: TrainingGameRecord, game = 0): SparseFeatureRow[] {
  const label = winnerToLabel(record.game.winner);
  if (label === null) return [];
  return record.samples.map((s) => sampleToSparseRow(s, label, game));
}

// Issue #245 Stage 2: search-score bootstrapping ラベルで 1 試合 → 特徴行列。
// 各サンプルの searchScore (Pass 1 で付与、先手絶対視点 cp) と試合の outcome (z) を §3.4 の
// cp 空間混合 → tanh squash でラベル化する (label ∈ [-1,1])。searchScore が無い/null のサンプルは
// outcome のみを squash したラベル (= α 無効 = 純 outcome) を付け、label 空間を [-1,1] で一貫させる。
// winner=null (中断) の試合は学習対象外ゆえ空配列を返す (outcome 同様)。
export function gameToBootstrapRows(
  record: TrainingGameRecord,
  params: BootstrapLabelParams,
  game = 0,
): SparseFeatureRow[] {
  const outcomeZ = winnerToLabel(record.game.winner);
  if (outcomeZ === null) return [];
  return record.samples.map((s) => {
    const ss = s.searchScore;
    const label =
      ss === undefined || ss === null
        ? squashBootstrapLabel(0, outcomeZ, { ...params, alpha: 0 }) // search 無 → outcome のみ squash
        : squashBootstrapLabel(ss, outcomeZ, params);
    return sampleToSparseRow(s, label, game);
  });
}
