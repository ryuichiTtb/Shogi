// Issue #193 / card-apply: AI 探索が選んだ TurnAction を、reducer が解釈できる
// Action 列へ変換する純粋関数。
//
// 設計判断:
// - 純粋関数 + ユニットテストで配線品質を担保する (hook 統合テストは
//   @testing-library/react の環境問題で不安定なため、変換ロジックを切り出して
//   単体で検証する)。
// - double_move (二手指し) は AI 接続せず move フォールバックとする (論点 A)。
//   reducer の doubleMove 状態が AI 探索に未連携のため、ここで null を返して
//   呼び出し側に「駒移動の最善手で代替せよ」と伝える。完全対応は別タスク。
// - SELECT_CARD_TARGET は reducer 内で自動的に CONFIRM_PLAY_CARD を呼ぶため
//   (reducer.ts: stateWithTarget → CONFIRM_PLAY_CARD)、target あり playCard は
//   BEGIN_PLAY_CARD → SELECT_CARD_TARGET の 2 dispatch で完結する。

import type { TurnAction } from "@/lib/shogi/ai/turn/types";
import type { Player } from "@/lib/shogi/types";
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
): Action[] | null {
  switch (action.kind) {
    case "move":
      return [{ type: "MAKE_MOVE", move: action.move }];

    case "draw":
      return [{ type: "DRAW_CARD", player }];

    case "playCard": {
      // 二手指しは reducer の doubleMove 状態と AI 探索が未連携のため接続しない。
      // null を返し、呼び出し側に move フォールバックを指示する。
      if (action.defId === DOUBLE_MOVE_DEF_ID) {
        return null;
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
