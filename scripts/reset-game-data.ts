// 学習用データ収集 (Issue #245) に向け、学習価値のない既存の対局データを一掃する。
//
// 削除対象: GameMove (全手) / Game (全対局) / PlayerStats (勝敗・レーティング)。
// 残すもの: Card マスタ / Deck / User / 所持カード / UI 設定 (= 棋譜ではないため)。
//
// 旧 Game/GameMove は各手番の cardState も eventLog も持たず、学習教材として価値がない
// (Issue #245 フェーズ0)。新方式 (TrainingGame/TrainingSample) で取り直すため一掃する。
// 自己対戦の再学習サイクルでデータを作り直す際の初期化にも再利用できる。
//
// 実行 (ドライラン = 件数表示のみ・無害): npx tsx scripts/reset-game-data.ts
// 実行 (実削除):                          npx tsx scripts/reset-game-data.ts --confirm
//
// ⚠️ --confirm は本番 Neon DB に対する取り消し不可の削除。AGENTS rule 5 により、
//    ユーザーの明示的な確認のもとでのみ実行すること。

import "dotenv/config";
import { prisma } from "../src/lib/prisma";

async function main() {
  const confirm = process.argv.includes("--confirm");

  const [games, moves, stats] = await Promise.all([
    prisma.game.count(),
    prisma.gameMove.count(),
    prisma.playerStats.count(),
  ]);

  console.log("=== 削除対象 (現在の件数) ===");
  console.log(`  GameMove    : ${moves} 件`);
  console.log(`  Game        : ${games} 件`);
  console.log(`  PlayerStats : ${stats} 件`);

  if (!confirm) {
    console.log("\n[dry-run] --confirm 未指定のため削除していません。");
    console.log("実削除するには: npx tsx scripts/reset-game-data.ts --confirm");
    return;
  }

  console.log("\n--confirm 指定 → 削除を実行します...");
  // FK 制約: GameMove は Game に onDelete:Cascade。子 → 親の明示順で安全に削除する。
  const delMoves = await prisma.gameMove.deleteMany({});
  const delGames = await prisma.game.deleteMany({});
  const delStats = await prisma.playerStats.deleteMany({});

  console.log("=== 削除結果 ===");
  console.log(`  GameMove    : ${delMoves.count} 件 削除`);
  console.log(`  Game        : ${delGames.count} 件 削除`);
  console.log(`  PlayerStats : ${delStats.count} 件 削除`);
  console.log("\n完了。");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[reset-game-data] 失敗:", e);
    process.exit(1);
  });
