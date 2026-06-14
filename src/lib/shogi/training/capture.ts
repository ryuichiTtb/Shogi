// 人間対局キャプチャの純粋ロジック (Issue #245 フェーズ0 P0-3, React 非依存)。
//
// reducer の eventLog 伸長を 1 render ずつ捌き、per-decision サンプルを増減する。
// React の useEffect からは captureStep を呼ぶだけにし、増減ロジックを本モジュールに
// 集約して単体テスト可能にする (#109 疎結合・保守性)。
//
// 仕様:
// - 二手指し進行中 (doubleMove !== null) はサンプル確定を保留し、pre-world (= カード宣言
//   直前の盤面 + カード状態) を保持し続ける。ターン完了 (doubleMove === null) で eventLog が
//   一括伸長し、cardPlay + move×2 を 1 サンプルに畳む。
// - eventLog 伸長 → その decision の events 束から TurnAction を逆算し 1 サンプル追加。
// - eventLog 縮小 (待った / カードキャンセル) → 巻き戻った decision のサンプルを破棄。

import type { CardGameState, GameEvent } from "@/lib/shogi/cards/types";
import type { GameState } from "@/lib/shogi/types";

import { deriveActionFromEvents } from "./derive-action";
import { buildTrainingSample } from "./serialize";
import type { TrainingSampleData } from "./types";

// 1 render 分の入力 (盤面 + カード状態 + 二手指し状態 + 累積 eventLog)。
export interface CaptureWorld {
  gameState: GameState;
  cardState: CardGameState;
  doubleMove: object | null; // null かどうかだけ参照 (二手指し進行中の保留判定)
  eventLog: readonly GameEvent[];
}

export interface CaptureState {
  // eventLogLenAfter = その decision 適用後の eventLog 長 (待った時の破棄対応付けに使う)。
  samples: { sample: TrainingSampleData; eventLogLenAfter: number }[];
  plyCounter: number;
  prev: { gameState: GameState; cardState: CardGameState; eventLogLen: number } | null;
}

export function createCaptureState(): CaptureState {
  return { samples: [], plyCounter: 0, prev: null };
}

// 1 render 分を反映する (in-place 更新)。
export function captureStep(cap: CaptureState, world: CaptureWorld): void {
  // 二手指し進行中は保留 (prev を更新せず、カード宣言直前の pre-world を保持)。
  if (world.doubleMove !== null) return;

  const curLen = world.eventLog.length;
  const prev = cap.prev;
  if (prev) {
    if (curLen > prev.eventLogLen) {
      const events = world.eventLog.slice(prev.eventLogLen);
      const action = deriveActionFromEvents(events);
      if (action) {
        cap.samples.push({
          sample: buildTrainingSample(
            { gameState: prev.gameState, cardState: prev.cardState, doubleMove: null },
            action,
            events,
            cap.plyCounter,
          ),
          eventLogLenAfter: curLen,
        });
        cap.plyCounter += 1;
      }
    } else if (curLen < prev.eventLogLen) {
      const samples = cap.samples;
      while (samples.length > 0 && samples[samples.length - 1].eventLogLenAfter > curLen) {
        samples.pop();
      }
      cap.plyCounter = samples.length;
    }
  }

  cap.prev = {
    gameState: world.gameState,
    cardState: world.cardState,
    eventLogLen: curLen,
  };
}

// 終局 flush 用に確定サンプル列を取り出す。
export function captureSamples(cap: CaptureState): TrainingSampleData[] {
  return cap.samples.map((s) => s.sample);
}
