import type { GameState, Move, Player, Position } from "../types";

// --- 定石ブックシステム ---
// 対局ごとにランダムで戦法を選択し、序盤の多様性を確保する

// コンパクトな手の表記
// 盤面移動: "76,77" = (row7,col6) → (row7,col7) ※row,colの順
// 打ち駒:   "drop:pawn@53" = 歩を(row5,col3)に打つ
// 成り:     "76,77+" = 成り付き

interface BookMove {
  move: string; // コンパクト表記
  responses?: BookNode[];
}

interface BookNode {
  move: string;
  children?: BookMove[];
}

interface OpeningStrategy {
  id: string;
  name: string;
  forPlayer: "sente" | "gote" | "both";
  weight: number; // 選択確率の重み（高いほど選ばれやすい）
  moves: BookMove[]; // ルートレベルの手
}

// 手のコンパクト表記をMoveオブジェクトに変換
function parseBookMove(notation: string, player: Player, board: (import("../types").Piece | null)[][]): Move | null {
  if (notation.startsWith("drop:")) {
    // drop:pawn@53
    const match = notation.match(/^drop:(\w+)@(\d)(\d)$/);
    if (!match) return null;
    const [, pieceType, rowStr, colStr] = match;
    return {
      type: "drop",
      to: { row: parseInt(rowStr), col: parseInt(colStr) },
      piece: pieceType,
      dropPiece: pieceType,
      player,
    };
  }

  // 盤面移動: "67,57" or "67,57+"
  const promote = notation.endsWith("+");
  const clean = promote ? notation.slice(0, -1) : notation;
  const parts = clean.split(",");
  if (parts.length !== 2) return null;

  const fromRow = parseInt(parts[0][0]);
  const fromCol = parseInt(parts[0][1]);
  const toRow = parseInt(parts[1][0]);
  const toCol = parseInt(parts[1][1]);

  const piece = board[fromRow]?.[fromCol];
  if (!piece) return null;

  const captured = board[toRow]?.[toCol];

  return {
    type: "move",
    from: { row: fromRow, col: fromCol },
    to: { row: toRow, col: toCol },
    piece: piece.type,
    captured: captured?.type,
    promote,
    player,
  };
}

// --- 定石データ ---
// 座標系: row=0が上（後手陣奥）、row=8が下（先手陣奥）
//         col=0が右（9筋）、col=8が左（1筋）
// 先手の初期配置: row6=歩、row7=[角(1),飛(7)]、row8=[香桂銀金王金銀桂香]

// === 先手用定石 ===

const SENTE_STRATEGIES: OpeningStrategy[] = [
  {
    id: "yagura",
    name: "矢倉",
    forPlayer: "sente",
    weight: 10,
    moves: [
      // 7六歩 (row6,col6→row5,col6)
      { move: "66,56" },
      // 6八銀 (row8,col6→row7,col5)
      { move: "86,75" },
      // 7七銀 (row7,col5→row6,col6)
      { move: "75,66" },
      // 5八金右 (row8,col5→row7,col4)
      { move: "85,74" },
      // 6九玉 (row8,col4→row7,col3)
      { move: "84,73" },
      // 7八玉 (row7,col3→row7,col1)
      { move: "73,71" },
      // 6七金 (row7,col4→row6,col5)
      { move: "74,65" },
      // 7八金 (row8,col3→row7,col2)
      { move: "83,72" },
    ],
  },
  {
    id: "kakugawari",
    name: "角換わり",
    forPlayer: "sente",
    weight: 8,
    moves: [
      // 7六歩
      { move: "66,56" },
      // 2六歩 (row6,col7→row5,col7)
      { move: "67,57" },
      // 2五歩
      { move: "57,47" },
      // 7八金 (row8,col3→row7,col2)
      { move: "83,72" },
      // 5八金 (row8,col5→row7,col4)
      { move: "85,74" },
      // 6八銀
      { move: "86,75" },
      // 7七銀
      { move: "75,66" },
    ],
  },
  {
    id: "aigakari",
    name: "相掛かり",
    forPlayer: "sente",
    weight: 7,
    moves: [
      // 2六歩
      { move: "67,57" },
      // 2五歩
      { move: "57,47" },
      // 7八金
      { move: "83,72" },
      // 3八銀 (row8,col6→row7,col5)
      { move: "86,75" },
      // 2四歩（攻め）
      { move: "47,37" },
    ],
  },
  {
    id: "shikenbisha",
    name: "四間飛車",
    forPlayer: "sente",
    weight: 10,
    moves: [
      // 7六歩
      { move: "66,56" },
      // 6八飛 (row7,col7→row7,col5) 飛車を四間に振る
      { move: "77,75" },
      // 7八銀
      { move: "86,76" },
      // 4八玉 (row8,col4→row8,col3)
      { move: "84,83" },
      // 3八玉
      { move: "83,82" },
      // 2八玉
      { move: "82,81" },
      // 3八金 (row8,col5→row7,col4)
      { move: "85,74" },
      // 1八香（穴熊への発展用省略）
    ],
  },
  {
    id: "nakabisha",
    name: "中飛車",
    forPlayer: "sente",
    weight: 9,
    moves: [
      // 5六歩 (row6,col4→row5,col4)
      { move: "64,54" },
      // 5八飛 (row7,col7→row7,col4) 飛車を中央に
      { move: "77,74" },
      // 7八銀
      { move: "86,76" },
      // 4八玉
      { move: "84,83" },
      // 3八玉
      { move: "83,82" },
      // 6八金 (row8,col5→row7,col5)
      { move: "85,75" },
    ],
  },
  {
    id: "sangenbisha",
    name: "三間飛車",
    forPlayer: "sente",
    weight: 7,
    moves: [
      // 7六歩
      { move: "66,56" },
      // 7八飛 (row7,col7→row7,col6) 飛車を三間に
      { move: "77,76" },
      // 6八銀
      { move: "86,75" },
      // 4八玉
      { move: "84,83" },
      // 3八玉
      { move: "83,82" },
      // 2八玉
      { move: "82,81" },
    ],
  },
  {
    id: "bougin",
    name: "棒銀",
    forPlayer: "sente",
    weight: 8,
    moves: [
      // 2六歩
      { move: "67,57" },
      // 2五歩
      { move: "57,47" },
      // 3八銀 (row8,col2→row7,col2)
      { move: "82,72" },
      // 2七銀 (row7,col2→row6,col7)
      { move: "72,67" },
      // 7八金
      { move: "83,72" },
    ],
  },
];

// === 後手用定石 ===

const GOTE_STRATEGIES: OpeningStrategy[] = [
  {
    id: "gote_yagura",
    name: "後手矢倉",
    forPlayer: "gote",
    weight: 10,
    moves: [
      // 3四歩 (row2,col2→row3,col2)
      { move: "22,32" },
      // 4二銀 (row0,col2→row1,col3)
      { move: "02,13" },
      // 3三銀
      { move: "13,22" },
      // 4二金 (row0,col3→row1,col3)
      { move: "03,13" },
      // 3一玉 (row0,col4→row1,col3)
      { move: "04,13" },
    ],
  },
  {
    id: "gote_shikenbisha",
    name: "後手四間飛車",
    forPlayer: "gote",
    weight: 10,
    moves: [
      // 3四歩
      { move: "22,32" },
      // 4二飛 (row1,col1→row1,col3) 飛車を四間に
      { move: "11,13" },
      // 3二銀
      { move: "02,12" },
      // 6二玉 (row0,col4→row0,col5)
      { move: "04,05" },
      // 7二玉
      { move: "05,06" },
      // 8二玉
      { move: "06,07" },
      // 7二銀
      { move: "06,12" },
    ],
  },
  {
    id: "gote_nakabisha",
    name: "後手中飛車",
    forPlayer: "gote",
    weight: 9,
    moves: [
      // 5四歩 (row2,col4→row3,col4)
      { move: "24,34" },
      // 5二飛 (row1,col1→row1,col4)
      { move: "11,14" },
      // 3二銀
      { move: "02,12" },
      // 6二玉
      { move: "04,05" },
      // 7二玉
      { move: "05,06" },
    ],
  },
  {
    id: "gote_kakugawari",
    name: "後手角換わり",
    forPlayer: "gote",
    weight: 8,
    moves: [
      // 8四歩 (row2,col7→row3,col7)
      { move: "27,37" },
      // 8五歩
      { move: "37,47" },
      // 3二金 (row0,col3→row1,col2)
      { move: "03,12" },
      // 4二銀
      { move: "02,13" },
      // 3三銀
      { move: "13,22" },
    ],
  },
  {
    id: "gote_bougin",
    name: "後手棒銀",
    forPlayer: "gote",
    weight: 8,
    moves: [
      // 8四歩
      { move: "27,37" },
      // 8五歩
      { move: "37,47" },
      // 7二銀 (row0,col6→row1,col6)
      { move: "06,16" },
      // 8三銀 (row1,col6→row2,col7)
      { move: "16,27" },
      // 3二金
      { move: "03,12" },
    ],
  },
];

// 全戦法の統合
const ALL_STRATEGIES = [...SENTE_STRATEGIES, ...GOTE_STRATEGIES];

// 対局の手順が定石と一致するかチェックし、次の手を返す
export function getBookMove(
  state: GameState,
  player: Player
): Move | null {
  const history = state.moveHistory;
  const applicableStrategies = ALL_STRATEGIES.filter(
    (s) => s.forPlayer === player || s.forPlayer === "both"
  );

  // 各戦法について、現在の手順と一致するか確認
  const candidates: { move: Move; weight: number }[] = [];

  for (const strategy of applicableStrategies) {
    const bookMoves = strategy.moves;

    // 手番に基づいてブック内の何手目かを計算
    // 先手なら偶数手（0, 2, 4...）がこちらの手
    // 後手なら奇数手（1, 3, 5...）がこちらの手
    const myMoveIndices: number[] = [];
    for (let i = 0; i < history.length; i++) {
      if (history[i].player === player) myMoveIndices.push(i);
    }
    const myMoveCount = myMoveIndices.length;

    if (myMoveCount >= bookMoves.length) continue; // ブック終了

    // これまでの自分の手がブックと一致するか確認
    let matches = true;
    for (let i = 0; i < myMoveCount; i++) {
      const bookNotation = bookMoves[i].move;
      const actualMove = history[myMoveIndices[i]];
      if (!moveMatchesNotation(actualMove, bookNotation)) {
        matches = false;
        break;
      }
    }

    if (!matches) continue;

    // 次のブック手を取得
    const nextNotation = bookMoves[myMoveCount].move;
    const nextMove = parseBookMove(nextNotation, player, state.board);
    if (nextMove) {
      candidates.push({ move: nextMove, weight: strategy.weight });
    }
  }

  if (candidates.length === 0) return null;

  // 重み付きランダム選択
  const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);
  let rand = Math.random() * totalWeight;
  for (const candidate of candidates) {
    rand -= candidate.weight;
    if (rand <= 0) return candidate.move;
  }

  return candidates[candidates.length - 1].move;
}

// Moveオブジェクトがブック表記と一致するか
function moveMatchesNotation(move: Move, notation: string): boolean {
  if (notation.startsWith("drop:")) {
    if (move.type !== "drop") return false;
    const match = notation.match(/^drop:(\w+)@(\d)(\d)$/);
    if (!match) return false;
    return move.dropPiece === match[1] &&
      move.to.row === parseInt(match[2]) &&
      move.to.col === parseInt(match[3]);
  }

  if (move.type !== "move") return false;

  const promote = notation.endsWith("+");
  const clean = promote ? notation.slice(0, -1) : notation;
  const parts = clean.split(",");
  if (parts.length !== 2) return false;

  const fromRow = parseInt(parts[0][0]);
  const fromCol = parseInt(parts[0][1]);
  const toRow = parseInt(parts[1][0]);
  const toCol = parseInt(parts[1][1]);

  return move.from?.row === fromRow &&
    move.from?.col === fromCol &&
    move.to.row === toRow &&
    move.to.col === toCol &&
    (move.promote ?? false) === promote;
}

// 定石ブック内の手数上限
export const MAX_BOOK_MOVES = 15;
