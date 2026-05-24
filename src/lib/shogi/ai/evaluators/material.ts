import type { GameState, RuleVariant } from "../../types";
import { PST_MAP } from "./pst";

// 盤上駒得評価 (material + PST)。
//
// Issue #193 / PR2: evaluate.ts にインライン展開されていた盤上駒ループを
// 純粋関数として抽出。分離前は evaluate / evaluateWithBreakdown に同一ロジックが
// 2 重展開されていたため、本関数を両者から呼ぶことで計算順序・係数・丸めの
// 完全一致を構造的に保証する (evaluate-equivalence.test.ts で担保)。

// 駒の価値テーブル（盤上）
export const PIECE_VALUES: Record<string, number> = {
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

// 盤上の駒の評価 (駒価値 + 配置ボーナス)。先手 +、後手 -。
export function computeMaterial(state: GameState, variant: RuleVariant): number {
  const rows = variant.boardSize.rows;
  let material = 0;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < variant.boardSize.cols; col++) {
      const piece = state.board[row][col];
      if (!piece) continue;

      const value = PIECE_VALUES[piece.type] ?? 100;
      const sign = piece.owner === "sente" ? 1 : -1;
      material += sign * value;

      // 配置ボーナス（全駒種）
      const pst = PST_MAP[piece.type];
      if (pst) {
        const posRow = piece.owner === "sente" ? row : rows - 1 - row;
        const posBonus = pst[posRow]?.[col] ?? 0;
        material += sign * posBonus;
      }
    }
  }

  return material;
}
