import type { Difficulty, GameState, Move, Player, RuleVariant } from "../types";
import { STANDARD_VARIANT } from "../variants/standard";
import { findBestMove } from "./search";
import { getBookMove, MAX_BOOK_MOVES } from "./openingBook";
import { getFullLegalMoves } from "../moves";

// 難易度別探索パラメータ
const DIFFICULTY_PARAMS: Record<Difficulty, {
  maxDepth: number;
  timeLimitMs: number;
  addNoise: number;
  useBook: boolean;
  nearEqualThreshold: number; // 接戦時ランダム選択の閾値（cp）
}> = {
  beginner: {
    maxDepth: 3,
    timeLimitMs: 1000,
    addNoise: 0.40,
    useBook: true,
    nearEqualThreshold: 0, // beginnerはaddNoiseで多様性確保
  },
  intermediate: {
    maxDepth: 8,
    timeLimitMs: 3000,
    addNoise: 0.03,
    useBook: true,
    nearEqualThreshold: 0,
  },
  advanced: {
    maxDepth: 12,
    timeLimitMs: 3000,
    addNoise: 0,
    useBook: true,
    nearEqualThreshold: 20,
  },
  expert: {
    maxDepth: 16,
    timeLimitMs: 3000,
    addNoise: 0,
    useBook: true,
    nearEqualThreshold: 15,
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

  // 定石ブック参照（序盤のみ）
  if (params.useBook && state.moveCount < MAX_BOOK_MOVES * 2) {
    const bookMove = getBookMove(state, player);
    if (bookMove) {
      // ブック手が合法手に含まれるか検証
      const legalMoves = getFullLegalMoves(state, player, variant);
      const isLegal = legalMoves.some(
        (m) =>
          m.type === bookMove.type &&
          m.to.row === bookMove.to.row &&
          m.to.col === bookMove.to.col &&
          (bookMove.type === "drop"
            ? m.dropPiece === bookMove.dropPiece
            : m.from?.row === bookMove.from?.row &&
              m.from?.col === bookMove.from?.col &&
              (m.promote ?? false) === (bookMove.promote ?? false))
      );
      if (isLegal) return bookMove;
    }
  }

  // 探索による手の選択
  return findBestMove(state, player, params, variant);
}

// 難易度の表示名
export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  beginner: "初級",
  intermediate: "中級",
  advanced: "上級",
  expert: "超上級",
};
