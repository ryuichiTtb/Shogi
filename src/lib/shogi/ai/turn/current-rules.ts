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
import type { CardGameState } from "@/lib/shogi/cards/types";
import { DRAW_COST, AUTO_DRAW_INTERVAL } from "@/lib/shogi/cards/definitions";
import { getCardActions } from "./action-generator";
import type { AiTurnState, ApplyActionResult, TurnAction, TurnRules } from "./types";

// PR1d-1: ドロー判定ヘルパ。
// 計画 md L506-510 / 進行中チェックリスト F-4 反映:
//   ・mana >= DRAW_COST (= 2): 手動ドロー使用後もマナ余裕を保つ
//   ・deck.length > 0: 山札枯渇時はドロー不能
//   ・drawProgress < AUTO_DRAW_INTERVAL - 1 (= 4): 次手番開始時の自動ドロー発火直前
//     (drawProgress = 4) の局面では手動ドローを使うと「マナ -2 + 既に出る自動ドローを
//     1 ターン分前倒し」にしかならず ROI が低い。drawProgress < 4 のときに限定して、
//     自動ドローを 5 ターン後に持ち越しつつマナ -2 を即時投資する意味のあるケースに絞る。
export function canDraw(cardState: CardGameState, player: Player): boolean {
  return (
    cardState.mana[player] >= DRAW_COST &&
    cardState.deck[player].length > 0 &&
    cardState.drawProgress[player] < AUTO_DRAW_INTERVAL - 1
  );
}

export class CurrentRules implements TurnRules {
  constructor(private readonly variant: RuleVariant) {}

  // 現行ルールは「1 アクション = 1 ターン終了」。
  // history・state は将来ルールで使うシグネチャ整合のため受け取るが、現行では未参照。
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  isTurnTerminating(_action: TurnAction, _history: TurnAction[], _state: AiTurnState): boolean {
    return true;
  }

  // PR1d-2: getLegalActions に root のみ PlayCardAction 候補追加 (PR1d-1 の DrawAction に続く拡張)。
  // ・move 候補は既存通り全列挙
  // ・state.isRoot === true かつ variant.id === "card-shogi" のときのみ DrawAction / PlayCardAction を追加
  //   (= 子ノードでは move-only に絞る、PR3 でカード深読みを広げる際に拡張)
  // ・state.isRoot 未指定 or false の場合は従来通り move-only (= PR1c-2 完了時点の振る舞いを保持)
  // ・PlayCardAction 生成は action-generator.ts の getCardActions に委譲
  //   (BEGIN_PLAY_CARD 7 項目 reducer.ts:1124 を AI 側で同じ純粋関数で再現)
  // ・実際の production 探索パス (engine.ts findBestMoveWithStats / search.ts findBestMove) からの
  //   呼出統合は PR1d-2 コミット 3 で行う (本コミット 2 段階では search.ts に evaluateAction を
  //   追加するが、production 経路は依然 findBestMove → getSearchLegalMoves 直接呼出のため、
  //   本メソッド経由の playCard / draw 候補は production からは未到達)。
  getLegalActions(state: AiTurnState, player: Player): TurnAction[] {
    const moves = getFullLegalMoves(state.gameState, player, this.variant);
    const actions: TurnAction[] = moves.map((move) => ({ kind: "move" as const, move }));

    if (state.isRoot === true && this.variant.id === "card-shogi") {
      if (canDraw(state.cardState, player)) {
        actions.push({ kind: "draw" });
      }
      for (const cardAction of getCardActions(state, player, this.variant)) {
        actions.push(cardAction);
      }
    }

    return actions;
  }

  // PR1d-2 コミット 2 段階での実装方針 (ZZ-5 後続対応):
  // move 以外 (draw / playCard) の applyAction は引き続き throw 維持。
  // 理由: PR1d-2 では search.ts の evaluateAction (新規) が simulateCardEffect 等を
  // 直接呼んで playCard / draw の評価値を算出する設計に確定したため、applyAction 経由の
  // 状態遷移は不要 (= reducer ロジックを AI 側で二重実装するリスクを回避)。
  // production 探索パスは依然として findBestMove (search.ts) → getSearchLegalMoves 直接呼出で、
  // CurrentRules.applyAction は呼ばれず throw 到達せず。
  // 将来 PR3 (カード深読み探索) で applyAction(draw / playCard) が必要になった時点で実装する。
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
      `CurrentRules.applyAction: action.kind="${action.kind}" は PR3 (カード深読み探索) で実装予定 (PR1d-2 段階では evaluateAction が simulateCardEffect 等を直接呼ぶため applyAction 経由は不要)`,
    );
  }
}
