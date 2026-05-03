// 認証実装前の暫定ユーザー処理。actions/game.ts と actions/deck.ts から共有する。
// 認証導入時にここを差し替えるだけで全 Server Action が新ユーザー解決に乗り換える想定。

import { prisma } from "@/lib/prisma";

export const DEFAULT_PLAYER_ID = "default-player";

export async function ensureDefaultUser() {
  return prisma.user.upsert({
    where: { id: DEFAULT_PLAYER_ID },
    create: { id: DEFAULT_PLAYER_ID, name: "Player" },
    update: {},
  });
}
