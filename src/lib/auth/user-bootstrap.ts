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

  let defaultDeck = await db.deck.findFirst({
    where: { userId, isDefault: true },
  });
  if (!defaultDeck) {
    defaultDeck = await db.deck.create({
      data: {
        userId,
        name: "デフォルトデッキ",
        isDefault: true,
      },
    });
  }

  await Promise.all(
    playableCardDefs.map((def) =>
      db.deckEntry.upsert({
        where: { deckId_cardId: { deckId: defaultDeck.id, cardId: def.id } },
        create: {
          deckId: defaultDeck.id,
          cardId: def.id,
          count: INITIAL_DECK_CARD_COUNT,
        },
        update: {},
      }),
    ),
  );
}
