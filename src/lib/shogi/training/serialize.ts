// 学習用サンプルの直列化 (Issue #245 フェーズ0)。
//
// 盤面は学習用 serializeBoardForTraining (moveHistory / positionHistory を除外しサイズ削減)、
// カード状態は既存 serializeCardState を再利用してロスレスに JSON 化する。
// イベントは at (= Date.now()) のみ剥がして保存する (計画 §10, M1 NIT-1)。
// 純粋関数のみ (React / Next / Prisma / Node fs 非依存)。

import { serializeCardState } from "@/lib/shogi/cards/state";
import type { GameEvent } from "@/lib/shogi/cards/types";
import type { TurnAction } from "@/lib/shogi/kernel/turn-action-types";
import type { WorldState } from "@/lib/shogi/kernel/world-kernel";
import type { GameState } from "@/lib/shogi/types";
import type { TrainingEvent, TrainingSampleData } from "./types";

// 学習用の盤面直列化。局面の自己完結部分 (盤面 + 持ち駒 + 手番 + 手数 + 終局状態) のみを残し、
// moveHistory / positionHistory は除外する。両者はサンプル列 (各 action) と局面列から学習時に
// 導出可能であり (計画 §10「導出可能 = 保存しない」)、各サンプルに丸ごと持つと N decision に対し
// O(N^2) に肥大する (累積配列 × サンプル数) ため保存しない。
export function serializeBoardForTraining(state: GameState) {
  return {
    board: state.board.map((row) => row.map((p) => (p ? { type: p.type, owner: p.owner } : null))),
    hand: state.hand,
    currentPlayer: state.currentPlayer,
    status: state.status,
    winner: state.winner,
    moveCount: state.moveCount,
  };
}

// GameEvent から at (= Date.now()) を剥がす。順序は配列順 / plyIndex で担保する。
// fastMove / drawEvent.source など学習に有用なフィールドはそのまま残す。
export function stripEventTimestamp(event: GameEvent): TrainingEvent {
  const copy: Record<string, unknown> = { ...event };
  delete copy.at;
  return copy as TrainingEvent;
}

export function stripEventTimestamps(events: readonly GameEvent[]): TrainingEvent[] {
  return events.map(stripEventTimestamp);
}

// 行動前の WorldState + 採用 action + 適用で生じた events から 1 サンプルを組み立てる。
// worldBeforeAction は「行動する側がその局面を見ている瞬間」(= applyTurnAction 適用前)。
export function buildTrainingSample(
  worldBeforeAction: WorldState,
  action: TurnAction,
  events: readonly GameEvent[],
  plyIndex: number,
): TrainingSampleData {
  const { gameState, cardState, doubleMove } = worldBeforeAction;
  const sample: TrainingSampleData = {
    plyIndex,
    moveCount: gameState.moveCount,
    sideToMove: gameState.currentPlayer,
    boardState: serializeBoardForTraining(gameState),
    cardState: serializeCardState(cardState),
    action,
    events: stripEventTimestamps(events),
  };
  // 二手指し継続中だけ刻む (通常ターンでは付けない = 既存サンプルと同じ形のまま)。
  if (doubleMove) sample.doubleMoveMovesLeft = doubleMove.movesLeft;
  return sample;
}
