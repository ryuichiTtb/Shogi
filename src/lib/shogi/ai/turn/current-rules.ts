// Issue #193 / PR1a: 現行ルール (1 アクション = 1 ターン) の TurnRules 実装。
//
// 振る舞いキープを最重要視するため、PR1a の getLegalActions は move-only を返す
// (= AI の探索候補は従来通り駒指しのみ)。draw / playCard の生成は PR1d で導入する。
// applyAction の draw / playCard 分岐は PR1d で実装するため、PR1a では throw する
// (PR1a の AI 探索パスからは move 以外で呼ばれない)。
//
// 詳細: docs/plans/issue-193.md「PR1a 詳細」「PR1d 詳細」参照。

import { applyMoveForSearch } from "@/lib/shogi/board";
import { getFullLegalMoves } from "@/lib/shogi/moves";
import type { Player, RuleVariant } from "@/lib/shogi/types";
import type { AiTurnState, ApplyActionResult, TurnAction, TurnRules } from "./types";

export class CurrentRules implements TurnRules {
  constructor(private readonly variant: RuleVariant) {}

  // 現行ルールは「1 アクション = 1 ターン終了」。
  // history・state は将来ルールで使うシグネチャ整合のため受け取るが、現行では未参照。
  isTurnTerminating(_action: TurnAction, _history: TurnAction[], _state: AiTurnState): boolean {
    return true;
  }

  // PR1a では振る舞いキープのため move-only を返す。draw / playCard は PR1d で追加。
  getLegalActions(state: AiTurnState, player: Player): TurnAction[] {
    const moves = getFullLegalMoves(state.gameState, player, this.variant);
    return moves.map((move) => ({ kind: "move" as const, move }));
  }

  // move 以外は PR1d で実装。PR1a の AI 探索からは呼ばれない (getLegalActions が move のみを返すため)。
  applyAction(state: AiTurnState, action: TurnAction): ApplyActionResult {
    if (action.kind === "move") {
      const nextGameState = applyMoveForSearch(state.gameState, action.move);
      return {
        next: {
          gameState: nextGameState,
          cardState: state.cardState,
          doubleMove: state.doubleMove,
        },
        events: [],
        turnEnded: true,
      };
    }
    throw new Error(
      `CurrentRules.applyAction: action.kind="${action.kind}" は PR1d で実装予定 (PR1a の AI 探索パスからは呼ばれません)`,
    );
  }
}
