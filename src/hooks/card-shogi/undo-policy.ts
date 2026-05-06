// 待った (UNDO) 可否判定の共通ロジック (Issue #82)。
//
// 仕様:
// - 「過去 2 ターン (= プレイヤー切替 2 回までの範囲)」内にカード操作
//   (cardPlayEvent / manual drawEvent / trapSetEvent / trapTriggerEvent) があれば 待った 不可。
// - 同色プレイヤーの連続 moveEvent (= 二手指し 1手目+2手目 のような multi-ply turn)
//   は 1 ターン扱いで通り抜ける (= ply 数ではなく turn 数で判定)。
// - 過去 2 つの moveEvent (= 直近 2 ply) を巻き戻すスコープ index も併せて返す。
//
// この関数を **reducer の UNDO ケースと UI の canUndo memo の両方** で使うことで、
// 判定ロジックの分裂・更新漏れを防ぐ。
//
// 新規カード追加時:
// - 新たな card 系 event kind を追加した場合は `isCardOpEvent` の判定を更新すること。
// - 1 ターンに複数 ply 消費するカード (double_move 系) は本ヘルパが自動対応する
//   (プレイヤー切替検出により同色連続を 1 ターン扱い)。

import type { GameEvent } from "@/lib/shogi/cards/types";
import type { Player } from "@/lib/shogi/types";

/**
 * イベントが「カード操作系」(待った可否判定でブロック対象) か。
 * 新たな card 系 event を追加するときはここを更新する。
 *
 * Issue #130: auto drawEvent は手番終了時の副作用であり、ユーザーが任意に実行した
 * カード操作ではない。待った時に reducer 側で手札/山札へ巻き戻すため、ブロック対象外。
 * source 未指定の旧ログは manual 扱いとして保守的にブロックする。
 */
export function isCardOpEvent(ev: GameEvent): boolean {
  return (
    ev.kind === "cardPlayEvent" ||
    (ev.kind === "drawEvent" && (ev.source ?? "manual") === "manual") ||
    ev.kind === "trapSetEvent" ||
    ev.kind === "trapTriggerEvent"
  );
}

/**
 * 待った可否と巻き戻し対象 index を返す。
 *
 * - `null`: 待った不可。理由は以下のいずれか
 *   - moveEvent が 2 件未満 (履歴不足)
 *   - 過去 2 ターン以内にカード操作あり (cardOp)
 *   - 同色 moveEvent しか存在せず、対戦相手の手番境界に到達していない
 * - `number`: 待った可能。eventLog のこの index 以降を巻き戻す
 *   (= 末尾から 2 番目の moveEvent の index)。
 *
 * アルゴリズム:
 * - eventLog を末尾から逆向きにスキャン
 * - moveEvent を見つけたらカウント。プレイヤーが前回から切り替わっていればターン境界
 * - 2 回目のターン境界で「過去 2 ターン分のスキャン完了」として break
 * - スキャン中に cardOp が出現すれば即 null (block)
 * - 完走しても movesSeen<2 / playerChanges<2 なら null
 */
export function getUndoScope(eventLog: GameEvent[]): number | null {
  let lastPlayer: Player | null = null;
  let playerChanges = 0;
  let movesSeen = 0;
  let scopeStartIndex = -1;

  for (let i = eventLog.length - 1; i >= 0; i--) {
    const ev = eventLog[i];
    if (ev.kind === "moveEvent") {
      movesSeen++;
      if (movesSeen === 2) scopeStartIndex = i;
      if (lastPlayer === null) {
        lastPlayer = ev.move.player;
      } else if (ev.move.player !== lastPlayer) {
        playerChanges++;
        lastPlayer = ev.move.player;
        if (playerChanges === 2) break;
      }
    } else if (isCardOpEvent(ev)) {
      return null;
    }
  }

  if (movesSeen < 2) return null;
  // 同色 moveEvent しか存在しない (= 対戦相手の手番に到達していない) ケースは
  // ゲーム開始直後の二手指し連続使用などで発生しうる。安全側に倒して block。
  // (実フローでは canUndo の isPlayerTurn ガードでも先にブロックされるはずだが、
  //  ヘルパ単体でも保守的に扱う)
  if (playerChanges < 1) return null;
  if (scopeStartIndex < 0) return null;
  return scopeStartIndex;
}

/**
 * 待った可否判定に必要な reducer 内部 state の最小 shape (Issue #149)。
 *
 * CardShogiGameStateInternal はこの shape に structural に互換。
 * undo-policy.ts → reducer.ts の型循環参照を避けるため、最小 structural type を
 * ここで定義する (length / null チェックしか行わないため `object | null` で十分)。
 */
export interface UndoEligibilityState {
  doubleMove: object | null;
  gameState: { moveHistory: { length: number } };
  undoSnapshots: { length: number };
  cardState: { pendingCard: object | null };
  eventLog: GameEvent[];
}

/**
 * 待った可能か判定する共通ヘルパ (Issue #149)。
 *
 * 呼び出し元は reducer の UNDO ケース冒頭ガードと、UI から参照されるフック return の両方。
 * これにより UI/reducer の判定ズレ (Issue #149 の根本原因 = `undoSnapshots.length >= 2`
 * チェックが reducer 側にしか存在せず、UI ボタンが活性表示のまま無反応になる事象) を
 * 構造的に防ぐ。
 *
 * 判定条件 (reducer 内部条件):
 * - 二手指し中ではない (`doubleMove === null`)
 * - 駒指し履歴が 2 ply 以上
 * - スナップショットリングが 2 件以上 (= 直近 2 ply 分の状態が保持されている)
 *   → 1 回 UNDO 直後はリングが空になるので、次の UNDO はここで弾かれる
 * - カード使用 pending 中ではない
 * - eventLog 上で getUndoScope が非 null (cardOp ブロック通過 + 過去 2 ターン分のスコープ確保)
 *
 * UI 固有条件 (isPlayerTurn / isAiThinking) は UI 側で別途 wrap する。
 * これらは reducer 内部 state からは導出できない (AI 戦で playerColor を外から渡される) ため。
 */
export function canUndoFromState(state: UndoEligibilityState): boolean {
  if (state.doubleMove !== null) return false;
  if (state.gameState.moveHistory.length < 2) return false;
  if (state.undoSnapshots.length < 2) return false;
  if (state.cardState.pendingCard !== null) return false;
  if (getUndoScope(state.eventLog) === null) return false;
  return true;
}
