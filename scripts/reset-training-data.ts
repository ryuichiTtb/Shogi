// 学習データ (TrainingGame / TrainingSample) の初期化 (Issue #245)。
//
// 取り直し (re-collection) や不完全データの除去に使う。reset-game-data.ts (旧 Game/GameMove)
// とは対象が別 (こちらは学習用テーブル)。ドライラン既定 + --confirm 実削除のガード付き。
//
// 実行 (worktree ルートで。worktree に .env が無い場合は DOTENV_CONFIG_PATH を指定):
//   npx tsx scripts/reset-training-data.ts            (ドライラン = 件数表示のみ)
//   npx tsx scripts/reset-training-data.ts --confirm  (実削除)
//
// ⚠️ --confirm は本番 Neon DB の取り消し不可な削除。AGENTS rule 5 によりユーザー確認下でのみ。

import "dotenv/config";
import { prisma } from "../src/lib/prisma";

async function main() {
  const confirm = process.argv.includes("--confirm");

  const [games, samples] = await Promise.all([
    prisma.trainingGame.count(),
    prisma.trainingSample.count(),
  ]);

  console.log("=== 削除対象 (現在の件数) ===");
  console.log(`  TrainingSample: ${samples} サンプル`);
  console.log(`  TrainingGame  : ${games} 試合`);

  if (!confirm) {
    console.log("\n[dry-run] --confirm 未指定のため削除していません。");
    console.log("実削除するには: npx tsx scripts/reset-training-data.ts --confirm");
    return;
  }

  console.log("\n--confirm 指定 → 削除を実行します...");
  // TrainingSample は TrainingGame に onDelete:Cascade。子 → 親の明示順で安全に削除。
  const delSamples = await prisma.trainingSample.deleteMany({});
  const delGames = await prisma.trainingGame.deleteMany({});

  console.log("=== 削除結果 ===");
  console.log(`  TrainingSample: ${delSamples.count} 件 削除`);
  console.log(`  TrainingGame  : ${delGames.count} 件 削除`);
  console.log("\n完了。");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[reset-training-data] 失敗:", e);
    process.exit(1);
  });
