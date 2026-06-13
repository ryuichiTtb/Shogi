import type { GameState, Move, Player, RuleVariant } from "../types";
import { STANDARD_VARIANT } from "../variants/standard";
// Issue #193 / PR1b (Phase 3): 探索ホットパスの合法手生成は getSearchLegalMoves に切替。
// getFullLegalMoves は本ファイル内で直接呼ばないので import から除外、isInCheck のみ moves から取込む。
import { isInCheck, getFullLegalMoves } from "../moves";
import { getSearchLegalMoves } from "./legal-moves";
import { applyMoveForSearch } from "../board";
import { evaluate, scoreMoveForOrdering } from "./evaluate";
import { cardResultIntroducesTadasute, hasHangingPiece } from "./blunder-guard";
import { simulateCardEffect } from "../cards/effects";
import { getCardValue } from "../cards/card-spec-server";
import {
  getDrawValue,
  DOUBLE_MOVE_TOP_K,
} from "./cards/heuristics";
import { CurrentRules, canDraw } from "./turn/current-rules";
import { getCardActions } from "./turn/action-generator";
import type { AiTurnState, TurnAction } from "./turn/types";
import type { CardGameState } from "../cards/types";
import { CARD_DEFS, DRAW_COST } from "../cards/definitions";
// Issue #235 S1b: AI root カード/ドロー評価を useKernelSearch フラグ裏で L0 カーネル経由に切替える。
import { applyTurnAction, type WorldState } from "../kernel/world-kernel";
import {
  type CardDigest,
  computeCardDigest,
  updateCardDigest,
} from "./cards/digest";
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
  isActionPhaseTimeUp,
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
  // Issue #235 S4c-1: WorldState 探索 (findBestMoveWorld) が返す root 最善 TurnAction
  // (move / card / draw)。move-only findBestMove は未設定 (engine が {kind:"move", move} を構築 =
  // 既存不変)。world 経路の engine cutover (S4c-1b) がこれを selectedAction に採用する。
  bestAction?: TurnAction;
}

export function findBestMove(
  state: GameState,
  player: Player,
  options: SearchOptions,
  variant: RuleVariant = STANDARD_VARIANT,
  ctx?: SearchContext,
  // Issue #235 S4b-2a: WorldState 探索 (useTurnActionSearch ON) 用の root cardState。
  // flag OFF / standard / 未供給では以降の move-only 探索をそのまま実行 (production 完全不変)。
  cardState?: CardGameState,
): RootSearchResult | null {
  // Issue #235 S4b-2a: useTurnActionSearch ON かつ card-shogi かつ cardState 供給時は
  // WorldState (TurnAction) 探索へ分岐 (カードを木に入れる新 card-aware 探索)。
  if (ctx?.useTurnActionSearch && variant.id === "card-shogi" && cardState !== undefined) {
    return findBestMoveWorld(state, cardState, player, options, variant, ctx);
  }
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

// =========================================================================
// Issue #235 S4b-2a / S4c-1: WorldState (TurnAction) card-aware 探索
// =========================================================================
// 既存 negamax / quiescence / findBestMove (move-only deep search) は 1 行も触らず、
// WorldState を回し move + (root の) card/draw を TurnAction として木に入れる新 card-aware
// 探索を別シンボルで複製する (standard byte 等価維持の唯一道、計画 §11)。
//
// スコープ (S4b-2a additive 足場 → S4c-1 で production cutover):
// - flag OFF (= useTurnActionSearch 未指定) では findBestMove 冒頭で分岐せず move-only 経路。
//   standard variant は cardState 未供給で常に move-only (防御ガード)。
// - TT は積まない (S4c-2。boardHash TT はカードを木に入れると cardState 差で誤 hit)。
// - **S4c-1: カードは root のみ展開** (expandCards)。deep node は move-only (相手・自分の深ノード共)。
//   = 「カードを今打つ」帰結を move と同じ深さで読み公平比較する最小設計 (P1 解消、§12.1-1)。
// - double_move は S4c-1 では除外 (実行プラミング = S4c-1d)。getWorldLegalActions で除外。
// - cardDigest は per-node 更新 (updateCardDigest 踏襲、root 固定だと inert 化 = PR3-3 C-9)。
// - 着手は getFullLegalMoves(+cardState) で mark-aware (S4a)。quiescence の captureGen は
//   cardState 非対応ゆえ非 mark-aware (S4c-1d/後段で解消)。
// - selector は root のみ実効 (S4b-2b、deep node は move-only ゆえ M=∞ で no-op)。
// - noise/nearEqual は findBestMoveWorld が root アクション上で適用 (D-B)。

// WorldState ノードの合法 TurnAction を生成。
// Issue #235 S4c-1: カード/ドローは root の自分番ノードのみ展開する (expandCards=true)。
// root 以降 (相手番・自分の深ノード) は move-only 継続 = 「カードを今打つ」帰結を move-only で
// 深く読み move と公平比較する最小設計 (P1 解消。multi-card planning は S5/L3。計画 §12.1-1)。
// S4b-2a の rootPlayer gate (相手ノードでカード展開される不整合) を expandCards へ是正。
// double_move は S4c-1 では除外 (実行プラミング未配線 = S4c-1d。AI は候補化しない)。
// 特性化テストから expandCards gate / double_move 除外を検証するため export。
export function getWorldLegalActions(
  world: WorldState,
  variant: RuleVariant,
  expandCards: boolean,
): TurnAction[] {
  const player = world.gameState.currentPlayer;
  // 着手は cardState-aware (マーク駒の幻成りを生成しない、S4a)。
  const moves = getFullLegalMoves(world.gameState, player, variant, world.cardState);
  const actions: TurnAction[] = moves.map((move) => ({ kind: "move" as const, move }));
  // card/draw は root の自分番ノードのみ (expandCards)。double_move 継続中 (doubleMove!==null)
  // は move-only (S4c-1 では doubleMove は常に null だが、S4c-1d の中間ノード move-only を先取り防御)。
  if (expandCards && variant.id === "card-shogi" && world.doubleMove === null) {
    // 王手中は draw 禁止 (reducer.ts DRAW_CARD = 王手中ドロー不可 と整合。kernel の
    // applyDrawAction は非王手を caller 保証の前提とするため、ここで弾かないと「王手放置パス」
    // を探索木に注入し minimax を汚染する。M2 指摘)。card は getCardActions が王手中 use
    // condition で自前に枝刈り済。
    const playerInCheck = isInCheck(world.gameState, player, variant);
    const aiState: AiTurnState = {
      gameState: world.gameState,
      cardState: world.cardState,
      doubleMove: null,
      isRoot: true,
    };
    if (!playerInCheck && canDraw(world.cardState, player)) {
      actions.push({ kind: "draw" });
    }
    for (const cardAction of getCardActions(aiState, player, variant)) {
      // double_move は S4c-1 除外 (S4c-1d で統合)。
      if (cardAction.kind === "playCard" && cardAction.defId === "double_move") continue;
      actions.push(cardAction);
    }
  }
  return actions;
}

// TurnAction の順序付けスコア: move は既存 scoreMove (TT 手は無いので ttMove=null)、
// card/draw は move の後ろ (-1。quiet move の history は >=0 ゆえ全 move より後)。
function actionOrderScore(action: TurnAction, ply: number, ctx: SearchContext): number {
  if (action.kind === "move") return scoreMove(action.move, null, ply, ctx);
  return -1;
}

// Issue #235 S4b-2b: selector。各ノードの TurnAction を move 上位 M + card 上位 K (+draw) に
// 枝刈りする (PoC-1 再検証用)。M/K=Infinity は枝刈りなし (全展開)。K=0 は card/draw 完全除外
// (= move-only control)。move は scoreMove 降順、card は getCardValue 降順で上位を残す。
// 特性化テストから検証するため export。
export function selectBranchCandidates(
  actions: TurnAction[],
  M: number,
  K: number,
  gameState: GameState,
  player: Player,
  ply: number,
  ctx: SearchContext,
): TurnAction[] {
  // 早期 return (MED-2 反映): card/draw が無く M=∞ なら枝刈り結果は入力と同一。deep node は
  // move-only (expandCards=false) かつ production 既定 M=∞ ゆえこのホットパスで 3 filter + spread の
  // 無駄アロケーションを回避する (O(n) スキャン + 早期 break のみ)。root (card 有) は通過して通常処理。
  if (!Number.isFinite(M)) {
    let hasNonMove = false;
    for (const a of actions) {
      if (a.kind !== "move") {
        hasNonMove = true;
        break;
      }
    }
    if (!hasNonMove) return actions;
  }
  const moves = actions.filter((a) => a.kind === "move");
  const topMoves =
    Number.isFinite(M) && moves.length > M
      ? [...moves]
          .sort((a, b) => actionOrderScore(b, ply, ctx) - actionOrderScore(a, ply, ctx))
          .slice(0, M)
      : moves;

  if (K === 0) return topMoves; // move-only control (card/draw 除外)

  const cards = actions.filter(
    (a): a is Extract<TurnAction, { kind: "playCard" }> => a.kind === "playCard",
  );
  const draws = actions.filter((a) => a.kind === "draw");
  const topCards =
    Number.isFinite(K) && cards.length > K
      ? [...cards]
          .sort(
            (a, b) =>
              getCardValue(b.defId, gameState, player) -
              getCardValue(a.defId, gameState, player),
          )
          .slice(0, K)
      : cards;

  return [...topMoves, ...topCards, ...draws];
}

// quiescenceWorld: 静止探索 (move-only captures/promotions)。既存 quiescence と同型だが、
// per-node cardDigest を明示引数で受け leaf eval に渡す (ctx.cardDigest 固定でなく per-node)。
// quiescence は applyMoveForSearch (board-only) で cardState 不変ゆえ digest は本階層で一定。
// TT を使わないため hash は不要 (updateHash 呼出なし)。
function quiescenceWorld(
  state: GameState,
  alpha: number,
  beta: number,
  player: Player,
  variant: RuleVariant,
  cardDigest: CardDigest | undefined,
  qDepth: number,
  ctx: SearchContext,
): number {
  ctx.nodes++;
  if (shouldStop(ctx)) return 0;
  const opponent: Player = player === "sente" ? "gote" : "sente";

  if (qDepth > MAX_Q_DEPTH) {
    const rawScore = evaluate(state, variant, cardDigest);
    return player === "sente" ? rawScore : -rawScore;
  }

  const inCheck = isInCheck(state, player, variant);
  if (inCheck) {
    const moves = getSearchLegalMoves(state, player, variant);
    if (moves.length === 0) return -(MATE_SCORE - qDepth);
    let bestScore = NEG_INF;
    for (const move of moves) {
      if (shouldStop(ctx)) return 0;
      const nextState = applyMoveForSearch(state, move);
      const score = -quiescenceWorld(nextState, -beta, -alpha, opponent, variant, cardDigest, qDepth + 1, ctx);
      if (score > bestScore) bestScore = score;
      if (score > alpha) alpha = score;
      if (alpha >= beta) return beta;
    }
    return bestScore;
  }

  const rawScore = evaluate(state, variant, cardDigest);
  const standPat = player === "sente" ? rawScore : -rawScore;
  if (standPat >= beta) return beta;
  let currentAlpha = alpha;
  if (standPat > currentAlpha) currentAlpha = standPat;

  const captures = getCaptureMovesForSearch(state, player, variant);
  for (const move of captures) {
    if (shouldStop(ctx)) return 0;
    const capturedValue = ORDER_PIECE_VALUES[move.captured!] ?? 100;
    if (standPat + capturedValue + 200 < currentAlpha) continue;
    const nextState = applyMoveForSearch(state, move);
    const score = -quiescenceWorld(nextState, -beta, -currentAlpha, opponent, variant, cardDigest, qDepth + 1, ctx);
    if (score >= beta) return beta;
    if (score > currentAlpha) currentAlpha = score;
  }

  const promotions = getPromotionMovesForSearch(state, player, variant);
  for (const move of promotions) {
    if (shouldStop(ctx)) return 0;
    const nextState = applyMoveForSearch(state, move);
    const score = -quiescenceWorld(nextState, -beta, -currentAlpha, opponent, variant, cardDigest, qDepth + 1, ctx);
    if (score >= beta) return beta;
    if (score > currentAlpha) currentAlpha = score;
  }

  return currentAlpha;
}

// negamaxWorld: WorldState を回す card-aware negamax。既存 negamax の PVS/null-move/LMR/
// futility/killer/history/quiescence を faithful port し、遷移を applyTurnAction、cardDigest を
// per-node 更新に置換。TT は積まない (S4c-2)。
// S4c-1: 着手生成は move-only (getWorldLegalActions(world, variant, false))。カードは root のみ
// 展開ゆえ deep node に rootPlayer gate は不要 → rootPlayer 引数を撤去 (計画 §12.10)。
function negamaxWorld(
  world: WorldState,
  depth: number,
  alpha: number,
  beta: number,
  variant: RuleVariant,
  cardDigest: CardDigest | undefined,
  ply: number,
  isNullMoveAllowed: boolean,
  ctx: SearchContext,
): number {
  ctx.nodes++;
  if (shouldStop(ctx)) return 0;

  const state = world.gameState;
  const player = state.currentPlayer;
  const opponent: Player = player === "sente" ? "gote" : "sente";

  // 終局 (applyTurnAction の evaluateGameEnd が status を設定済): leaf として確定値を返す。
  // checkmate = 手番側 (player) が詰まされ = player 視点で最悪。stalemate/draw 等は 0
  // (move-only negamax の stalemate→0 と一致させ、no-card 局面の特性化を保つ)。
  if (state.status !== "active") {
    return state.status === "checkmate" ? -(MATE_SCORE - ply) : 0;
  }

  const inCheck = isInCheck(state, player, variant);
  if (inCheck && ply < MAX_DEPTH - 2) depth++;

  if (depth <= 0) {
    return quiescenceWorld(state, alpha, beta, player, variant, cardDigest, 0, ctx);
  }

  // S4c-1: deep node は move-only (expandCards=false。カードは root のみ展開、計画 §12.10)。
  let actions = getWorldLegalActions(world, variant, false);
  // S4b-2b: selector 枝刈り (M/K 指定時のみ。未指定=全展開で従来どおり)。deep node は move-only
  // ゆえ M=∞ 既定で no-op (S4e で deep-node M 校正余地を残す、MED-2)。
  if (ctx.selectorM !== undefined || ctx.selectorK !== undefined) {
    actions = selectBranchCandidates(
      actions, ctx.selectorM ?? Infinity, ctx.selectorK ?? Infinity, state, player, ply, ctx,
    );
  }
  if (actions.length === 0) {
    if (inCheck) return -(MATE_SCORE - ply); // 詰み
    return 0; // ステールメイト
  }

  // Null Move Pruning (board-based、王手中不可)。盤面のみに依存しカード非依存ゆえ流用可。
  // S4c-1b 修正: beta が有限のときのみ実行。findBestMoveWorld は aspiration window を持たず
  // PV を full-window (beta=+Infinity) で探索するため、beta=+Infinity の null 窓 (-beta, -beta+1)
  // = (-Infinity, -Infinity) が退化し、quiescence に alpha=±Infinity を渡して探索全体に ±Infinity を
  // 伝播させていた (root 全 action が -Infinity 化 = カードも move も評価不能)。beta=+Infinity では
  // `nullScore >= beta` は原理的に成立し得ず null-move 自体が無意味ゆえ、skip が正しい
  // (既存 negamax は aspiration で beta 有限のため本問題は起きない。S4e で aspiration 導入時に再検討)。
  if (isNullMoveAllowed && depth >= 3 && !inCheck && Number.isFinite(beta)) {
    const nullWorld: WorldState = {
      ...world,
      gameState: {
        ...state,
        currentPlayer: opponent,
        moveHistory: state.moveHistory,
        positionHistory: state.positionHistory,
      },
    };
    const R = depth >= 6 ? 3 : 2;
    const nullScore = -negamaxWorld(
      nullWorld, depth - 1 - R, -beta, -beta + 1, variant, cardDigest, ply + 1, false, ctx,
    );
    if (nullScore >= beta) return beta;
  }

  // 順序付け: move を scoreMove 降順、card/draw は後ろ。
  const sortedActions = [...actions].sort(
    (a, b) => actionOrderScore(b, ply, ctx) - actionOrderScore(a, ply, ctx),
  );

  let maxScore = NEG_INF;
  let staticEval: number | null = null;

  for (let i = 0; i < sortedActions.length; i++) {
    const action = sortedActions[i];
    const move = action.kind === "move" ? action.move : null;
    const isCapture = move !== null && move.captured !== undefined;
    const isPromotion = move !== null && move.promote === true;
    const isKiller = move !== null && isKillerMove(move, ply, ctx);

    // Futility Pruning (move のみ、depth 1-2 の非戦術手、王手中除外、i>0)
    if (move !== null && depth <= 2 && !isCapture && !isPromotion && !inCheck && i > 0) {
      if (staticEval === null) {
        const rawEval = evaluate(state, variant, cardDigest);
        staticEval = player === "sente" ? rawEval : -rawEval;
      }
      const margin = depth === 1 ? 300 : 500;
      if (staticEval + margin <= alpha) continue;
    }

    const applied = applyTurnAction(world, action, { spectatorMode: true });
    const childWorld = applied.world;
    const childDigest =
      cardDigest !== undefined
        ? updateCardDigest(cardDigest, world.cardState, childWorld.cardState, childWorld.gameState)
        : undefined;

    let score: number;
    if (!applied.turnEnded) {
      // 手番継続 (S4c-1 は double_move 除外ゆえ未到達。S4c-1d で live 化。保険: 同 player
      // 継続=符号反転なし)。
      score = negamaxWorld(
        childWorld, depth - 1, alpha, beta, variant, childDigest, ply + 1, true, ctx,
      );
    } else if (i === 0) {
      score = -negamaxWorld(
        childWorld, depth - 1, -beta, -alpha, variant, childDigest, ply + 1, true, ctx,
      );
    } else {
      // PVS + LMR (reduction は move のみ)
      let reduction = 0;
      if (move !== null && i >= 3 && depth >= 3 && !isCapture && !isPromotion && !isKiller && !inCheck) {
        reduction = 1;
        if (i >= 8 && depth >= 5) reduction = 2;
      }
      score = -negamaxWorld(
        childWorld, depth - 1 - reduction, -alpha - 1, -alpha, variant, childDigest, ply + 1, true, ctx,
      );
      if (score > alpha && score < beta) {
        score = -negamaxWorld(
          childWorld, depth - 1, -beta, -alpha, variant, childDigest, ply + 1, true, ctx,
        );
      }
    }

    if (score > maxScore) maxScore = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) {
      // β cut: killer/history は move のみ更新 (card/draw は対象外)。停止後は更新しない。
      if (!ctx.stopped && move !== null) {
        updateKillerMove(move, ply, ctx);
        const fromIdx = moveFromIndex(move);
        const toIdx = moveToIndex(move);
        ctx.historyTable[fromIdx][toIdx] += depth * depth;
      }
      break;
    }
  }

  return maxScore;
}

// findBestMoveWorld: WorldState 探索の root 反復深化。root で move + card/draw を**同列に**深読みし
// (S4c-1: カードは root のみ展開、§12.10)、最善 TurnAction (bestAction) を返す。move-only argmax
// (bestMove) + rootMoveScores も保持し、engine の blunder guard が move 採用時に参照する。
// noise/nearEqual は root アクション上で適用 (beginner/intermediate 弱さ演出、D-B)。
// 特性化テストから検証するため export。
export function findBestMoveWorld(
  state: GameState,
  cardState: CardGameState,
  player: Player,
  options: SearchOptions,
  variant: RuleVariant,
  ctx: SearchContext,
): RootSearchResult | null {
  const rootWorld: WorldState = { gameState: state, cardState, doubleMove: null };
  let rootActions = getWorldLegalActions(rootWorld, variant, true); // expandCards=true (root)
  // S4b-2b: root にも selector を適用 (M/K 指定時のみ)。
  if (ctx.selectorM !== undefined || ctx.selectorK !== undefined) {
    rootActions = selectBranchCandidates(
      rootActions, ctx.selectorM ?? Infinity, ctx.selectorK ?? Infinity, state, player, 0, ctx,
    );
  }
  const rootMoves = rootActions
    .filter((a): a is Extract<TurnAction, { kind: "move" }> => a.kind === "move")
    .map((a) => a.move);
  if (rootMoves.length === 0) return null; // 合法手なし (詰み/ステールメイト)
  if (rootActions.length === 1 && rootMoves.length === 1) {
    // 合法手が move 1 つのみ: bestAction も設定 (MINOR、early return の bestAction 漏れ防止)。
    return { move: rootMoves[0], rootMoveScores: [], bestAction: { kind: "move", move: rootMoves[0] } };
  }

  const baseDigest =
    ctx.cardDigest ??
    (variant.id === "card-shogi" ? computeCardDigest(cardState, state) : undefined);

  let bestMove = rootMoves[0];
  let rootMoveScores: { move: Move; score: number }[] = [];
  let bestAction: TurnAction = { kind: "move", move: bestMove };
  let rootActionScores: { action: TurnAction; score: number }[] = [];

  for (let depth = 1; depth <= options.maxDepth; depth++) {
    if (shouldStop(ctx)) break;
    const elapsedFromStart = performance.now() - ctx.startedAt;
    if (elapsedFromStart > options.timeLimitMs * 0.55) break;

    const sortedRoot = [...rootActions].sort(
      (a, b) => actionOrderScore(b, 0, ctx) - actionOrderScore(a, 0, ctx),
    );

    let alpha = NEG_INF;
    let bestMoveScore = NEG_INF;
    let depthBestMove = bestMove;
    let depthBestActionScore = NEG_INF;
    let depthBestAction: TurnAction = bestAction;
    const depthMoveScores: { move: Move; score: number }[] = [];
    const depthActionScores: { action: TurnAction; score: number }[] = [];
    let stopped = false;
    let i = 0;

    for (const action of sortedRoot) {
      if (shouldStop(ctx)) { stopped = true; break; }
      // root の全 action は turnEnded=true (S4c-1 は double_move 除外) → 相手番へ反転。
      const applied = applyTurnAction(rootWorld, action, { spectatorMode: true });
      const childWorld = applied.world;
      const childDigest =
        baseDigest !== undefined
          ? updateCardDigest(baseDigest, cardState, childWorld.cardState, childWorld.gameState)
          : undefined;

      let score: number;
      if (i === 0) {
        score = -negamaxWorld(childWorld, depth - 1, NEG_INF, -alpha, variant, childDigest, 1, true, ctx);
      } else {
        score = -negamaxWorld(childWorld, depth - 1, -alpha - 1, -alpha, variant, childDigest, 1, true, ctx);
        if (score > alpha) {
          score = -negamaxWorld(childWorld, depth - 1, NEG_INF, -alpha, variant, childDigest, 1, true, ctx);
        }
      }

      if (ctx.stopped) { stopped = true; break; }

      // 全 action を同列スコアリング (bestAction)。move のみ別途保持 (blunder guard 用 rootMoveScores)。
      depthActionScores.push({ action, score });
      if (score > depthBestActionScore) { depthBestActionScore = score; depthBestAction = action; }
      if (action.kind === "move") {
        depthMoveScores.push({ move: action.move, score });
        if (score > bestMoveScore) { bestMoveScore = score; depthBestMove = action.move; }
      }
      if (score > alpha) alpha = score;
      i++;
    }

    if (stopped) break;
    bestMove = depthBestMove;
    bestAction = depthBestAction;
    rootMoveScores = depthMoveScores;
    rootActionScores = depthActionScores;
    ctx.depthCompleted = depth;
  }

  // S4c-1 (D-B): noise/nearEqual を root アクション上で適用 (findBestMove:711-727 の move-only
  // noise を TurnAction へ一般化、beginner/intermediate 弱さ演出)。
  // nearEqual: best から閾値内の root アクションから random (move/card/draw 横断)。
  if (options.nearEqualThreshold > 0 && rootActionScores.length > 1) {
    const bestScore = rootActionScores.reduce((m, a) => (a.score > m ? a.score : m), NEG_INF);
    const candidates = rootActionScores.filter(
      (a) => a.score >= bestScore - options.nearEqualThreshold,
    );
    if (candidates.length > 1) {
      bestAction = candidates[Math.floor(Math.random() * candidates.length)].action;
    }
  }
  // addNoise: move 上位5 (scoreMoveForOrdering = findBestMove:722 と同関数、MED-1) から random。
  // card は actionOrderScore 上 -1 で最後尾 ゆえ top-5 はほぼ move = 「ランダム駒 move」(既存挙動踏襲)。
  if (options.addNoise > 0 && Math.random() < options.addNoise && rootMoves.length > 0) {
    const sortedMoves = [...rootMoves].sort(
      (a, b) => scoreMoveForOrdering(b) - scoreMoveForOrdering(a),
    );
    const randomIndex = Math.floor(Math.random() * Math.min(rootMoves.length, 5));
    const noisyMove = sortedMoves[randomIndex];
    if (noisyMove) bestAction = { kind: "move", move: noisyMove };
  }

  // bestAction が move のときは move フィールドを一致させる (blunder guard が採用 move と
  // rootMoveScores の整合を前提とするため)。card/draw 採用時は move-only argmax を保持
  // (engine が usingCardAction=true で blunder guard を skip = move フィールドは UI 互換用途)。
  if (bestAction.kind === "move") bestMove = bestAction.move;

  return { move: bestMove, rootMoveScores, bestAction };
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
// - playCard "no_promote" / "check_break": 現局面評価 + valueModel 局面依存値 (S3b)
//   (targeting:none で盤面不変、トラップセット増分価値。check_break=自玉露出度 / no_promote=
//    相手成り脅威度で gross 値を算出、固定 TRAP_VALUE_* を脱却)
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
        return searchDoubleMoveSuperAction(state, player, variant, ctx, excludeTadasute);
      }
      // PR1d-4 / S3b: トラップ系 (no_promote / check_break) は targeting:none で盤面不変
      // (simulateCardEffect は null)。カード使用で自盤面にトラップがセットされる増分価値を
      // 現局面評価 (player 視点) に加算 (= draw の getDrawValue 加算と同型)。
      // S3b: 固定 TRAP_VALUE_* を脱却し valueModel (局面依存 gross 値、player 視点) へ統一
      // (check_break=自玉露出度 / no_promote=相手成り脅威度。card-spec-server、ai → L1 依存反転)。
      if (action.defId === "no_promote" || action.defId === "check_break") {
        const trapRaw = evaluate(state.gameState, variant, cardDigest);
        const trapSigned = player === "sente" ? trapRaw : -trapRaw;
        const trapBonus = getCardValue(action.defId, state.gameState, player);
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
  excludeTadasute = false,
): number {
  // Issue #235 S1b: useKernelSearch ON で kernel 連鎖 (applyTurnAction) 経路へ分岐。
  // OFF は以下の旧実装 (CurrentRules.applyAction + 手動 wiring) を完全保持 = バイト等価。
  if (ctx?.useKernelSearch) {
    return searchDoubleMoveSuperActionKernel(state, player, variant, ctx, excludeTadasute);
  }

  const rules = new CurrentRules(variant);

  // Step 1: double_move カード適用 (doubleMove フラグ ON、turnEnded=false)
  const afterCard = rules.applyAction(state, {
    kind: "playCard",
    cardInstanceId: "", // super-action 内部探索では instanceId 不問
    defId: "double_move",
  }).next;

  // PR3-3 C-11 (adversarial verify F-1 残課題解消):
  // CurrentRules.applyAction の double_move 分岐は旧設計 (= cost を cardDigest 側で扱う)
  // の名残で cardState を変更しない。PR3-3 C-6 で updateCardDigest を per-action wiring
  // 化した今、本関数でも cardState を実遷移 (mana -=cost, hand -=1 double_move) させて
  // digest を更新する必要がある (= 死にマナ C-3 / handValue C-4 が super-action 経路でも
  // 効くようになる)。drawProgress も整合性のため +1 加算 (C-12 と同方針、production
  // applyTurnEndEffects 等価)。
  const doubleMoveCost = CARD_DEFS["double_move"].cost;
  const dmHandIdx = state.cardState.hand[player].findIndex(
    (c) => c.defId === "double_move",
  );
  const newHand =
    dmHandIdx >= 0
      ? [
          ...state.cardState.hand[player].slice(0, dmHandIdx),
          ...state.cardState.hand[player].slice(dmHandIdx + 1),
        ]
      : state.cardState.hand[player]; // 想定外: 候補生成時の checks で除外されているはず
  const newCardState: CardGameState = {
    ...state.cardState,
    mana: {
      ...state.cardState.mana,
      [player]: state.cardState.mana[player] - doubleMoveCost,
    },
    hand: { ...state.cardState.hand, [player]: newHand },
    drawProgress: {
      ...state.cardState.drawProgress,
      [player]: state.cardState.drawProgress[player] + 1,
    },
  };
  // afterCard.cardState を corrected newCardState で上書き
  // (以降の move 連鎖は CurrentRules.applyAction(move) が cardState を入力からそのまま
  //  propagate するため、newCardState が自動的に afterFirst/afterSecond にも継承される)
  const afterCardWiredCS = { ...afterCard, cardState: newCardState };

  // digest を更新: ctx 未渡時は computeCardDigest フォールバック (C-6 と同パターン)
  const prevDigest =
    ctx?.cardDigest ??
    (variant.id === "card-shogi"
      ? computeCardDigest(state.cardState, state.gameState)
      : undefined);
  const innerDigest =
    prevDigest !== undefined
      ? updateCardDigest(prevDigest, state.cardState, newCardState, afterCardWiredCS.gameState)
      : undefined;

  // Step 2: 1 手目候補生成 (move-only)。性能配慮で heuristic 上位 K 手に絞る。
  const firstMovesAll = getSearchLegalMoves(afterCardWiredCS.gameState, player, variant);
  if (firstMovesAll.length === 0) return NEG_INF; // 1 手目なし = 二手指し不成立で負
  const firstMoves =
    firstMovesAll.length > DOUBLE_MOVE_TOP_K
      ? [...firstMovesAll]
          .sort((a, b) => scoreMoveForOrdering(b) - scoreMoveForOrdering(a))
          .slice(0, DOUBLE_MOVE_TOP_K)
      : firstMovesAll;

  let bestScore = NEG_INF;
  let bestScoreIgnoringTadasute = NEG_INF; // PR3-3 C-3: フォールバック (R-3)
  // Step 3: 各 1 手目 × 全 2 手目を局所探索、2 手指し後を depth=0 評価
  for (const firstMove of firstMoves) {
    // Issue #235 派生 (Vercel 504 対策): フェーズ予算超過で打ち切り (評価済み combo の
    // best を返す = 時間制限探索の標準挙動。全滅時は NEG_INF → engine が move へフォールバック)。
    // 実測で 1 super-action ≈ 4s 超 (終盤、2 手目に持ち駒ドロップ ~130 手) のため必須。
    if (isActionPhaseTimeUp(ctx)) break;
    const afterFirst = rules.applyAction(afterCardWiredCS, { kind: "move", move: firstMove });
    // 不変条件: 二手指し 1 手目は turnEnded=false (= player 反転禁止の構造的保証)
    if (afterFirst.turnEnded) {
      throw new Error(
        "Invariant violation: double_move 1 手目で turnEnded が true (player 反転禁止が破れている)",
      );
    }
    const secondMoves = getSearchLegalMoves(afterFirst.next.gameState, player, variant);
    if (secondMoves.length === 0) continue; // 2 手目なしはこの 1 手目をスキップ
    for (const secondMove of secondMoves) {
      // 504 対策: combo 単位 (~ms 級処理) での時間チェック。now() コストは無視できる。
      if (isActionPhaseTimeUp(ctx)) break;
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
      // PR3-3 C-11: innerDigest (= double_move 適用後の cardState 反映済) を evaluate に渡す
      const raw = evaluate(afterSecond.next.gameState, variant, innerDigest);
      const score = player === "sente" ? raw : -raw;
      if (score > bestScoreIgnoringTadasute) bestScoreIgnoringTadasute = score;
      // PR3-3 C-3 (PR2 残課題解消): 2 手指し完了局面で「タダ捨て」(自駒がハングする手)
      // になる組合せを除外。double_move 2 手目で相手駒の前に自駒を打つ等を抑止する。
      if (
        excludeTadasute &&
        hasHangingPiece(afterSecond.next.gameState, player, variant)
      ) {
        continue;
      }
      if (score > bestScore) bestScore = score;
    }
  }
  // PR3-3 C-3 フォールバック (R-3): 全組合せがタダ捨て除外で消えた場合、
  // タダ捨てを許容してでも super-action として有限スコアを返す
  // (空集合で NEG_INF を返すと double_move カードが過剰に減点される問題を回避)。
  if (bestScore === NEG_INF) return bestScoreIgnoringTadasute;
  return bestScore;
}

// Issue #235 S1b: searchDoubleMoveSuperAction の useKernelSearch ON 版。
// double_move を L0 カーネル applyTurnAction の連鎖 (playCard → move → move) で評価し、
// cost 正確消費 (hand→graveyard) / lazy drawProgress / flip 抑止を kernel が一元処理する
// (OFF の手動 wiring 近似を解消、DP-2/DP-1 適用)。OFF 版と同じ構造 (TOP_K 絞り・excludeTadasute・
// bestScoreIgnoringTadasute フォールバック) を維持し、状態遷移のみ kernel に置換する。
function searchDoubleMoveSuperActionKernel(
  state: AiTurnState,
  player: Player,
  variant: RuleVariant,
  ctx: SearchContext,
  excludeTadasute: boolean,
): number {
  // Issue #235 S1d (decision i): AI 探索は仮想局面の評価であり、wall-clock 早指しボーナス
  // (時刻依存) は探索の意味論上無意味かつ非決定的。kernel lookahead は常に spectatorMode=true で
  // 呼び決定論化する (OFF 近似 applyActionForLookahead が move に mana ボーナスを付けないことと整合)。
  // ctx.spectatorMode はゲームレベルの観戦判定であり、探索 lookahead の決定論化とは別概念として分離する。
  const spectatorMode = true;

  // 計画 OBS3-2: double_move カードが手札にあることを実 lookup で確認 (候補生成で除外済の前提)。
  // 未発見なら NEG_INF (?? "" 空文字 fallback は kernel consumeNormalCard を null 化し OFF と
  // 非対称になるため使わない)。
  const dmCard = state.cardState.hand[player].find((c) => c.defId === "double_move");
  if (!dmCard) return NEG_INF;

  const world0 = aiTurnStateToWorldState(state); // root: doubleMove = null
  // Step 1: double_move 発動 (kernel が KernelDoubleMove を cardInstanceId + cost から構築、遅延消費)
  const worldDM = applyTurnAction(
    world0,
    { kind: "playCard", cardInstanceId: dmCard.instanceId, defId: "double_move" },
    { spectatorMode },
  ).world;

  // digest prev (root)。ctx 未渡フォールバックは OFF 版 (computeCardDigest) と同方針。
  const prevDigest =
    ctx.cardDigest ??
    (variant.id === "card-shogi" ? computeCardDigest(state.cardState, state.gameState) : undefined);

  // Step 2: 1 手目候補生成 (move-only)。OFF 同様 heuristic 上位 K 手に絞る。
  const firstMovesAll = getSearchLegalMoves(worldDM.gameState, player, variant);
  if (firstMovesAll.length === 0) return NEG_INF;
  const firstMoves =
    firstMovesAll.length > DOUBLE_MOVE_TOP_K
      ? [...firstMovesAll]
          .sort((a, b) => scoreMoveForOrdering(b) - scoreMoveForOrdering(a))
          .slice(0, DOUBLE_MOVE_TOP_K)
      : firstMovesAll;

  let bestScore = NEG_INF;
  let bestScoreIgnoringTadasute = NEG_INF;

  for (const firstMove of firstMoves) {
    // Issue #235 派生 (Vercel 504 対策): OFF 版と同様、フェーズ予算超過で打ち切り。
    // kernel 経路は combo ごとに applyTurnAction (makeMoveWithEffects = evaluateGameEnd 込み
    // ≈ ms 級) を呼ぶため、ここが 504 の主因だった (実測 1 super-action ≈ 4.3s)。
    if (isActionPhaseTimeUp(ctx)) break;
    const afterFirst = applyTurnAction(worldDM, { kind: "move", move: firstMove }, { spectatorMode });
    const worldF = afterFirst.world;

    // 計画 R3/OBS3-1: 1 手目で終局 (mate 等) なら kernel が gameOver 分岐で turnEnded=true +
    // finalize 済 (world-kernel.ts:258-274)。その局面を直接評価し 2 手目ループを skip
    // (OFF の CurrentRules.applyAction は game-end 評価せず turnEnded=false で続行する非対称、ON 是正)。
    if (afterFirst.turnEnded) {
      const innerDigest =
        prevDigest !== undefined
          ? updateCardDigest(prevDigest, state.cardState, worldF.cardState, worldF.gameState)
          : undefined;
      const raw = evaluate(worldF.gameState, variant, innerDigest);
      const score = player === "sente" ? raw : -raw;
      if (score > bestScoreIgnoringTadasute) bestScoreIgnoringTadasute = score;
      // 1 手目詰みは「タダ捨て」ではないので excludeTadasute に関わらず採用候補。
      if (score > bestScore) bestScore = score;
      continue;
    }

    const secondMoves = getSearchLegalMoves(worldF.gameState, player, variant);
    if (secondMoves.length === 0) continue;
    for (const secondMove of secondMoves) {
      // 504 対策: combo 単位での時間チェック (OFF 版と同方針)。
      if (isActionPhaseTimeUp(ctx)) break;
      const afterSecond = applyTurnAction(worldF, { kind: "move", move: secondMove }, { spectatorMode });
      const worldS = afterSecond.world;
      // 不変条件: 2 手目で turnEnded=true (ターン終了)。
      if (!afterSecond.turnEnded) {
        throw new Error(
          "Invariant violation: double_move 2 手目で turnEnded が false (kernel 経路)",
        );
      }
      // per-combo digest (kernel の worldS.cardState = cost 正確消費 + lazy drawProgress 反映済)。
      const innerDigest =
        prevDigest !== undefined
          ? updateCardDigest(prevDigest, state.cardState, worldS.cardState, worldS.gameState)
          : undefined;
      const raw = evaluate(worldS.gameState, variant, innerDigest);
      const score = player === "sente" ? raw : -raw;
      if (score > bestScoreIgnoringTadasute) bestScoreIgnoringTadasute = score;
      if (excludeTadasute && hasHangingPiece(worldS.gameState, player, variant)) {
        continue;
      }
      if (score > bestScore) bestScore = score;
    }
  }
  if (bestScore === NEG_INF) return bestScoreIgnoringTadasute;
  return bestScore;
}

// =========================================================================
// PR3-3a: TurnAction lookahead 評価 (= 相手 1 ply 最善応答後のスコア)
// =========================================================================
//
// 計画 md docs/plans/issue-193-pr3-3-deep-card-search.md 3.1 章。
//
// 設計:
// - 既存 evaluateAction (depth=0 評価) は move の深い tactical 値が直接出るが、
//   playCard/draw も同じ depth=0 で比較されると move の駒得 +100cp に card の
//   calibration +30〜60cp が負ける構造的非対称が発生 (PR3-1 で校正完了するも残存)。
// - 本関数は各 TurnAction 候補に「相手 1 ply 最善応答 (move-only、O(opp_moves) スキャン)」を
//   加えた lookahead スコアを返す。move 側の見かけ +100cp は相手が取り返すと ±0 に
//   収束、card 側の +50cp が tempo として残ることで card が公平に競争可能に。
// - double_move は既存 searchDoubleMoveSuperAction が 2 手指し後を直接評価しており、
//   lookahead 不要 (むしろ 2 重評価でコストが上がるため delegate)。
//
// 性能配慮:
// - 各 lookahead = O(opp_moves) ≒ 30-50 evaluate 呼び出し
// - 候補数 (60 程度) × 50 = ~3000 evaluate / root。1 evaluate ≒ O(81 squares + small) で
//   既存 findBestMove (深さ 6) の探索コストよりは安価 (depthCompleted への影響軽微)。
// - cardDigest は **PR3-3 C-6 で per-action 更新化** (旧: prev digest 流用)。
//   updateCardDigest (PR3-2 で追加済 API) を使い、action 適用後の cardState 差分のみ
//   再計算。これにより PR3-1 C-3 (死にマナペナルティ) / C-4 (HAND_VALUE_DECAY) が
//   実際にアクション選択へ効くようになる (旧 root スカラー方式では argmax で打ち消されていた)。
//
// 互換性:
// - lookaheadPly=0 で呼ぶと既存 evaluateAction にフォールバック (= 振る舞いキープ)

/**
 * PR3-3 C-6: action 適用後の (gameState, cardState) を計算する純粋関数。
 *
 * lookahead で digest を per-action 更新するために、各 action 種別ごとの状態遷移を集約。
 * - move:        applyMoveForSearch → gameState 変化、cardState は drawProgress[player] += 1 のみ
 * - draw:        gameState 不変、cardState: mana-=DRAW_COST / hand+=1 / drawProgress[player] += 1
 * - playCard trap (no_promote / check_break): gameState 不変、cardState: mana-=cost /
 *                hand-=1 / drawProgress[player] += 1 / trap[player] セット
 * - playCard 通常 (pawn_return / piece_return / double_pawn): simulateCardEffect →
 *                gameState 変化、cardState: mana-=cost / hand-=1 / drawProgress[player] += 1
 * - playCard double_move: null を返す (呼出側が searchDoubleMoveSuperAction に delegate)
 * - 山札枯渇 (draw) / simulateCardEffect 失敗 (mana_up 等の本 PR 対象外カード) も null
 *
 * PR3-3 C-12 (adversarial verify F-1 残課題解消):
 * drawProgress は全 action 種別で +1 加算 (= production の applyTurnEndEffects 等価)。
 * 旧実装は draw のみ =0 リセットしていたが、production の DRAW_CARD は drawProgress を
 * 触らず後続 COMMIT_DRAW → applyTurnEndEffects で +=1 加算する。move/playCard でも
 * applyTurnEndEffects は呼ばれるため +=1 が必要。3 種すべてで +1 統一することで
 * action 間の比較対称性を確保 (production-equivalent な post-action state)。
 */
// Issue #235 S1b: OFF-vs-ON 特性化テスト (kernel-search-equivalence.test.ts) から直接比較するため export。
// production の呼出経路・振る舞いは不変 (export 付与のみ)。
export function applyActionForLookahead(
  state: AiTurnState,
  action: TurnAction,
  player: Player,
): { gameState: GameState; cardState: CardGameState } | null {
  // PR3-3 C-12: 全 action 種別で drawProgress[player] += 1 (production 等価)
  const advancedDrawProgress = {
    ...state.cardState.drawProgress,
    [player]: state.cardState.drawProgress[player] + 1,
  };

  if (action.kind === "move") {
    return {
      gameState: applyMoveForSearch(state.gameState, action.move),
      cardState: {
        ...state.cardState,
        drawProgress: advancedDrawProgress,
      },
    };
  }
  if (action.kind === "draw") {
    if (state.cardState.deck[player].length === 0) return null;
    // 引いたカード自体は handValueDelta = f(hand.length) のみに影響するため、
    // 山札先頭をそのまま hand に追加するだけで digest 計算には十分。
    const drawnCard = state.cardState.deck[player][0];
    return {
      gameState: state.gameState,
      cardState: {
        ...state.cardState,
        mana: {
          ...state.cardState.mana,
          [player]: state.cardState.mana[player] - DRAW_COST,
        },
        hand: {
          ...state.cardState.hand,
          [player]: [...state.cardState.hand[player], drawnCard],
        },
        deck: {
          ...state.cardState.deck,
          [player]: state.cardState.deck[player].slice(1),
        },
        // PR3-3 C-12: production は drawProgress 0 リセットせず +=1 (DRAW_CARD は触らず、
        // 後続 applyTurnEndEffects(drawer) で current+1。canDraw は <AUTO_DRAW_INTERVAL-1=4
        // で gate されるため、手動ドロー後の drawProgress は最大 5)。
        drawProgress: advancedDrawProgress,
      },
    };
  }
  // playCard
  if (action.defId === "double_move") return null; // delegate
  const def = CARD_DEFS[action.defId];
  if (!def) return null; // 未知 cardId は安全側で除外
  const newHand = state.cardState.hand[player].filter(
    (c) => c.instanceId !== action.cardInstanceId,
  );
  const baseCardState: CardGameState = {
    ...state.cardState,
    mana: {
      ...state.cardState.mana,
      [player]: state.cardState.mana[player] - def.cost,
    },
    hand: { ...state.cardState.hand, [player]: newHand },
    drawProgress: advancedDrawProgress,
  };
  if (action.defId === "no_promote" || action.defId === "check_break") {
    return {
      gameState: state.gameState,
      cardState: {
        ...baseCardState,
        trap: {
          ...baseCardState.trap,
          [player]: {
            instanceId: action.cardInstanceId,
            defId: action.defId,
            owner: player,
          },
        },
      },
    };
  }
  // 通常 (pawn_return / piece_return / double_pawn): 盤面変化を simulateCardEffect で適用
  const nextGameState = simulateCardEffect(
    state.gameState,
    player,
    action.defId,
    action.target ?? null,
  );
  if (!nextGameState) return null;
  return { gameState: nextGameState, cardState: baseCardState };
}

// =========================================================================
// Issue #235 S1b: useKernelSearch ON 経路の変換ヘルパ
// =========================================================================
// applyActionForLookahead (上、OFF 近似) の kernel 版。useKernelSearch フラグが ON のとき
// evaluateActionWithLookahead が本関数を呼び、L0 カーネル applyTurnAction で正確な遷移を得る。
// OFF との差分は docs/plans/issue-235-s1b-ai-wiring.md §3 (すべて「ON が production 等価」方向)。
// 戻り値型は applyActionForLookahead と同一 ({gameState, cardState}) = 後段 updateCardDigest /
// getOpponentResponseScore に無改変で流れる (events は AI 評価で不要のため捨象)。

// AiTurnState → WorldState 変換 (純粋)。doubleMove は optional な cardInstance/cardCost を
// kernel 必須型へ narrowing (S1b 経路では root doubleMove=null のため fallback は保険)。
// Issue #235 S1b: 特性化テストから比較するため export (純粋関数)。
export function aiTurnStateToWorldState(state: AiTurnState): WorldState {
  const dm = state.doubleMove;
  return {
    gameState: state.gameState,
    cardState: state.cardState,
    doubleMove:
      dm === null
        ? null
        : {
            active: dm.active,
            movesLeft: dm.movesLeft,
            cardInstance: dm.cardInstance ?? { instanceId: "", defId: "double_move" },
            cardCost: dm.cardCost ?? CARD_DEFS["double_move"].cost,
          },
  };
}

// Issue #235 S1b: 特性化テストから OFF (applyActionForLookahead) と比較するため export。
export function applyTurnActionForLookahead(
  state: AiTurnState,
  action: TurnAction,
  variant: RuleVariant,
  spectatorMode: boolean,
): { gameState: GameState; cardState: CardGameState } | null {
  // standard variant は kernel 非経由 (防御的二重ガード、計画 R6)。
  if (variant.id !== "card-shogi") return null;
  // double_move は searchDoubleMoveSuperAction に delegate (呼出側で分岐済、ここは保険)。
  if (action.kind === "playCard" && action.defId === "double_move") return null;
  const world = aiTurnStateToWorldState(state);
  const result = applyTurnAction(world, action, { spectatorMode });
  return { gameState: result.world.gameState, cardState: result.world.cardState };
}

function getOpponentResponseScore(
  stateAfterOurAction: GameState,
  ourPlayer: Player,
  variant: RuleVariant,
  cardDigest: CardDigest | undefined,
): number {
  const opp: Player = ourPlayer === "sente" ? "gote" : "sente";
  const oppMoves = getSearchLegalMoves(stateAfterOurAction, opp, variant);
  if (oppMoves.length === 0) {
    // 相手の合法手なし (詰み or stalemate)。terminal 局面として通常評価値を返す。
    const raw = evaluate(stateAfterOurAction, variant, cardDigest);
    return ourPlayer === "sente" ? raw : -raw;
  }
  // 相手は our perspective score を最小化する手を選ぶ (= 我々を最も不利にする手)
  let worstForUs = Number.POSITIVE_INFINITY;
  for (const oppMove of oppMoves) {
    const next = applyMoveForSearch(stateAfterOurAction, oppMove);
    const raw = evaluate(next, variant, cardDigest);
    const ourScore = ourPlayer === "sente" ? raw : -raw;
    if (ourScore < worstForUs) worstForUs = ourScore;
  }
  return worstForUs;
}

export function evaluateActionWithLookahead(
  state: AiTurnState,
  action: TurnAction,
  player: Player,
  variant: RuleVariant,
  ctx?: SearchContext,
  excludeTadasute = false,
  lookaheadPly: 0 | 1 = 1,
): number {
  if (lookaheadPly === 0) {
    return evaluateAction(state, action, player, variant, ctx, excludeTadasute);
  }
  // double_move は super-action 内部探索が既に 2 手後 (= 1 ply 以上) を評価済のため delegate。
  // PR3-3 C-3: excludeTadasute を伝播して 2 手目タダ捨て組合せを除外させる。
  if (action.kind === "playCard" && action.defId === "double_move") {
    return searchDoubleMoveSuperAction(state, player, variant, ctx, excludeTadasute);
  }
  // Issue #235 S1b: useKernelSearch ON で kernel 経路 (applyTurnAction) に分岐。OFF は旧近似のまま。
  // Issue #235 S1d (decision i): 探索 lookahead は常に決定論化 (spectatorMode=true)。仮想局面評価では
  // wall-clock 早指しボーナスは無意味かつ非決定のため game-level spectatorMode に依存させない。
  const applied = ctx?.useKernelSearch
    ? applyTurnActionForLookahead(state, action, variant, true)
    : applyActionForLookahead(state, action, player);
  if (!applied) return Number.NEGATIVE_INFINITY;

  // 通常カードのタダ捨て除外 (action 適用後の盤面で判定、既存 evaluateAction 同型)
  if (
    excludeTadasute &&
    action.kind === "playCard" &&
    action.defId !== "no_promote" &&
    action.defId !== "check_break" &&
    cardResultIntroducesTadasute(
      state.gameState,
      applied.gameState,
      player,
      variant,
    )
  ) {
    return Number.NEGATIVE_INFINITY;
  }

  // PR3-3 C-6: per-action cardDigest 更新 (F-1 解消)。
  // 旧実装は prev (root) digest を流用していたため、全候補で digest が同値 → argmax で
  // C-3 (死にマナ) / C-4 (handValue) の効果が打ち消されて inert になっていた。
  // updateCardDigest (PR3-2 API) で applied.cardState への遷移を反映した digest を生成し、
  // opp scan の eval / final eval に伝播することで C-3/C-4 が actually に効くようになる。
  // - draw / playCard / trap は applied.cardState (mana / hand / drawProgress / trap) が変化
  // - move も PR3-3 C-12 で applied.cardState.drawProgress[player] += 1 が入るため変化する。
  //   旧実装の「move は updateCardDigest 呼出 skip」最適化は廃止 (drawProgress 差分のみのケース
  //   では updateCardDigest 内で handChanged=false により exp() 呼出 skip されるため軽量)。
  // - card-shogi で prev digest が未渡 (ctx 未指定のテスト/エッジケース) でも適切に動くよう、
  //   その場合は computeCardDigest(state.cardState) でフォールバック生成 (O(1)+exp×2 のみ)。
  //   production は engine.ts で root digest が常に渡るためフォールバック発火しない。
  // - standard variant (variant.id !== "card-shogi") では digest は意味を持たないため undefined のまま
  let prevDigest = ctx?.cardDigest;
  if (prevDigest === undefined && variant.id === "card-shogi") {
    prevDigest = computeCardDigest(state.cardState, state.gameState);
  }
  const newDigest =
    prevDigest !== undefined
      ? updateCardDigest(prevDigest, state.cardState, applied.cardState, applied.gameState)
      : prevDigest;

  const oppScore = getOpponentResponseScore(
    applied.gameState,
    player,
    variant,
    newDigest,
  );

  // draw: digest は post-draw 状態 (mana-2 / hand+1 / drawProgress=0) を反映するが、
  // getDrawValue は「ドローを引き起こすヒューリスティック encouragement」で独立。
  // digest 経由の値 (mana 変化 -20cp + hand 増 +2cp + drawProgress reset 等で実質負方向)
  // だけでは draw が選ばれないため、getDrawValue を加算して push する設計。
  if (action.kind === "draw") {
    return oppScore + getDrawValue(state.gameState, player, state.cardState);
  }

  // PR3-3 C-6 / S3b: トラップ系 (no_promote / check_break) の価値は newDigest.trapValueDelta に
  // 反映済 (updateCardDigest が applied.gameState から valueModel で局面依存値を precompute、
  // opp scan の各 evaluate に乗る)。ここでの明示加算は不要 (重複加算回避)。
  return oppScore;
}
