import type { GameState, Move, Player } from "../types";

// --- 定石ブックシステム ---
// 対局ごとにランダムで戦法を選択し、序盤の多様性を確保する

// 座標系: row=0が一段(後手陣奥), row=8が九段(先手陣奥)
//         col=0が9筋(右端), col=8が1筋(左端)
// 変換: 筋F段R → col=9-F, row=R-1
// 例: 7六 → col=9-7=2, row=6-1=5 → (5, 2)

// 標準将棋表記(筋段)からrow,colに変換
function fromNotation(fileRank: string): { row: number; col: number } {
  const file = parseInt(fileRank[0]); // 筋 (1-9)
  const rank = parseInt(fileRank[1]); // 段 (1-9)
  return { row: rank - 1, col: 9 - file };
}

// 標準表記の手を内部Moveに変換
// "77-76" = 七七から七六へ移動
// "drop:pawn@56" = 歩を五六に打つ
function parseBookNotation(
  notation: string,
  player: Player,
  board: (import("../types").Piece | null)[][]
): Move | null {
  if (notation.startsWith("drop:")) {
    const match = notation.match(/^drop:(\w+)@(\d\d)$/);
    if (!match) return null;
    const [, pieceType, posStr] = match;
    const to = fromNotation(posStr);
    return { type: "drop", to, piece: pieceType, dropPiece: pieceType, player };
  }

  const promote = notation.endsWith("+");
  const clean = promote ? notation.slice(0, -1) : notation;
  const parts = clean.split("-");
  if (parts.length !== 2) return null;

  const from = fromNotation(parts[0]);
  const to = fromNotation(parts[1]);

  const piece = board[from.row]?.[from.col];
  if (!piece) return null;

  const captured = board[to.row]?.[to.col];
  return {
    type: "move", from, to, piece: piece.type,
    captured: captured?.type, promote, player,
  };
}

interface BookMove {
  move: string; // 標準表記 "77-76" etc.
}

interface OpeningStrategy {
  id: string;
  name: string;
  forPlayer: "sente" | "gote" | "both";
  weight: number;
  moves: BookMove[];
}

// === 先手用定石 ===
// 初期配置(先手):
//   九段(row8): 香(0) 桂(1) 銀(2) 金(3) 玉(4) 金(5) 銀(6) 桂(7) 香(8)
//   八段(row7): .(0)  角(1) .(2)  .(3)  .(4)  .(5)  .(6)  飛(7) .(8)
//   七段(row6): 歩(0-8)
// 先手は row が減る方向に進む

const SENTE_STRATEGIES: OpeningStrategy[] = [
  {
    id: "yagura",
    name: "矢倉",
    forPlayer: "sente",
    weight: 10,
    moves: [
      { move: "77-76" }, // 7六歩
      { move: "69-78" }, // 7八金
      { move: "79-68" }, // 6八銀
      { move: "68-77" }, // 7七銀
      { move: "49-58" }, // 5八金右
      { move: "58-67" }, // 6七金
      { move: "59-69" }, // 6九玉
      { move: "69-79" }, // 7九玉
    ],
  },
  {
    id: "yagura2",
    name: "矢倉急戦",
    forPlayer: "sente",
    weight: 8,
    moves: [
      { move: "77-76" }, // 7六歩
      { move: "27-26" }, // 2六歩
      { move: "26-25" }, // 2五歩
      { move: "39-48" }, // 4八銀
      { move: "69-78" }, // 7八金
      { move: "59-69" }, // 6九玉
    ],
  },
  {
    id: "kakugawari",
    name: "角換わり",
    forPlayer: "sente",
    weight: 8,
    moves: [
      { move: "77-76" }, // 7六歩
      { move: "27-26" }, // 2六歩
      { move: "26-25" }, // 2五歩
      { move: "69-78" }, // 7八金
      { move: "49-58" }, // 5八金
      { move: "39-48" }, // 4八銀
    ],
  },
  {
    id: "aigakari",
    name: "相掛かり",
    forPlayer: "sente",
    weight: 7,
    moves: [
      { move: "27-26" }, // 2六歩
      { move: "26-25" }, // 2五歩
      { move: "69-78" }, // 7八金
      { move: "39-48" }, // 4八銀
      { move: "77-76" }, // 7六歩
    ],
  },
  {
    id: "shikenbisha",
    name: "四間飛車",
    forPlayer: "sente",
    weight: 10,
    moves: [
      { move: "77-76" }, // 7六歩
      { move: "28-68" }, // 6八飛（飛車を四間に振る）
      { move: "39-48" }, // 4八銀
      { move: "59-49" }, // 4九玉
      { move: "49-38" }, // 3八玉
      { move: "38-28" }, // 2八玉
      { move: "69-58" }, // 5八金左
    ],
  },
  {
    id: "nakabisha",
    name: "中飛車",
    forPlayer: "sente",
    weight: 9,
    moves: [
      { move: "57-56" }, // 5六歩
      { move: "28-58" }, // 5八飛
      { move: "39-48" }, // 4八銀
      { move: "59-49" }, // 4九玉
      { move: "49-38" }, // 3八玉
      { move: "69-68" }, // 6八金
    ],
  },
  {
    id: "sangenbisha",
    name: "三間飛車",
    forPlayer: "sente",
    weight: 7,
    moves: [
      { move: "77-76" }, // 7六歩
      { move: "28-78" }, // 7八飛（三間に振る）
      { move: "39-48" }, // 4八銀
      { move: "59-49" }, // 4九玉
      { move: "49-38" }, // 3八玉
      { move: "38-28" }, // 2八玉
    ],
  },
  {
    id: "bougin",
    name: "棒銀",
    forPlayer: "sente",
    weight: 9,
    moves: [
      { move: "27-26" }, // 2六歩
      { move: "26-25" }, // 2五歩
      { move: "39-38" }, // 3八銀
      { move: "38-27" }, // 2七銀
      { move: "69-78" }, // 7八金
      { move: "77-76" }, // 7六歩
    ],
  },
  {
    id: "hidarimino",
    name: "左美濃",
    forPlayer: "sente",
    weight: 7,
    moves: [
      { move: "77-76" }, // 7六歩
      { move: "27-26" }, // 2六歩
      { move: "59-68" }, // 6八玉
      { move: "68-78" }, // 7八玉
      { move: "79-68" }, // 6八銀
      { move: "49-58" }, // 5八金
    ],
  },
];

// === 後手用定石 ===
// 初期配置(後手):
//   一段(row0): 香(0) 桂(1) 銀(2) 金(3) 玉(4) 金(5) 銀(6) 桂(7) 香(8)
//   二段(row1): .(0)  飛(1) .(2)  .(3)  .(4)  .(5)  .(6)  角(7) .(8)
//   三段(row2): 歩(0-8)
// 後手は row が増える方向に進む

const GOTE_STRATEGIES: OpeningStrategy[] = [
  {
    id: "gote_yagura",
    name: "後手矢倉",
    forPlayer: "gote",
    weight: 10,
    moves: [
      { move: "33-34" }, // 3四歩
      { move: "71-62" }, // 6二銀
      { move: "62-53" }, // 5三銀
      { move: "51-42" }, // 4二玉
      { move: "41-32" }, // 3二金
    ],
  },
  {
    id: "gote_shikenbisha",
    name: "後手四間飛車",
    forPlayer: "gote",
    weight: 10,
    moves: [
      { move: "33-34" }, // 3四歩
      { move: "82-42" }, // 4二飛
      { move: "51-62" }, // 6二玉
      { move: "62-72" }, // 7二玉
      { move: "31-32" }, // 3二銀
    ],
  },
  {
    id: "gote_nakabisha",
    name: "後手中飛車",
    forPlayer: "gote",
    weight: 9,
    moves: [
      { move: "53-54" }, // 5四歩
      { move: "82-52" }, // 5二飛
      { move: "71-62" }, // 6二銀
      { move: "51-42" }, // 4二玉
      { move: "42-32" }, // 3二玉
    ],
  },
  {
    id: "gote_kakugawari",
    name: "後手角換わり",
    forPlayer: "gote",
    weight: 8,
    moves: [
      { move: "83-84" }, // 8四歩
      { move: "84-85" }, // 8五歩
      { move: "41-32" }, // 3二金
      { move: "71-62" }, // 6二銀
      { move: "62-53" }, // 5三銀
    ],
  },
  {
    id: "gote_bougin",
    name: "後手棒銀",
    forPlayer: "gote",
    weight: 8,
    moves: [
      { move: "83-84" }, // 8四歩
      { move: "84-85" }, // 8五歩
      { move: "71-72" }, // 7二銀
      { move: "72-83" }, // 8三銀
      { move: "41-32" }, // 3二金
    ],
  },
  {
    id: "gote_sangenbisha",
    name: "後手三間飛車",
    forPlayer: "gote",
    weight: 7,
    moves: [
      { move: "33-34" }, // 3四歩
      { move: "82-32" }, // 3二飛
      { move: "51-62" }, // 6二玉
      { move: "62-72" }, // 7二玉
      { move: "71-62" }, // 6二銀
    ],
  },
  {
    id: "gote_ibisha",
    name: "後手居飛車",
    forPlayer: "gote",
    weight: 8,
    moves: [
      { move: "83-84" }, // 8四歩
      { move: "33-34" }, // 3四歩
      { move: "41-32" }, // 3二金
      { move: "71-62" }, // 6二銀
      { move: "51-42" }, // 4二玉
    ],
  },
];

const ALL_STRATEGIES = [...SENTE_STRATEGIES, ...GOTE_STRATEGIES];

// 対局の手順に基づいて次のブック手を返す
export function getBookMove(
  state: GameState,
  player: Player
): Move | null {
  const history = state.moveHistory;
  const applicableStrategies = ALL_STRATEGIES.filter(
    (s) => s.forPlayer === player || s.forPlayer === "both"
  );

  const candidates: { move: Move; weight: number }[] = [];

  for (const strategy of applicableStrategies) {
    const bookMoves = strategy.moves;

    // 自分の手番だけを抽出
    const myMoveIndices: number[] = [];
    for (let i = 0; i < history.length; i++) {
      if (history[i].player === player) myMoveIndices.push(i);
    }
    const myMoveCount = myMoveIndices.length;

    if (myMoveCount >= bookMoves.length) continue;

    // これまでの自分の手がブックと一致するか
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

    // 次のブック手を生成・検証
    const nextNotation = bookMoves[myMoveCount].move;
    const nextMove = parseBookNotation(nextNotation, player, state.board);
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

// Moveが標準表記と一致するか
function moveMatchesNotation(move: Move, notation: string): boolean {
  if (notation.startsWith("drop:")) {
    if (move.type !== "drop") return false;
    const match = notation.match(/^drop:(\w+)@(\d\d)$/);
    if (!match) return false;
    const to = fromNotation(match[2]);
    return move.dropPiece === match[1] && move.to.row === to.row && move.to.col === to.col;
  }

  if (move.type !== "move") return false;
  const promote = notation.endsWith("+");
  const clean = promote ? notation.slice(0, -1) : notation;
  const parts = clean.split("-");
  if (parts.length !== 2) return false;

  const from = fromNotation(parts[0]);
  const to = fromNotation(parts[1]);

  return (
    move.from?.row === from.row && move.from?.col === from.col &&
    move.to.row === to.row && move.to.col === to.col &&
    (move.promote ?? false) === promote
  );
}

export const MAX_BOOK_MOVES = 15;
