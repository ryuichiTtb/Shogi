// Issue #193 / PR1a: SearchStrategy のシン・アダプタ実装。
//
// PR1a では DIFFICULTY_PARAMS パススルーで findBestMoveWithStats を呼ぶだけ。
// 各キャラ別 Strategy (sakura.ts / musashi.ts / genno.ts / ryuou.ts) は本クラスを
// 継承して characterId / difficulty / targetReadingPly を固定するだけの空殻。
// PR1d で内部に cardDigest 評価・キャラ別ヒューリスティクス (Strategy.shouldDraw 等) を
// 充填する想定。
//
// `addNoise` / `nearEqualThreshold` / `useBook` は PR1a では DIFFICULTY_PARAMS パススルー
// (search.ts / engine.ts からの直接参照もそのまま)、PR1c-2 で Strategy 経由に再集約する。
//
// 詳細: docs/plans/issue-193.md「PR1a 主な変更 2.」「PR1c-2 詳細」参照。

import { DIFFICULTY_PARAMS, findBestMoveWithStats } from "@/lib/shogi/ai/engine";
import type { Difficulty } from "@/lib/shogi/types";
import { SPECTATOR_TIME_LIMIT_MS } from "./spectator-override";
import type {
  SearchStrategy,
  SearchStrategyOptions,
  SelectMoveInput,
  SelectMoveResult,
} from "./types";

export class LegacyStrategyAdapter implements SearchStrategy {
  readonly characterId: string;
  readonly difficulty: Difficulty;
  readonly maxSearchDepth: number;
  readonly targetReadingPly: number;
  readonly timeLimitMs: number;
  readonly addNoise: number;
  readonly nearEqualThreshold: number;
  readonly useBook: boolean;
  readonly spectator: boolean;

  constructor(
    characterId: string,
    difficulty: Difficulty,
    targetReadingPly: number,
    opts: SearchStrategyOptions = {},
  ) {
    this.characterId = characterId;
    this.difficulty = difficulty;
    this.targetReadingPly = targetReadingPly;
    this.spectator = opts.spectator ?? false;

    const params = DIFFICULTY_PARAMS[difficulty];
    this.maxSearchDepth = params.maxDepth;
    // 観戦モード時は timeLimitMs を SPECTATOR_TIME_LIMIT_MS まで短縮 (UX 用)。
    // 元値より短い場合のみ短縮 (= beginner 800ms 等は元のまま)。
    this.timeLimitMs = this.spectator
      ? Math.min(params.timeLimitMs, SPECTATOR_TIME_LIMIT_MS)
      : params.timeLimitMs;
    this.addNoise = params.addNoise;
    this.nearEqualThreshold = params.nearEqualThreshold;
    this.useBook = params.useBook;
  }

  selectMove(input: SelectMoveInput): SelectMoveResult {
    // Issue #193 / PR1c-2 Phase B (MM-3 反映): timeLimitMs 経路から spectator フラグ経由に切替。
    // engine 内で createStrategy(difficulty, { spectator }) で Strategy 構築時に
    // Math.min(base, SPECTATOR_TIME_LIMIT_MS) で短縮処理される (= 二重 override 解消)。
    // cardState は PR1a では未使用 (PR1d で findBestMoveWithStats に渡す経路を追加予定)。
    return findBestMoveWithStats(input.state, input.player, this.difficulty, input.variant, {
      signal: input.signal,
      spectator: this.spectator,
    });
  }
}
