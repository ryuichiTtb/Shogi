// Issue #193 / PR1d-2: AI 探索側のカードアクション候補生成。
//
// 設計:
// reducer.ts の BEGIN_PLAY_CARD で集約されたカード使用可否判定を、AI 側で**同じ値**を参照して再現する。
// 二重実装を避けて構造的に整合性を確保。
//
// Issue #235 S2c: 使用可否判定を **CardSpec registry のクエリへ統一**。従来は CARD_DEFS (cost/kind/
// checkUsage/targeting) と CARD_USE_CONDITIONS (関数) を個別参照していたが、`CARD_SPECS[id]` の
// meta.cost / meta.kind / useCondition / checkUsage / targeting へ集約 (族別 switch 排除、単一源化)。
// registry 由来値は CARD_DEFS/CARD_USE_CONDITIONS と等価 (card-spec.test で担保) のため挙動不変。
// 盤面マスの空間妥当性 (isValidCardTargetSquare) と 同種トラップ重複 / 王手回避列挙
// (hasSameKindTrapPlaced / getCheckEscapingSquares) は registry 非保持の純粋関数として effects.ts に残す。

import {
  hasSameKindTrapPlaced,
  isValidCardTargetSquare,
  getCheckEscapingSquares,
} from "@/lib/shogi/cards/effects";
import { CARD_SPECS, type CardSpec } from "@/lib/shogi/cards/card-spec-server";
import { isInCheck } from "@/lib/shogi/moves";
import type { CardId, CardTarget } from "@/lib/shogi/cards/types";
import type { GameState, Player, RuleVariant } from "@/lib/shogi/types";
import type { AiTurnState, TurnAction } from "./types";

/**
 * BEGIN_PLAY_CARD の 7 項目を AI 側で再現したカードアクション候補生成。
 *
 * CardSpec registry (`CARD_SPECS`) を単一窓口にクエリするため、reducer の判定ロジックと不一致リスクが
 * 構造的に発生しない。useCondition は registry が `(world, player)` シグネチャで内包 (= CARD_USE_CONDITIONS
 * を統一)。AiTurnState は CardWorldView ({gameState, cardState}) へ構造的に代入可能。
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

  // Issue #235 派生 (Vercel 504 対策、2026-06-10): 同一 defId の重複インスタンスは dedupe し
  // 先頭インスタンスのみ候補化する。使用可否判定 ((4)〜(7)) と効果・評価は defId と盤面/カード
  // 状態のみに依存しインスタンス間で完全に等価なため、「どのコピーを切るか」は探索上無意味。
  // dedupe なしだと手札に同種カードが N 枚あるとき同一評価が N 回走り、特に二手指し
  // (super-action 内部探索 ≈ 数秒/回) の重複が Vercel maxDuration 10s 超過 (504) の主因だった
  // (実測: 二手指し 3 枚で計 11.4s)。採用される instanceId は従来も argmax の strict > により
  // 先頭コピーだったため、選択結果は不変。
  const seenDefIds = new Set<CardId>();

  for (const card of state.cardState.hand[player]) {
    if (seenDefIds.has(card.defId)) continue;
    seenDefIds.add(card.defId);
    const spec = CARD_SPECS[card.defId];

    // (3) 手札にないカードは for...of で自然にスキップ済 (state.cardState.hand[player] が手札全件)

    // (4) マナ不足は使用不可
    if (state.cardState.mana[player] < spec.meta.cost) continue;

    // (5) 同種トラップ重複は使用不可
    if (spec.meta.kind === "trap" && hasSameKindTrapPlaced(state.cardState, player, card.defId)) {
      continue;
    }

    // (6) 個別使用条件 (registry の useCondition = CARD_USE_CONDITIONS 内包、定義済は
    //     pawn_return / double_pawn / piece_return の 3 枚)
    if (spec.useCondition && !spec.useCondition(state, player)) {
      continue;
    }

    // (7) 王手中: checkUsage フラグで二段ゲート
    if (isInCheck(state.gameState, player, variant)) {
      if (spec.checkUsage === "forbidden") continue;
      if (spec.checkUsage === "conditional" && spec.targeting !== "none") {
        const escapingSquares = getCheckEscapingSquares(state.gameState, player, card.defId);
        if (escapingSquares.length === 0) continue;
      }
    }

    // 7 項目通過後、target 列挙して PlayCardAction を yield
    for (const target of enumerateTargets(state, spec, player)) {
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
 * CardSpec の targeting に応じて対象 target を列挙 (第 4 次レビュー C-5 反映)。
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
  spec: CardSpec,
  player: Player,
): Iterable<CardTarget | null> {
  switch (spec.targeting) {
    case "none":
      yield null;
      return;
    case "square":
    case "ownPiece": {
      // 「ownPiece」も実態は盤面マス指定 (isValidCardTargetSquare の defId 別 case で
      // 自駒種別を判定するため、CardTarget の kind は "square" 統一)
      for (const pos of enumerateValidSquaresForCard(state.gameState, spec.meta.id, player)) {
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
 * targeting: "square"/"ownPiece" カード (pawn_return / piece_return / double_pawn) の対象マス列挙。
 *
 * isValidCardTargetSquare (effects.ts) を 9×9 ループで呼ぶシン実装 (= reducer 側と同一判定)。
 * isValidCardTargetSquare 内部で variant.id 固定 (CARD_SHOGI_VARIANT) で王手判定済のため、
 * 王手中の use condition は getCardActions の (6) 段階で既に枝刈り済。
 */
function* enumerateValidSquaresForCard(
  gameState: GameState,
  defId: CardId,
  player: Player,
): Iterable<{ row: number; col: number }> {
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      if (isValidCardTargetSquare(gameState, player, defId, { row, col })) {
        yield { row, col };
      }
    }
  }
}
