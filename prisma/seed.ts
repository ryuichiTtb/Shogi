// カード将棋(card-shogi variant)用のシードデータを投入する。
// 既存データは破壊しない(upsert / findFirst+create)。
//
// 実行: npx tsx prisma/seed.ts
// または: npx prisma db seed (prisma.config.ts の migrations.seed 設定経由)

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { ALL_CARD_DEFS } from "../src/lib/shogi/cards/definitions";

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

  console.log("✓ Seed completed (Card master only)");
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
