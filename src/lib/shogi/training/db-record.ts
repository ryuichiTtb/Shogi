// DB 行 (TrainingGame / TrainingSample) → TrainingGameRecord への純粋マッピング
// (Issue #245 フェーズ1 P1-0)。
//
// 学習パイプライン (DB → JSONL export) と自己対戦 (in-memory → JSONL) が
// 同じ TrainingGameRecord 形式へ収束するよう、DB 行の構造を TrainingGameRecord へ
// 変換するロジックをここに一元化する。スクリプト (scripts/export-training-245.ts) は
// Prisma 取得 + fs 書き出しの I/O のみを担い、変換はこの純関数に委譲する
// (training/ の方針 = React/Next/Prisma/Node fs 非依存・疎結合)。
//
// Prisma 生成型に依存しないよう、読み取るフィールドだけを表す構造的入力型を定義する
// (Prisma の Json 型は string|number|... のユニオンだが、ここでは保存時の元構造を
//  ロスレスに復元するため unknown として受け、TrainingSampleData の型へキャストする)。

import type { Difficulty, GameStatus, Player } from "@/lib/shogi/types";
import type { TurnAction } from "@/lib/shogi/kernel/turn-action-types";
import type {
  TrainingEvent,
  TrainingGameData,
  TrainingGameRecord,
  TrainingSampleData,
  TrainingSource,
} from "./types";

// DB の TrainingGame 行のうち export で読むフィールド (Prisma 型非依存の構造的型)。
export interface TrainingGameRow {
  source: string;
  variantId: string;
  senteDifficulty: string | null;
  senteCharacterId: string | null;
  goteDifficulty: string | null;
  goteCharacterId: string | null;
  humanColor: string | null;
  deckSpecSente: unknown;
  deckSpecGote: unknown;
  winner: string | null;
  finalStatus: string;
  moveCount: number;
  engineVersion: string | null;
  sourceGameId: string | null;
}

// DB の TrainingSample 行のうち export で読むフィールド。
export interface TrainingSampleRow {
  plyIndex: number;
  moveCount: number;
  sideToMove: string;
  boardState: unknown;
  cardState: unknown;
  action: unknown;
  events: unknown;
}

function toGameData(row: TrainingGameRow): TrainingGameData {
  // DB は文字列で保存する (Prisma の enum 不使用)。保存元は serialize/types の union 値ゆえ
  // ロスレスに復元できる。null は型どおり null のまま通す。
  return {
    source: row.source as TrainingSource,
    variantId: row.variantId,
    senteDifficulty: (row.senteDifficulty as Difficulty | null) ?? null,
    senteCharacterId: row.senteCharacterId ?? null,
    goteDifficulty: (row.goteDifficulty as Difficulty | null) ?? null,
    goteCharacterId: row.goteCharacterId ?? null,
    humanColor: (row.humanColor as Player | null) ?? null,
    deckSpecSente: row.deckSpecSente ?? null,
    deckSpecGote: row.deckSpecGote ?? null,
    winner: (row.winner as Player | "draw" | null) ?? null,
    finalStatus: row.finalStatus as GameStatus,
    moveCount: row.moveCount,
    engineVersion: row.engineVersion ?? null,
    sourceGameId: row.sourceGameId ?? null,
  };
}

function toSampleData(row: TrainingSampleRow): TrainingSampleData {
  return {
    plyIndex: row.plyIndex,
    moveCount: row.moveCount,
    sideToMove: row.sideToMove as Player,
    boardState: row.boardState,
    cardState: row.cardState,
    action: row.action as TurnAction,
    events: (row.events as TrainingEvent[]) ?? [],
  };
}

// DB 行 (game + その samples) を 1 試合分の TrainingGameRecord へ変換する。
// samples は plyIndex 昇順へ defensively 並べ替える (DB の @@unique([trainingGameId, plyIndex])
// で一意性は保証されるが、取得側の orderBy に依存せず順序を確定させる)。
export function toTrainingGameRecord(
  game: TrainingGameRow,
  samples: readonly TrainingSampleRow[],
): TrainingGameRecord {
  const ordered = [...samples].sort((a, b) => a.plyIndex - b.plyIndex);
  return {
    game: toGameData(game),
    samples: ordered.map(toSampleData),
  };
}
