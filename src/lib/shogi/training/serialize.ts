// 学習用サンプルの直列化 (Issue #245 フェーズ0)。
//
// 局面・カード状態は既存の serializeGameState / serializeCardState を再利用し、
// ロスレスに JSON 化する (新たな直列化ロジックを増やさない = 冗長排除)。
// イベントは at (= Date.now()) のみ剥がして保存する (計画 §10, M1 NIT-1)。
// 純粋関数のみ (React / Next / Prisma / Node fs 非依存)。

import { serializeGameState } from "@/lib/shogi/board";
import { serializeCardState } from "@/lib/shogi/cards/state";
import type { GameEvent } from "@/lib/shogi/cards/types";
import type { TurnAction } from "@/lib/shogi/kernel/turn-action-types";
import type { WorldState } from "@/lib/shogi/kernel/world-kernel";
import type { TrainingEvent, TrainingSampleData } from "./types";

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
  const { gameState, cardState } = worldBeforeAction;
  return {
    plyIndex,
    moveCount: gameState.moveCount,
    sideToMove: gameState.currentPlayer,
    boardState: serializeGameState(gameState),
    cardState: serializeCardState(cardState),
    action,
    events: stripEventTimestamps(events),
  };
}
