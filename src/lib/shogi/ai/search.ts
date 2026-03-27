import type { GameState, Move, Player, RuleVariant } from "../types";
import { STANDARD_VARIANT } from "../variants/standard";
import { getFullLegalMoves } from "../moves";
import { applyMove } from "../board";
import { evaluate, scoreMoveForOrdering } from "./evaluate";
import { evaluateGameEnd } from "../rules";

const NEG_INF = -Infinity;
const POS_INF = Infinity;

interface SearchOptions {
  maxDepth: number;
  timeLimitMs: number;
  addNoise: number; // 0.0-1.0 ノイズ比率（beginner向け）
}

// Alpha-Beta探索（Negamax形式）
function negamax(
  state: GameState,
  depth: number,
  alpha: number,
  beta: number,
  player: Player,
  variant: RuleVariant
): number {
  const finalState = evaluateGameEnd(state, variant);
  if (finalState.status !== "active") {
    const rawScore = evaluate(finalState, variant);
    return player === "sente" ? rawScore : -rawScore;
  }

  if (depth === 0) {
    const rawScore = evaluate(state, variant);
    return player === "sente" ? rawScore : -rawScore;
  }

  const moves = getFullLegalMoves(state, player, variant);
  if (moves.length === 0) {
    const rawScore = evaluate(state, variant);
    return player === "sente" ? rawScore : -rawScore;
  }

  // 手の順序付け（alpha-beta効率化）
  const sortedMoves = [...moves].sort(
    (a, b) => scoreMoveForOrdering(b) - scoreMoveForOrdering(a)
  );

  let maxScore = NEG_INF;
  const opponent: Player = player === "sente" ? "gote" : "sente";

  for (const move of sortedMoves) {
    const nextState = applyMove(state, move);
    const score = -negamax(nextState, depth - 1, -beta, -alpha, opponent, variant);

    if (score > maxScore) maxScore = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) break; // Beta cutoff
  }

  return maxScore;
}

// 反復深化で最善手を探索
export function findBestMove(
  state: GameState,
  player: Player,
  options: SearchOptions,
  variant: RuleVariant = STANDARD_VARIANT
): Move | null {
  const moves = getFullLegalMoves(state, player, variant);
  if (moves.length === 0) return null;
  if (moves.length === 1) return moves[0];

  const startTime = Date.now();
  let bestMove = moves[0];
  let bestScore = NEG_INF;

  // 反復深化
  for (let depth = 1; depth <= options.maxDepth; depth++) {
    const elapsed = Date.now() - startTime;
    if (elapsed > options.timeLimitMs * 0.8) break;

    // 手の順序付け
    const sortedMoves = [...moves].sort(
      (a, b) => scoreMoveForOrdering(b) - scoreMoveForOrdering(a)
    );

    let depthBestMove = sortedMoves[0];
    let depthBestScore = NEG_INF;
    const opponent: Player = player === "sente" ? "gote" : "sente";

    for (const move of sortedMoves) {
      const elapsed2 = Date.now() - startTime;
      if (elapsed2 > options.timeLimitMs * 0.9) break;

      const nextState = applyMove(state, move);
      const score = -negamax(nextState, depth - 1, NEG_INF, POS_INF, opponent, variant);

      if (score > depthBestScore) {
        depthBestScore = score;
        depthBestMove = move;
      }
    }

    if (depthBestScore > bestScore) {
      bestScore = depthBestScore;
      bestMove = depthBestMove;
    }
  }

  // ノイズ追加（初級向け）
  if (options.addNoise > 0 && Math.random() < options.addNoise) {
    const randomIndex = Math.floor(Math.random() * Math.min(moves.length, 5));
    const shuffledMoves = [...moves].sort(
      (a, b) => scoreMoveForOrdering(b) - scoreMoveForOrdering(a)
    );
    bestMove = shuffledMoves[randomIndex] ?? bestMove;
  }

  return bestMove;
}
