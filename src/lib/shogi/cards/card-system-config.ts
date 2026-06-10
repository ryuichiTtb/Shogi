// Issue #235 S2e: カードシステム定数の集約層 (CardSystemConfig)。
//
// 目的 (epic doc §4 / S2 計画 docs/plans/issue-235-s2-cardspec.md §3 S2e / §8):
//   従来 definitions.ts / deck-rules.ts に散在していたカードシステム定数 (マナ / ドロー /
//   デッキ構築上限) を、registry 近傍の単一 `CardSystemConfig` に集約し、将来の phase 別
//   バージョニングを可能にする。**値は一切変更しない (= 挙動完全不変)**。値の再校正・動的化は
//   S3 以降の別段で扱う。
//
// 本ファイルの責務 = **関数を持たない値のみ** (Server→Client 境界を serialize 可能 = client-safe)。
//   per-card meta を扱う card-spec.ts とは別概念 (system-wide config) のため別ファイルに分離する。
//   関数を持たないため S2d の ESLint 境界 (src/components/** → card-spec-server import 禁止) には
//   抵触せず、Client コンポーネントから (definitions/deck-rules 経由で) 安全に参照できる。
//
// 後方互換: 旧 definitions.ts / deck-rules.ts の名前付き定数 (MANA_CAP 等) は本ファイルから
//   re-export することで既存 import を一切壊さない (churn 最小)。値の SSOT は CARD_SYSTEM_CONFIG。

import type { Player } from "@/lib/shogi/types";
import type { CardRarity } from "./types";

// カードシステム全体の構成定数 (値のみ = client-safe)。将来 phase 別バージョニングの単位。
export interface CardSystemConfig {
  mana: {
    // 先後別の初期マナ (Issue #81 / 2026-05-01 確定)。後手が +1 で先手番有利を緩和。
    initial: Record<Player, number>;
    // マナ上限。将来カード効果 (自分UP/相手DOWN) で動的化する想定 (現状は静的)。
    cap: number;
    // 1 手番消費するごとのマナ加算。
    perTurn: number;
    // 早指し (fastThresholdMs 以内) 時の追加マナ (合計 perTurn + fastBonus)。
    fastBonus: number;
    // 早指し判定のしきい値 (ms)。
    fastThresholdMs: number;
  };
  draw: {
    // 手動ドローのマナコスト (Issue #130 で 3 → 2 に引き下げ。自動ドローと併存させ、手動は
    //   「自動を待たずに今すぐ引きたい」加速行動と位置づけ直してコストを下げた)。
    cost: number;
    // 経過手数による自動ドローの間隔 (Issue #130)。「自分の手番が終わるたびに +1」のカウントが
    //   本値に到達すると、マナ消費なしで山札から 1 枚引く (駒移動・手動ドロー・カード使用・
    //   トラップ設置のすべてが「手番終了」としてカウント対象)。
    autoInterval: number;
  };
  deck: {
    // デッキ合計枚数の上下限 (Issue #89)。
    totalMax: number;
    totalMin: number;
    // レア度別の「デッキ内のそのレア度合計」上限。null は無制限 (合計 totalMax の範囲内)。
    //   例: epic = 4 → 究極カード (同名/異名問わず合計) が 4 枚を超えてはいけない。
    rarityMaxPerDeck: Record<CardRarity, number | null>;
  };
}

// カードシステム定数の SSOT。**値は S2 着手前と完全一致 (S2e は集約のみ・値不変)**。
export const CARD_SYSTEM_CONFIG: CardSystemConfig = {
  mana: {
    initial: { sente: 2, gote: 3 },
    cap: 20,
    perTurn: 1,
    fastBonus: 1,
    fastThresholdMs: 3000,
  },
  draw: {
    cost: 2,
    autoInterval: 5,
  },
  deck: {
    totalMax: 30,
    totalMin: 1,
    rarityMaxPerDeck: {
      common: null,
      rare: null,
      super_rare: 10,
      epic: 4,
    },
  },
};

// ===== 後方互換のフラット名前付き定数 (CARD_SYSTEM_CONFIG からの導出ビュー) =====
// 既存 consumer (definitions.ts / deck-rules.ts 経由 import) を壊さないため維持する。
// 値の SSOT は CARD_SYSTEM_CONFIG。新規コードは CARD_SYSTEM_CONFIG を直接参照してよい。

// マナ・早指しの確定値 (Issue #81 / 2026-05-01 確定)。
export const INITIAL_MANA: Record<Player, number> = CARD_SYSTEM_CONFIG.mana.initial;
export const MANA_CAP = CARD_SYSTEM_CONFIG.mana.cap;
export const MANA_PER_TURN = CARD_SYSTEM_CONFIG.mana.perTurn;
export const MANA_FAST_BONUS = CARD_SYSTEM_CONFIG.mana.fastBonus;
export const FAST_THRESHOLD_MS = CARD_SYSTEM_CONFIG.mana.fastThresholdMs;

// ドローの確定値 (Issue #130)。
export const DRAW_COST = CARD_SYSTEM_CONFIG.draw.cost;
export const AUTO_DRAW_INTERVAL = CARD_SYSTEM_CONFIG.draw.autoInterval;

// デッキ編成上限 (Issue #89)。
export const DECK_TOTAL_MAX = CARD_SYSTEM_CONFIG.deck.totalMax;
export const DECK_TOTAL_MIN = CARD_SYSTEM_CONFIG.deck.totalMin;
export const RARITY_MAX_PER_DECK: Record<CardRarity, number | null> =
  CARD_SYSTEM_CONFIG.deck.rarityMaxPerDeck;
