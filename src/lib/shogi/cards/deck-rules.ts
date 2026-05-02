// デッキ編成ルール (Issue #89)
//
// Server Action と Client UI の両方から参照する、デッキ枚数・レア度別上限の
// 定数とバリデーション関数。所持枚数 (PlayerCardCollection.count) を超える
// 編成も不可とする。

import type { CardId, CardRarity } from "./types";

export const DECK_TOTAL_MAX = 30;
export const DECK_TOTAL_MIN = 1;

// レア度別の同名カード上限 (1 デッキあたり)。null は無制限 (合計 30 枚の範囲内)。
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
  // カード別の「これ以上追加できない」枚数。UI で「+追加」ボタンを disabled に
  // するときに使う。値はそのカードを編成可能な最大枚数 (現状の count とは独立)。
  perCardMax: Map<CardId, number>;
  totalCount: number;
}

export function validateDeckEntries(
  entries: DeckEntryInput[],
  ownership: Map<CardId, CardOwnershipInfo>,
): DeckValidationResult {
  const errors: string[] = [];
  const perCardMax = new Map<CardId, number>();
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
    const limit = perCardLimit(info);
    if (entry.count > limit) {
      errors.push(
        `${entry.cardId} は ${limit} 枚までしか入れられません (所持: ${info.owned}, レア度上限: ${RARITY_MAX_PER_DECK[info.rarity] ?? "無制限"})`,
      );
    }
    totalCount += entry.count;
  }

  if (totalCount < DECK_TOTAL_MIN) {
    errors.push(`デッキは ${DECK_TOTAL_MIN} 枚以上必要です`);
  }
  if (totalCount > DECK_TOTAL_MAX) {
    errors.push(`デッキは ${DECK_TOTAL_MAX} 枚までです (現在 ${totalCount} 枚)`);
  }

  // 各カードの「最大投入可能枚数」を返す (所持枚数 と レア度上限 の min)。
  for (const [cardId, info] of ownership) {
    perCardMax.set(cardId, perCardLimit(info));
  }

  return { ok: errors.length === 0, errors, perCardMax, totalCount };
}

function perCardLimit(info: CardOwnershipInfo): number {
  const rarityCap = RARITY_MAX_PER_DECK[info.rarity];
  return rarityCap === null ? info.owned : Math.min(info.owned, rarityCap);
}

// レア度別の枚数集計 (UI の summary 表示用)
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
