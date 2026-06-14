// 学習用データの保存先 (sink) — フレームワーク非依存のコア。
//
// TrainingSink インターフェースは types.ts が定義。本ファイルは、テストや
// in-memory 用途で使う MemoryTrainingSink を提供する。Node fs に依存する JSONL シンクや
// Prisma に依存する DB シンクは、それぞれ利用側 (scripts / server) の Node-safe な場所に置く
// (client バンドルへ node:fs / prisma が混入しないようにするため)。

import type { TrainingGameData, TrainingSampleData, TrainingSink } from "./types";

export type { TrainingSink } from "./types";

// 書いた試合をメモリ配列に貯めるだけのシンク。テスト・小規模検証用。
export class MemoryTrainingSink implements TrainingSink {
  readonly games: { game: TrainingGameData; samples: TrainingSampleData[] }[] = [];

  writeGame(game: TrainingGameData, samples: TrainingSampleData[]): Promise<void> {
    this.games.push({ game, samples });
    return Promise.resolve();
  }

  get totalSamples(): number {
    return this.games.reduce((sum, g) => sum + g.samples.length, 0);
  }
}
