// カード将棋(card-shogi variant)用のシードデータを投入する。
// 既存データは破壊しない(upsert / findFirst+create)。
//
// 実行: npx tsx prisma/seed.ts
// または: npx prisma db seed (prisma.config.ts の migrations.seed 設定経由)

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { ALL_CARD_DEFS } from "../src/lib/shogi/cards/definitions";

const DEFAULT_PLAYER_ID = "default-player";

async function main() {
  console.log("Seeding card-shogi data...");

  // 0. ALL_CARD_DEFS から削除されたカードのレコードを掃除する。
  //    deprecated ステータスは Card マスタに残すが、ALL_CARD_DEFS から完全削除された
  //    カード (例: サンプルカード sample_*) は孤立レコードになるため全削除する。
  //    FK 制約があるため、子テーブル (DeckEntry / PlayerCardCollection) → Card の順で削除。
  const validCardIds = ALL_CARD_DEFS.map((d) => d.id);
  const orphanDeckEntries = await prisma.deckEntry.deleteMany({
    where: { cardId: { notIn: validCardIds } },
  });
  const orphanCollections = await prisma.playerCardCollection.deleteMany({
    where: { cardId: { notIn: validCardIds } },
  });
  const orphanCards = await prisma.card.deleteMany({
    where: { id: { notIn: validCardIds } },
  });
  if (orphanDeckEntries.count + orphanCollections.count + orphanCards.count > 0) {
    console.log(
      `  - 孤立レコード削除: Card ${orphanCards.count} 件 / DeckEntry ${orphanDeckEntries.count} 件 / PlayerCardCollection ${orphanCollections.count} 件`,
    );
  }

  // 1. Card マスタを upsert
  for (const def of ALL_CARD_DEFS) {
    await prisma.card.upsert({
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
    });
    console.log(`  - Card: ${def.name} (${def.id})`);
  }

  // 2. default-player の存在を確保(card-shogi モードで使う想定)
  await prisma.user.upsert({
    where: { id: DEFAULT_PLAYER_ID },
    create: { id: DEFAULT_PLAYER_ID, name: "Player" },
    update: {},
  });

  // 3. default-player のデフォルトデッキを作成(なければ)
  let defaultDeck = await prisma.deck.findFirst({
    where: { userId: DEFAULT_PLAYER_ID, isDefault: true },
  });
  if (!defaultDeck) {
    defaultDeck = await prisma.deck.create({
      data: {
        userId: DEFAULT_PLAYER_ID,
        name: "デフォルトデッキ",
        isDefault: true,
      },
    });
    console.log(`  - Deck (新規作成): ${defaultDeck.id}`);
  } else {
    console.log(`  - Deck (既存): ${defaultDeck.id}`);
  }

  // 廃止カードは DeckEntry / PlayerCardCollection には投入しない(Card マスタには履歴として残す)
  const playableDefs = ALL_CARD_DEFS.filter((d) => d.status !== "deprecated");

  // 4. DeckEntry を 各カード2枚ずつで構成 (Phase A 時点 / 設計ドキュメント 3.5)。
  //    新カード追加時は ALL_CARD_DEFS に含まれていれば自動的に各2枚で投入される。
  for (const def of playableDefs) {
    await prisma.deckEntry.upsert({
      where: { deckId_cardId: { deckId: defaultDeck.id, cardId: def.id } },
      create: { deckId: defaultDeck.id, cardId: def.id, count: 2 },
      update: { count: 2 },
    });
  }
  // 既に投入済みの廃止カード DeckEntry を掃除
  const removedDeckEntries = await prisma.deckEntry.deleteMany({
    where: {
      deckId: defaultDeck.id,
      cardId: { in: ALL_CARD_DEFS.filter((d) => d.status === "deprecated").map((d) => d.id) },
    },
  });
  console.log(`  - DeckEntry: ${playableDefs.length} 種を各2枚 (廃止 ${removedDeckEntries.count} 件削除)`);

  // 5. PlayerCardCollection (所持カード) を全種10枚で初期化(編成画面の検証用に潤沢に)
  const OWNED_COUNT_PER_CARD = 10;
  for (const def of playableDefs) {
    await prisma.playerCardCollection.upsert({
      where: { userId_cardId: { userId: DEFAULT_PLAYER_ID, cardId: def.id } },
      create: { userId: DEFAULT_PLAYER_ID, cardId: def.id, count: OWNED_COUNT_PER_CARD },
      update: { count: OWNED_COUNT_PER_CARD },
    });
  }
  // 既に投入済みの廃止カード PlayerCardCollection を掃除
  const removedCollections = await prisma.playerCardCollection.deleteMany({
    where: {
      userId: DEFAULT_PLAYER_ID,
      cardId: { in: ALL_CARD_DEFS.filter((d) => d.status === "deprecated").map((d) => d.id) },
    },
  });
  console.log(`  - PlayerCardCollection: ${playableDefs.length} 種を各${OWNED_COUNT_PER_CARD}枚 (廃止 ${removedCollections.count} 件削除)`);

  console.log("✓ Seed completed");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
