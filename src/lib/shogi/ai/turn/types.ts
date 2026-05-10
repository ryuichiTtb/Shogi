// Issue #193 / PR1a: AI 探索内で扱う統一行動型 TurnAction と、合法生成・適用・
// ターン終了判定を切替えるための抽象 TurnRules を定義する。
//
// reducer (src/hooks/card-shogi/reducer.ts) は触らず、AI 探索側のみで二重化する設計。
// 詳細は docs/plans/issue-193.md「拡張性設計の核 — TurnAction 抽象」参照。
//
// 現行ルール (CurrentRules) では 1 アクションでターン終了するが、将来ルール
// (FutureRules、PR3 以降で追加予定) では「マナに応じて任意回数のドロー/カード使用 +
// 最後に必ず駒1手」のように move を含むまでターン継続する形に切替えられる。
// TurnRules.isTurnTerminating の実装差替だけでルール変更耐性を担保する。

import type { CardGameState, CardId, CardTarget, GameEvent } from "@/lib/shogi/cards/types";
import type { GameState, Move, Player } from "@/lib/shogi/types";

// AI 探索内で扱う統一行動型。
// - move: 通常の駒指し (既存 Move の薄いラッパ)
// - draw: 山札ドロー (マナ DRAW_COST 消費)
// - playCard: 手札カード使用 (def.cost マナ消費 + 効果適用)
export type TurnAction =
  | { kind: "move"; move: Move }
  | { kind: "draw" }
  | { kind: "playCard"; cardInstanceId: string; defId: CardId; target?: CardTarget };

// AI 探索内部で参照する世界モデル。reducer state とは独立。
// - gameState: 既存の駒・盤面・手番情報
// - cardState: マナ・手札・山札・トラップ・drawProgress
// - doubleMove: 二手指し継続中の状態 (active プレイヤーと残り手数)。null は通常局面。
//   reducer の doubleMove スナップショット (preFirstMoveState/preCardState) は AI 側では
//   持たない (探索内では1手目を仮想適用してから2手目を選ぶため、戻し用スナップショットは不要)。
export interface AiTurnState {
  gameState: GameState;
  cardState: CardGameState;
  doubleMove: {
    active: Player;
    movesLeft: 1 | 2;
  } | null;
}

// applyAction の戻り値。
// - next: 適用後の新しい AiTurnState
// - events: 既存 reducer と同じ GameEvent ストリーム (将来の同期検証で使用)
// - turnEnded: このアクションでターンが終了するか (PR1d-3 の super-action 探索で
//   1手目は false, 2手目で true を返すなど、negamax 側の player 反転制御に使う)
export interface ApplyActionResult {
  next: AiTurnState;
  events: GameEvent[];
  turnEnded: boolean;
}

// ルール切替の核となる抽象。
// 現行ルール: src/lib/shogi/ai/turn/current-rules.ts の CURRENT_TURN_RULES
// 将来ルール: PR3 以降で追加予定 (例: future-rules.ts の FUTURE_TURN_RULES)
export interface TurnRules {
  // ターン終了判定。history はそのターン内で既に適用済の TurnAction 列。
  // 現行: 単発のアクションで常に true (= 1 アクション = 1 ターン)
  // 将来: action.kind === "move" を含むまで false (= 任意回数の draw/playCard 後に move でターン終了)
  isTurnTerminating(action: TurnAction, history: TurnAction[], state: AiTurnState): boolean;

  // 合法 TurnAction 列挙。root のみカードアクションを許容するなど、ルール側で枝刈りも行う。
  getLegalActions(state: AiTurnState, player: Player): TurnAction[];

  // アクション適用。reducer の makeMoveWithEffects と二重化されるが、二重化の不一致は
  // PR1a 段階では fixture (strategy-equivalence.test.ts) でカバーする。
  applyAction(state: AiTurnState, action: TurnAction): ApplyActionResult;
}
