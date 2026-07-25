// 盤デザイン設定 (UserPreference.boardLayout) の「未設定」への戻し (Issue #250)。
//
// #250 で boardLayout は nullable + @default なしになり「NULL = 未設定 = コード既定
// (DEFAULT_BOARD_LAYOUT_ID) を適用」というセマンティクスになった。しかし既存行には
// 旧 DB 既定 ('light-2') が実値として保存済みで、保存値が優先されるため既定変更が届かない。
// 本スクリプトは既存行を NULL に戻して「未設定」状態へ揃える。
//
// ⚠️ 実行前提 (順序を守ること):
//   1. nullable 化したコードが本番にデプロイ済み (旧 Prisma client は非 NULL 前提のため、
//      デプロイ前に NULL を入れると読み取りで例外になりうる)
//   2. `npm run db:push` で schema (nullable + @default 削除) を DB に適用済み
//      (未適用だと NOT NULL 制約違反 23502 で 1 行も変わらない = 安全側に倒れる)
//
// 実行 (リポジトリルートで。worktree から実行する場合は
//   DOTENV_CONFIG_PATH=/home/ryuichi/workspace/Shogi/.env を付ける):
//   npx tsx scripts/reset-board-layout-preference.ts             (ドライラン = 分布表示のみ)
//   npx tsx scripts/reset-board-layout-preference.ts --confirm   (実行)
//
// ⚠️ --confirm は本番 Neon DB の更新で、明示的に選ばれた盤デザインも失われる (復元は
//    下記スナップショット JSON からの手動 UPDATE のみ)。AGENTS rule 5 によりユーザー確認下でのみ。

import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { prisma } from "../src/lib/prisma";

// 復元用スナップショットの保存先。local-data/ は .gitignore 対象 (非追跡)。
const SNAPSHOT_PATH =
  process.env.BOARD_LAYOUT_SNAPSHOT ?? "local-data/board-layout-before-reset.json";

async function main() {
  const confirm = process.argv.includes("--confirm");

  // 現在の分布。実行前後で比較して成否を判定する材料になる。
  const distribution = await prisma.userPreference.groupBy({
    by: ["boardLayout"],
    _count: { _all: true },
    orderBy: { boardLayout: "asc" },
  });
  const total = distribution.reduce((sum, row) => sum + row._count._all, 0);

  console.log("=== 現在の boardLayout 分布 ===");
  for (const row of distribution) {
    console.log(`  ${row.boardLayout ?? "(NULL = 未設定)"}: ${row._count._all} 行`);
  }
  console.log(`  合計: ${total} 行`);

  const targets = distribution
    .filter((row) => row.boardLayout !== null)
    .reduce((sum, row) => sum + row._count._all, 0);
  console.log(`\n未設定 (NULL) に戻す対象: ${targets} 行`);

  if (!confirm) {
    console.log("\n[dry-run] --confirm 未指定のため更新していません。");
    console.log("実行するには: npx tsx scripts/reset-board-layout-preference.ts --confirm");
    return;
  }

  // 復元材料を先に退避する (NULL 化は SQL だけでは戻せない)。
  const snapshot = await prisma.userPreference.findMany({
    select: { userId: true, boardLayout: true, updatedAt: true },
    orderBy: { userId: "asc" },
  });
  mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true });
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2));
  console.log(`\nスナップショットを保存: ${SNAPSHOT_PATH} (${snapshot.length} 行)`);

  // ★updateMany ではなく生 SQL を使う理由: UserPreference.updatedAt は @updatedAt なので
  // Prisma client 経由の更新は全行の updatedAt を「今」に書き換える。すると
  // src/lib/auth/merge-rules.ts の shouldUseGuestPreference (guest.updatedAt > account.updatedAt)
  // の判定材料が壊れ、ゲスト設定の引き継ぎ挙動が変わってしまう。生 UPDATE なら保持される
  // (@updatedAt は DB トリガでなく client 側実装のため)。
  const affected = await prisma.$executeRaw`UPDATE "UserPreference" SET "boardLayout" = NULL`;
  console.log(`\n=== 更新結果 ===\n  ${affected} 行を未設定 (NULL) に戻しました。`);

  const after = await prisma.userPreference.groupBy({
    by: ["boardLayout"],
    _count: { _all: true },
    orderBy: { boardLayout: "asc" },
  });
  console.log("\n=== 更新後の分布 ===");
  for (const row of after) {
    console.log(`  ${row.boardLayout ?? "(NULL = 未設定)"}: ${row._count._all} 行`);
  }
  console.log(
    "\n完了。実機ではフルリロード (または新規タブ) で反映を確認してください " +
      "(共有 layout は soft navigation では再取得されない)。",
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[reset-board-layout-preference] 失敗:", e);
    process.exit(1);
  });
