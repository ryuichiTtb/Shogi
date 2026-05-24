import type { GameState, Player, RuleVariant } from "../../types";
import { findKing, isSquareAttackedByFast } from "../../moves";

// 玉の安全度評価 (囲いパターン認識 + 周辺評価 + 逃げ道 + 王手)。
//
// Issue #193 / PR2: evaluate.ts から分離。囲いパターン定義・係数・判定順は
// 分離元から 1 文字も変えていない (evaluate-equivalence.test.ts で担保)。

// 囲いパターン: 玉からの相対位置と必要な駒種
interface CastlePattern {
  name: string;
  // 玉の絶対位置条件（先手視点）: [row, col]。nullは任意
  kingRow?: number;
  kingCol?: number;
  // 玉からの相対座標に置くべき駒 [dr, dc, pieceType]
  pieces: [number, number, string][];
  bonus: number;
}

// 先手視点での囲いパターン
const CASTLE_PATTERNS: CastlePattern[] = [
  // 矢倉囲い: 玉が7八（row7,col1）、金が6八(row6,col1)と7七(row7,col2)、銀が6七(row6,col2)
  {
    name: "矢倉",
    kingRow: 7, kingCol: 1,
    pieces: [[0, 1, "gold"], [-1, 0, "gold"], [-1, 1, "silver"]],
    bonus: 150,
  },
  // 美濃囲い: 玉が8二（row8,col1）、金が7八(row7,col1)、銀が7七(row7,col2)
  {
    name: "美濃",
    kingRow: 8, kingCol: 1,
    pieces: [[-1, 0, "gold"], [-1, 1, "silver"]],
    bonus: 120,
  },
  // 高美濃: 玉が8二（row8,col1）、金が6七(row6,col2)、銀が7七(row7,col2)
  {
    name: "高美濃",
    kingRow: 8, kingCol: 1,
    pieces: [[-2, 1, "gold"], [-1, 1, "silver"]],
    bonus: 130,
  },
  // 穴熊: 玉が8一（row8,col0）、金が8二(row8,col1)、銀が7一(row7,col0)
  {
    name: "穴熊",
    kingRow: 8, kingCol: 0,
    pieces: [[0, 1, "gold"], [-1, 0, "silver"]],
    bonus: 200,
  },
  // elmo囲い: 玉が8二（row8,col1）、金が7八(row7,col1)、銀が8三(row8,col2)
  {
    name: "elmo",
    kingRow: 8, kingCol: 1,
    pieces: [[-1, 0, "gold"], [0, 1, "silver"]],
    bonus: 130,
  },
  // 舟囲い: 玉が7八(row7,col1)または6八(row6,col1)付近、金が隣接
  {
    name: "舟囲い",
    kingRow: 7, kingCol: 2,
    pieces: [[0, -1, "gold"]],
    bonus: 60,
  },
  // 左美濃: 玉が8八（row8,col7）、金が7八(row7,col7)、銀が7七(row7,col6)
  {
    name: "左美濃",
    kingRow: 8, kingCol: 7,
    pieces: [[-1, 0, "gold"], [-1, -1, "silver"]],
    bonus: 120,
  },
  // 居飛車穴熊: 玉が8九（row8,col8）、金が8八(row8,col7)、銀が7九(row7,col8)
  {
    name: "居飛車穴熊",
    kingRow: 8, kingCol: 8,
    pieces: [[0, -1, "gold"], [-1, 0, "silver"]],
    bonus: 200,
  },
];

// 囲い評価（片方のプレイヤー）
// Issue #193 / PR1c: PR1c-2/PR1d/PR2 で外部参照するため export 化。本体ロジック不変。
export function evaluateCastle(
  state: GameState,
  player: Player,
  kingRow: number,
  kingCol: number,
  variant: RuleVariant
): number {
  const { rows } = variant.boardSize;
  let bestBonus = 0;

  for (const pattern of CASTLE_PATTERNS) {
    // 玉の位置を先手視点に変換して比較
    const patternKingRow = player === "sente" ? (pattern.kingRow ?? kingRow) : rows - 1 - (pattern.kingRow ?? (rows - 1 - kingRow));
    const patternKingCol = pattern.kingCol ?? kingCol;

    // 左右対称も考慮（colを8-colに反転）
    const positions = [patternKingCol, 8 - patternKingCol];

    for (const pCol of positions) {
      if (kingRow !== patternKingRow || kingCol !== pCol) continue;

      let matchCount = 0;
      const totalPieces = pattern.pieces.length;

      for (const [dr, dc, reqType] of pattern.pieces) {
        // 左右反転時はdcも反転
        const actualDc = pCol === patternKingCol ? dc : -dc;
        const pr = kingRow + (player === "sente" ? dr : -dr);
        const pc = kingCol + actualDc;

        if (pr < 0 || pr >= rows || pc < 0 || pc >= 9) continue;
        const piece = state.board[pr][pc];
        if (piece && piece.owner === player && piece.type === reqType) {
          matchCount++;
        }
      }

      if (totalPieces > 0) {
        const bonus = Math.floor(pattern.bonus * matchCount / totalPieces);
        if (bonus > bestBonus) bestBonus = bonus;
      }
    }
  }

  return bestBonus;
}

// 玉の安全度評価（囲いパターン + 周辺評価）
// Issue #193 / PR1c: PR1c-2/PR1d/PR2 で外部参照するため export 化。本体ロジック不変。
export function evaluateKingSafety(
  state: GameState,
  player: Player,
  variant: RuleVariant
): number {
  const kingPos = findKing(state.board, player, variant.boardSize);
  if (!kingPos) return -5000;

  let safety = 0;
  const { rows, cols } = variant.boardSize;
  const opponent: Player = player === "sente" ? "gote" : "sente";

  // 囲いパターンボーナス
  safety += evaluateCastle(state, player, kingPos.row, kingPos.col, variant);

  // 玉周辺の味方駒カウント + 敵駒ペナルティ
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = kingPos.row + dr;
      const c = kingPos.col + dc;
      if (r < 0 || r >= rows || c < 0 || c >= cols) continue;

      const piece = state.board[r][c];
      if (!piece) continue;

      const dist = Math.max(Math.abs(dr), Math.abs(dc));

      if (piece.owner === player) {
        const isDefensePiece = piece.type === "gold" || piece.type === "silver" ||
          piece.type === "promoted_pawn" || piece.type === "promoted_lance" ||
          piece.type === "promoted_knight" || piece.type === "promoted_silver";
        const baseBonus = dist === 1 ? 25 : 10;
        safety += isDefensePiece ? Math.floor(baseBonus * 1.5) : baseBonus;
      } else {
        // 敵駒が玉周辺に侵入: 駒種別のペナルティ
        const pt = piece.type;
        let threatPenalty: number;
        if (pt === "rook" || pt === "promoted_rook") {
          threatPenalty = dist === 1 ? -120 : -60;
        } else if (pt === "bishop" || pt === "promoted_bishop") {
          threatPenalty = dist === 1 ? -100 : -50;
        } else if (pt === "gold" || pt === "silver" || pt === "promoted_pawn" ||
                   pt === "promoted_silver" || pt === "promoted_knight" || pt === "promoted_lance") {
          threatPenalty = dist === 1 ? -60 : -25;
        } else {
          threatPenalty = dist === 1 ? -35 : -15;
        }
        safety += threatPenalty;
      }
    }
  }

  // 玉の逃げ道評価（liberty）: 隣接空きマスのうち敵に攻撃されていない数
  let liberties = 0;
  const kingDirs = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
  for (const [dr, dc] of kingDirs) {
    const r = kingPos.row + dr;
    const c = kingPos.col + dc;
    if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
    const piece = state.board[r][c];
    // 味方駒がいるマスには逃げられない
    if (piece && piece.owner === player) continue;
    // 敵に攻撃されているマスには逃げられない
    if (isSquareAttackedByFast(state.board, { row: r, col: c }, opponent, variant.boardSize)) continue;
    liberties++;
  }
  // 逃げ道が少ないほどペナルティ（0=完全に囲まれている→危険）
  if (liberties === 0) {
    safety -= 150; // 逃げ道なし: 詰みの危険
  } else if (liberties === 1) {
    safety -= 60;  // 逃げ道1つ: 危険
  }

  // 王手ペナルティ（強化: 王手は非常に危険な状態）
  if (isSquareAttackedByFast(state.board, kingPos, opponent, variant.boardSize)) {
    safety -= 500;
  }

  return safety;
}
