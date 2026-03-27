import type { Board, Hand, PieceDefinition, RuleVariant } from "./types";

// 標準将棋の駒定義
export const STANDARD_PIECE_DEFINITIONS: PieceDefinition[] = [
  {
    type: "king",
    kanji: "王",
    value: 0,
    canPromote: false,
    movePatterns: [
      {
        type: "step",
        directions: [
          [-1, -1], [-1, 0], [-1, 1],
          [0, -1],           [0, 1],
          [1, -1],  [1, 0],  [1, 1],
        ],
      },
    ],
  },
  {
    type: "rook",
    kanji: "飛",
    kanjiPromoted: "竜",
    value: 10,
    canPromote: true,
    promotesTo: "promoted_rook",
    movePatterns: [
      {
        type: "slide",
        directions: [[-1, 0], [1, 0], [0, -1], [0, 1]],
      },
    ],
  },
  {
    type: "promoted_rook",
    kanji: "竜",
    value: 13,
    canPromote: false,
    movePatterns: [
      {
        type: "slide",
        directions: [[-1, 0], [1, 0], [0, -1], [0, 1]],
      },
      {
        type: "step",
        directions: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
      },
    ],
  },
  {
    type: "bishop",
    kanji: "角",
    kanjiPromoted: "馬",
    value: 8,
    canPromote: true,
    promotesTo: "promoted_bishop",
    movePatterns: [
      {
        type: "slide",
        directions: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
      },
    ],
  },
  {
    type: "promoted_bishop",
    kanji: "馬",
    value: 11,
    canPromote: false,
    movePatterns: [
      {
        type: "slide",
        directions: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
      },
      {
        type: "step",
        directions: [[-1, 0], [1, 0], [0, -1], [0, 1]],
      },
    ],
  },
  {
    type: "gold",
    kanji: "金",
    value: 6,
    canPromote: false,
    movePatterns: [
      {
        type: "step",
        directions: [
          [-1, -1], [-1, 0], [-1, 1],
          [0, -1],           [0, 1],
                    [1, 0],
        ],
      },
    ],
  },
  {
    type: "silver",
    kanji: "銀",
    kanjiPromoted: "全",
    value: 5,
    canPromote: true,
    promotesTo: "promoted_silver",
    movePatterns: [
      {
        type: "step",
        directions: [
          [-1, -1], [-1, 0], [-1, 1],
          [1, -1],           [1, 1],
        ],
      },
    ],
  },
  {
    type: "promoted_silver",
    kanji: "全",
    value: 6,
    canPromote: false,
    movePatterns: [
      {
        type: "step",
        directions: [
          [-1, -1], [-1, 0], [-1, 1],
          [0, -1],           [0, 1],
                    [1, 0],
        ],
      },
    ],
  },
  {
    type: "knight",
    kanji: "桂",
    kanjiPromoted: "圭",
    value: 4,
    canPromote: true,
    promotesTo: "promoted_knight",
    mustPromoteRows: 2, // 最終2段で強制成り
    movePatterns: [
      {
        type: "jump",
        directions: [[-2, -1], [-2, 1]],
      },
    ],
  },
  {
    type: "promoted_knight",
    kanji: "圭",
    value: 6,
    canPromote: false,
    movePatterns: [
      {
        type: "step",
        directions: [
          [-1, -1], [-1, 0], [-1, 1],
          [0, -1],           [0, 1],
                    [1, 0],
        ],
      },
    ],
  },
  {
    type: "lance",
    kanji: "香",
    kanjiPromoted: "杏",
    value: 3,
    canPromote: true,
    promotesTo: "promoted_lance",
    mustPromoteRows: 1, // 最終1段で強制成り
    movePatterns: [
      {
        type: "slide",
        directions: [[-1, 0]],
      },
    ],
  },
  {
    type: "promoted_lance",
    kanji: "杏",
    value: 6,
    canPromote: false,
    movePatterns: [
      {
        type: "step",
        directions: [
          [-1, -1], [-1, 0], [-1, 1],
          [0, -1],           [0, 1],
                    [1, 0],
        ],
      },
    ],
  },
  {
    type: "pawn",
    kanji: "歩",
    kanjiPromoted: "と",
    value: 1,
    canPromote: true,
    promotesTo: "promoted_pawn",
    mustPromoteRows: 1, // 最終1段で強制成り
    movePatterns: [
      {
        type: "step",
        directions: [[-1, 0]],
      },
    ],
  },
  {
    type: "promoted_pawn",
    kanji: "と",
    value: 6,
    canPromote: false,
    movePatterns: [
      {
        type: "step",
        directions: [
          [-1, -1], [-1, 0], [-1, 1],
          [0, -1],           [0, 1],
                    [1, 0],
        ],
      },
    ],
  },
];

// 駒タイプからPieceDefinitionを取得するマップ
export const PIECE_DEF_MAP = new Map<string, PieceDefinition>(
  STANDARD_PIECE_DEFINITIONS.map((def) => [def.type, def])
);

// 打ち駒の元の形（成り駒を元の駒に戻す）
export const UNPROMOTE_MAP: Record<string, string> = {
  promoted_rook: "rook",
  promoted_bishop: "bishop",
  promoted_silver: "silver",
  promoted_knight: "knight",
  promoted_lance: "lance",
  promoted_pawn: "pawn",
};

// 捕獲された駒を手駒に加える際、成り駒を元の形に戻す
export function unpromotePieceType(type: string): string {
  return UNPROMOTE_MAP[type] ?? type;
}

// 標準将棋の初期盤面
// row=0: 後手陣最奥（9段）、row=8: 先手陣最奥（1段）
// col=0: 右端（9筋）、col=8: 左端（1筋）
function createInitialBoard(boardSize: { rows: number; cols: number }): Board {
  const board: Board = Array(boardSize.rows)
    .fill(null)
    .map(() => Array(boardSize.cols).fill(null));

  // 後手の配置（row 0-2）
  // row=0: 後手の後衛（香桂銀金王金銀桂香）
  board[0][0] = { type: "lance", owner: "gote" };
  board[0][1] = { type: "knight", owner: "gote" };
  board[0][2] = { type: "silver", owner: "gote" };
  board[0][3] = { type: "gold", owner: "gote" };
  board[0][4] = { type: "king", owner: "gote" };
  board[0][5] = { type: "gold", owner: "gote" };
  board[0][6] = { type: "silver", owner: "gote" };
  board[0][7] = { type: "knight", owner: "gote" };
  board[0][8] = { type: "lance", owner: "gote" };

  // row=1: 後手の飛角
  board[1][1] = { type: "rook", owner: "gote" };
  board[1][7] = { type: "bishop", owner: "gote" };

  // row=2: 後手の歩
  for (let col = 0; col < 9; col++) {
    board[2][col] = { type: "pawn", owner: "gote" };
  }

  // 先手の配置（row 6-8）
  // row=6: 先手の歩
  for (let col = 0; col < 9; col++) {
    board[6][col] = { type: "pawn", owner: "sente" };
  }

  // row=7: 先手の飛角
  board[7][1] = { type: "bishop", owner: "sente" };
  board[7][7] = { type: "rook", owner: "sente" };

  // row=8: 先手の後衛（香桂銀金王金銀桂香）
  board[8][0] = { type: "lance", owner: "sente" };
  board[8][1] = { type: "knight", owner: "sente" };
  board[8][2] = { type: "silver", owner: "sente" };
  board[8][3] = { type: "gold", owner: "sente" };
  board[8][4] = { type: "king", owner: "sente" };
  board[8][5] = { type: "gold", owner: "sente" };
  board[8][6] = { type: "silver", owner: "sente" };
  board[8][7] = { type: "knight", owner: "sente" };
  board[8][8] = { type: "lance", owner: "sente" };

  return board;
}

// 標準将棋バリアント
export const STANDARD_VARIANT: RuleVariant = {
  id: "standard",
  name: "標準将棋",
  description: "9×9の標準的な将棋ルール",
  boardSize: { rows: 9, cols: 9 },
  pieces: STANDARD_PIECE_DEFINITIONS,
  initialSetup: createInitialBoard,
  rules: {
    allowDrop: true,
    promotionZoneRows: 3,
    checkRepetition: true,
    allowImpasse: true,
    impassePoints: { major: 5, minor: 1 },
    pawnDropCheckmate: true,
    doublePawn: true,
  },
};
