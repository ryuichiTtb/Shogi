// Issue #193 / PR1a: SearchStrategy 抽象の型定義。
//
// 難易度差別化を Strategy パターンで実装する基盤。PR1a 段階では空殻
// (LegacyStrategyAdapter が DIFFICULTY_PARAMS パススルーで findBestMoveWithStats を呼ぶ)
// として導入し、PR1d で中身 (cardDigest 評価、shouldDraw 等のキャラ別ロジック) を充填する。
//
// `addNoise` / `nearEqualThreshold` / `useBook` は PR1a では DIFFICULTY_PARAMS パススルーで
// 現状維持。PR1c-2 (Strategy 再集約 refactor) で search.ts / engine.ts からの直接参照を
// Strategy 経由に切替える。
//
// 詳細: docs/plans/issue-193.md「拡張性設計の核」「PR1a 主な変更 2.」「PR1c-2 詳細」参照。

import type { CardGameState } from "@/lib/shogi/cards/types";
import type { Difficulty, GameState, Move, Player, RuleVariant } from "@/lib/shogi/types";
import type { SearchStats } from "@/lib/shogi/ai/search-context";

export interface SearchStrategyOptions {
  // CPU vs CPU 観戦モード。true のとき timeLimitMs を SPECTATOR_TIME_LIMIT_MS まで短縮。
  spectator?: boolean;
}

// AI が一手を選ぶときの入力。cardState は PR1a では受け取るだけで未使用 (PR1d で利用)。
export interface SelectMoveInput {
  state: GameState;
  player: Player;
  variant: RuleVariant;
  cardState?: CardGameState;
  signal?: AbortSignal;
}

export interface SelectMoveResult {
  move: Move | null;
  stats: SearchStats;
}

// SearchStrategy: キャラ別の探索パラメータと意思決定を抽象化する。
// PR1a の各 Strategy 実装は LegacyStrategyAdapter のシン・アダプタ。
export interface SearchStrategy {
  // キャラクター ID (data/characters.ts の id と整合: "sakura" / "musashi" / "genno" / "ryuou")
  readonly characterId: string;
  // 既存 DIFFICULTY_PARAMS のキー
  readonly difficulty: Difficulty;
  // 反復深化の上限値 (= DIFFICULTY_PARAMS[difficulty].maxDepth)
  readonly maxSearchDepth: number;
  // ユーザー向け棋力目安としての先読み手数 (Issue #193 本文より): 1 / 3 / 5 / 6
  readonly targetReadingPly: number;
  // 探索時間上限 (ms)。spectator=true のときは SPECTATOR_TIME_LIMIT_MS で上書き。
  readonly timeLimitMs: number;
  // PR1a では DIFFICULTY_PARAMS パススルー、PR1c-2 で Strategy 経由参照に切替。
  readonly addNoise: number;
  readonly nearEqualThreshold: number;
  readonly useBook: boolean;
  readonly spectator: boolean;

  // 一手選択。PR1a 段階では内部で findBestMoveWithStats を呼ぶアダプタ実装。
  selectMove(input: SelectMoveInput): SelectMoveResult;
}
