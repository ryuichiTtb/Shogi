// カード将棋(card-shogi variant)の型定義
//
// Phase 0 暫定実装。Phase A 以降でカード追加・効果追加に伴い拡張する。
// イベント駆動設計(設計ドキュメント 2.6)の足がかりとして、状態遷移は GameEvent として記録する。

import type { Player, Move } from "@/lib/shogi/types";

export type CardKind = "normal" | "trap";

// Phase 0 の暫定カードID。Phase A 以降でユニオンを拡張する。
// `sample_*` はレア度ビジュアル検証用 (#104)、status: "draft"。
export type CardId =
  | "mana_up"
  | "pawn_return"
  | "no_promote"
  | "double_pawn"
  | "sample_normal_common"
  | "sample_normal_rare"
  | "sample_normal_super_rare"
  | "sample_normal_epic"
  | "sample_trap_common"
  | "sample_trap_rare"
  | "sample_trap_super_rare"
  | "sample_trap_epic";

export type CardTargeting = "none" | "ownPiece" | "enemyPiece" | "square";

// 4段階レア度 (Issue #104)
export type CardRarity = "common" | "rare" | "super_rare" | "epic";

// マスターカタログ運用用ステータス(Issue #102)
// draft: 検討中(本実装前) / preparing: 実装中(プール非公開) /
// active: 公開中 / deprecated: 廃止
export type CardStatus = "draft" | "preparing" | "active" | "deprecated";

// 採用フェーズ(設計ドキュメント 2.5)
export type CardPhase = "0" | "A" | "B" | "C";

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
  // カードの絵柄/アイコン(Phase 0 は絵文字)。Phase A 以降で SVG/画像差替予定。
  icon: string;
  // 運用ステータス(マスターカタログでのフィルタ・公開判定に使用)
  status: CardStatus;
  // 採用フェーズ
  phase?: CardPhase;
  // 詳細仕様(マスターカタログ詳細ページ表示用、改行・箇条書き可)
  detailDescription?: string;
  // 追加日(ISO 日付文字列、例: "2026-04-30")
  addedAt?: string;
  // 関連 Issue 番号
  relatedIssues?: number[];
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

// 「成り不可」マーク (no_promote 永続効果)。
// 各プレイヤーが「成り不可」状態を持つ自分の駒の現在位置を保持。
// 駒が動いたら座標を追従、駒が取られた / 持ち駒に戻った場合は削除 (案A 仕様)。
export interface PieceMark {
  row: number;
  col: number;
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
  // no_promote の永続マーク。各プレイヤーの「成り不可」駒の現在位置リスト。
  noPromoteMarks: Record<Player, PieceMark[]>;
}

export type CardAction =
  | { type: "CHARGE_MANA"; player: Player; amount: number; reason: "turn" | "card" }
  | { type: "DRAW_CARD"; player: Player }
  // ドロー演出完了時に呼ぶ。currentPlayer を相手に渡し、isDrawing をクリア。
  | { type: "COMMIT_DRAW" }
  | { type: "BEGIN_PLAY_CARD"; player: Player; instanceId: string }
  | { type: "SELECT_CARD_TARGET"; target: CardTarget }
  | { type: "CONFIRM_PLAY_CARD" }
  | { type: "CANCEL_PLAY_CARD" }
  | { type: "SET_TRAP"; player: Player; instanceId: string }
  | { type: "TRIGGER_TRAP"; player: Player; reason: TrapTrigger }
  | { type: "RESET_TURN_TIMER"; player: Player };

export type GameEvent =
  | { kind: "moveEvent"; move: Move; at: number }
  | { kind: "manaChargeEvent"; player: Player; amount: number; reason: "turn" | "card"; fastMove?: boolean; at: number }
  | { kind: "drawEvent"; player: Player; instance: CardInstance; at: number }
  | { kind: "cardPlayEvent"; player: Player; instance: CardInstance; target?: CardTarget; at: number }
  | { kind: "trapSetEvent"; player: Player; instance: TrapInstance; at: number }
  | { kind: "trapTriggerEvent"; player: Player; instance: TrapInstance; reason: TrapTrigger; at: number };
