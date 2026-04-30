// Phase 0a モック専用の型定義。Phase 0d で正式に src/lib/shogi/cards/types.ts へ移植する想定。
// 本実装と互換性を保つため、フィールド名・列挙値は Plan 通りに揃える。

import type { Player } from "@/lib/shogi/types";

export type CardKind = "normal" | "trap";

export type CardId = "mana_up" | "pawn_return" | "no_promote";

export type CardTargeting = "none" | "ownPiece" | "enemyPiece" | "square";

export interface CardDefinition {
  id: CardId;
  kind: CardKind;
  name: string;
  description: string;
  cost: number;
  rarity: "common" | "rare" | "epic";
  effectId: string;
  targeting: CardTargeting;
}

export interface CardInstance {
  instanceId: string;
  defId: CardId;
}

export interface TrapInstance {
  instanceId: string;
  defId: CardId;
  owner: Player;
}

export interface MockCardGameState {
  mana: Record<Player, number>;
  manaCap: number;
  hand: Record<Player, CardInstance[]>;
  deck: Record<Player, CardInstance[]>;
  graveyard: Record<Player, CardInstance[]>;
  trap: Record<Player, TrapInstance | null>;
  pendingCard: { instance: CardInstance; phase: "selectTarget" | "confirm" } | null;
}

export type MockCardAction =
  | { type: "CHARGE_MANA"; player: Player; amount: number }
  | { type: "DRAW_CARD"; player: Player }
  | { type: "BEGIN_PLAY_CARD"; player: Player; instanceId: string }
  | { type: "CONFIRM_PLAY_CARD" }
  | { type: "CANCEL_PLAY_CARD" }
  | { type: "SET_TRAP"; player: Player; instanceId: string };
