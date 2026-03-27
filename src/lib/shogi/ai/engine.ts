import type { Difficulty, GameState, Move, Player, RuleVariant } from "../types";
import { STANDARD_VARIANT } from "../variants/standard";
import { findBestMove } from "./search";

// 難易度別探索パラメータ
const DIFFICULTY_PARAMS: Record<Difficulty, {
  maxDepth: number;
  timeLimitMs: number;
  addNoise: number;
}> = {
  beginner: {
    maxDepth: 2,
    timeLimitMs: 1000,
    addNoise: 0.4, // 40%の確率でランダムな手
  },
  intermediate: {
    maxDepth: 4,
    timeLimitMs: 3000,
    addNoise: 0.1, // 10%の確率でランダムな手
  },
  advanced: {
    maxDepth: 6,
    timeLimitMs: 5000,
    addNoise: 0, // 常に最善手
  },
};

// 指定難易度でAIの最善手を計算
export function calculateAiMove(
  state: GameState,
  player: Player,
  difficulty: Difficulty,
  variant: RuleVariant = STANDARD_VARIANT
): Move | null {
  const params = DIFFICULTY_PARAMS[difficulty];
  return findBestMove(state, player, params, variant);
}

// 難易度の表示名
export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  beginner: "初級",
  intermediate: "中級",
  advanced: "上級",
};
