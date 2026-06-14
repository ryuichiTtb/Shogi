"use server";

// 学習データ収集の保存先 (DB sink) — Issue #245 フェーズ0 P0-3。
//
// 人間対局のキャプチャ (use-card-shogi-game.ts) が終局時に 1 試合分をまとめて呼ぶ。
// 既存の対局保存 (game.ts の saveCardShogiMove 等) とは完全に独立した別経路・別
// トランザクションで、失敗が対局保存・プレイへ波及しない best-effort 設計 (M1 M-1)。

import { prisma } from "@/lib/prisma";
import type { TrainingGameData, TrainingSampleData } from "@/lib/shogi/training/types";

// 収集の有効/無効 (server 側で評価し client バンドルに env を漏らさない)。
// 既定 OFF (M1 §5-4): db push でテーブルを作成し、本番 env に
// ENABLE_TRAINING_CAPTURE=true を設定して初めて記録が有効になる (二重ガード)。
function isTrainingCaptureEnabled(): boolean {
  return process.env.ENABLE_TRAINING_CAPTURE === "true";
}

// 人間対局 1 試合分 (メタ + per-decision サンプル列) を学習用テーブルへ確定保存する。
// 中断対局 (winner=null) は学習価値が無いため保存しない。
export async function recordTrainingGame(
  game: TrainingGameData,
  samples: TrainingSampleData[],
): Promise<void> {
  if (!isTrainingCaptureEnabled()) return; // OFF: テーブル不在 (db push 前) でも安全
  if (game.winner == null) return; // 中断対局 = 学習除外
  if (samples.length === 0) return;

  try {
    await prisma.$transaction(async (tx) => {
      const created = await tx.trainingGame.create({
        data: {
          source: game.source,
          variantId: game.variantId,
          senteDifficulty: game.senteDifficulty ?? null,
          senteCharacterId: game.senteCharacterId ?? null,
          goteDifficulty: game.goteDifficulty ?? null,
          goteCharacterId: game.goteCharacterId ?? null,
          humanColor: game.humanColor ?? null,
          deckSpecSente: (game.deckSpecSente ?? null) as never,
          deckSpecGote: (game.deckSpecGote ?? null) as never,
          winner: game.winner ?? null,
          finalStatus: game.finalStatus,
          moveCount: game.moveCount,
          engineVersion: game.engineVersion ?? null,
          sourceGameId: game.sourceGameId ?? null,
        },
        select: { id: true },
      });

      await tx.trainingSample.createMany({
        data: samples.map((s) => ({
          trainingGameId: created.id,
          plyIndex: s.plyIndex,
          moveCount: s.moveCount,
          sideToMove: s.sideToMove,
          boardState: s.boardState as never,
          cardState: s.cardState as never,
          action: s.action as never,
          events: s.events as never,
        })),
      });
    });
  } catch (e) {
    // テーブル不在 (db push 前) / 接続失敗等は全て握り潰す。対局保存・プレイに影響させない。
    console.error("[recordTrainingGame] 学習データ保存に失敗 (best-effort, 無視):", e);
  }
}
