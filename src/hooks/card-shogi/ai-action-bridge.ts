// Issue #193 / card-apply: AI 探索が選んだ TurnAction を、reducer が解釈できる
// Action 列へ変換する純粋関数。
//
// 設計判断:
// - 純粋関数 + ユニットテストで配線品質を担保する (hook 統合テストは
//   @testing-library/react の環境問題で不安定なため、変換ロジックを切り出して
//   単体で検証する)。
// - double_move (二手指し): Issue #245 S4c-1d で 1-response 方式に接続。engine が実行用 move ペア
//   (doubleMove 引数) を供給したとき BEGIN→CONFIRM→MAKE_MOVE(1手目)[→MAKE_MOVE(2手目)] の
//   dispatch 列を返す。未供給 (bolt-on / dm 未探索 / 旧サーバ) は従来どおり null = move フォールバック。
// - SELECT_CARD_TARGET は reducer 内で自動的に CONFIRM_PLAY_CARD を呼ぶため
//   (reducer.ts: stateWithTarget → CONFIRM_PLAY_CARD)、target あり playCard は
//   BEGIN_PLAY_CARD → SELECT_CARD_TARGET の 2 dispatch で完結する。

import type { TurnAction } from "@/lib/shogi/ai/turn/types";
import type { Move, Player } from "@/lib/shogi/types";
import type { Action } from "./reducer";

// double_move カードの defId (CardDefinition.id)。AI 接続対象外 (論点 A)。
const DOUBLE_MOVE_DEF_ID = "double_move";

/**
 * AI が選んだ TurnAction を reducer Action 列へ変換する。
 *
 * @param action AI 探索の最良 TurnAction
 * @param player AI のプレイヤー (TurnAction は player を持たないため呼び出し側が渡す)
 * @returns dispatch すべき Action 配列。double_move は AI 未接続のため null
 *          (呼び出し側は move フォールバックで駒移動の最善手を指す)。
 */
export function turnActionToReducerActions(
  action: TurnAction,
  player: Player,
  // Issue #245 S4c-1d: double_move の実行用 move ペア (engine→route から搬送)。
  // 供給時のみ 4-dispatch 列を組む。未供給は dm でも null フォールバック (bolt-on 後方互換)。
  doubleMove?: { move1: Move; move2: Move | null },
): Action[] | null {
  switch (action.kind) {
    case "move":
      return [{ type: "MAKE_MOVE", move: action.move }];

    case "draw":
      return [{ type: "DRAW_CARD", player }];

    case "playCard": {
      if (action.defId === DOUBLE_MOVE_DEF_ID) {
        // Issue #245 S4c-1d (1-response): move ペア供給時は BEGIN→CONFIRM→MAKE_MOVE(1手目)
        // [→MAKE_MOVE(2手目)] を返す (double_move は targeting:none ゆえ SELECT_CARD_TARGET 不要)。
        // 1手目で詰み (move2=null) は 3-dispatch。未供給は従来の null = move フォールバック。
        if (doubleMove === undefined) return null;
        const acts: Action[] = [
          { type: "BEGIN_PLAY_CARD", player, instanceId: action.cardInstanceId },
          { type: "CONFIRM_PLAY_CARD" },
          { type: "MAKE_MOVE", move: doubleMove.move1 },
        ];
        if (doubleMove.move2 !== null) acts.push({ type: "MAKE_MOVE", move: doubleMove.move2 });
        return acts;
      }
      const begin: Action = {
        type: "BEGIN_PLAY_CARD",
        player,
        instanceId: action.cardInstanceId,
      };
      if (action.target !== undefined) {
        // SELECT_CARD_TARGET は reducer 内で CONFIRM_PLAY_CARD を自動呼出するため
        // 明示的な CONFIRM は不要。
        return [begin, { type: "SELECT_CARD_TARGET", target: action.target }];
      }
      return [begin, { type: "CONFIRM_PLAY_CARD" }];
    }
  }
}
