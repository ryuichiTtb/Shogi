import type { GameState, Move, Player, RuleVariant } from "../types";
import { STANDARD_VARIANT } from "../variants/standard";
import { getFullLegalMoves, getCaptureMoves, isInCheck } from "../moves";
import { applyMove } from "../board";
import { evaluate, scoreMoveForOrdering } from "./evaluate";
import { evaluateGameEnd } from "../rules";
import { TranspositionTable } from "./transpositionTable";
import { computeHash, PIECE_KEYS, HAND_KEYS, SIDE_TO_MOVE_KEY } from "./zobrist";
import type { ZobristHash } from "./zobrist";

const NEG_INF = -Infinity;
const POS_INF = Infinity;

const MAX_DEPTH = 64;

interface SearchOptions {
  maxDepth: number;
  timeLimitMs: number;
  addNoise: number; // 0.0-1.0 ノイズ比率（beginner向け）
}

// キラームーブ: 深さごとに2手保存
const killerMoves: (Move | null)[][] = Array.from({ length: MAX_DEPTH }, () => [null, null]);

// ヒストリーテーブル: history[from_index][to_index]
const historyTable: number[][] = Array.from({ length: 81 }, () => new Array(81).fill(0));

// ヒストリーテーブルをリセット
function resetSearchTables(): void {
  for (let i = 0; i < MAX_DEPTH; i++) {
    killerMoves[i][0] = null;
    killerMoves[i][1] = null;
  }
  for (let i = 0; i < 81; i++) {
    for (let j = 0; j < 81; j++) {
      historyTable[i][j] = 0;
    }
  }
}

// 手のインデックス（ヒストリー用）
function moveFromIndex(move: Move): number {
  if (move.type === "drop") return 80; // ドロップは一律インデックス（簡略化）
  return (move.from!.row * 9 + move.from!.col);
}

function moveToIndex(move: Move): number {
  return move.to.row * 9 + move.to.col;
}

// キラームーブかどうか
function isKillerMove(move: Move, ply: number): boolean {
  if (ply >= MAX_DEPTH) return false;
  const k0 = killerMoves[ply][0];
  const k1 = killerMoves[ply][1];
  return (
    (k0 !== null && movesEqual(move, k0)) ||
    (k1 !== null && movesEqual(move, k1))
  );
}

// キラームーブを更新
function updateKillerMove(move: Move, ply: number): void {
  if (ply >= MAX_DEPTH) return;
  if (move.captured) return; // 取り駒はキラーに不要
  const k0 = killerMoves[ply][0];
  if (k0 === null || !movesEqual(move, k0)) {
    killerMoves[ply][1] = killerMoves[ply][0];
    killerMoves[ply][0] = move;
  }
}

// 手の比較
function movesEqual(a: Move, b: Move): boolean {
  if (a.type !== b.type) return false;
  if (a.to.row !== b.to.row || a.to.col !== b.to.col) return false;
  if (a.type === "drop") return a.dropPiece === b.dropPiece;
  return (
    a.from !== undefined &&
    b.from !== undefined &&
    a.from.row === b.from.row &&
    a.from.col === b.from.col &&
    a.promote === b.promote
  );
}

// Incremental hash update after applying a move
function updateHash(
  prevHash: ZobristHash,
  prevState: GameState,
  move: Move,
  nextState: GameState
): ZobristHash {
  let hash = prevHash;

  // Flip side to move
  hash ^= SIDE_TO_MOVE_KEY;

  if (move.type === "drop") {
    const piece = move.dropPiece!;
    const toIdx = move.to.row * 9 + move.to.col;
    // Place dropped piece on board
    const placeKey = PIECE_KEYS[piece]?.[move.player]?.[toIdx];
    if (placeKey !== undefined) hash ^= placeKey;

    // Remove from hand: prevState had count, nextState has count-1
    const prevCount = prevState.hand[move.player][piece] ?? 0;
    const nextCount = nextState.hand[move.player][piece] ?? 0;
    const handKeys = HAND_KEYS[piece]?.[move.player];
    if (handKeys) {
      if (prevCount > 0 && prevCount <= 18) hash ^= handKeys[prevCount];
      if (nextCount > 0 && nextCount <= 18) hash ^= handKeys[nextCount];
    }
  } else {
    const fromRow = move.from!.row;
    const fromCol = move.from!.col;
    const fromIdx = fromRow * 9 + fromCol;
    const toIdx = move.to.row * 9 + move.to.col;

    // Remove moving piece from origin
    const movingPieceType = move.piece;
    const fromKey = PIECE_KEYS[movingPieceType]?.[move.player]?.[fromIdx];
    if (fromKey !== undefined) hash ^= fromKey;

    // Determine destination piece type (after promotion)
    const destPieceType = nextState.board[move.to.row][move.to.col]?.type ?? movingPieceType;

    // Remove captured piece
    if (move.captured) {
      const capturedKey = PIECE_KEYS[move.captured]?.[move.player === "sente" ? "gote" : "sente"]?.[toIdx];
      if (capturedKey !== undefined) hash ^= capturedKey;

      // Add captured (unpromoted) piece to hand
      // The unpromoted type is derived from captured
      const capturedBase = getCapturedBase(move.captured);
      const capturedPlayer = move.player;
      const prevCount = prevState.hand[capturedPlayer][capturedBase] ?? 0;
      const nextCount = nextState.hand[capturedPlayer][capturedBase] ?? 0;
      const handKeys = HAND_KEYS[capturedBase]?.[capturedPlayer];
      if (handKeys) {
        if (prevCount > 0 && prevCount <= 18) hash ^= handKeys[prevCount];
        if (nextCount > 0 && nextCount <= 18) hash ^= handKeys[nextCount];
      }
    }

    // Place piece at destination
    const toKey = PIECE_KEYS[destPieceType]?.[move.player]?.[toIdx];
    if (toKey !== undefined) hash ^= toKey;
  }

  return hash;
}

// Get base (unpromoted) piece type for captured pieces going to hand
function getCapturedBase(pieceType: string): string {
  const promotedMap: Record<string, string> = {
    promoted_rook: "rook",
    promoted_bishop: "bishop",
    promoted_silver: "silver",
    promoted_knight: "knight",
    promoted_lance: "lance",
    promoted_pawn: "pawn",
  };
  return promotedMap[pieceType] ?? pieceType;
}

// 手の順序付けスコア
function scoreMove(
  move: Move,
  ttMove: Move | null,
  ply: number
): number {
  // TT手は最優先
  if (ttMove !== null && movesEqual(move, ttMove)) return 1000000;

  // 取り駒（MVV-LVA）
  if (move.captured) {
    const PIECE_VALUES: Record<string, number> = {
      pawn: 100, lance: 300, knight: 400, silver: 500, gold: 600,
      bishop: 800, rook: 1000, promoted_pawn: 600, promoted_lance: 600,
      promoted_knight: 600, promoted_silver: 600, promoted_bishop: 1100,
      promoted_rook: 1300, king: 10000,
    };
    return 100000 + (PIECE_VALUES[move.captured] ?? 0) - (PIECE_VALUES[move.piece] ?? 0) * 0.1;
  }

  // 成り
  if (move.promote) return 50000;

  // キラームーブ
  if (isKillerMove(move, ply)) return 10000;

  // ヒストリーヒューリスティック
  const fromIdx = moveFromIndex(move);
  const toIdx = moveToIndex(move);
  return historyTable[fromIdx][toIdx];
}

// 静止探索（取り駒のみ）
function quiescence(
  state: GameState,
  alpha: number,
  beta: number,
  player: Player,
  variant: RuleVariant,
  tt: TranspositionTable,
  hash: ZobristHash
): number {
  const finalState = evaluateGameEnd(state, variant);
  if (finalState.status !== "active") {
    const rawScore = evaluate(finalState, variant);
    return player === "sente" ? rawScore : -rawScore;
  }

  const rawScore = evaluate(state, variant);
  const standPat = player === "sente" ? rawScore : -rawScore;

  if (standPat >= beta) return beta;
  if (standPat > alpha) alpha = standPat;

  const captures = getCaptureMoves(state, player, variant);
  const opponent: Player = player === "sente" ? "gote" : "sente";

  for (const move of captures) {
    const nextState = applyMove(state, move);
    const nextHash = updateHash(hash, state, move, nextState);
    const score = -quiescence(nextState, -beta, -alpha, opponent, variant, tt, nextHash);

    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }

  return alpha;
}

// Negamax with alpha-beta, TT, null-move pruning, LMR, killers, history
function negamax(
  state: GameState,
  depth: number,
  alpha: number,
  beta: number,
  player: Player,
  variant: RuleVariant,
  tt: TranspositionTable,
  hash: ZobristHash,
  ply: number,
  isNullMoveAllowed: boolean,
  startTime: number,
  timeLimitMs: number
): number {
  // Time check
  if ((ply % 16 === 0) && (Date.now() - startTime > timeLimitMs)) {
    const rawScore = evaluate(state, variant);
    return player === "sente" ? rawScore : -rawScore;
  }

  // TT probe
  const ttEntry = tt.probe(hash);
  let ttMove: Move | null = null;
  if (ttEntry && ttEntry.depth >= depth) {
    ttMove = ttEntry.bestMove;
    if (ttEntry.flag === "exact") return ttEntry.score;
    if (ttEntry.flag === "lower" && ttEntry.score > alpha) alpha = ttEntry.score;
    if (ttEntry.flag === "upper" && ttEntry.score < beta) beta = ttEntry.score;
    if (alpha >= beta) return ttEntry.score;
  } else if (ttEntry) {
    ttMove = ttEntry.bestMove;
  }

  // Terminal state check
  const finalState = evaluateGameEnd(state, variant);
  if (finalState.status !== "active") {
    const rawScore = evaluate(finalState, variant);
    return player === "sente" ? rawScore : -rawScore;
  }

  // Quiescence search at depth 0
  if (depth <= 0) {
    return quiescence(state, alpha, beta, player, variant, tt, hash);
  }

  // Null Move Pruning
  const opponent: Player = player === "sente" ? "gote" : "sente";
  if (
    isNullMoveAllowed &&
    depth >= 3 &&
    !isInCheckFast(state, player, variant)
  ) {
    // Make a "null move" by just switching turn
    const nullState: GameState = {
      ...state,
      currentPlayer: opponent,
      moveHistory: [...state.moveHistory],
      positionHistory: [...state.positionHistory],
    };
    const nullHash = hash ^ SIDE_TO_MOVE_KEY;
    const R = 2;
    const nullScore = -negamax(
      nullState,
      depth - 1 - R,
      -beta,
      -beta + 1,
      opponent,
      variant,
      tt,
      nullHash,
      ply + 1,
      false,
      startTime,
      timeLimitMs
    );
    if (nullScore >= beta) {
      return beta;
    }
  }

  // Generate and order moves
  const moves = getFullLegalMoves(state, player, variant);
  if (moves.length === 0) {
    const rawScore = evaluate(state, variant);
    return player === "sente" ? rawScore : -rawScore;
  }

  const sortedMoves = [...moves].sort(
    (a, b) => scoreMove(b, ttMove, ply) - scoreMove(a, ttMove, ply)
  );

  let maxScore = NEG_INF;
  let bestMove: Move | null = null;
  const originalAlpha = alpha;

  for (let i = 0; i < sortedMoves.length; i++) {
    const move = sortedMoves[i];
    const nextState = applyMove(state, move);
    const nextHash = updateHash(hash, state, move, nextState);

    let score: number;

    // Late Move Reduction (LMR): non-tactical moves after first 3
    const isCapture = move.captured !== undefined;
    const isPromotion = move.promote === true;
    const isKiller = isKillerMove(move, ply);

    if (
      i >= 3 &&
      depth >= 3 &&
      !isCapture &&
      !isPromotion &&
      !isKiller
    ) {
      // Reduced search
      score = -negamax(
        nextState,
        depth - 2,
        -alpha - 1,
        -alpha,
        opponent,
        variant,
        tt,
        nextHash,
        ply + 1,
        true,
        startTime,
        timeLimitMs
      );
      // If reduction finds improvement, do full search
      if (score > alpha) {
        score = -negamax(
          nextState,
          depth - 1,
          -beta,
          -alpha,
          opponent,
          variant,
          tt,
          nextHash,
          ply + 1,
          true,
          startTime,
          timeLimitMs
        );
      }
    } else {
      score = -negamax(
        nextState,
        depth - 1,
        -beta,
        -alpha,
        opponent,
        variant,
        tt,
        nextHash,
        ply + 1,
        true,
        startTime,
        timeLimitMs
      );
    }

    if (score > maxScore) {
      maxScore = score;
      bestMove = move;
    }
    if (score > alpha) {
      alpha = score;
    }
    if (alpha >= beta) {
      // Beta cutoff: update killers and history
      updateKillerMove(move, ply);
      const fromIdx = moveFromIndex(move);
      const toIdx = moveToIndex(move);
      historyTable[fromIdx][toIdx] += depth * depth;
      break;
    }
  }

  // TT store
  let flag: "exact" | "lower" | "upper";
  if (maxScore <= originalAlpha) {
    flag = "upper";
  } else if (maxScore >= beta) {
    flag = "lower";
  } else {
    flag = "exact";
  }
  tt.store(hash, depth, maxScore, flag, bestMove);

  return maxScore;
}

// 王手判定（null move用ラッパー）
function isInCheckFast(
  state: GameState,
  player: Player,
  variant: RuleVariant
): boolean {
  return isInCheck(state, player, variant);
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
  const tt = new TranspositionTable();
  tt.newSearch();
  resetSearchTables();

  let bestMove = moves[0];
  let bestScore = NEG_INF;

  // Compute initial hash
  const initialHash = computeHash(state);

  // 反復深化
  for (let depth = 1; depth <= options.maxDepth; depth++) {
    const elapsed = Date.now() - startTime;
    if (elapsed > options.timeLimitMs * 0.8) break;

    // Use TT move from previous iteration for ordering
    const ttEntry = tt.probe(initialHash);
    const ttMove = ttEntry?.bestMove ?? null;

    // Sort root moves using TT move
    const sortedMoves = [...moves].sort(
      (a, b) => scoreMove(b, ttMove, 0) - scoreMove(a, ttMove, 0)
    );

    let depthBestMove = sortedMoves[0];
    let depthBestScore = NEG_INF;
    const opponent: Player = player === "sente" ? "gote" : "sente";
    let alpha = NEG_INF;
    const beta = POS_INF;

    for (const move of sortedMoves) {
      const elapsed2 = Date.now() - startTime;
      if (elapsed2 > options.timeLimitMs * 0.9) break;

      const nextState = applyMove(state, move);
      const nextHash = updateHash(initialHash, state, move, nextState);
      const score = -negamax(
        nextState,
        depth - 1,
        -beta,
        -alpha,
        opponent,
        variant,
        tt,
        nextHash,
        1,
        true,
        startTime,
        options.timeLimitMs
      );

      if (score > depthBestScore) {
        depthBestScore = score;
        depthBestMove = move;
      }
      if (score > alpha) {
        alpha = score;
      }
    }

    if (depthBestScore > bestScore || depth === 1) {
      bestScore = depthBestScore;
      bestMove = depthBestMove;
    }

    tt.newSearch();
  }

  // ノイズ追加（初級向け）
  if (options.addNoise > 0 && Math.random() < options.addNoise) {
    const sortedMoves = [...moves].sort(
      (a, b) => scoreMoveForOrdering(b) - scoreMoveForOrdering(a)
    );
    const randomIndex = Math.floor(Math.random() * Math.min(moves.length, 5));
    bestMove = sortedMoves[randomIndex] ?? bestMove;
  }

  return bestMove;
}
