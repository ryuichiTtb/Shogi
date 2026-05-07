import type { Difficulty, GameState, Move, Player, RuleVariant } from "../types";
import { STANDARD_VARIANT } from "../variants/standard";
import { findBestMove } from "./search";
import {
  createSearchContext,
  finalizeStats,
  type SearchStats,
} from "./search-context";
import { evaluate, getLeastAttackerValue } from "./evaluate";
import { getBookMove, MAX_BOOK_MOVES } from "./openingBook";
import { getFullLegalMoves, isSquareAttackedByFast } from "../moves";
import { applyMoveForSearch } from "../board";

export interface DifficultyParams {
  maxDepth: number;
  timeLimitMs: number;
  addNoise: number;
  useBook: boolean;
  nearEqualThreshold: number; // 接戦時ランダム選択の閾値（cp）
}

// 難易度別探索パラメータ。
// Issue #176: hard stop は 4000ms 以内に収める方針。Phase 0 ベンチで現行値の
// expert 4500ms / advanced 4000ms が timeLimitMs を最大 7s 級まで踏み抜く挙動が
// 確認されたため、deadline 厳格化 (Stage A) と組み合わせて以下に揃える。
// 仮置きの目安。Stage C 完了後の bench 結果でさらに微調整する。
export const DIFFICULTY_PARAMS: Record<Difficulty, DifficultyParams> = {
  beginner: {
    maxDepth: 3,
    timeLimitMs: 1000,
    addNoise: 0.50,       // 高ノイズ: 半分の確率でランダムな手
    useBook: false,        // 定石なし: 自然な弱さを演出
    nearEqualThreshold: 200, // 広い閾値: 大きくブレる
  },
  intermediate: {
    maxDepth: 6,
    timeLimitMs: 2000,
    addNoise: 0.10,       // 10%のノイズ
    useBook: true,
    nearEqualThreshold: 80, // 中程度の閾値
  },
  advanced: {
    maxDepth: 16,          // 反復深化で到達できる限り深く
    timeLimitMs: 4000,     // 4秒（品質優先）
    addNoise: 0,           // ノイズなし: ブランダー排除
    useBook: true,
    nearEqualThreshold: 0,  // 常に最善手を選択
  },
  expert: {
    maxDepth: 24,          // 反復深化で到達できる限り深く
    timeLimitMs: 4500,     // 4.5秒（品質最優先）
    addNoise: 0,           // ノイズなし: ブランダー排除
    useBook: true,
    nearEqualThreshold: 0,  // 常に最善手を選択
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
  const bestMove = findBestMove(state, player, {
    maxDepth: params.maxDepth,
    timeLimitMs: params.timeLimitMs,
    addNoise: params.addNoise,
    nearEqualThreshold: params.nearEqualThreshold,
  }, variant);

  // ブランダーガード（上級・超上級専用）
  // 探索結果の最終チェック: 選択した手を指した後に自駒がタダ取りされないか確認
  if (
    (difficulty === "advanced" || difficulty === "expert") &&
    bestMove !== null
  ) {
    const nextState = applyMoveForSearch(state, bestMove);
    if (hasHangingPiece(nextState, player, variant)) {
      // ブランダーの可能性 → 全合法手から安全な手を選び直す
      const legalMoves = getFullLegalMoves(state, player, variant);
      const safeMoves = legalMoves.filter((move) => {
        const ns = applyMoveForSearch(state, move);
        return !hasHangingPiece(ns, player, variant);
      });

      if (safeMoves.length > 0) {
        // 安全な手の中から静的評価で最善手を選択
        let bestSafeScore = -Infinity;
        let bestSafeMove = safeMoves[0];
        for (const move of safeMoves) {
          const ns = applyMoveForSearch(state, move);
          const rawScore = evaluate(ns, variant);
          const score = player === "sente" ? rawScore : -rawScore;
          if (score > bestSafeScore) {
            bestSafeScore = score;
            bestSafeMove = move;
          }
        }
        return bestSafeMove;
      }
      // 安全な手がない場合（全手がタダ取りされる場合）は元の最善手を返す
    }
  }

  return bestMove;
}

// ブランダーガード用: 駒の価値テーブル
const BLUNDER_PIECE_VALUES: Record<string, number> = {
  pawn: 100, lance: 300, knight: 400, silver: 500, gold: 600,
  bishop: 800, rook: 1000, promoted_pawn: 600, promoted_lance: 600,
  promoted_knight: 600, promoted_silver: 600, promoted_bishop: 1100,
  promoted_rook: 1300, king: 10000,
};

// ブランダーガード: 指した後に自駒がタダ取りまたは損な交換にさらされるかチェック
function hasHangingPiece(
  state: GameState,
  player: Player,
  variant: RuleVariant,
  minValue: number = 300
): boolean {
  const board = state.board;
  const { rows, cols } = variant.boardSize;
  const opponent: Player = player === "sente" ? "gote" : "sente";

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const piece = board[row][col];
      if (!piece || piece.owner !== player || piece.type === "king") continue;

      const value = BLUNDER_PIECE_VALUES[piece.type] ?? 0;
      if (value < minValue) continue;

      const pos = { row, col };
      if (isSquareAttackedByFast(board, pos, opponent, variant.boardSize)) {
        if (!isSquareAttackedByFast(board, pos, player, variant.boardSize)) {
          return true; // 攻撃されているが守られていない → タダ取り
        }
        // 守られているが、最安攻撃駒との交換で損する場合もブランダー
        const leastAttacker = getLeastAttackerValue(board, pos, opponent, variant.boardSize);
        if (leastAttacker > 0 && (value - leastAttacker) >= minValue) {
          return true; // 損な交換（例: 飛車を歩で攻撃されている）
        }
      }
    }
  }
  return false;
}

// 難易度の表示名
export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  beginner: "初級",
  intermediate: "中級",
  advanced: "上級",
  expert: "超上級",
};

// Issue #176: Route Handler / hooks から呼ぶ統一 API。
// SearchContext を内部生成し、deadline 付き探索を行う。stats を返すので
// route 側で stoppedBy / depthCompleted / nodes をログに残せる。
//
// 旧 calculateAiMove は Stage B で削除予定。Stage A では並存させ、
// 段階的に Route Handler 経由へ移行する。
export interface FindBestMoveOptions {
  signal?: AbortSignal;
}

export interface FindBestMoveResult {
  move: Move | null;
  stats: SearchStats;
}

export function findBestMoveWithStats(
  state: GameState,
  player: Player,
  difficulty: Difficulty,
  variant: RuleVariant = STANDARD_VARIANT,
  options: FindBestMoveOptions = {},
): FindBestMoveResult {
  const params = DIFFICULTY_PARAMS[difficulty];
  const ctx = createSearchContext({
    timeLimitMs: params.timeLimitMs,
    signal: options.signal,
  });

  // 定石ブック (序盤のみ)
  let usedBook = false;
  let bookMove: Move | null = null;
  if (params.useBook && state.moveCount < MAX_BOOK_MOVES * 2) {
    const candidate = getBookMove(state, player);
    if (candidate) {
      const legalMoves = getFullLegalMoves(state, player, variant);
      const isLegal = legalMoves.some(
        (m) =>
          m.type === candidate.type &&
          m.to.row === candidate.to.row &&
          m.to.col === candidate.to.col &&
          (candidate.type === "drop"
            ? m.dropPiece === candidate.dropPiece
            : m.from?.row === candidate.from?.row &&
              m.from?.col === candidate.from?.col &&
              (m.promote ?? false) === (candidate.promote ?? false))
      );
      if (isLegal) {
        bookMove = candidate;
        usedBook = true;
      }
    }
  }

  if (bookMove) {
    return {
      move: bookMove,
      stats: finalizeStats(ctx, { usedBook: true, usedFallback: false }),
    };
  }

  // 探索
  const bestMove = findBestMove(
    state,
    player,
    {
      maxDepth: params.maxDepth,
      timeLimitMs: params.timeLimitMs,
      addNoise: params.addNoise,
      nearEqualThreshold: params.nearEqualThreshold,
    },
    variant,
    ctx,
  );

  // depth 1 すら完了しなかった場合の server fallback (合法手の先頭を返す)。
  // Issue #176: client 側 fallback は持たない方針なので、ここで必ず非 null を返したい。
  let move = bestMove;
  let usedFallback = false;
  if (move === null) {
    const legal = getFullLegalMoves(state, player, variant);
    if (legal.length > 0) {
      move = legal[0];
      usedFallback = true;
    }
  }

  // ブランダーガード (advanced / expert のみ、抑制版)。
  // Issue #176: 戦術的駒捨てを潰すリスクがあるが、Stage A では現行挙動を維持する。
  // Phase 4 (PR 2) で抑制ロジックを再設計する。
  if (
    !usedFallback &&
    move !== null &&
    (difficulty === "advanced" || difficulty === "expert")
  ) {
    const nextState = applyMoveForSearch(state, move);
    if (hasHangingPiece(nextState, player, variant)) {
      const legalMoves = getFullLegalMoves(state, player, variant);
      const safeMoves = legalMoves.filter((m) => {
        const ns = applyMoveForSearch(state, m);
        return !hasHangingPiece(ns, player, variant);
      });
      if (safeMoves.length > 0) {
        let bestSafeScore = -Infinity;
        let bestSafeMove = safeMoves[0];
        for (const m of safeMoves) {
          const ns = applyMoveForSearch(state, m);
          const rawScore = evaluate(ns, variant);
          const score = player === "sente" ? rawScore : -rawScore;
          if (score > bestSafeScore) {
            bestSafeScore = score;
            bestSafeMove = m;
          }
        }
        move = bestSafeMove;
      }
    }
  }

  return {
    move,
    stats: finalizeStats(ctx, { usedBook, usedFallback }),
  };
}
