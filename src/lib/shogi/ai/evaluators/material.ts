import type { GameState, Player, RuleVariant } from "../../types";
import type { PieceMark } from "../../cards/types";
import { PIECE_DEF_MAP } from "../../variants/standard";
import { isSquareMarked } from "../../cards/effects";
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

// Issue #235 S4d-3 (epic §6 7.2(iv)1 per-piece modifier #1): 成れる駒種の「成りによる価値上昇分」
// = value(promotesTo) − value(type)。PIECE_VALUES + PIECE_DEF_MAP の promotesTo から導出 (係数の
// 二重定義を避ける)。成れない駒種 (gold/king/成駒) は entry 無し = 上昇分 0。
const PROMOTION_GAIN: Record<string, number> = (() => {
  const gain: Record<string, number> = {};
  for (const [type, def] of PIECE_DEF_MAP) {
    if (def.canPromote && def.promotesTo) {
      gain[type] = (PIECE_VALUES[def.promotesTo] ?? 0) - (PIECE_VALUES[type] ?? 0);
    }
  }
  return gain;
})();

// no_promote マーク駒は永久に成れない = 成り潜在価値を構造的に喪失。その喪失を「成り上昇分の
// 一定割合」で減価する (D-1: 控えめ。全額減価はマーク歩を負価値化し不当ゆえ。最終係数は S4e bench
// 校正)。成り脅威割引 (modifier #2, promotion-threat.ts) は opponent 駒のみ対象で本 modifier
// (自駒含む全 owner) と排他 = 二重計上は構造的に発生しない (M1 MED-1)。
const NO_PROMOTE_MATERIAL_DISCOUNT_RATIO = 0.1;

// 盤上の駒の評価 (駒価値 + 配置ボーナス)。先手 +、後手 -。
//
// Issue #235 S4d-3: optional `marks` (両者の noPromoteMarks)。マーク駒は成り潜在喪失分を減価
// (owner にとって不利 = sente 絶対視点で -sign × discount)。marks 未渡/空は fast path = 従来値と
// バイト等価 (standard / card-shogi マーク無し局面)。
export function computeMaterial(
  state: GameState,
  variant: RuleVariant,
  marks?: Record<Player, PieceMark[]> | null,
): number {
  const rows = variant.boardSize.rows;
  let material = 0;

  const senteMarks = marks?.sente;
  const goteMarks = marks?.gote;
  const hasMarks =
    (senteMarks !== undefined && senteMarks.length > 0) ||
    (goteMarks !== undefined && goteMarks.length > 0);

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

      // S4d-3 per-piece modifier #1: マーク駒の成り潜在喪失を減価 (marks 有り局面のみ)。
      if (hasMarks) {
        const ownerMarks = piece.owner === "sente" ? senteMarks : goteMarks;
        if (isSquareMarked(ownerMarks, row, col)) {
          const gain = PROMOTION_GAIN[piece.type];
          if (gain !== undefined && gain > 0) {
            material += -sign * gain * NO_PROMOTE_MATERIAL_DISCOUNT_RATIO;
          }
        }
      }
    }
  }

  return material;
}
