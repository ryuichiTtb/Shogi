import type { GameState, Player, RuleVariant } from "../types";
import { STANDARD_VARIANT } from "../variants/standard";
import { findKing, isInCheck } from "../moves";

// 局面評価関数
// 正の値 = 先手有利、負の値 = 後手有利

// 駒の価値テーブル（盤上）
const PIECE_VALUES: Record<string, number> = {
  pawn: 100,
  lance: 300,
  knight: 400,
  silver: 500,
  gold: 600,
  bishop: 800,
  rook: 1000,
  promoted_pawn: 600,
  promoted_lance: 600,
  promoted_knight: 600,
  promoted_silver: 600,
  promoted_bishop: 1100,
  promoted_rook: 1300,
  king: 10000,
};

// 手駒の価値（盤上より少し高い - 柔軟性のため）
const HAND_PIECE_VALUES: Record<string, number> = {
  pawn: 110,
  lance: 330,
  knight: 440,
  silver: 550,
  gold: 660,
  bishop: 880,
  rook: 1100,
};

// 配置評価テーブル（先手視点、row=0が前線/敵陣奥, row=8が自陣奥）

// 歩兵の配置ボーナス
const PAWN_PST: number[][] = [
  [30, 30, 30, 30, 30, 30, 30, 30, 30],
  [20, 20, 20, 20, 20, 20, 20, 20, 20],
  [10, 10, 10, 10, 10, 10, 10, 10, 10],
  [ 5,  5,  5,  5,  5,  5,  5,  5,  5],
  [ 0,  0,  0,  0,  0,  0,  0,  0,  0],
  [-5, -5, -5, -5, -5, -5, -5, -5, -5],
  [ 0,  0,  0,  0,  0,  0,  0,  0,  0],
  [ 0,  0,  0,  0,  0,  0,  0,  0,  0],
  [ 0,  0,  0,  0,  0,  0,  0,  0,  0],
];

// 飛車: 中央制圧・前進ボーナス
const ROOK_PST: number[][] = [
  [15, 10, 10, 10, 15, 10, 10, 10, 15],
  [15, 10, 10, 10, 15, 10, 10, 10, 15],
  [10,  5,  5,  5, 10,  5,  5,  5, 10],
  [ 5,  5,  5,  5, 10,  5,  5,  5,  5],
  [ 5,  5,  5,  5, 10,  5,  5,  5,  5],
  [ 0,  0,  0,  0,  5,  0,  0,  0,  0],
  [ 0,  0,  0,  0,  5,  0,  0,  0,  0],
  [ 0,  0,  0,  0,  0,  0,  0,  0,  0],
  [ 0,  0,  0,  0,  0,  0,  0,  0,  0],
];

// 角行: 対角線制圧
const BISHOP_PST: number[][] = [
  [ 0,  5,  0,  5,  0,  5,  0,  5,  0],
  [ 5,  5,  5,  5,  5,  5,  5,  5,  5],
  [ 0,  5, 10,  5,  0,  5, 10,  5,  0],
  [ 5,  5,  5, 10,  5, 10,  5,  5,  5],
  [ 0,  5,  0,  5, 15,  5,  0,  5,  0],
  [ 5,  5,  0,  5,  5,  5,  0,  5,  5],
  [ 0,  5,  0,  5,  0,  5,  0,  5,  0],
  [ 5,  0,  5,  0,  5,  0,  5,  0,  5],
  [ 0,  0,  0,  0,  0,  0,  0,  0,  0],
];

// 金将: 玉周辺守備
const GOLD_PST: number[][] = [
  [ 0,  0,  0,  5,  0,  5,  0,  0,  0],
  [ 0,  5,  5,  5,  5,  5,  5,  5,  0],
  [ 0,  5, 10,  5,  5,  5, 10,  5,  0],
  [ 0,  0,  5, 10, 10, 10,  5,  0,  0],
  [ 0,  0,  5,  5, 10,  5,  5,  0,  0],
  [ 0,  0,  0,  5,  5,  5,  0,  0,  0],
  [ 0,  0,  0,  0,  5,  0,  0,  0,  0],
  [ 0,  0,  0,  0,  0,  0,  0,  0,  0],
  [ 0,  0,  0,  0,  0,  0,  0,  0,  0],
];

// 銀将: 玉周辺守備 + 攻め参加
const SILVER_PST: number[][] = [
  [ 0,  0,  5,  5,  5,  5,  5,  0,  0],
  [ 0,  5,  5,  5,  5,  5,  5,  5,  0],
  [ 0,  5, 10,  5,  5,  5, 10,  5,  0],
  [ 0,  5,  5, 10,  5, 10,  5,  5,  0],
  [ 0,  5,  5,  5, 10,  5,  5,  5,  0],
  [ 0,  0,  5,  5,  5,  5,  5,  0,  0],
  [ 0,  0,  0,  5,  5,  5,  0,  0,  0],
  [ 0,  0,  0,  0,  0,  0,  0,  0,  0],
  [ 0,  0,  0,  0,  0,  0,  0,  0,  0],
];

// 桂馬: 後段ペナルティ、前進ボーナス
const KNIGHT_PST: number[][] = [
  [  0,  5, 10, 10, 10, 10, 10,  5,  0],
  [  0,  5, 10, 15, 15, 15, 10,  5,  0],
  [  0,  5,  5, 10, 10, 10,  5,  5,  0],
  [  0,  5,  5,  5,  5,  5,  5,  5,  0],
  [  0,  0,  5,  5,  5,  5,  5,  0,  0],
  [  0,  0,  0,  0,  0,  0,  0,  0,  0],
  [-10,-10,-10,-10,-10,-10,-10,-10,-10],
  [-15,-15,-15,-15,-15,-15,-15,-15,-15],
  [-20,-20,-20,-20,-20,-20,-20,-20,-20],
];

// 香車: 前進ボーナス
const LANCE_PST: number[][] = [
  [20, 20, 20, 20, 20, 20, 20, 20, 20],
  [15, 15, 15, 15, 15, 15, 15, 15, 15],
  [10, 10, 10, 10, 10, 10, 10, 10, 10],
  [ 5,  5,  5,  5,  5,  5,  5,  5,  5],
  [ 0,  0,  0,  0,  0,  0,  0,  0,  0],
  [-5, -5, -5, -5, -5, -5, -5, -5, -5],
  [-5, -5, -5, -5, -5, -5, -5, -5, -5],
  [ 0,  0,  0,  0,  0,  0,  0,  0,  0],
  [ 0,  0,  0,  0,  0,  0,  0,  0,  0],
];

// 玉: 囲い位置ボーナス（左右どちらかの端に寄る）
const KING_PST: number[][] = [
  [-30,-40,-40,-50,-50,-50,-40,-40,-30],
  [-30,-40,-40,-50,-50,-50,-40,-40,-30],
  [-30,-40,-40,-50,-50,-50,-40,-40,-30],
  [-30,-40,-40,-50,-50,-50,-40,-40,-30],
  [-20,-30,-30,-40,-40,-40,-30,-30,-20],
  [-10,-20,-20,-30,-30,-30,-20,-20,-10],
  [ 20, 20,  0,  0,  0,  0,  0, 20, 20],
  [ 20, 30, 10,  0,  0,  0, 10, 30, 20],
  [ 20, 30, 10,  0,  0,  0, 10, 30, 20],
];

// 成り駒（金将と同等の動き）のPST - 前進ボーナスを持つ
const PROMOTED_MINOR_PST: number[][] = [
  [10, 10, 10, 10, 15, 10, 10, 10, 10],
  [ 5,  5,  5,  5, 10,  5,  5,  5,  5],
  [ 5,  5,  5,  5,  5,  5,  5,  5,  5],
  [ 5,  5,  5,  5,  5,  5,  5,  5,  5],
  [ 0,  0,  0,  0,  5,  0,  0,  0,  0],
  [ 0,  0,  0,  0,  0,  0,  0,  0,  0],
  [ 0,  0,  0,  0,  0,  0,  0,  0,  0],
  [ 0,  0,  0,  0,  0,  0,  0,  0,  0],
  [ 0,  0,  0,  0,  0,  0,  0,  0,  0],
];

// 龍王: 飛車の成り - より強力な前進ボーナス
const PROMOTED_ROOK_PST: number[][] = [
  [25, 20, 20, 20, 25, 20, 20, 20, 25],
  [20, 15, 15, 15, 20, 15, 15, 15, 20],
  [15, 10, 10, 10, 15, 10, 10, 10, 15],
  [10,  5,  5,  5, 15,  5,  5,  5, 10],
  [ 5,  5,  5,  5, 15,  5,  5,  5,  5],
  [ 0,  0,  0,  0, 10,  0,  0,  0,  0],
  [ 0,  0,  0,  0,  5,  0,  0,  0,  0],
  [ 0,  0,  0,  0,  0,  0,  0,  0,  0],
  [ 0,  0,  0,  0,  0,  0,  0,  0,  0],
];

// 龍馬: 角行の成り
const PROMOTED_BISHOP_PST: number[][] = [
  [10, 10, 10, 10, 10, 10, 10, 10, 10],
  [10, 15, 10, 10, 15, 10, 10, 15, 10],
  [10, 10, 20, 10, 10, 10, 20, 10, 10],
  [10, 10, 10, 20, 10, 20, 10, 10, 10],
  [10, 10, 10, 10, 25, 10, 10, 10, 10],
  [10, 10, 10, 10, 10, 10, 10, 10, 10],
  [10, 10, 10, 10, 10, 10, 10, 10, 10],
  [ 5,  5,  5,  5,  5,  5,  5,  5,  5],
  [ 0,  0,  0,  0,  0,  0,  0,  0,  0],
];

// PSTマップ
const PST_MAP: Record<string, number[][] | undefined> = {
  pawn: PAWN_PST,
  rook: ROOK_PST,
  bishop: BISHOP_PST,
  gold: GOLD_PST,
  silver: SILVER_PST,
  knight: KNIGHT_PST,
  lance: LANCE_PST,
  king: KING_PST,
  promoted_pawn: PROMOTED_MINOR_PST,
  promoted_lance: PROMOTED_MINOR_PST,
  promoted_knight: PROMOTED_MINOR_PST,
  promoted_silver: PROMOTED_MINOR_PST,
  promoted_rook: PROMOTED_ROOK_PST,
  promoted_bishop: PROMOTED_BISHOP_PST,
};

// 玉の安全度評価（玉の周辺に味方の駒がいるか）
function evaluateKingSafety(
  state: GameState,
  player: Player,
  variant: RuleVariant
): number {
  const kingPos = findKing(state.board, player, variant.boardSize);
  if (!kingPos) return -5000;

  let safety = 0;
  const { rows, cols } = variant.boardSize;

  // 玉周辺の味方駒の数をカウント
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = kingPos.row + dr;
      const c = kingPos.col + dc;
      if (r < 0 || r >= rows || c < 0 || c >= cols) continue;

      const piece = state.board[r][c];
      if (piece && piece.owner === player) {
        const dist = Math.max(Math.abs(dr), Math.abs(dc));
        // 金・銀・成り小駒は守備評価を高める
        const isDefensePiece = ["gold", "silver", "promoted_pawn", "promoted_lance", "promoted_knight", "promoted_silver"].includes(piece.type);
        const baseBonus = dist === 1 ? 20 : 10;
        safety += isDefensePiece ? baseBonus * 1.5 : baseBonus;
      }
    }
  }

  // 王手されている場合は大きなペナルティ
  if (isInCheck(state, player, variant)) {
    safety -= 200;
  }

  return safety;
}

// メイン評価関数
export function evaluate(
  state: GameState,
  variant: RuleVariant = STANDARD_VARIANT
): number {
  if (state.status === "checkmate") {
    return state.winner === "sente" ? 100000 : -100000;
  }
  if (state.status !== "active") return 0;

  let score = 0;
  const rows = variant.boardSize.rows;

  // 盤上の駒の評価
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < variant.boardSize.cols; col++) {
      const piece = state.board[row][col];
      if (!piece) continue;

      const value = PIECE_VALUES[piece.type] ?? 100;
      const sign = piece.owner === "sente" ? 1 : -1;
      score += sign * value;

      // 配置ボーナス（全駒種）
      const pst = PST_MAP[piece.type];
      if (pst) {
        // 先手: row=0が前線、後手: 盤面反転してrow=0が前線
        const posRow = piece.owner === "sente" ? row : rows - 1 - row;
        const posBonus = pst[posRow]?.[col] ?? 0;
        score += sign * posBonus;
      }
    }
  }

  // 手駒の評価
  for (const [type, count] of Object.entries(state.hand.sente)) {
    score += (HAND_PIECE_VALUES[type] ?? 100) * (count ?? 0);
  }
  for (const [type, count] of Object.entries(state.hand.gote)) {
    score -= (HAND_PIECE_VALUES[type] ?? 100) * (count ?? 0);
  }

  // 玉の安全度
  score += evaluateKingSafety(state, "sente", variant);
  score -= evaluateKingSafety(state, "gote", variant);

  return score;
}

// 評価値に基づく手のソート（alpha-beta探索のための手の順序付け）
export function scoreMoveForOrdering(move: import("../types").Move): number {
  let score = 0;

  // 取り駒優先
  if (move.captured) {
    score += PIECE_VALUES[move.captured] ?? 0;
    score -= (PIECE_VALUES[move.piece] ?? 0) * 0.1;
  }

  // 成り優先
  if (move.promote) score += 200;

  return score;
}
