// カード将棋(card-shogi variant)の型定義
//
// Phase 0 暫定実装。Phase A 以降でカード追加・効果追加に伴い拡張する。
// イベント駆動設計(設計ドキュメント 2.6)の足がかりとして、状態遷移は GameEvent として記録する。

import type { Player, Move } from "@/lib/shogi/types";

export type CardKind = "normal" | "trap";

// Phase 0 の暫定カードID。Phase A 以降でユニオンを拡張する。
export type CardId = "mana_up" | "pawn_return" | "no_promote";

export type CardTargeting = "none" | "ownPiece" | "enemyPiece" | "square";

export type CardRarity = "common" | "rare" | "epic";

export interface CardDefinition {
  id: CardId;
  kind: CardKind;
  name: string;
  description: string;
  cost: number;
  rarity: CardRarity;
  // effects.ts でディスパッチするための識別子。CardId と同値だが将来「同一効果の別カード」を許すため独立。
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

export type TrapTrigger = "promotion_declared" | "check_declared";

export type CardTarget = { kind: "square"; row: number; col: number } | { kind: "handPiece"; pieceType: string };

export interface PendingCard {
  instance: CardInstance;
  player: Player;
  phase: "selectTarget" | "confirm";
  target?: CardTarget;
}

export interface CardGameState {
  mana: Record<Player, number>;
  manaCap: number;
  hand: Record<Player, CardInstance[]>;
  deck: Record<Player, CardInstance[]>;
  graveyard: Record<Player, CardInstance[]>;
  trap: Record<Player, TrapInstance | null>;
  pendingCard: PendingCard | null;
  // 早指し判定用に、各プレイヤーの「今の番が始まった瞬間」のタイムスタンプを保持
  lastTurnStartedAt: Record<Player, number | null>;
}

export type CardAction =
  | { type: "CHARGE_MANA"; player: Player; amount: number; reason: "turn" | "card" }
  | { type: "DRAW_CARD"; player: Player }
  | { type: "BEGIN_PLAY_CARD"; player: Player; instanceId: string }
  | { type: "SELECT_CARD_TARGET"; target: CardTarget }
  | { type: "CONFIRM_PLAY_CARD" }
  | { type: "CANCEL_PLAY_CARD" }
  | { type: "SET_TRAP"; player: Player; instanceId: string }
  | { type: "TRIGGER_TRAP"; player: Player; reason: TrapTrigger }
  | { type: "RESET_TURN_TIMER"; player: Player };

export type GameEvent =
  | { kind: "moveEvent"; move: Move; at: number }
  | { kind: "manaChargeEvent"; player: Player; amount: number; reason: "turn" | "card"; at: number }
  | { kind: "drawEvent"; player: Player; instance: CardInstance; at: number }
  | { kind: "cardPlayEvent"; player: Player; instance: CardInstance; target?: CardTarget; at: number }
  | { kind: "trapSetEvent"; player: Player; instance: TrapInstance; at: number }
  | { kind: "trapTriggerEvent"; player: Player; instance: TrapInstance; reason: TrapTrigger; at: number };
