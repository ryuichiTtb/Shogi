// Issue #193 / PR1d-2: AI 探索側のカードアクション候補生成。
//
// 設計:
// reducer.ts の BEGIN_PLAY_CARD (L1124) で集約された 7 項目のカード使用可否判定を、
// AI 側で **同じ純粋関数** (`hasSameKindTrapPlaced` / `isInCheck` /
// `getCheckEscapingSquares` / `CARD_USE_CONDITIONS`) を呼んで再現する。
// 二重実装を避けて構造的に整合性を確保。
//
// PR1d-2 では通常 3 カード (pawn_return / piece_return / double_pawn) に対応。
// double_move (PR1d-3 super-action 探索) とトラップ系 (PR1d-4 no_promote / check_break)
// は別 sub PR で実装。
//
// 計画 md `docs/plans/issue-193-pr1d.md` PR1d-2 詳細 / 主な変更 1. action-generator.ts 新規 参照。

import { CARD_DEFS, CARD_USE_CONDITIONS } from "@/lib/shogi/cards/definitions";
import {
  hasSameKindTrapPlaced,
  isValidCardTargetSquare,
  getCheckEscapingSquares,
} from "@/lib/shogi/cards/effects";
import { isInCheck } from "@/lib/shogi/moves";
import type {
  CardDefinition,
  CardTarget,
} from "@/lib/shogi/cards/types";
import type { GameState, Player, RuleVariant } from "@/lib/shogi/types";
import type { AiTurnState, TurnAction } from "./types";

/**
 * BEGIN_PLAY_CARD (reducer.ts:1124) の 7 項目を AI 側で再現したカードアクション候補生成。
 *
 * 既存純粋関数 (hasSameKindTrapPlaced / isInCheck / getCheckEscapingSquares /
 * CARD_USE_CONDITIONS) を共用するため、reducer の判定ロジックと不一致リスクが構造的に発生しない。
 *
 * variant は AiTurnState に持たないため引数で明示的に受け取る (CurrentRules.getLegalActions と
 * 同じ「this.variant 経由」のパターンと一貫)。calling 側は CurrentRules.getLegalActions 内で
 * `this.variant` を渡す。
 *
 * @returns AiTurnState の手番側プレイヤーが今 root で打てる PlayCardAction の Generator
 */
export function* getCardActions(
  state: AiTurnState,
  player: Player,
  variant: RuleVariant,
): Iterable<TurnAction> {
  // (1) 二手指し中は他カード禁止
  if (state.doubleMove !== null) return;

  // (2) 自分の手番でなければ使用禁止
  if (state.gameState.currentPlayer !== player) return;

  for (const card of state.cardState.hand[player]) {
    const def = CARD_DEFS[card.defId];

    // (3) 手札にないカードは for...of で自然にスキップ済 (state.cardState.hand[player] が手札全件)

    // (4) マナ不足は使用不可
    if (state.cardState.mana[player] < def.cost) continue;

    // (5) 同種トラップ重複は使用不可
    if (def.kind === "trap" && hasSameKindTrapPlaced(state.cardState, player, card.defId)) {
      continue;
    }

    // (6) CARD_USE_CONDITIONS 個別判定 (定義済は 3 枚: pawn_return / double_pawn / piece_return)
    const conditionFn = CARD_USE_CONDITIONS[card.defId];
    if (conditionFn && !conditionFn(state.gameState, player, state.cardState)) {
      continue;
    }

    // (7) 王手中: checkUsage フラグで二段ゲート
    if (isInCheck(state.gameState, player, variant)) {
      if (def.checkUsage === "forbidden") continue;
      if (def.checkUsage === "conditional" && def.targeting !== "none") {
        const escapingSquares = getCheckEscapingSquares(state.gameState, player, card.defId);
        if (escapingSquares.length === 0) continue;
      }
    }

    // 7 項目通過後、target 列挙して PlayCardAction を yield
    for (const target of enumerateTargets(state, def, player)) {
      yield {
        kind: "playCard",
        cardInstanceId: card.instanceId,
        defId: card.defId,
        target: target ?? undefined,
      };
    }
  }
}

/**
 * カード定義の targeting に応じて対象 target を列挙 (第 4 次レビュー C-5 反映)。
 *
 * - "none": ターゲット不要カード (mana_up / check_break / double_move / no_promote) → null を 1 回 yield
 * - "square": 盤面マス指定カード (double_pawn 等) → 有効マスを順次 yield
 * - "ownPiece": 自駒マス指定カード (pawn_return / piece_return) → 自駒マスを順次 yield
 *   (内部表現は `{ kind: "square", row, col }` で、`isValidCardTargetSquare` の defId 別判定で
 *   自駒種別チェックが行われる)
 * - "enemyPiece": 相手駒マス指定カード (将来カードで使用想定) → PR1d 範囲では空 yield
 */
function* enumerateTargets(
  state: AiTurnState,
  def: CardDefinition,
  player: Player,
): Iterable<CardTarget | null> {
  switch (def.targeting) {
    case "none":
      yield null;
      return;
    case "square":
    case "ownPiece": {
      // 「ownPiece」も実態は盤面マス指定 (isValidCardTargetSquare の defId 別 case で
      // 自駒種別を判定するため、CardTarget の kind は "square" 統一)
      for (const pos of enumerateValidSquaresForCard(state.gameState, def, player)) {
        yield { kind: "square", row: pos.row, col: pos.col };
      }
      return;
    }
    case "enemyPiece":
      // PR1d 範囲では未実装 (将来カードで使用想定)、空 Generator
      return;
  }
}

/**
 * targeting: "square" カード (pawn_return / piece_return / double_pawn) の対象マス列挙。
 *
 * isValidCardTargetSquare (effects.ts:274) を 9×9 ループで呼ぶシン実装 (= reducer 側と同一判定)。
 * isValidCardTargetSquare 内部で variant.id 固定 (CARD_SHOGI_VARIANT) で王手判定済のため、
 * 王手中の use condition は CARD_USE_CONDITIONS 経由で getCardActions の (6) 段階で既に枝刈り済。
 */
function* enumerateValidSquaresForCard(
  gameState: GameState,
  def: CardDefinition,
  player: Player,
): Iterable<{ row: number; col: number }> {
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      if (isValidCardTargetSquare(gameState, player, def.id, { row, col })) {
        yield { row, col };
      }
    }
  }
}
