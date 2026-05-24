import type { Board, GameState, Player, Position, RuleVariant } from "../../types";
import { isSquareAttackedByFast } from "../../moves";
import { PIECE_VALUES } from "./material";

// 駒安全性評価 (タダ取り・駒損交換の検知) と最安攻撃駒の探索。
//
// Issue #193 / PR2: evaluate.ts から分離。ロジック・係数・走査順は分離元から
// 1 文字も変えていない (evaluate-equivalence.test.ts で担保)。

// 金型の駒タイプ (最安攻撃駒探索でのみ使用)
const GOLD_TYPES = new Set(["gold", "promoted_pawn", "promoted_silver", "promoted_knight", "promoted_lance"]);

// 最も安い攻撃駒の価値を返す（交換品質評価用）
// isSquareAttackedByFastと同じ逆方向走査だが、安い駒から順に探索し、見つかったら即return
export function getLeastAttackerValue(
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

// 駒の安全性を評価（タダ取り・駒損交換の検知）
// Issue #193 / PR1c (Phase 4 足場): 後続 PR (PR2) で評価関数モジュール本体分離する
// 際に外部から呼べるよう export 化。本体ロジックは一切変更しない (1 cp ずれ厳禁)。
export function evaluatePieceSafety(
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
        // タダ取り: 無防備の駒 → 駒価値の85%ペナルティ
        penalty -= Math.floor(value * 0.85);
      } else {
        // 攻撃され、かつ守られている → 交換品質を評価
        const leastAttacker = getLeastAttackerValue(board, pos, opponent, variant.boardSize);
        if (leastAttacker > 0 && leastAttacker < value) {
          // 安い駒で攻撃されている → 交換すると損
          // 例: 飛車(1000)を歩(100)が攻撃 → 900×0.65=585cpペナルティ
          penalty -= Math.floor((value - leastAttacker) * 0.65);
        }
      }
    }
  }

  return penalty;
}
