import type { GameState, Move, Player, RuleVariant } from "../types";
import { STANDARD_VARIANT } from "../variants/standard";
import { getFullLegalMoves, isInCheck } from "../moves";
import { applyMoveForSearch } from "../board";
import { evaluate, scoreMoveForOrdering } from "./evaluate";
import { TranspositionTable } from "./transpositionTable";
import { computeHash, PIECE_KEYS, HAND_KEYS, SIDE_TO_MOVE_KEY } from "./zobrist";
import type { ZobristHash } from "./zobrist";
import { getCaptureMovesForSearch } from "./captureGen";

const NEG_INF = -Infinity;
const POS_INF = Infinity;

const MAX_DEPTH = 64;
const MATE_SCORE = 90000;

interface SearchOptions {
  maxDepth: number;
  timeLimitMs: number;
  addNoise: number; // 0.0-1.0 ノイズ比率（beginner向け）
  nearEqualThreshold: number; // 接戦時ランダム選択の閾値（cp）
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
  if (move.type === "drop") return 80;
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
  if (move.captured) return;
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
    const placeKey = PIECE_KEYS[piece]?.[move.player]?.[toIdx];
    if (placeKey !== undefined) hash ^= placeKey;

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

    const movingPieceType = move.piece;
    const fromKey = PIECE_KEYS[movingPieceType]?.[move.player]?.[fromIdx];
    if (fromKey !== undefined) hash ^= fromKey;

    const destPieceType = nextState.board[move.to.row][move.to.col]?.type ?? movingPieceType;

    if (move.captured) {
      const capturedKey = PIECE_KEYS[move.captured]?.[move.player === "sente" ? "gote" : "sente"]?.[toIdx];
      if (capturedKey !== undefined) hash ^= capturedKey;

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

    const toKey = PIECE_KEYS[destPieceType]?.[move.player]?.[toIdx];
    if (toKey !== undefined) hash ^= toKey;
  }

  return hash;
}

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

// 駒の価値（手の順序付け用）
const ORDER_PIECE_VALUES: Record<string, number> = {
  pawn: 100, lance: 300, knight: 400, silver: 500, gold: 600,
  bishop: 800, rook: 1000, promoted_pawn: 600, promoted_lance: 600,
  promoted_knight: 600, promoted_silver: 600, promoted_bishop: 1100,
  promoted_rook: 1300, king: 10000,
};

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
    return 100000 + (ORDER_PIECE_VALUES[move.captured] ?? 0) - (ORDER_PIECE_VALUES[move.piece] ?? 0) * 0.1;
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
  const rawScore = evaluate(state, variant);
  const standPat = player === "sente" ? rawScore : -rawScore;

  if (standPat >= beta) return beta;
  let currentAlpha = alpha;
  if (standPat > currentAlpha) currentAlpha = standPat;

  // 直接取り駒生成（全合法手生成を避ける）
  const captures = getCaptureMovesForSearch(state, player, variant);
  const opponent: Player = player === "sente" ? "gote" : "sente";

  for (const move of captures) {
    // Delta Pruning: 取っても到底alphaに届かない駒取りをスキップ
    const capturedValue = ORDER_PIECE_VALUES[move.captured!] ?? 100;
    if (standPat + capturedValue + 200 < currentAlpha) continue;

    const nextState = applyMoveForSearch(state, move);
    const nextHash = updateHash(hash, state, move, nextState);
    const score = -quiescence(nextState, -beta, -currentAlpha, opponent, variant, tt, nextHash);

    if (score >= beta) return beta;
    if (score > currentAlpha) currentAlpha = score;
  }

  return currentAlpha;
}

// Negamax with alpha-beta, TT, null-move pruning, LMR, PVS, futility, killers, history
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
  // Time check（8ノードごと）
  if ((ply & 7) === 0 && (Date.now() - startTime > timeLimitMs)) {
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

  // Check Extension: 王手されている場合は深度を1延長
  // depthを直接変更することで、再帰呼出し・TT・futilityすべてに自動反映
  const inCheck = isInCheck(state, player, variant);
  if (inCheck && ply < MAX_DEPTH - 2) {
    depth++;
  }

  // Quiescence search at depth 0
  if (depth <= 0) {
    return quiescence(state, alpha, beta, player, variant, tt, hash);
  }

  // 合法手生成（evaluateGameEnd の代わりに手数で終局判定）
  const moves = getFullLegalMoves(state, player, variant);
  const opponent: Player = player === "sente" ? "gote" : "sente";

  if (moves.length === 0) {
    // 手がない = 詰み or ステールメイト
    if (inCheck) {
      return -(MATE_SCORE - ply); // ��み（深いほど低評価＝早い詰みを���先）
    }
    return 0; // ステールメイト
  }

  // Null Move Pruning（王手中は使用不可）
  if (
    isNullMoveAllowed &&
    depth >= 3 &&
    !inCheck
  ) {
    const nullState: GameState = {
      ...state,
      currentPlayer: opponent,
      moveHistory: state.moveHistory,
      positionHistory: state.positionHistory,
    };
    const nullHash = hash ^ SIDE_TO_MOVE_KEY;
    const R = depth >= 6 ? 3 : 2;
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

  // 静的評価（futility pruning用）
  let staticEval: number | null = null;

  // 手の順序付け
  const sortedMoves = [...moves].sort(
    (a, b) => scoreMove(b, ttMove, ply) - scoreMove(a, ttMove, ply)
  );

  let maxScore = NEG_INF;
  let bestMove: Move | null = null;
  const originalAlpha = alpha;

  for (let i = 0; i < sortedMoves.length; i++) {
    const move = sortedMoves[i];
    const isCapture = move.captured !== undefined;
    const isPromotion = move.promote === true;
    const isKiller = isKillerMove(move, ply);

    // Futility Pruning（depth 1-2で非戦術手をスキップ、王手中は除外）
    if (depth <= 2 && !isCapture && !isPromotion && !inCheck && i > 0) {
      if (staticEval === null) {
        const rawEval = evaluate(state, variant);
        staticEval = player === "sente" ? rawEval : -rawEval;
      }
      const margin = depth === 1 ? 300 : 500;
      if (staticEval + margin <= alpha) continue;
    }

    const nextState = applyMoveForSearch(state, move);
    const nextHash = updateHash(hash, state, move, nextState);

    let score: number;

    if (i === 0) {
      // 最初の手（PV候補）: フルウィンドウ
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
    } else {
      // PVS: まずnull-window探索
      // LMR: 3手目以降の非戦術手は深度を下げる（王手中は除外）
      let reduction = 0;
      if (i >= 3 && depth >= 3 && !isCapture && !isPromotion && !isKiller && !inCheck) {
        reduction = 1;
        if (i >= 8 && depth >= 5) reduction = 2;
      }

      score = -negamax(
        nextState,
        depth - 1 - reduction,
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

      // null-windowで改善あり → フルウィンドウで再探索
      if (score > alpha && score < beta) {
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
    }

    if (score > maxScore) {
      maxScore = score;
      bestMove = move;
    }
    if (score > alpha) {
      alpha = score;
    }
    if (alpha >= beta) {
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
  // ルート手ごとのスコアを追跡（nearEqualThreshold用）
  let rootMoveScores: { move: Move; score: number }[] = [];

  const initialHash = computeHash(state);

  // 反復深化 + Aspiration Windows
  for (let depth = 1; depth <= options.maxDepth; depth++) {
    const elapsed = Date.now() - startTime;
    if (elapsed > options.timeLimitMs * 0.8) break;

    const ttEntry = tt.probe(initialHash);
    const ttMove = ttEntry?.bestMove ?? null;

    const sortedMoves = [...moves].sort(
      (a, b) => scoreMove(b, ttMove, 0) - scoreMove(a, ttMove, 0)
    );

    const opponent: Player = player === "sente" ? "gote" : "sente";

    // Aspiration Windows（depth > 1 から使用）
    let aspirationAlpha = depth > 1 ? bestScore - 50 : NEG_INF;
    let aspirationBeta = depth > 1 ? bestScore + 50 : POS_INF;
    let aspirationRetry = 0;

    while (aspirationRetry < 3) {
      let depthBestMove = sortedMoves[0];
      let depthBestScore = NEG_INF;
      const depthMoveScores: { move: Move; score: number }[] = [];
      let alpha = aspirationAlpha;

      for (let i = 0; i < sortedMoves.length; i++) {
        const move = sortedMoves[i];
        const elapsed2 = Date.now() - startTime;
        if (elapsed2 > options.timeLimitMs * 0.85) break;

        const nextState = applyMoveForSearch(state, move);
        const nextHash = updateHash(initialHash, state, move, nextState);

        let score: number;
        if (i === 0) {
          score = -negamax(
            nextState,
            depth - 1,
            -aspirationBeta,
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
        } else {
          // PVS at root
          score = -negamax(
            nextState,
            depth - 1,
            -alpha - 1,
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
          if (score > alpha && score < aspirationBeta) {
            score = -negamax(
              nextState,
              depth - 1,
              -aspirationBeta,
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
          }
        }

        depthMoveScores.push({ move, score });

        if (score > depthBestScore) {
          depthBestScore = score;
          depthBestMove = move;
        }
        if (score > alpha) {
          alpha = score;
        }
      }

      // Aspiration fail check
      if (depthBestScore <= aspirationAlpha) {
        aspirationAlpha = NEG_INF;
        aspirationRetry++;
        continue;
      }
      if (depthBestScore >= aspirationBeta) {
        aspirationBeta = POS_INF;
        aspirationRetry++;
        continue;
      }

      // 成功
      if (depthBestScore > bestScore || depth === 1) {
        bestScore = depthBestScore;
        bestMove = depthBestMove;
        rootMoveScores = depthMoveScores;
      }
      break;
    }

    tt.newSearch();
  }

  // nearEqualThreshold: 最善手に近い評価値の手からランダム選択（多様性確保）
  if (options.nearEqualThreshold > 0 && rootMoveScores.length > 1) {
    const candidates = rootMoveScores.filter(
      (ms) => ms.score >= bestScore - options.nearEqualThreshold
    );
    if (candidates.length > 1) {
      bestMove = candidates[Math.floor(Math.random() * candidates.length)].move;
    }
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
