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
// Issue #176 timeout-fix: hard stop 4.0 秒以内に揃え、Vercel maxDuration=10 と
// blunder guard 200ms budget (fix-PR2 で導入予定) を加味して以下に確定。
// (旧 PR #185: beginner 1000 / intermediate 2000 / advanced 4000 / expert 4500、
//  expert で hard stop 4.0 秒を踏み超していたため本番で 504 多発)
//
// PR #185 Stage C bench で expert/midgame_30 max が 3.8s に張り付く =
// 既存実装でも 3.8s で打ち切られていたため、3.5s でも結果は近い。
// fix-PR2 で導入予定の 200ms blunder guard budget と合わせて「探索 3.3s +
// blunder guard 200ms = 計 3.5s」という二重保護も成立。
export const DIFFICULTY_PARAMS: Record<Difficulty, DifficultyParams> = {
  beginner: {
    maxDepth: 3,
    timeLimitMs: 800,      // 旧 1000ms。0.8s 程度で計画書 issue-176.md L67 目安に整合
    addNoise: 0.50,        // 高ノイズ: 半分の確率でランダムな手
    useBook: false,        // 定石なし: 自然な弱さを演出
    nearEqualThreshold: 200, // 広い閾値: 大きくブレる
  },
  intermediate: {
    maxDepth: 6,
    timeLimitMs: 1800,     // 旧 2000ms。
    addNoise: 0.10,        // 10%のノイズ
    useBook: true,
    nearEqualThreshold: 80, // 中程度の閾値
  },
  advanced: {
    maxDepth: 16,          // 反復深化で到達できる限り深く
    timeLimitMs: 3000,     // 旧 4000ms。hard stop 4s 以内、余白拡大
    addNoise: 0,           // ノイズなし: ブランダー排除
    useBook: true,
    nearEqualThreshold: 0, // 常に最善手を選択
  },
  expert: {
    maxDepth: 24,          // 反復深化で到達できる限り深く
    timeLimitMs: 3500,     // 旧 4500ms。Stage C bench で max 3.8s 観測 = 3.5s 切詰可
    addNoise: 0,           // ノイズなし: ブランダー排除
    useBook: true,
    nearEqualThreshold: 0, // 常に最善手を選択
  },
};

// Issue #176: 旧 calculateAiMove は完全置換。findBestMoveWithStats (本ファイル末尾) を使う。

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
// 旧 calculateAiMove は Stage B で削除済み。
export interface FindBestMoveOptions {
  signal?: AbortSignal;
  // Issue #193 / PR1a: 観戦モード (CPU vs CPU) で timeLimitMs を 1500ms 等に短縮するための override。
  // 未指定時は DIFFICULTY_PARAMS[difficulty].timeLimitMs (既存挙動) を使用。
  timeLimitMs?: number;
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
  // Issue #193: options.timeLimitMs が指定されていれば override (観戦モード用)、なければ既存挙動
  const effectiveTimeLimitMs = options.timeLimitMs ?? params.timeLimitMs;
  const ctx = createSearchContext({
    timeLimitMs: effectiveTimeLimitMs,
    signal: options.signal,
  });

  // 定石ブック (序盤のみ)。
  // Issue #193 / PR1a: card-shogi では openingBook lookup を無効化。
  // ドロー/カード操作で board hash がズレるため定石が機能しないこと、および
  // 振る舞いキープ例外として明示的に「card-shogi の両者合計 30 ply (= 各 15 手)
  // で意図的振る舞い変更」を許容する。MAX_BOOK_MOVES * 2 は両者合計手数 (ply) で、
  // MAX_BOOK_MOVES = 15 (各プレイヤー側の手数上限)。
  const useBookForVariant = params.useBook && variant.id === "standard";
  let usedBook = false;
  let bookMove: Move | null = null;
  if (useBookForVariant && state.moveCount < MAX_BOOK_MOVES * 2) {
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
      timeLimitMs: effectiveTimeLimitMs,
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
