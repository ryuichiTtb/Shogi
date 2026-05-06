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
import { INITIAL_DECK_CARD_COUNT } from "@/lib/auth/user-bootstrap";
import { ALL_CARD_DEFS } from "@/lib/shogi/cards/definitions";

// Issue #150: 「サインアウト→サインイン」を繰り返すと account の deck が増殖するバグ対策。
// 新規ゲスト User 作成時に ensureInitialUserData で default deck (デフォルトデッキ名 +
// 全 playable カード × INITIAL_DECK_CARD_COUNT 枚) が自動生成される。これを merge で
// account に毎回 isDefault=false として移管していたため、ログインのたびに deck が増えた。
// 「ユーザーが触っていない初期構成のまま」かを判定し、その場合は移管せず削除する。
const PLAYABLE_CARD_IDS_FOR_MERGE: Set<string> = new Set(
  ALL_CARD_DEFS.filter((d) => d.status !== "deprecated").map((d) => d.id),
);
const PRISTINE_DEFAULT_DECK_NAME = "デフォルトデッキ";

interface DeckWithEntriesForMerge {
  id: string;
  name: string;
  isDefault: boolean;
  entries: { cardId: string; count: number }[];
}

function isPristineInitialDeck(deck: DeckWithEntriesForMerge): boolean {
  if (!deck.isDefault) return false;
  if (deck.name !== PRISTINE_DEFAULT_DECK_NAME) return false;
  if (deck.entries.length !== PLAYABLE_CARD_IDS_FOR_MERGE.size) return false;
  return deck.entries.every(
    (e) =>
      PLAYABLE_CARD_IDS_FOR_MERGE.has(e.cardId) &&
      e.count === INITIAL_DECK_CARD_COUNT,
  );
}

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
  db: MergeClient,
  guestUserId: string,
  accountUserId: string,
): Promise<void> {
  const [guestStats, accountStats] = await Promise.all([
    db.playerStats.findUnique({ where: { userId: guestUserId } }),
    db.playerStats.findUnique({ where: { userId: accountUserId } }),
  ]);
  if (!guestStats) return;

  const next = mergedStats(accountStats, guestStats);
  await db.playerStats.upsert({
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
  await db.playerStats.deleteMany({ where: { userId: guestUserId } });
}

async function mergePreferences(
  db: MergeClient,
  guestUserId: string,
  accountUserId: string,
): Promise<void> {
  const [guestPreference, accountPreference] = await Promise.all([
    db.userPreference.findUnique({ where: { userId: guestUserId } }),
    db.userPreference.findUnique({ where: { userId: accountUserId } }),
  ]);
  if (!guestPreference) return;

  if (shouldUseGuestPreference(accountPreference, guestPreference)) {
    await db.userPreference.upsert({
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

  await db.userPreference.deleteMany({ where: { userId: guestUserId } });
}

async function mergeCollections(
  db: MergeClient,
  guestUserId: string,
  accountUserId: string,
): Promise<void> {
  const [guestRows, accountRows] = await Promise.all([
    db.playerCardCollection.findMany({ where: { userId: guestUserId } }),
    db.playerCardCollection.findMany({ where: { userId: accountUserId } }),
  ]);
  const accountCounts = new Map(
    accountRows.map((row) => [row.cardId, row.count] as const),
  );

  await Promise.all(
    guestRows.map((row) =>
      db.playerCardCollection.upsert({
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

  await db.playerCardCollection.deleteMany({ where: { userId: guestUserId } });
}

async function moveDecks(
  db: MergeClient,
  guestUserId: string,
  accountUserId: string,
): Promise<void> {
  const accountDefault = await db.deck.findFirst({
    where: { userId: accountUserId, isDefault: true },
    select: { id: true },
  });

  // Issue #150: 「未編集の初期構成 deck」と「ユーザーが触った deck」を判別するため、
  // updateMany で一括ではなく 1 件ずつ取得して扱う。
  const guestDecks = await db.deck.findMany({
    where: { userId: guestUserId },
    select: {
      id: true,
      name: true,
      isDefault: true,
      entries: { select: { cardId: true, count: true } },
    },
  });

  for (const guestDeck of guestDecks) {
    if (accountDefault && isPristineInitialDeck(guestDeck)) {
      // 増殖防止: account に既に default deck がある状況で、
      // ゲスト deck が「ensureInitialUserData が作った初期構成のまま」なら捨てる。
      // FK は cascade なので deckEntry も自動削除される。
      await db.deck.delete({ where: { id: guestDeck.id } });
      continue;
    }

    await db.deck.update({
      where: { id: guestDeck.id },
      data: accountDefault
        ? { userId: accountUserId, isDefault: false }
        : { userId: accountUserId },
    });
  }

  if (accountDefault) return;

  const nextDefault = await db.deck.findFirst({
    where: { userId: accountUserId, isDefault: true },
    select: { id: true },
  });
  if (nextDefault) return;

  const firstDeck = await db.deck.findFirst({
    where: { userId: accountUserId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (firstDeck) {
    await db.deck.update({
      where: { id: firstDeck.id },
      data: { isDefault: true },
    });
  }
}

// Issue #150: 以前は全 step を prisma.$transaction で囲んでいたが、
// Vercel + Neon HTTP 環境では interactive transaction の 5s timeout に
// 引っかかる (再ログイン時に account/guest 両方の playerCardCollection 30+ 件
// upsert で 5s 超え、P2028 でクラッシュ)。
//
// 各 step は冪等になるよう設計してあるため (max ベースの統合・upsert・
// updateMany・deleteMany)、transaction 外の順次実行に変更しても
// 途中失敗時はリロード/再ログインで自然に最終状態へ収束する。
// 最後の user.delete は deleteMany に変えて二重実行 (P2025) を吸収する。
export async function mergeGuestSessionIntoAccount(
  guestToken: string | undefined,
  accountUserId: string,
): Promise<MergeResult> {
  if (!isValidGuestSessionToken(guestToken)) {
    return { merged: false, reason: "missing-session" };
  }

  const tokenHash = hashGuestSessionToken(guestToken);

  const session = await prisma.guestSession.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!session) {
    return { merged: false, reason: "missing-session" };
  }
  if (session.userId === accountUserId) {
    await prisma.guestSession.deleteMany({ where: { id: session.id } });
    return { merged: false, reason: "same-user" };
  }
  if (session.user.kind !== "guest") {
    await prisma.guestSession.deleteMany({ where: { id: session.id } });
    return { merged: false, reason: "not-guest" };
  }

  const account = await prisma.user.findUnique({
    where: { id: accountUserId },
    select: { id: true, kind: true },
  });
  if (!account || account.kind !== "account") {
    throw new Error("Account user is missing");
  }

  const guestUserId = session.userId;

  await mergePlayerStats(prisma, guestUserId, accountUserId);
  await mergePreferences(prisma, guestUserId, accountUserId);
  await mergeCollections(prisma, guestUserId, accountUserId);
  await moveDecks(prisma, guestUserId, accountUserId);
  await prisma.game.updateMany({
    where: { playerId: guestUserId },
    data: { playerId: accountUserId },
  });
  await prisma.guestSession.deleteMany({ where: { userId: guestUserId } });
  await prisma.user.deleteMany({ where: { id: guestUserId } });

  return { merged: true, reason: "merged" };
}
