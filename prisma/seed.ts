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

  // 4. DeckEntry を 各カード2枚ずつ計6枚で構成(設計ドキュメント 3.5)
  for (const def of ALL_CARD_DEFS) {
    await prisma.deckEntry.upsert({
      where: { deckId_cardId: { deckId: defaultDeck.id, cardId: def.id } },
      create: { deckId: defaultDeck.id, cardId: def.id, count: 2 },
      update: { count: 2 },
    });
  }
  console.log(`  - DeckEntry: ${ALL_CARD_DEFS.length} 種を各2枚`);

  // 5. PlayerCardCollection (所持カード) を全種2枚で初期化(将来のガチャ・編成画面用)
  for (const def of ALL_CARD_DEFS) {
    await prisma.playerCardCollection.upsert({
      where: { userId_cardId: { userId: DEFAULT_PLAYER_ID, cardId: def.id } },
      create: { userId: DEFAULT_PLAYER_ID, cardId: def.id, count: 2 },
      update: { count: 2 },
    });
  }
  console.log(`  - PlayerCardCollection: ${ALL_CARD_DEFS.length} 種を各2枚`);

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
