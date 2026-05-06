import "server-only";

import { prisma } from "@/lib/prisma";
import { ALL_CARD_DEFS } from "@/lib/shogi/cards/definitions";
import { DEFAULT_CARD_BACK_STYLE, DEFAULT_THEME } from "@/lib/user-preferences";

export const INITIAL_OWNED_CARD_COUNT = 10;
export const INITIAL_DECK_CARD_COUNT = 2;

type BootstrapClient = Pick<
  typeof prisma,
  | "card"
  | "deck"
  | "deckEntry"
  | "playerCardCollection"
  | "playerStats"
  | "userPreference"
>;

const playableCardDefs = ALL_CARD_DEFS.filter((def) => def.status !== "deprecated");

export async function ensureCardMaster(db: BootstrapClient = prisma): Promise<void> {
  // Issue #150: 既に Card マスタが揃っている (= seed 済み) 場合はスキップする。
  // ensureInitialUserData / ensureOwnedCardsForUser から毎ログイン呼ばれるため、
  // 全件 upsert を毎回走らせると Vercel + Neon HTTP のラウンドトリップが累積し
  // interactive transaction の 5s 制限を超える原因になる。
  // Card 内容の更新は seed (npm run db:seed) で行う運用とし、ここでは
  // 「seed 未実行 / 新カード追加で行数が足りない」場合のみ upsert で補完する。
  const existing = await db.card.count();
  if (existing >= ALL_CARD_DEFS.length) return;

  await Promise.all(
    ALL_CARD_DEFS.map((def) =>
      db.card.upsert({
        where: { id: def.id },
        create: {
          id: def.id,
          kind: def.kind,
          name: def.name,
          description: def.description,
          cost: def.cost,
          rarity: def.rarity,
          effectId: def.effectId,
          targeting: def.targeting,
        },
        update: {
          kind: def.kind,
          name: def.name,
          description: def.description,
          cost: def.cost,
          rarity: def.rarity,
          effectId: def.effectId,
          targeting: def.targeting,
        },
      }),
    ),
  );
}

export async function ensureInitialUserData(
  db: BootstrapClient,
  userId: string,
): Promise<void> {
  await ensureCardMaster(db);

  await db.playerStats.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });

  await db.userPreference.upsert({
    where: { userId },
    create: {
      userId,
      cardBackStyle: DEFAULT_CARD_BACK_STYLE,
      theme: DEFAULT_THEME,
    },
    update: {},
  });

  await Promise.all(
    playableCardDefs.map((def) =>
      db.playerCardCollection.upsert({
        where: { userId_cardId: { userId, cardId: def.id } },
        create: {
          userId,
          cardId: def.id,
          count: INITIAL_OWNED_CARD_COUNT,
        },
        update: {},
      }),
    ),
  );

  // default deck の確保。
  // Issue #150: ゲスト → アカウント merge 後にもこの関数が呼ばれるため、
  // 「すでに default deck が存在する (= ゲストから移管された / 既存ユーザー)」場合は
  // 編成 (deckEntry) には触らない。触ると「ユーザーが意図的に外したカード」が
  // 勝手に再追加されてしまう。初期 entry は default deck を新規作成した場合のみ入れる。
  const existingDefault = await db.deck.findFirst({
    where: { userId, isDefault: true },
  });
  if (existingDefault) return;

  const defaultDeck = await db.deck.create({
    data: {
      userId,
      name: "デフォルトデッキ",
      isDefault: true,
    },
  });
  await Promise.all(
    playableCardDefs.map((def) =>
      db.deckEntry.create({
        data: {
          deckId: defaultDeck.id,
          cardId: def.id,
          count: INITIAL_DECK_CARD_COUNT,
        },
      }),
    ),
  );
}
