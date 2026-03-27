import type {
  Board,
  GameState,
  Hand,
  Move,
  Piece,
  Player,
  Position,
  RuleVariant,
} from "./types";
import { STANDARD_VARIANT } from "./variants/standard";
import { unpromotePieceType } from "./variants/standard";

// 初期ゲーム状態を作成
export function createInitialGameState(variant: RuleVariant = STANDARD_VARIANT): GameState {
  const board = variant.initialSetup(variant.boardSize);
  const hand: Hand = {
    sente: {},
    gote: {},
  };

  const state: GameState = {
    board,
    hand,
    currentPlayer: "sente",
    moveHistory: [],
    positionHistory: [],
    status: "active",
    moveCount: 0,
  };

  state.positionHistory = [serializePosition(state)];
  return state;
}

// 盤面をディープコピー
export function cloneBoard(board: Board): Board {
  return board.map((row) => row.map((piece) => (piece ? { ...piece } : null)));
}

// 手駒をディープコピー
export function cloneHand(hand: Hand): Hand {
  return {
    sente: { ...hand.sente },
    gote: { ...hand.gote },
  };
}

// ゲーム状態をディープコピー
export function cloneGameState(state: GameState): GameState {
  return {
    ...state,
    board: cloneBoard(state.board),
    hand: cloneHand(state.hand),
    moveHistory: [...state.moveHistory],
    positionHistory: [...state.positionHistory],
  };
}

// 手を適用して新しいゲーム状態を返す（元の状態は変更しない）
export function applyMove(state: GameState, move: Move): GameState {
  const next = cloneGameState(state);

  if (move.type === "drop") {
    // 打ち駒
    const piece = move.dropPiece!;
    next.board[move.to.row][move.to.col] = {
      type: piece,
      owner: move.player,
    };
    // 手駒を減らす
    const count = next.hand[move.player][piece] ?? 0;
    if (count <= 1) {
      delete next.hand[move.player][piece];
    } else {
      next.hand[move.player][piece] = count - 1;
    }
  } else {
    // 移動
    const fromPiece = next.board[move.from!.row][move.from!.col]!;
    const captured = next.board[move.to.row][move.to.col];

    // 捕獲処理
    if (captured) {
      const capturedBase = unpromotePieceType(captured.type);
      const currentCount = next.hand[move.player][capturedBase] ?? 0;
      next.hand[move.player][capturedBase] = currentCount + 1;
    }

    // 駒を移動
    next.board[move.from!.row][move.from!.col] = null;
    next.board[move.to.row][move.to.col] = {
      type: move.promote ? fromPiece.type + "_promoted_temp" : fromPiece.type,
      owner: move.player,
    };

    // 成り処理
    if (move.promote && move.piece) {
      const variant = STANDARD_VARIANT;
      const def = variant.pieces.find((p) => p.type === fromPiece.type);
      if (def?.promotesTo) {
        next.board[move.to.row][move.to.col] = {
          type: def.promotesTo,
          owner: move.player,
        };
      }
    } else {
      next.board[move.to.row][move.to.col] = {
        type: fromPiece.type,
        owner: move.player,
      };
    }
  }

  next.currentPlayer = move.player === "sente" ? "gote" : "sente";
  next.moveHistory = [...state.moveHistory, move];
  next.moveCount = state.moveCount + 1;

  const posHash = serializePosition(next);
  next.positionHistory = [...state.positionHistory, posHash];

  return next;
}

// 指定マスの駒を取得
export function getPieceAt(board: Board, pos: Position): Piece | null {
  return board[pos.row]?.[pos.col] ?? null;
}

// 局面のシリアライズ（千日手検出用）
export function serializePosition(state: GameState): string {
  const boardStr = state.board
    .map((row) =>
      row
        .map((p) => (p ? `${p.owner[0]}${p.type}` : "0"))
        .join(",")
    )
    .join("|");

  const handStr = Object.entries(state.hand)
    .map(([player, pieces]) =>
      Object.entries(pieces)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([type, count]) => `${player[0]}${type}:${count}`)
        .join(",")
    )
    .join("|");

  return `${state.currentPlayer}|${boardStr}|${handStr}`;
}

// 先手・後手の視点変換（行番号）
// 先手にとっての「前」は row が減る方向（row=8から0に向かう）
// 後手にとっての「前」は row が増える方向（row=0から8に向かう）
export function toPlayerDirection(row: number, col: number, player: Player, boardRows: number): [number, number] {
  if (player === "sente") {
    return [row, col];
  }
  // 後手は盤面を反転した視点
  return [boardRows - 1 - row, col];
}

// 成りゾーンにいるか判定
export function isInPromotionZone(
  row: number,
  player: Player,
  boardRows: number,
  promotionZoneRows: number
): boolean {
  if (player === "sente") {
    return row < promotionZoneRows;
  } else {
    return row >= boardRows - promotionZoneRows;
  }
}

// 手駒の一覧を配列として返す
export function getHandPieces(hand: Hand, player: Player): Array<{ type: string; count: number }> {
  return Object.entries(hand[player])
    .filter(([, count]) => (count ?? 0) > 0)
    .map(([type, count]) => ({ type, count: count! }));
}

// ゲーム状態をJSONシリアライズ可能な形式に変換
export function serializeGameState(state: GameState): object {
  return {
    ...state,
    board: state.board.map((row) =>
      row.map((piece) => (piece ? { type: piece.type, owner: piece.owner } : null))
    ),
  };
}

// JSONからゲーム状態を復元
export function deserializeGameState(data: unknown): GameState {
  return data as GameState;
}
