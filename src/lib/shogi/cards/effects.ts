// カード効果の純粋関数群。
// 入力に対して副作用を起こさず、新しい状態オブジェクトを返す。
// reducer から呼び出され、reducer 側で eventLog を追記する。

import type { GameState, Player, Position } from "@/lib/shogi/types";
import { cloneGameState } from "../board";
import type { CardGameState } from "./types";

// マナUP: 即時マナ +3 (上限 manaCap を超えない)
export function applyManaUp(
  cardState: CardGameState,
  player: Player,
): CardGameState {
  const next = Math.min(cardState.manaCap, cardState.mana[player] + 3);
  return {
    ...cardState,
    mana: { ...cardState.mana, [player]: next },
  };
}

// 歩戻し: 自盤上の歩(または と金)1枚を持ち駒に戻す。
// と金は将棋ルール上「歩」として持ち駒になる(unpromote)。
// 失敗時(対象がない/相手の駒/歩でない)は null を返す。
export function applyPawnReturn(
  state: GameState,
  player: Player,
  target: Position,
): GameState | null {
  const piece = state.board[target.row]?.[target.col];
  if (!piece) return null;
  if (piece.owner !== player) return null;
  if (piece.type !== "pawn" && piece.type !== "promoted_pawn") return null;

  const newState = cloneGameState(state);
  newState.board[target.row][target.col] = null;
  const currentCount = newState.hand[player]["pawn"] ?? 0;
  newState.hand[player]["pawn"] = currentCount + 1;
  return newState;
}

// トラップセット: 手札の指定カードを trap スロットへ移動 (マナ消費は呼び出し側)
export function applyTrapSet(
  cardState: CardGameState,
  player: Player,
  instanceId: string,
): CardGameState | null {
  const card = cardState.hand[player].find((c) => c.instanceId === instanceId);
  if (!card) return null;
  return {
    ...cardState,
    hand: {
      ...cardState.hand,
      [player]: cardState.hand[player].filter((c) => c.instanceId !== instanceId),
    },
    trap: {
      ...cardState.trap,
      [player]: { instanceId: card.instanceId, defId: card.defId, owner: player },
    },
  };
}

// トラップ発火後の解除 (発火したトラップは消費される)
export function applyTrapClear(
  cardState: CardGameState,
  player: Player,
): CardGameState {
  if (!cardState.trap[player]) return cardState;
  return {
    ...cardState,
    trap: { ...cardState.trap, [player]: null },
  };
}

// 通常カード使用: マナ消費 + 手札からグレイブへ
export function consumeNormalCard(
  cardState: CardGameState,
  player: Player,
  instanceId: string,
  cost: number,
): CardGameState | null {
  const card = cardState.hand[player].find((c) => c.instanceId === instanceId);
  if (!card) return null;
  if (cardState.mana[player] < cost) return null;
  return {
    ...cardState,
    mana: { ...cardState.mana, [player]: cardState.mana[player] - cost },
    hand: {
      ...cardState.hand,
      [player]: cardState.hand[player].filter((c) => c.instanceId !== instanceId),
    },
    graveyard: {
      ...cardState.graveyard,
      [player]: [...cardState.graveyard[player], card],
    },
  };
}
