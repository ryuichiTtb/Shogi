import type { Board, GameState, Player, Position, RuleVariant } from "../types";
import { STANDARD_VARIANT } from "../variants/standard";
import { findKing, isSquareAttackedByFast } from "../moves";

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

// 成り可能な駒タイプ（成りゾーン脅威検知用）
const PROMOTABLE_TYPES = new Set(["pawn", "lance", "knight", "silver", "bishop", "rook"]);

// 成り込み脅威ペナルティ
const PROMOTION_THREAT: Record<string, number> = {
  rook: 150, bishop: 120, silver: 30, pawn: 15, lance: 15, knight: 15,
};

// 金型の駒タイプ
const GOLD_TYPES = new Set(["gold", "promoted_pawn", "promoted_silver", "promoted_knight", "promoted_lance"]);

// 最も安い攻撃駒の価値を返す（交換品質評価用）
// isSquareAttackedByFastと同じ逆方向走査だが、安い駒から順に探索し、見つかったら即return
function getLeastAttackerValue(
  board: Board,
  pos: Position,
  attacker: Player,
  boardSize: { rows: number; cols: number }
): number {
  const { rows, cols } = boardSize;
  const tr = pos.row;
  const tc = pos.col;
  const s = attacker === "sente" ? -1 : 1;
  let r: number, c: number;

  // 歩 (100) — 最安値から探索
  r = tr - s;
  if (r >= 0 && r < rows) {
    const p = board[r][tc];
    if (p && p.owner === attacker && p.type === "pawn") return 100;
  }

  // 香車 (300)
  const lanceDr = attacker === "sente" ? 1 : -1;
  r = tr + lanceDr;
  while (r >= 0 && r < rows) {
    const p = board[r][tc];
    if (p) {
      if (p.owner === attacker && p.type === "lance") return 300;
      break;
    }
    r += lanceDr;
  }

  // 桂馬 (400)
  r = tr + s * -2;
  if (r >= 0 && r < rows) {
    c = tc + s * -1;
    if (c >= 0 && c < cols) {
      const p = board[r][c];
      if (p && p.owner === attacker && p.type === "knight") return 400;
    }
    c = tc + s * 1;
    if (c >= 0 && c < cols) {
      const p = board[r][c];
      if (p && p.owner === attacker && p.type === "knight") return 400;
    }
  }

  // 銀 (500)
  const sd: [number, number][] = [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 1]];
  for (let i = 0; i < 5; i++) {
    r = tr + s * sd[i][0];
    c = tc + s * sd[i][1];
    if (r >= 0 && r < rows && c >= 0 && c < cols) {
      const p = board[r][c];
      if (p && p.owner === attacker && p.type === "silver") return 500;
    }
  }

  // 金型 (600) — 金、と金、成銀、成桂、成香
  const gd: [number, number][] = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, 0]];
  for (let i = 0; i < 6; i++) {
    r = tr + s * gd[i][0];
    c = tc + s * gd[i][1];
    if (r >= 0 && r < rows && c >= 0 && c < cols) {
      const p = board[r][c];
      if (p && p.owner === attacker && GOLD_TYPES.has(p.type)) return 600;
    }
  }

  // 角 (800)
  for (const [dr, dc] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
    r = tr + dr;
    c = tc + dc;
    while (r >= 0 && r < rows && c >= 0 && c < cols) {
      const p = board[r][c];
      if (p) {
        if (p.owner === attacker && p.type === "bishop") return 800;
        break;
      }
      r += dr;
      c += dc;
    }
  }

  // 飛車 (1000)
  for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    r = tr + dr;
    c = tc + dc;
    while (r >= 0 && r < rows && c >= 0 && c < cols) {
      const p = board[r][c];
      if (p) {
        if (p.owner === attacker && p.type === "rook") return 1000;
        break;
      }
      r += dr;
      c += dc;
    }
  }

  // 馬 (1100)
  for (const [dr, dc] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
    r = tr + dr;
    c = tc + dc;
    while (r >= 0 && r < rows && c >= 0 && c < cols) {
      const p = board[r][c];
      if (p) {
        if (p.owner === attacker && p.type === "promoted_bishop") return 1100;
        break;
      }
      r += dr;
      c += dc;
    }
  }
  // 馬の縦横ステップ
  for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    r = tr + dr;
    c = tc + dc;
    if (r >= 0 && r < rows && c >= 0 && c < cols) {
      const p = board[r][c];
      if (p && p.owner === attacker && p.type === "promoted_bishop") return 1100;
    }
  }

  // 龍 (1300)
  for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    r = tr + dr;
    c = tc + dc;
    while (r >= 0 && r < rows && c >= 0 && c < cols) {
      const p = board[r][c];
      if (p) {
        if (p.owner === attacker && p.type === "promoted_rook") return 1300;
        break;
      }
      r += dr;
      c += dc;
    }
  }
  // 龍の斜めステップ
  for (const [dr, dc] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
    r = tr + dr;
    c = tc + dc;
    if (r >= 0 && r < rows && c >= 0 && c < cols) {
      const p = board[r][c];
      if (p && p.owner === attacker && p.type === "promoted_rook") return 1300;
    }
  }

  // 王 (10000) — 最後
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      r = tr + dr;
      c = tc + dc;
      if (r >= 0 && r < rows && c >= 0 && c < cols) {
        const p = board[r][c];
        if (p && p.owner === attacker && p.type === "king") return 10000;
      }
    }
  }

  return 0; // 攻撃駒なし
}

// --- 駒安全性評価 ---

// 駒の安全性を評価（タダ取り・駒損交換の検知）
function evaluatePieceSafety(
  state: GameState,
  player: Player,
  variant: RuleVariant
): number {
  let penalty = 0;
  const opponent: Player = player === "sente" ? "gote" : "sente";
  const { rows, cols } = variant.boardSize;
  const board = state.board;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const piece = board[row][col];
      if (!piece || piece.owner !== player || piece.type === "king") continue;

      const pos = { row, col };
      const attacked = isSquareAttackedByFast(board, pos, opponent, variant.boardSize);
      if (!attacked) continue;

      const value = PIECE_VALUES[piece.type] ?? 100;
      const defended = isSquareAttackedByFast(board, pos, player, variant.boardSize);

      if (!defended) {
        // タダ取り: 無防備の駒 → 駒価値の70%ペナルティ
        penalty -= Math.floor(value * 0.7);
      } else {
        // 攻撃され、かつ守られている → 交換品質を評価
        const leastAttacker = getLeastAttackerValue(board, pos, opponent, variant.boardSize);
        if (leastAttacker > 0 && leastAttacker < value) {
          // 安い駒で攻撃されている → 交換すると損
          // 例: 飛車(1000)を歩(100)が攻撃 → 900×0.4=360cpペナルティ
          penalty -= Math.floor((value - leastAttacker) * 0.4);
        }
      }
    }
  }

  return penalty;
}

// --- 成り込み脅威検知 ---

// 相手の未成り駒が成りゾーンに侵入している場合のペナルティ
function evaluatePromotionThreats(
  state: GameState,
  player: Player,
  variant: RuleVariant
): number {
  let penalty = 0;
  const opponent: Player = player === "sente" ? "gote" : "sente";
  const { rows } = variant.boardSize;
  const zoneRows = variant.rules.promotionZoneRows; // 3

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < 9; col++) {
      const piece = state.board[row][col];
      if (!piece || piece.owner !== opponent) continue;
      if (!PROMOTABLE_TYPES.has(piece.type)) continue;

      // 相手が成りゾーンにいるか判定
      // opponent=senteなら成りゾーンはrow < zoneRows (0,1,2)
      // opponent=goteなら成りゾーンはrow >= rows - zoneRows (6,7,8)
      const inPromotionZone = opponent === "sente"
        ? row < zoneRows
        : row >= rows - zoneRows;

      if (inPromotionZone) {
        penalty -= PROMOTION_THREAT[piece.type] ?? 15;
      }
    }
  }

  return penalty;
}

// --- 囲いパターン認識 ---

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
function evaluateCastle(
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
function evaluateKingSafety(
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

// 飛車のオープンファイル評価
function evaluateRookFiles(
  state: GameState,
  player: Player,
  variant: RuleVariant
): number {
  let bonus = 0;
  const { rows, cols } = variant.boardSize;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const piece = state.board[row][col];
      if (!piece || piece.owner !== player) continue;
      if (piece.type !== "rook" && piece.type !== "promoted_rook") continue;

      // 同列に自分の歩がないか確認
      let hasFriendlyPawn = false;
      let hasEnemyPawn = false;
      for (let r = 0; r < rows; r++) {
        const p = state.board[r][col];
        if (p && p.type === "pawn") {
          if (p.owner === player) hasFriendlyPawn = true;
          else hasEnemyPawn = true;
        }
      }

      if (!hasFriendlyPawn && !hasEnemyPawn) {
        bonus += 30; // オープンファイル
      } else if (!hasFriendlyPawn) {
        bonus += 15; // セミオープンファイル
      }
    }
  }

  return bonus;
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

  // 玉の安全度（囲いパターン込み）
  score += evaluateKingSafety(state, "sente", variant);
  score -= evaluateKingSafety(state, "gote", variant);

  // 飛車オープンファイル
  score += evaluateRookFiles(state, "sente", variant);
  score -= evaluateRookFiles(state, "gote", variant);

  // 駒安全性（タダ取り・駒損交換の検知）
  score += evaluatePieceSafety(state, "sente", variant);
  score -= evaluatePieceSafety(state, "gote", variant);

  // 成り込み脅威
  score += evaluatePromotionThreats(state, "sente", variant);
  score -= evaluatePromotionThreats(state, "gote", variant);

  // テンポボーナス（手番側に小さなボーナス）
  score += state.currentPlayer === "sente" ? 15 : -15;

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
