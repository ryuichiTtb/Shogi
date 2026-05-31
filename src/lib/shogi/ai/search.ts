import type { GameState, Move, Player, RuleVariant } from "../types";
import { STANDARD_VARIANT } from "../variants/standard";
// Issue #193 / PR1b (Phase 3): 探索ホットパスの合法手生成は getSearchLegalMoves に切替。
// getFullLegalMoves は本ファイル内で直接呼ばないので import から除外、isInCheck のみ moves から取込む。
import { isInCheck } from "../moves";
import { getSearchLegalMoves } from "./legal-moves";
import { applyMoveForSearch } from "../board";
import { evaluate, scoreMoveForOrdering } from "./evaluate";
import { cardResultIntroducesTadasute } from "./blunder-guard";
import { simulateCardEffect } from "../cards/effects";
import {
  getDrawValue,
  DOUBLE_MOVE_TOP_K,
  TRAP_VALUE_NO_PROMOTE,
  TRAP_VALUE_CHECK_BREAK,
} from "./cards/heuristics";
import { CurrentRules } from "./turn/current-rules";
import type { AiTurnState, TurnAction } from "./turn/types";
import {
  computeHash,
  PIECE_KEYS, PIECE_KEYS_HI,
  HAND_KEYS, HAND_KEYS_HI,
  SIDE_TO_MOVE_KEY, SIDE_TO_MOVE_KEY_HI,
} from "./zobrist";
import type { ZobristHash } from "./zobrist";
import { getCaptureMovesForSearch, getPromotionMovesForSearch } from "./captureGen";
import {
  MAX_DEPTH,
  createSearchContext,
  shouldStop,
  type SearchContext,
} from "./search-context";

const NEG_INF = -Infinity;
const POS_INF = Infinity;

const MATE_SCORE = 90000;
const MAX_Q_DEPTH = 8;

interface SearchOptions {
  maxDepth: number;
  timeLimitMs: number;
  addNoise: number; // 0.0-1.0 ノイズ比率（beginner向け）
  nearEqualThreshold: number; // 接戦時ランダム選択の閾値（cp）
}

// Issue #176 Stage C: globalTT / killerMoves / historyTable はモジュールスコープ
// から削除し、SearchContext (per-request) 配下の ctx.tt / ctx.killerMoves /
// ctx.historyTable を使う。複数 AI request が同時に走っても探索状態が混線しない。

// 手のインデックス（ヒストリー用）
function moveFromIndex(move: Move): number {
  if (move.type === "drop") return 80;
  return (move.from!.row * 9 + move.from!.col);
}

function moveToIndex(move: Move): number {
  return move.to.row * 9 + move.to.col;
}

// キラームーブかどうか (ctx.killerMoves から読む)
function isKillerMove(move: Move, ply: number, ctx: SearchContext): boolean {
  if (ply >= MAX_DEPTH) return false;
  const k0 = ctx.killerMoves[ply][0];
  const k1 = ctx.killerMoves[ply][1];
  return (
    (k0 !== null && movesEqual(move, k0)) ||
    (k1 !== null && movesEqual(move, k1))
  );
}

// キラームーブを更新 (ctx.killerMoves に書く)
function updateKillerMove(move: Move, ply: number, ctx: SearchContext): void {
  if (ply >= MAX_DEPTH) return;
  if (move.captured) return;
  const k0 = ctx.killerMoves[ply][0];
  if (k0 === null || !movesEqual(move, k0)) {
    ctx.killerMoves[ply][1] = ctx.killerMoves[ply][0];
    ctx.killerMoves[ply][0] = move;
  }
}

// 手の比較
// Issue #193 / PR2: blunder guard の同点圏 tie-breaker が rootMoveScores から
// 指し手のスコアを引くために export 化。
export function movesEqual(a: Move, b: Move): boolean {
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

// Incremental dual hash update after applying a move
// 全XOR操作に >>> 0 を適用（computeHashとの整合性を保証）
function updateHash(
  prevHash: ZobristHash,
  prevState: GameState,
  move: Move,
  nextState: GameState
): ZobristHash {
  let lo = prevHash.lo;
  let hi = prevHash.hi;

  // Flip side to move
  lo = (lo ^ SIDE_TO_MOVE_KEY) >>> 0;
  hi = (hi ^ SIDE_TO_MOVE_KEY_HI) >>> 0;

  if (move.type === "drop") {
    const piece = move.dropPiece!;
    const toIdx = move.to.row * 9 + move.to.col;
    const placeKeyLo = PIECE_KEYS[piece]?.[move.player]?.[toIdx];
    const placeKeyHi = PIECE_KEYS_HI[piece]?.[move.player]?.[toIdx];
    if (placeKeyLo !== undefined) lo = (lo ^ placeKeyLo) >>> 0;
    if (placeKeyHi !== undefined) hi = (hi ^ placeKeyHi) >>> 0;

    const prevCount = prevState.hand[move.player][piece] ?? 0;
    const nextCount = nextState.hand[move.player][piece] ?? 0;
    const handKeysLo = HAND_KEYS[piece]?.[move.player];
    const handKeysHi = HAND_KEYS_HI[piece]?.[move.player];
    if (handKeysLo) {
      if (prevCount > 0 && prevCount <= 18) lo = (lo ^ handKeysLo[prevCount]) >>> 0;
      if (nextCount > 0 && nextCount <= 18) lo = (lo ^ handKeysLo[nextCount]) >>> 0;
    }
    if (handKeysHi) {
      if (prevCount > 0 && prevCount <= 18) hi = (hi ^ handKeysHi[prevCount]) >>> 0;
      if (nextCount > 0 && nextCount <= 18) hi = (hi ^ handKeysHi[nextCount]) >>> 0;
    }
  } else {
    const fromIdx = move.from!.row * 9 + move.from!.col;
    const toIdx = move.to.row * 9 + move.to.col;

    const movingPieceType = move.piece;
    const fromKeyLo = PIECE_KEYS[movingPieceType]?.[move.player]?.[fromIdx];
    const fromKeyHi = PIECE_KEYS_HI[movingPieceType]?.[move.player]?.[fromIdx];
    if (fromKeyLo !== undefined) lo = (lo ^ fromKeyLo) >>> 0;
    if (fromKeyHi !== undefined) hi = (hi ^ fromKeyHi) >>> 0;

    const destPieceType = nextState.board[move.to.row][move.to.col]?.type ?? movingPieceType;

    if (move.captured) {
      const capturedOwner = move.player === "sente" ? "gote" : "sente";
      const capturedKeyLo = PIECE_KEYS[move.captured]?.[capturedOwner]?.[toIdx];
      const capturedKeyHi = PIECE_KEYS_HI[move.captured]?.[capturedOwner]?.[toIdx];
      if (capturedKeyLo !== undefined) lo = (lo ^ capturedKeyLo) >>> 0;
      if (capturedKeyHi !== undefined) hi = (hi ^ capturedKeyHi) >>> 0;

      const capturedBase = getCapturedBase(move.captured);
      const capturedPlayer = move.player;
      const prevCount = prevState.hand[capturedPlayer][capturedBase] ?? 0;
      const nextCount = nextState.hand[capturedPlayer][capturedBase] ?? 0;
      const handKeysLo = HAND_KEYS[capturedBase]?.[capturedPlayer];
      const handKeysHi = HAND_KEYS_HI[capturedBase]?.[capturedPlayer];
      if (handKeysLo) {
        if (prevCount > 0 && prevCount <= 18) lo = (lo ^ handKeysLo[prevCount]) >>> 0;
        if (nextCount > 0 && nextCount <= 18) lo = (lo ^ handKeysLo[nextCount]) >>> 0;
      }
      if (handKeysHi) {
        if (prevCount > 0 && prevCount <= 18) hi = (hi ^ handKeysHi[prevCount]) >>> 0;
        if (nextCount > 0 && nextCount <= 18) hi = (hi ^ handKeysHi[nextCount]) >>> 0;
      }
    }

    const toKeyLo = PIECE_KEYS[destPieceType]?.[move.player]?.[toIdx];
    const toKeyHi = PIECE_KEYS_HI[destPieceType]?.[move.player]?.[toIdx];
    if (toKeyLo !== undefined) lo = (lo ^ toKeyLo) >>> 0;
    if (toKeyHi !== undefined) hi = (hi ^ toKeyHi) >>> 0;
  }

  return { lo, hi };
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

// 手の順序付けスコア (ctx.killerMoves / ctx.historyTable を参照)
function scoreMove(
  move: Move,
  ttMove: Move | null,
  ply: number,
  ctx: SearchContext
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
  if (isKillerMove(move, ply, ctx)) return 10000;

  // ヒストリーヒューリスティック
  const fromIdx = moveFromIndex(move);
  const toIdx = moveToIndex(move);
  return ctx.historyTable[fromIdx][toIdx];
}

// 静止探索（取り駒 + 成り手 + 王手回避）。
// Issue #176: deadline / abort / per-request TT は SearchContext を経由する。
// 停止後の score は上位で破棄されるが、念のため早期 return で探索爆発を抑える。
function quiescence(
  state: GameState,
  alpha: number,
  beta: number,
  player: Player,
  variant: RuleVariant,
  hash: ZobristHash,
  qDepth: number,
  ctx: SearchContext
): number {
  ctx.nodes++;
  if (shouldStop(ctx)) return 0;

  const opponent: Player = player === "sente" ? "gote" : "sente";

  // 深度制限
  if (qDepth > MAX_Q_DEPTH) {
    // PR1d-1: ctx.cardDigest を伝播 (W-1 root スカラー方式、未渡時は既存挙動)
    const rawScore = evaluate(state, variant, ctx.cardDigest);
    return player === "sente" ? rawScore : -rawScore;
  }

  const inCheck = isInCheck(state, player, variant);

  if (inCheck) {
    // 王手中: stand-pat不可、全合法手を探索（逃げなければならない）
    const moves = getSearchLegalMoves(state, player, variant);
    if (moves.length === 0) {
      return -(MATE_SCORE - qDepth); // 詰み
    }

    let bestScore = NEG_INF;
    for (const move of moves) {
      if (shouldStop(ctx)) return 0;
      const nextState = applyMoveForSearch(state, move);
      const nextHash = updateHash(hash, state, move, nextState);
      const score = -quiescence(nextState, -beta, -alpha, opponent, variant, nextHash, qDepth + 1, ctx);

      if (score > bestScore) bestScore = score;
      if (score > alpha) alpha = score;
      if (alpha >= beta) return beta;
    }
    return bestScore;
  }

  // 通常: stand-pat + 取り駒 + 成り手
  // PR1d-1: ctx.cardDigest を伝播 (W-1 root スカラー方式、未渡時は既存挙動)
  const rawScore = evaluate(state, variant, ctx.cardDigest);
  const standPat = player === "sente" ? rawScore : -rawScore;

  if (standPat >= beta) return beta;
  let currentAlpha = alpha;
  if (standPat > currentAlpha) currentAlpha = standPat;

  // 取り駒（MVV-LVAソート済み）
  const captures = getCaptureMovesForSearch(state, player, variant);
  for (const move of captures) {
    if (shouldStop(ctx)) return 0;
    // Delta Pruning: 取っても到底alphaに届かない駒取りをスキップ
    const capturedValue = ORDER_PIECE_VALUES[move.captured!] ?? 100;
    if (standPat + capturedValue + 200 < currentAlpha) continue;

    const nextState = applyMoveForSearch(state, move);
    const nextHash = updateHash(hash, state, move, nextState);
    const score = -quiescence(nextState, -beta, -currentAlpha, opponent, variant, nextHash, qDepth + 1, ctx);

    if (score >= beta) return beta;
    if (score > currentAlpha) currentAlpha = score;
  }

  // 非取り成り手（歩・香の成り。と金化は+500cpの価値があるため常に探索）
  const promotions = getPromotionMovesForSearch(state, player, variant);
  for (const move of promotions) {
    if (shouldStop(ctx)) return 0;
    const nextState = applyMoveForSearch(state, move);
    const nextHash = updateHash(hash, state, move, nextState);
    const score = -quiescence(nextState, -beta, -currentAlpha, opponent, variant, nextHash, qDepth + 1, ctx);

    if (score >= beta) return beta;
    if (score > currentAlpha) currentAlpha = score;
  }

  return currentAlpha;
}

// Negamax with alpha-beta, TT, null-move pruning, LMR, PVS, futility, killers, history
// Issue #176: deadline / abort / per-request TT は SearchContext を経由する。
function negamax(
  state: GameState,
  depth: number,
  alpha: number,
  beta: number,
  player: Player,
  variant: RuleVariant,
  hash: ZobristHash,
  ply: number,
  isNullMoveAllowed: boolean,
  ctx: SearchContext
): number {
  ctx.nodes++;
  if (shouldStop(ctx)) return 0;

  // TT probe (dual hash) — per-request TT
  const tt = ctx.tt;
  const ttEntry = tt.probe(hash.lo, hash.hi);
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
  const inCheck = isInCheck(state, player, variant);
  if (inCheck && ply < MAX_DEPTH - 2) {
    depth++;
  }

  // Quiescence search at depth 0
  if (depth <= 0) {
    return quiescence(state, alpha, beta, player, variant, hash, 0, ctx);
  }

  // 合法手生成
  const moves = getSearchLegalMoves(state, player, variant);
  const opponent: Player = player === "sente" ? "gote" : "sente";

  if (moves.length === 0) {
    if (inCheck) {
      return -(MATE_SCORE - ply); // 詰み
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
    const nullHash: ZobristHash = {
      lo: (hash.lo ^ SIDE_TO_MOVE_KEY) >>> 0,
      hi: (hash.hi ^ SIDE_TO_MOVE_KEY_HI) >>> 0,
    };
    const R = depth >= 6 ? 3 : 2;
    const nullScore = -negamax(
      nullState,
      depth - 1 - R,
      -beta,
      -beta + 1,
      opponent,
      variant,
      nullHash,
      ply + 1,
      false,
      ctx
    );
    if (nullScore >= beta) {
      return beta;
    }
  }

  // 静的評価（futility pruning用）
  let staticEval: number | null = null;

  // 手の順序付け
  const sortedMoves = [...moves].sort(
    (a, b) => scoreMove(b, ttMove, ply, ctx) - scoreMove(a, ttMove, ply, ctx)
  );

  let maxScore = NEG_INF;
  let bestMove: Move | null = null;
  const originalAlpha = alpha;

  for (let i = 0; i < sortedMoves.length; i++) {
    const move = sortedMoves[i];
    const isCapture = move.captured !== undefined;
    const isPromotion = move.promote === true;
    const isKiller = isKillerMove(move, ply, ctx);

    // Futility Pruning（depth 1-2で非戦術手をスキップ、王手中は除外���
    if (depth <= 2 && !isCapture && !isPromotion && !inCheck && i > 0) {
      if (staticEval === null) {
        // PR1d-1: ctx.cardDigest を伝播 (W-1 root スカラー方式、未渡時は既存挙動)
        const rawEval = evaluate(state, variant, ctx.cardDigest);
        staticEval = player === "sente" ? rawEval : -rawEval;
      }
      const margin = depth === 1 ? 300 : 500;
      if (staticEval + margin <= alpha) continue;
    }

    const nextState = applyMoveForSearch(state, move);
    const nextHash = updateHash(hash, state, move, nextState);

    let score: number;

    if (i === 0) {
      score = -negamax(
        nextState,
        depth - 1,
        -beta,
        -alpha,
        opponent,
        variant,
        nextHash,
        ply + 1,
        true,
        ctx
      );
    } else {
      // PVS + LMR
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
        nextHash,
        ply + 1,
        true,
        ctx
      );

      if (score > alpha && score < beta) {
        score = -negamax(
          nextState,
          depth - 1,
          -beta,
          -alpha,
          opponent,
          variant,
          nextHash,
          ply + 1,
          true,
          ctx
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
      // Issue #176: 停止後は killer / history を更新しない (途中値で汚染しないため)
      if (!ctx.stopped) {
        updateKillerMove(move, ply, ctx);
        const fromIdx = moveFromIndex(move);
        const toIdx = moveToIndex(move);
        ctx.historyTable[fromIdx][toIdx] += depth * depth;
      }
      break;
    }
  }

  // TT store (dual hash)。Issue #176: 停止後の score は信頼できないため保存しない。
  if (!ctx.stopped) {
    let flag: "exact" | "lower" | "upper";
    if (maxScore <= originalAlpha) {
      flag = "upper";
    } else if (maxScore >= beta) {
      flag = "lower";
    } else {
      flag = "exact";
    }
    tt.store(hash.lo, hash.hi, depth, maxScore, flag, bestMove);
  }

  return maxScore;
}

// 反復深化で最善手を探索。
// Issue #176: SearchContext で deadline / abort / nodes / per-request stats を共有する。
// `ctx` 省略時は options.timeLimitMs から SearchContext を生成する。通常は
// engine.ts (findBestMoveWithStats) または Route Handler が ctx を渡す。
// Issue #193 / PR2: findBestMove の戻り値。move に加え、root 各手の深い探索スコア
// (player 視点、最終完了 depth の値) を rootMoveScores として公開する。
// blunder guard の同点圏 tie-breaker が「ハング手 vs 最善安全手」を深いスコアで
// 比較し、探索が見返りを確認した戦術的犠牲を尊重するために使う。
// (静的 evaluate では犠牲の見返りが見えないため、深いスコアが必須)
export interface RootSearchResult {
  move: Move;
  rootMoveScores: { move: Move; score: number }[];
}

export function findBestMove(
  state: GameState,
  player: Player,
  options: SearchOptions,
  variant: RuleVariant = STANDARD_VARIANT,
  ctx?: SearchContext
): RootSearchResult | null {
  const moves = getSearchLegalMoves(state, player, variant);
  if (moves.length === 0) return null;
  // 合法手 1 つのみ: 比較対象が無いので rootMoveScores は空で返す。
  if (moves.length === 1) return { move: moves[0], rootMoveScores: [] };

  const searchCtx: SearchContext =
    ctx ?? createSearchContext({ timeLimitMs: options.timeLimitMs });

  // per-request TT。ctx を新規作成した場合は空の TT、ctx を受け取った場合は
  // 上位 (engine.ts) が用意した TT (= 同 request 内では 1 回限りの newSearch)。
  searchCtx.tt.newSearch();

  let bestMove = moves[0];
  let bestScore = NEG_INF;
  let rootMoveScores: { move: Move; score: number }[] = [];

  const initialHash = computeHash(state);

  // 反復深化 + Aspiration Windows
  for (let depth = 1; depth <= options.maxDepth; depth++) {
    if (shouldStop(searchCtx)) break;
    // 時間予算の半分を超えたら次 depth に進まない (中途で打ち切るより早めに止める)
    const elapsedFromStart = performance.now() - searchCtx.startedAt;
    if (elapsedFromStart > options.timeLimitMs * 0.55) break;

    const ttEntry = searchCtx.tt.probe(initialHash.lo, initialHash.hi);
    const ttMove = ttEntry?.bestMove ?? null;

    const sortedMoves = [...moves].sort(
      (a, b) => scoreMove(b, ttMove, 0, searchCtx) - scoreMove(a, ttMove, 0, searchCtx)
    );

    const opponent: Player = player === "sente" ? "gote" : "sente";

    // Aspiration Windows（depth > 1 から使用、±100cp）
    let aspirationAlpha = depth > 1 ? bestScore - 100 : NEG_INF;
    let aspirationBeta = depth > 1 ? bestScore + 100 : POS_INF;
    let aspirationRetry = 0;
    let depthCompletedFully = false;

    while (aspirationRetry < 3) {
      let depthBestMove = sortedMoves[0];
      let depthBestScore = NEG_INF;
      const depthMoveScores: { move: Move; score: number }[] = [];
      let alpha = aspirationAlpha;
      let stoppedDuringRoot = false;

      for (let i = 0; i < sortedMoves.length; i++) {
        if (shouldStop(searchCtx)) {
          stoppedDuringRoot = true;
          break;
        }
        const move = sortedMoves[i];

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
            nextHash,
            1,
            true,
            searchCtx
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
            nextHash,
            1,
            true,
            searchCtx
          );
          if (score > alpha && score < aspirationBeta) {
            score = -negamax(
              nextState,
              depth - 1,
              -aspirationBeta,
              -alpha,
              opponent,
              variant,
              nextHash,
              1,
              true,
              searchCtx
            );
          }
        }

        // Issue #176: 停止後の score は信頼できない (途中で 0 が返る)。
        // root の depthMoveScores には保存せず、当該 depth は未完了扱いにする。
        if (searchCtx.stopped) {
          stoppedDuringRoot = true;
          break;
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

      // 停止で root を抜けた場合、当該 depth は未完了として採用しない
      if (stoppedDuringRoot) break;

      // Aspiration fail check (段階的拡大)
      if (depthBestScore <= aspirationAlpha) {
        aspirationAlpha = aspirationRetry === 0 ? bestScore - 300 : NEG_INF;
        aspirationRetry++;
        continue;
      }
      if (depthBestScore >= aspirationBeta) {
        aspirationBeta = aspirationRetry === 0 ? bestScore + 300 : POS_INF;
        aspirationRetry++;
        continue;
      }

      // 成功 (depth 完全終了)
      if (depthBestScore > bestScore || depth === 1) {
        bestScore = depthBestScore;
        bestMove = depthBestMove;
        rootMoveScores = depthMoveScores;
      }
      depthCompletedFully = true;
      break;
    }

    if (depthCompletedFully) {
      searchCtx.depthCompleted = depth;
    } else {
      // 停止または aspiration 連続失敗で当該 depth が完了しなかった場合は反復深化を打ち切る
      break;
    }
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

  // Issue #193 / PR2: bestMove (noise / nearEqual 調整後) と root スコアを返す。
  // rootMoveScores は最終完了 depth の各手スコア (player 視点)。
  return { move: bestMove, rootMoveScores };
}

// Issue #193 / PR1d-2: TurnAction (move / draw / playCard) を player 視点のスカラー評価値に変換する純粋関数。
//
// 設計意図:
// - production の探索ホットパス (findBestMove / negamax / quiescence) は move-only のまま保持し、
//   playCard / draw は本関数を engine.ts (PR1d-2 コミット 3 で統合予定) の root 経路から呼んで評価
// - evaluate.ts の sente 絶対視点 (PR1d-1 W-2 反映) を player 視点に符号反転して返す
// - cardDigest は ctx?.cardDigest (W-1 root スカラー方式) を使用、未渡時は加算 skip = 振る舞いキープ
//
// 評価方針:
// - move: applyMoveForSearch 後の局面で evaluate (= 既存 root 評価と同じ depth=0 評価)
// - draw: 局面は変わらず、cardDigest も root スカラー固定のため evaluate 値は同じ。
//   ドローを促進するため getDrawValue(state, player, cardState) を加算 (PR3-1: 旧 DRAW_VALUE_BONUS=30
//   固定を動的化、手札枚数/マナ余剰/局面段階に応じて算出。退化原因 ① 解消)
// - playCard (通常カード): simulateCardEffect で仮想 GameState 遷移後の局面で evaluate。
//   simulateCardEffect が null を返す target なしカード (mana_up 等) は
//   Number.NEGATIVE_INFINITY を返して候補から除外
// - playCard "double_move": PR1d-3 で searchDoubleMoveSuperAction (2 手指し組合せの
//   depth=0 局所探索、判断 1 = 案 B) に委譲
// - playCard "no_promote" / "check_break": PR1d-4 で現局面評価 + TRAP_VALUE_* 加算
//   (targeting:none で盤面不変、トラップセット増分価値の固定近似、bench で係数調整)
//
// 注: depth=0 評価のため、move の深く読んだスコア (findBestMove 反復深化結果) との
// 直接比較は不公平だが、engine.ts root 経路 (PR1d-2) で move も evaluateAction で
// 再評価して比較基準を統一済 (= 公平化済)。
export function evaluateAction(
  state: AiTurnState,
  action: TurnAction,
  player: Player,
  variant: RuleVariant,
  ctx?: SearchContext,
  // Issue #193 / PR2 (検証フィードバック): true のとき、カード使用結果がタダ捨て
  // (手番側に無防備で取られる駒が新規発生) になる playCard を候補から除外 (-Inf)。
  // 呼び出し側 (engine) が難易度に応じて渡す (全難易度で原則 true、初級のみ確率的に false)。
  excludeTadasute = false,
): number {
  const cardDigest = ctx?.cardDigest;
  switch (action.kind) {
    case "move": {
      const nextState = applyMoveForSearch(state.gameState, action.move);
      const raw = evaluate(nextState, variant, cardDigest);
      return player === "sente" ? raw : -raw;
    }
    case "draw": {
      const raw = evaluate(state.gameState, variant, cardDigest);
      const signed = player === "sente" ? raw : -raw;
      return signed + getDrawValue(state.gameState, player, state.cardState);
    }
    case "playCard": {
      // PR1d-3 (判断 1 = 案 B): double_move は super-action 内部探索で 2 手指しの
      // 最良組合せを depth=0 評価 (simulateCardEffect は targeting:none で null を
      // 返すため、専用経路で扱う)。
      if (action.defId === "double_move") {
        return searchDoubleMoveSuperAction(state, player, variant, ctx);
      }
      // PR1d-4: トラップ系 (no_promote / check_break) は targeting:none で盤面不変
      // (simulateCardEffect は null)。カード使用で自盤面にトラップがセットされる
      // 増分価値を現局面評価 (player 視点) に加算 (= draw の getDrawValue 加算と同型)。
      // 「いつ使うべきか」(序盤 / king safety) の精度は固定価値の近似で代替し、
      // heuristics.ts の TRAP_VALUE_* を bench で調整 (計画 md L1267 警告に対応)。
      if (action.defId === "no_promote" || action.defId === "check_break") {
        const trapRaw = evaluate(state.gameState, variant, cardDigest);
        const trapSigned = player === "sente" ? trapRaw : -trapRaw;
        const trapBonus =
          action.defId === "no_promote"
            ? TRAP_VALUE_NO_PROMOTE
            : TRAP_VALUE_CHECK_BREAK;
        return trapSigned + trapBonus;
      }
      const nextGameState = simulateCardEffect(
        state.gameState,
        player,
        action.defId,
        action.target ?? null,
      );
      if (!nextGameState) {
        // simulateCardEffect が null を返すその他の target なしカード
        // (mana_up 等) は PR1d-4 範囲外
        return Number.NEGATIVE_INFINITY;
      }
      // Issue #193 / PR2 (検証フィードバック): タダ捨て除外。カード適用で手番側に
      // 無防備で取られる駒が新たに生じる手 (例: 二歩指しで相手飛車前に歩を打つ) は
      // 候補から外す。0 手先の静的評価では「次の手で只取りされる」損失が見えないため、
      // pieceSafety の前後悪化で検知してここで除外する。
      if (
        excludeTadasute &&
        cardResultIntroducesTadasute(state.gameState, nextGameState, player, variant)
      ) {
        return Number.NEGATIVE_INFINITY;
      }
      const raw = evaluate(nextGameState, variant, cardDigest);
      return player === "sente" ? raw : -raw;
    }
  }
}

// Issue #193 / PR1d-3: double_move (二手指し) を 1 つの super-action として扱う
// 内部探索 (判断 1 = 案 B「depth=0 簡易評価」採用)。
//
// 設計:
// - double_move は「同一プレイヤーが 2 ply 連続で指す」特殊機構。super-action 内部で
//   1 手目選択 → applyAction(turnEnded=false) → 2 手目選択 → applyAction(turnEnded=true)
//   → 2 手指し後の局面を depth=0 評価 (= PR1d-2 evaluateAction の depth=0 と公平)
// - player 反転禁止: 二手指し中は同一プレイヤーが連続するため negamax の符号反転や
//   player 反転を行わない (turnEnded フラグで構造的に保証、不変条件を assert)
// - 性能配慮 (案 B は depth=0 全探索で αβ pruning が効かない): 1 手目候補を
//   scoreMoveForOrdering 順上位 DOUBLE_MOVE_TOP_K 手に常時絞る (heuristics.ts の ZZ 反映)
// - cardDigest は ctx?.cardDigest (W-1 root スカラー方式) を使用、未渡時は加算 skip
//
// 計画 md L1060-1122 の擬似コードは案 A (negamax 深読み) 前提。本実装は案 B
// (depth=0) のため negamax 呼出なし・local αβ も depth=0 では単純 max に縮約
// (ZZ 反映)。double_move の「2 手分動ける」価値は組合せ探索が直接捕捉する。
function searchDoubleMoveSuperAction(
  state: AiTurnState,
  player: Player,
  variant: RuleVariant,
  ctx?: SearchContext,
): number {
  const cardDigest = ctx?.cardDigest;
  const rules = new CurrentRules(variant);

  // Step 1: double_move カード適用 (doubleMove フラグ ON、turnEnded=false)
  const afterCard = rules.applyAction(state, {
    kind: "playCard",
    cardInstanceId: "", // super-action 内部探索では instanceId 不問
    defId: "double_move",
  }).next;

  // Step 2: 1 手目候補生成 (move-only)。性能配慮で heuristic 上位 K 手に絞る。
  const firstMovesAll = getSearchLegalMoves(afterCard.gameState, player, variant);
  if (firstMovesAll.length === 0) return NEG_INF; // 1 手目なし = 二手指し不成立で負
  const firstMoves =
    firstMovesAll.length > DOUBLE_MOVE_TOP_K
      ? [...firstMovesAll]
          .sort((a, b) => scoreMoveForOrdering(b) - scoreMoveForOrdering(a))
          .slice(0, DOUBLE_MOVE_TOP_K)
      : firstMovesAll;

  let bestScore = NEG_INF;
  // Step 3: 各 1 手目 × 全 2 手目を局所探索、2 手指し後を depth=0 評価
  for (const firstMove of firstMoves) {
    const afterFirst = rules.applyAction(afterCard, { kind: "move", move: firstMove });
    // 不変条件: 二手指し 1 手目は turnEnded=false (= player 反転禁止の構造的保証)
    if (afterFirst.turnEnded) {
      throw new Error(
        "Invariant violation: double_move 1 手目で turnEnded が true (player 反転禁止が破れている)",
      );
    }
    const secondMoves = getSearchLegalMoves(afterFirst.next.gameState, player, variant);
    if (secondMoves.length === 0) continue; // 2 手目なしはこの 1 手目をスキップ
    for (const secondMove of secondMoves) {
      const afterSecond = rules.applyAction(afterFirst.next, {
        kind: "move",
        move: secondMove,
      });
      // 不変条件: 二手指し 2 手目で turnEnded=true (= ターン終了、通常フローに戻る)
      if (!afterSecond.turnEnded) {
        throw new Error(
          "Invariant violation: double_move 2 手目で turnEnded が false",
        );
      }
      // 案 B: 2 手指し後の局面を depth=0 評価 (player 視点、PR1d-2 evaluateAction と整合)
      const raw = evaluate(afterSecond.next.gameState, variant, cardDigest);
      const score = player === "sente" ? raw : -raw;
      if (score > bestScore) bestScore = score;
    }
  }
  return bestScore;
}
