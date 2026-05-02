"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { ensureDefaultUser } from "@/lib/auth/default-user";
import {
  validateDeckEntries,
  type CardOwnershipInfo,
  type DeckEntryInput,
} from "@/lib/shogi/cards/deck-rules";
import { ALL_CARD_DEFS } from "@/lib/shogi/cards/definitions";
import type { CardId, CardRarity } from "@/lib/shogi/cards/types";

// シードを Vercel ビルドで走らせていないため、編成画面を開いたタイミングで
// 「全 playable カードを各 OWNED_COUNT_PER_CARD 枚」に同期する。
// 認証・ガチャ機能が入るまでの暫定処置。
const OWNED_COUNT_PER_CARD = 10;

async function ensureOwnedCardsForUser(userId: string): Promise<void> {
  // Card マスタの存在を保証 (seed 未実行環境向け)。upsert なので副作用は冪等。
  await Promise.all(
    ALL_CARD_DEFS.map((def) =>
      prisma.card.upsert({
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

  const playable = ALL_CARD_DEFS.filter((d) => d.status !== "deprecated");
  await Promise.all(
    playable.map((def) =>
      prisma.playerCardCollection.upsert({
        where: { userId_cardId: { userId, cardId: def.id } },
        create: { userId, cardId: def.id, count: OWNED_COUNT_PER_CARD },
        update: { count: OWNED_COUNT_PER_CARD },
      }),
    ),
  );
  // 廃止カードは所持から除去
  await prisma.playerCardCollection.deleteMany({
    where: {
      userId,
      cardId: {
        in: ALL_CARD_DEFS.filter((d) => d.status === "deprecated").map((d) => d.id),
      },
    },
  });
}

export interface DeckSummary {
  id: string;
  name: string;
  isDefault: boolean;
  totalCount: number;
  createdAt: Date;
}

export interface DeckEntrySummary {
  cardId: CardId;
  count: number;
}

export interface DeckDetail extends DeckSummary {
  entries: DeckEntrySummary[];
}

export interface OwnedCardSummary {
  cardId: CardId;
  rarity: CardRarity;
  owned: number;
}

// 自分のデッキ一覧 + 各デッキの合計枚数を返す。
// 並び順は createdAt 昇順のみ。isDefault による先頭固定はしない (使用中切替で
// 並び順が変わると UX が悪いため)。
export async function listDecksForCurrentUser(): Promise<DeckSummary[]> {
  const user = await ensureDefaultUser();
  const decks = await prisma.deck.findMany({
    where: { userId: user.id },
    include: { entries: true },
    orderBy: { createdAt: "asc" },
  });
  return decks.map((d) => ({
    id: d.id,
    name: d.name,
    isDefault: d.isDefault,
    totalCount: d.entries.reduce((sum, e) => sum + e.count, 0),
    createdAt: d.createdAt,
  }));
}

// デッキ単体の詳細 (entries 込み)
export async function getDeckDetail(deckId: string): Promise<DeckDetail | null> {
  const user = await ensureDefaultUser();
  const deck = await prisma.deck.findFirst({
    where: { id: deckId, userId: user.id },
    include: { entries: true },
  });
  if (!deck) return null;
  return {
    id: deck.id,
    name: deck.name,
    isDefault: deck.isDefault,
    createdAt: deck.createdAt,
    totalCount: deck.entries.reduce((sum, e) => sum + e.count, 0),
    entries: deck.entries.map((e) => ({
      cardId: e.cardId as CardId,
      count: e.count,
    })),
  };
}

// 所持カード一覧 (Card join、count > 0 のみ)。
// 呼出し時に最新の playable カード定義を 10 枚ずつ所持済みに揃える (暫定)。
export async function listOwnedCardsForCurrentUser(): Promise<OwnedCardSummary[]> {
  const user = await ensureDefaultUser();
  await ensureOwnedCardsForUser(user.id);
  const rows = await prisma.playerCardCollection.findMany({
    where: { userId: user.id, count: { gt: 0 } },
    include: { card: true },
  });
  return rows.map((r) => ({
    cardId: r.cardId as CardId,
    rarity: r.card.rarity as CardRarity,
    owned: r.count,
  }));
}

// 新規デッキ作成。他にデッキが無ければ isDefault=true。
export async function createDeck(name: string): Promise<string> {
  const user = await ensureDefaultUser();
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error("デッキ名を入力してください");
  }
  if (trimmed.length > 30) {
    throw new Error("デッキ名は 30 文字以内にしてください");
  }
  const existingCount = await prisma.deck.count({ where: { userId: user.id } });
  const deck = await prisma.deck.create({
    data: {
      userId: user.id,
      name: trimmed,
      isDefault: existingCount === 0,
    },
  });
  revalidatePath("/decks");
  return deck.id;
}

export async function renameDeck(deckId: string, name: string): Promise<void> {
  const user = await ensureDefaultUser();
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error("デッキ名を入力してください");
  }
  if (trimmed.length > 30) {
    throw new Error("デッキ名は 30 文字以内にしてください");
  }
  const result = await prisma.deck.updateMany({
    where: { id: deckId, userId: user.id },
    data: { name: trimmed },
  });
  if (result.count === 0) {
    throw new Error("デッキが見つかりません");
  }
  revalidatePath("/decks");
}

// デッキ編成を保存 (バリデーション → 全 entries 入れ替え)
export async function saveDeckEntries(
  deckId: string,
  entries: DeckEntryInput[],
): Promise<void> {
  const user = await ensureDefaultUser();
  const deck = await prisma.deck.findFirst({
    where: { id: deckId, userId: user.id },
    select: { id: true },
  });
  if (!deck) {
    throw new Error("デッキが見つかりません");
  }

  // 所持カードを取得してバリデーション
  const owned = await prisma.playerCardCollection.findMany({
    where: { userId: user.id },
    include: { card: true },
  });
  const ownership = new Map<CardId, CardOwnershipInfo>();
  for (const row of owned) {
    ownership.set(row.cardId as CardId, {
      rarity: row.card.rarity as CardRarity,
      owned: row.count,
    });
  }

  const result = validateDeckEntries(entries, ownership);
  if (!result.ok) {
    throw new Error(result.errors.join(" / "));
  }

  // 重複 cardId をマージ (UI 側で防いでいるが念のため)
  const merged = new Map<CardId, number>();
  for (const e of entries) {
    merged.set(e.cardId, (merged.get(e.cardId) ?? 0) + e.count);
  }

  await prisma.$transaction([
    prisma.deckEntry.deleteMany({ where: { deckId } }),
    prisma.deckEntry.createMany({
      data: Array.from(merged.entries()).map(([cardId, count]) => ({
        deckId,
        cardId,
        count,
      })),
    }),
  ]);
  revalidatePath("/decks");
}

// 指定デッキを isDefault=true、他デッキを false にする
export async function setDefaultDeck(deckId: string): Promise<void> {
  const user = await ensureDefaultUser();
  const target = await prisma.deck.findFirst({
    where: { id: deckId, userId: user.id },
    select: { id: true },
  });
  if (!target) {
    throw new Error("デッキが見つかりません");
  }
  await prisma.$transaction([
    prisma.deck.updateMany({
      where: { userId: user.id, NOT: { id: deckId } },
      data: { isDefault: false },
    }),
    prisma.deck.update({
      where: { id: deckId },
      data: { isDefault: true },
    }),
  ]);
  revalidatePath("/decks");
}

// デッキ削除。最後の 1 個 (= 唯一の isDefault) は削除不可。
export async function deleteDeck(deckId: string): Promise<void> {
  const user = await ensureDefaultUser();
  const decks = await prisma.deck.findMany({
    where: { userId: user.id },
    select: { id: true, isDefault: true },
  });
  const target = decks.find((d) => d.id === deckId);
  if (!target) {
    throw new Error("デッキが見つかりません");
  }
  if (decks.length <= 1) {
    throw new Error("最後のデッキは削除できません");
  }
  if (target.isDefault) {
    throw new Error("使用中のデッキは削除できません。先に別のデッキを使用中にしてください。");
  }
  await prisma.deck.delete({ where: { id: deckId } });
  revalidatePath("/decks");
}
