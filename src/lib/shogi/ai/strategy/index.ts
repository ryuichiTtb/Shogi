// Issue #193 / PR1a: SearchStrategy モジュールの集約 export と Difficulty → Strategy factory。

import type { Difficulty } from "@/lib/shogi/types";
import { GennoStrategy } from "./genno";
import { LegacyStrategyAdapter } from "./legacy-adapter";
import { MusashiStrategy } from "./musashi";
import { RyuouStrategy } from "./ryuou";
import { SakuraStrategy } from "./sakura";
import { SPECTATOR_TIME_LIMIT_MS } from "./spectator-override";
import type { SearchStrategy, SearchStrategyOptions } from "./types";

export type {
  SearchStrategy,
  SearchStrategyOptions,
  SelectMoveInput,
  SelectMoveResult,
} from "./types";
export {
  LegacyStrategyAdapter,
  SakuraStrategy,
  MusashiStrategy,
  GennoStrategy,
  RyuouStrategy,
  SPECTATOR_TIME_LIMIT_MS,
};

// Difficulty から該当キャラ Strategy を生成する factory。
// CPU vs CPU 観戦モードで先手・後手それぞれに別 Strategy インスタンスを作る場合は、
// 各プレイヤーの difficulty で本 factory を呼び分ける (E-1 対応の client 側分岐想定)。
export function createStrategy(
  difficulty: Difficulty,
  opts: SearchStrategyOptions = {},
): SearchStrategy {
  switch (difficulty) {
    case "beginner":
      return new SakuraStrategy(opts);
    case "intermediate":
      return new MusashiStrategy(opts);
    case "advanced":
      return new GennoStrategy(opts);
    case "expert":
      return new RyuouStrategy(opts);
  }
}
