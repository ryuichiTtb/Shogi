// デッキ編成ルール (Issue #89)
//
// Server Action と Client UI の両方から参照する、デッキ枚数・レア度別上限の
// 定数とバリデーション関数。所持枚数 (PlayerCardCollection.count) を超える
// 編成も不可とする。

import type { CardId, CardRarity } from "./types";

export const DECK_TOTAL_MAX = 30;
export const DECK_TOTAL_MIN = 1;

// レア度別の「デッキ内のそのレア度合計」上限。null は無制限 (合計 30 枚の範囲内)。
// 例: epic = 4 → 究極カード(同名/異名問わず合計)が 4 枚を超えてはいけない。
export const RARITY_MAX_PER_DECK: Record<CardRarity, number | null> = {
  common: null,
  rare: null,
  super_rare: 10,
  epic: 4,
};

export interface DeckEntryInput {
  cardId: CardId;
  count: number;
}

export interface CardOwnershipInfo {
  rarity: CardRarity;
  owned: number;
}

export interface DeckValidationResult {
  ok: boolean;
  errors: string[];
  // カードごとの「最大投入可能枚数」(=所持枚数)。レア度上限はカード単位ではなく
  // 合計に課されるため、ここでは反映しない。UI 側で rarityTotal と組み合わせて
  // 「これ以上追加できるか」を判定する。
  perCardMax: Map<CardId, number>;
  // レア度別の現在合計 (UI の上限到達判定に使う)
  rarityCounts: Record<CardRarity, number>;
  totalCount: number;
}

export function validateDeckEntries(
  entries: DeckEntryInput[],
  ownership: Map<CardId, CardOwnershipInfo>,
): DeckValidationResult {
  const errors: string[] = [];
  const perCardMax = new Map<CardId, number>();
  const rarityCounts: Record<CardRarity, number> = {
    common: 0,
    rare: 0,
    super_rare: 0,
    epic: 0,
  };
  let totalCount = 0;

  for (const entry of entries) {
    const info = ownership.get(entry.cardId);
    if (!info) {
      errors.push(`未所持のカードがデッキに含まれています (${entry.cardId})`);
      continue;
    }
    if (entry.count <= 0) {
      errors.push(`枚数が不正です (${entry.cardId})`);
      continue;
    }
    if (entry.count > info.owned) {
      errors.push(
        `${entry.cardId} は所持枚数 (${info.owned}) を超えて編成できません`,
      );
    }
    rarityCounts[info.rarity] += entry.count;
    totalCount += entry.count;
  }

  // レア度別合計の上限チェック (super_rare / epic に上限あり)
  for (const r of ["common", "rare", "super_rare", "epic"] as CardRarity[]) {
    const cap = RARITY_MAX_PER_DECK[r];
    if (cap !== null && rarityCounts[r] > cap) {
      errors.push(
        `${rarityLabel(r)}は合計 ${cap} 枚までです (現在 ${rarityCounts[r]} 枚)`,
      );
    }
  }

  if (totalCount < DECK_TOTAL_MIN) {
    errors.push(`デッキは ${DECK_TOTAL_MIN} 枚以上必要です`);
  }
  if (totalCount > DECK_TOTAL_MAX) {
    errors.push(`デッキは ${DECK_TOTAL_MAX} 枚までです (現在 ${totalCount} 枚)`);
  }

  for (const [cardId, info] of ownership) {
    perCardMax.set(cardId, info.owned);
  }

  return {
    ok: errors.length === 0,
    errors,
    perCardMax,
    rarityCounts,
    totalCount,
  };
}

// レア度別の枚数集計 (UI の summary 表示用)。validateDeckEntries の rarityCounts と同等。
export function countByRarity(
  entries: DeckEntryInput[],
  ownership: Map<CardId, CardOwnershipInfo>,
): Record<CardRarity, number> {
  const result: Record<CardRarity, number> = {
    common: 0,
    rare: 0,
    super_rare: 0,
    epic: 0,
  };
  for (const e of entries) {
    const info = ownership.get(e.cardId);
    if (!info) continue;
    result[info.rarity] += e.count;
  }
  return result;
}

function rarityLabel(r: CardRarity): string {
  switch (r) {
    case "common":
      return "通常";
    case "rare":
      return "レア";
    case "super_rare":
      return "激レア";
    case "epic":
      return "究極";
  }
}
