import type { Move, Player } from "./types";
import { PIECE_DEF_MAP } from "./variants/standard";

// 将棋の筋（列）表示: col=0 → 9筋, col=8 → 1筋
function colToFile(col: number): string {
  return String(9 - col);
}

// 将棋の段（行）表示: row=0 → 一, row=8 → 九
const ROW_KANJI = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];
function rowToRank(row: number): string {
  return ROW_KANJI[row] ?? String(row + 1);
}

// 駒の漢字を取得
function getPieceKanji(type: string): string {
  const def = PIECE_DEF_MAP.get(type);
  return def?.kanji ?? type;
}

// 手をKIF形式の文字列に変換
// 例: ７六歩, ３四飛成, ２三歩打
export function moveToNotation(move: Move, prevTo?: { row: number; col: number }): string {
  const toFile = colToFile(move.to.col);
  const toRank = rowToRank(move.to.row);

  // 同じマスへの移動は「同」を使用
  const sameSquare =
    prevTo && prevTo.row === move.to.row && prevTo.col === move.to.col;
  const toStr = sameSquare ? "同" : `${toFile}${toRank}`;

  const pieceKanji = getPieceKanji(move.type === "drop" ? move.dropPiece! : move.piece);
  const promoteStr = move.promote ? "成" : "";
  const dropStr = move.type === "drop" ? "打" : "";

  return `${toStr}${pieceKanji}${promoteStr}${dropStr}`;
}

// KIF形式の全棋譜を生成
export function movesToKIF(moves: Move[]): string {
  const lines: string[] = [];
  let prevTo: { row: number; col: number } | undefined;

  moves.forEach((move, index) => {
    const moveNum = index + 1;
    const notation = moveToNotation(move, prevTo);
    const player = move.player === "sente" ? "▲" : "△";
    lines.push(`${moveNum}. ${player}${notation}`);
    prevTo = move.to;
  });

  return lines.join("\n");
}

// 投了・詰みの結果表示
export function gameResultText(
  status: string,
  winner?: string
): string {
  switch (status) {
    case "checkmate":
      return winner === "sente" ? "先手の勝ち（詰み）" : "後手の勝ち（詰み）";
    case "resign":
      return winner === "sente" ? "先手の勝ち（投了）" : "後手の勝ち（投了）";
    case "repetition":
      return "千日手（引き分け）";
    case "impasse":
      return winner === "draw" ? "持将棋（引き分け）" : `${winner === "sente" ? "先手" : "後手"}の勝ち（持将棋）`;
    case "timeout":
      return winner === "sente" ? "先手の勝ち（時間切れ）" : "後手の勝ち（時間切れ）";
    default:
      return "対局中";
  }
}
