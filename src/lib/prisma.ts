import { PrismaClient } from "@/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

// Issue #217: 本番 (Vercel) でもグローバルへ保持する。
// 旧実装は dev hot-reload 対策の定番 `NODE_ENV !== "production"` ガードを
// そのまま使っていたが、Vercel のウォーム lambda ではモジュール再評価
// (RSC / server action / route が別バンドルで評価されるケース等) のたびに
// createPrismaClient() が走り、@prisma/adapter-neon の Neon 接続が積み増し
// → Neon 無料枠の接続上限を圧迫し接続取得が長時間ブロックされる温床になる。
// グローバル保持で 1 lambda 1 クライアントに固定し接続チャーンを抑える。
globalForPrisma.prisma = prisma;
