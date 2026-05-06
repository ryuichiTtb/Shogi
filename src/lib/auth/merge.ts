import "server-only";

import { prisma } from "@/lib/prisma";
import {
  hashGuestSessionToken,
  isValidGuestSessionToken,
} from "@/lib/auth/guest-session";
import {
  mergedCardCount,
  mergedStats,
  shouldUseGuestPreference,
} from "@/lib/auth/merge-rules";

type MergeClient = Pick<
  typeof prisma,
  | "deck"
  | "game"
  | "guestSession"
  | "playerCardCollection"
  | "playerStats"
  | "user"
  | "userPreference"
>;

export interface MergeResult {
  merged: boolean;
  reason: "merged" | "missing-session" | "same-user" | "not-guest";
}

async function mergePlayerStats(
  tx: MergeClient,
  guestUserId: string,
  accountUserId: string,
): Promise<void> {
  const [guestStats, accountStats] = await Promise.all([
    tx.playerStats.findUnique({ where: { userId: guestUserId } }),
    tx.playerStats.findUnique({ where: { userId: accountUserId } }),
  ]);
  if (!guestStats) return;

  const next = mergedStats(accountStats, guestStats);
  await tx.playerStats.upsert({
    where: { userId: accountUserId },
    create: {
      userId: accountUserId,
      rating: next.rating,
      wins: next.wins,
      losses: next.losses,
      draws: next.draws,
    },
    update: {
      rating: next.rating,
      wins: next.wins,
      losses: next.losses,
      draws: next.draws,
    },
  });
  await tx.playerStats.delete({ where: { userId: guestUserId } });
}

async function mergePreferences(
  tx: MergeClient,
  guestUserId: string,
  accountUserId: string,
): Promise<void> {
  const [guestPreference, accountPreference] = await Promise.all([
    tx.userPreference.findUnique({ where: { userId: guestUserId } }),
    tx.userPreference.findUnique({ where: { userId: accountUserId } }),
  ]);
  if (!guestPreference) return;

  if (shouldUseGuestPreference(accountPreference, guestPreference)) {
    await tx.userPreference.upsert({
      where: { userId: accountUserId },
      create: {
        userId: accountUserId,
        cardBackStyle: guestPreference.cardBackStyle,
        theme: guestPreference.theme,
      },
      update: {
        cardBackStyle: guestPreference.cardBackStyle,
        theme: guestPreference.theme,
      },
    });
  }

  await tx.userPreference.delete({ where: { userId: guestUserId } });
}

async function mergeCollections(
  tx: MergeClient,
  guestUserId: string,
  accountUserId: string,
): Promise<void> {
  const [guestRows, accountRows] = await Promise.all([
    tx.playerCardCollection.findMany({ where: { userId: guestUserId } }),
    tx.playerCardCollection.findMany({ where: { userId: accountUserId } }),
  ]);
  const accountCounts = new Map(
    accountRows.map((row) => [row.cardId, row.count] as const),
  );

  await Promise.all(
    guestRows.map((row) =>
      tx.playerCardCollection.upsert({
        where: {
          userId_cardId: {
            userId: accountUserId,
            cardId: row.cardId,
          },
        },
        create: {
          userId: accountUserId,
          cardId: row.cardId,
          count: row.count,
        },
        update: {
          count: mergedCardCount(accountCounts.get(row.cardId), row.count),
        },
      }),
    ),
  );

  await tx.playerCardCollection.deleteMany({ where: { userId: guestUserId } });
}

async function moveDecks(
  tx: MergeClient,
  guestUserId: string,
  accountUserId: string,
): Promise<void> {
  const accountDefault = await tx.deck.findFirst({
    where: { userId: accountUserId, isDefault: true },
    select: { id: true },
  });

  await tx.deck.updateMany({
    where: { userId: guestUserId },
    data: accountDefault
      ? { userId: accountUserId, isDefault: false }
      : { userId: accountUserId },
  });

  if (accountDefault) return;

  const nextDefault = await tx.deck.findFirst({
    where: { userId: accountUserId, isDefault: true },
    select: { id: true },
  });
  if (nextDefault) return;

  const firstDeck = await tx.deck.findFirst({
    where: { userId: accountUserId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (firstDeck) {
    await tx.deck.update({
      where: { id: firstDeck.id },
      data: { isDefault: true },
    });
  }
}

export async function mergeGuestSessionIntoAccount(
  guestToken: string | undefined,
  accountUserId: string,
): Promise<MergeResult> {
  if (!isValidGuestSessionToken(guestToken)) {
    return { merged: false, reason: "missing-session" };
  }

  const tokenHash = hashGuestSessionToken(guestToken);

  return prisma.$transaction(async (tx) => {
    const session = await tx.guestSession.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!session) {
      return { merged: false, reason: "missing-session" };
    }
    if (session.userId === accountUserId) {
      await tx.guestSession.delete({ where: { id: session.id } });
      return { merged: false, reason: "same-user" };
    }
    if (session.user.kind !== "guest") {
      await tx.guestSession.delete({ where: { id: session.id } });
      return { merged: false, reason: "not-guest" };
    }

    const account = await tx.user.findUnique({
      where: { id: accountUserId },
      select: { id: true, kind: true },
    });
    if (!account || account.kind !== "account") {
      throw new Error("Account user is missing");
    }

    const guestUserId = session.userId;

    await mergePlayerStats(tx, guestUserId, accountUserId);
    await mergePreferences(tx, guestUserId, accountUserId);
    await mergeCollections(tx, guestUserId, accountUserId);
    await moveDecks(tx, guestUserId, accountUserId);
    await tx.game.updateMany({
      where: { playerId: guestUserId },
      data: { playerId: accountUserId },
    });
    await tx.guestSession.deleteMany({ where: { userId: guestUserId } });
    await tx.user.delete({ where: { id: guestUserId } });

    return { merged: true, reason: "merged" };
  });
}
