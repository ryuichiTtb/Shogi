// 学習データの点検 (Issue #245 フェーズ0 P0-6)。
//
// 貯まった TrainingGame / TrainingSample の件数・内訳・直近の試合を表示する読み取り専用ツール。
// 人間対局・自己対戦の記録が DB に正しく入っているかの確認に使う (= 収集が機能しているか点検)。
//
// 実行 (worktree ルートで。worktree に .env が無い場合は DOTENV_CONFIG_PATH を指定):
//   npx tsx scripts/training-data-stats.ts
//   STATS_RECENT=20 DOTENV_CONFIG_PATH=/abs/path/.env npx tsx scripts/training-data-stats.ts

import "dotenv/config";
import { prisma } from "../src/lib/prisma";

async function main() {
  const recent = Math.max(1, Number(process.env.STATS_RECENT ?? "10") || 10);

  const [gameCount, sampleCount, bySource] = await Promise.all([
    prisma.trainingGame.count(),
    prisma.trainingSample.count(),
    prisma.trainingGame.groupBy({ by: ["source"], _count: { _all: true } }),
  ]);

  console.log("=== 学習データ統計 ===");
  console.log(`TrainingGame  : ${gameCount} 試合`);
  console.log(`TrainingSample: ${sampleCount} サンプル`);
  for (const s of bySource) {
    console.log(`  - source=${s.source}: ${s._count._all} 試合`);
  }

  const games = await prisma.trainingGame.findMany({
    orderBy: { createdAt: "desc" },
    take: recent,
    select: {
      source: true,
      humanColor: true,
      winner: true,
      finalStatus: true,
      moveCount: true,
      createdAt: true,
      _count: { select: { samples: true } },
    },
  });

  console.log(`\n=== 直近 ${games.length} 試合 (TrainingGame) ===`);
  for (const g of games) {
    console.log(
      `  ${g.createdAt.toISOString()} | source=${g.source} human=${g.humanColor ?? "-"} ` +
        `winner=${g.winner ?? "-"} status=${g.finalStatus} moves=${g.moveCount} samples=${g._count.samples}`,
    );
  }

  // クロスチェック: 既存アプリの対局保存 (Game / GameMove)。
  // カード将棋を実際に指して保存されたかを確認する (TrainingGame と突き合わせる)。
  const [appGames, appMoves] = await Promise.all([prisma.game.count(), prisma.gameMove.count()]);
  console.log(`\n=== 既存アプリ対局 (Game / GameMove) ===`);
  console.log(`Game     : ${appGames} 試合`);
  console.log(`GameMove : ${appMoves} 手`);
  const recentGames = await prisma.game.findMany({
    orderBy: { updatedAt: "desc" },
    take: recent,
    select: { variantId: true, status: true, winner: true, playerColor: true, updatedAt: true, _count: { select: { moves: true } } },
  });
  console.log(`\n=== 直近 ${recentGames.length} 対局 (Game) ===`);
  for (const g of recentGames) {
    console.log(
      `  ${g.updatedAt.toISOString()} | variant=${g.variantId} status=${g.status} ` +
        `winner=${g.winner ?? "-"} playerColor=${g.playerColor} moves=${g._count.moves}`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[training-data-stats] 失敗:", e);
    process.exit(1);
  });
