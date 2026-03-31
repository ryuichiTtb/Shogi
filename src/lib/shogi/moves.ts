import type {
  Board,
  GameState,
  Hand,
  Move,
  Piece,
  PieceDefinition,
  Player,
  Position,
  RuleVariant,
} from "./types";
import { STANDARD_VARIANT, PIECE_DEF_MAP } from "./variants/standard";
import { applyMove, cloneGameState, isInPromotionZone } from "./board";

// 駒の価値テーブル（MVV-LVA用）
const MVV_LVA_VALUES: Record<string, number> = {
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

// 取り駒のみを返す（MVV-LVAでソート済み）
export function getCaptureMoves(
  state: GameState,
  player: Player,
  variant: RuleVariant = STANDARD_VARIANT
): Move[] {
  const allMoves = getFullLegalMoves(state, player, variant);
  const captures = allMoves.filter((m) => m.captured !== undefined);
  return captures.sort((a, b) => {
    const aVal = (MVV_LVA_VALUES[a.captured!] ?? 0) - (MVV_LVA_VALUES[a.piece] ?? 0) * 0.1;
    const bVal = (MVV_LVA_VALUES[b.captured!] ?? 0) - (MVV_LVA_VALUES[b.piece] ?? 0) * 0.1;
    return bVal - aVal;
  });
}

// 指定プレイヤーの全合法手を生成
export function getLegalMoves(state: GameState, player: Player, variant: RuleVariant = STANDARD_VARIANT): Move[] {
  const pseudoMoves = getPseudoMoves(state, player, variant);
  // 王を取られる手を除外
  return pseudoMoves.filter((move) => !leavesKingInCheck(state, move, player, variant));
}

// 疑似合法手（王手放置を含む）を生成
function getPseudoMoves(state: GameState, player: Player, variant: RuleVariant): Move[] {
  const moves: Move[] = [];

  // 盤上の駒の移動
  for (let row = 0; row < variant.boardSize.rows; row++) {
    for (let col = 0; col < variant.boardSize.cols; col++) {
      const piece = state.board[row][col];
      if (piece && piece.owner === player) {
        const pieceMoves = getPieceMoves(state, { row, col }, player, variant);
        moves.push(...pieceMoves);
      }
    }
  }

  // 打ち駒
  if (variant.rules.allowDrop) {
    const dropMoves = getDropMoves(state, player, variant);
    moves.push(...dropMoves);
  }

  return moves;
}

// 特定のマスにある駒の移動候補を生成
export function getPieceMoves(
  state: GameState,
  from: Position,
  player: Player,
  variant: RuleVariant = STANDARD_VARIANT
): Move[] {
  const piece = state.board[from.row][from.col];
  if (!piece || piece.owner !== player) return [];

  const def = getPieceDef(piece.type, variant);
  if (!def) return [];

  const moves: Move[] = [];
  const { rows, cols } = variant.boardSize;

  for (const pattern of def.movePatterns) {
    for (const [dr, dc] of pattern.directions) {
      // 後手は方向を反転
      const actualDr = player === "sente" ? dr : -dr;
      const actualDc = player === "sente" ? dc : -dc;

      if (pattern.type === "step" || pattern.type === "jump") {
        const toRow = from.row + actualDr;
        const toCol = from.col + actualDc;

        if (!isValidPos(toRow, toCol, rows, cols)) continue;

        const target = state.board[toRow][toCol];
        if (target && target.owner === player) continue; // 自駒には行けない

        const canPromote = canPromoteMove(from, { row: toRow, col: toCol }, piece, player, variant);
        const mustPromote = mustPromoteAfterMove({ row: toRow, col: toCol }, piece, player, variant);

        if (mustPromote) {
          moves.push(createMove(player, from, { row: toRow, col: toCol }, piece.type, target?.type, true));
        } else {
          moves.push(createMove(player, from, { row: toRow, col: toCol }, piece.type, target?.type, false));
          if (canPromote) {
            moves.push(createMove(player, from, { row: toRow, col: toCol }, piece.type, target?.type, true));
          }
        }
      } else if (pattern.type === "slide") {
        let r = from.row + actualDr;
        let c = from.col + actualDc;

        while (isValidPos(r, c, rows, cols)) {
          const target = state.board[r][c];

          if (target) {
            if (target.owner !== player) {
              // 敵駒を取る
              const canPromote = canPromoteMove(from, { row: r, col: c }, piece, player, variant);
              const mustPromote = mustPromoteAfterMove({ row: r, col: c }, piece, player, variant);

              if (mustPromote) {
                moves.push(createMove(player, from, { row: r, col: c }, piece.type, target.type, true));
              } else {
                moves.push(createMove(player, from, { row: r, col: c }, piece.type, target.type, false));
                if (canPromote) {
                  moves.push(createMove(player, from, { row: r, col: c }, piece.type, target.type, true));
                }
              }
            }
            break; // 駒があったらそれ以上進めない
          }

          const canPromote = canPromoteMove(from, { row: r, col: c }, piece, player, variant);
          const mustPromote = mustPromoteAfterMove({ row: r, col: c }, piece, player, variant);

          if (mustPromote) {
            moves.push(createMove(player, from, { row: r, col: c }, piece.type, undefined, true));
          } else {
            moves.push(createMove(player, from, { row: r, col: c }, piece.type, undefined, false));
            if (canPromote) {
              moves.push(createMove(player, from, { row: r, col: c }, piece.type, undefined, true));
            }
          }

          r += actualDr;
          c += actualDc;
        }
      }
    }
  }

  return moves;
}

// 打ち駒候補を生成
export function getDropMoves(
  state: GameState,
  player: Player,
  variant: RuleVariant = STANDARD_VARIANT
): Move[] {
  const moves: Move[] = [];
  const hand = state.hand[player];
  const { rows, cols } = variant.boardSize;

  for (const [pieceType, count] of Object.entries(hand)) {
    if (!count || count <= 0) continue;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (state.board[row][col]) continue; // マスが空でない

        const to = { row, col };

        // 行き場のない打ち禁止チェック
        if (hasNoFutureMoves(pieceType, to, player, variant)) continue;

        // 二歩チェック
        if (variant.rules.doublePawn && pieceType === "pawn") {
          if (hasPawnInColumn(state.board, col, player)) continue;
        }

        moves.push({
          type: "drop",
          to,
          piece: pieceType,
          dropPiece: pieceType,
          player,
        });
      }
    }
  }

  return moves;
}

// 王手放置の確認
function leavesKingInCheck(
  state: GameState,
  move: Move,
  player: Player,
  variant: RuleVariant
): boolean {
  const nextState = applyMove(state, move);
  return isInCheck(nextState, player, variant);
}

// 王手判定
export function isInCheck(state: GameState, player: Player, variant: RuleVariant = STANDARD_VARIANT): boolean {
  const kingPos = findKing(state.board, player, variant.boardSize);
  if (!kingPos) return false;

  const opponent: Player = player === "sente" ? "gote" : "sente";
  const opponentMoves = getPseudoMoves(state, opponent, variant);

  return opponentMoves.some(
    (m) => m.type === "move" && m.to.row === kingPos.row && m.to.col === kingPos.col
  );
}

// 詰み判定
export function isCheckmate(state: GameState, player: Player, variant: RuleVariant = STANDARD_VARIANT): boolean {
  if (!isInCheck(state, player, variant)) return false;
  return getLegalMoves(state, player, variant).length === 0;
}

// 打ち歩詰め判定
export function isPawnDropCheckmate(
  state: GameState,
  move: Move,
  variant: RuleVariant = STANDARD_VARIANT
): boolean {
  if (!variant.rules.pawnDropCheckmate) return false;
  if (move.type !== "drop" || move.dropPiece !== "pawn") return false;

  const nextState = applyMove(state, move);
  const opponent: Player = move.player === "sente" ? "gote" : "sente";
  return isCheckmate(nextState, opponent, variant);
}

// 打ち歩詰めを除外した合法手
export function getLegalDropMoves(
  state: GameState,
  player: Player,
  variant: RuleVariant = STANDARD_VARIANT
): Move[] {
  const dropMoves = getDropMoves(state, player, variant).filter(
    (m) => !leavesKingInCheck(state, m, player, variant)
  );

  if (!variant.rules.pawnDropCheckmate) return dropMoves;

  return dropMoves.filter((m) => !isPawnDropCheckmate(state, m, variant));
}

// 完全な合法手（打ち歩詰め考慮）
export function getFullLegalMoves(
  state: GameState,
  player: Player,
  variant: RuleVariant = STANDARD_VARIANT
): Move[] {
  const boardMoves = getPieceMoves_all(state, player, variant).filter(
    (m) => !leavesKingInCheck(state, m, player, variant)
  );
  const dropMoves = getLegalDropMoves(state, player, variant);
  return [...boardMoves, ...dropMoves];
}

function getPieceMoves_all(
  state: GameState,
  player: Player,
  variant: RuleVariant
): Move[] {
  const moves: Move[] = [];
  for (let row = 0; row < variant.boardSize.rows; row++) {
    for (let col = 0; col < variant.boardSize.cols; col++) {
      const piece = state.board[row][col];
      if (piece && piece.owner === player) {
        moves.push(...getPieceMoves(state, { row, col }, player, variant));
      }
    }
  }
  return moves;
}

// ヘルパー関数

function isValidPos(row: number, col: number, rows: number, cols: number): boolean {
  return row >= 0 && row < rows && col >= 0 && col < cols;
}

function getPieceDef(type: string, variant: RuleVariant): PieceDefinition | undefined {
  return variant.pieces.find((p) => p.type === type);
}

function createMove(
  player: Player,
  from: Position,
  to: Position,
  piece: string,
  captured: string | undefined,
  promote: boolean
): Move {
  return {
    type: "move",
    from,
    to,
    piece,
    captured,
    promote,
    player,
  };
}

function canPromoteMove(
  from: Position,
  to: Position,
  piece: Piece,
  player: Player,
  variant: RuleVariant
): boolean {
  const def = getPieceDef(piece.type, variant);
  if (!def || !def.canPromote || !def.promotesTo) return false;

  const { rows } = variant.boardSize;
  const { promotionZoneRows } = variant.rules;

  const fromInZone = isInPromotionZone(from.row, player, rows, promotionZoneRows);
  const toInZone = isInPromotionZone(to.row, player, rows, promotionZoneRows);

  return fromInZone || toInZone;
}

function mustPromoteAfterMove(
  to: Position,
  piece: Piece,
  player: Player,
  variant: RuleVariant
): boolean {
  const def = getPieceDef(piece.type, variant);
  if (!def || !def.mustPromoteRows) return false;

  const { rows } = variant.boardSize;
  const mustRows = def.mustPromoteRows;

  if (player === "sente") {
    return to.row < mustRows;
  } else {
    return to.row >= rows - mustRows;
  }
}

// 行き場のない駒の判定（打ち駒の制限）
function hasNoFutureMoves(
  pieceType: string,
  to: Position,
  player: Player,
  variant: RuleVariant
): boolean {
  const def = getPieceDef(pieceType, variant);
  if (!def) return false;

  // 移動先で合法的な移動先が1つもないか確認
  const { rows, cols } = variant.boardSize;

  for (const pattern of def.movePatterns) {
    for (const [dr, dc] of pattern.directions) {
      const actualDr = player === "sente" ? dr : -dr;
      const r = to.row + actualDr;
      const c = to.col + dc;

      if (pattern.type === "jump") {
        const actualDc = player === "sente" ? dc : dc; // 桂馬は横方向はそのまま
        const jr = to.row + (player === "sente" ? dr : -dr);
        const jc = to.col + actualDc;
        if (isValidPos(jr, jc, rows, cols)) return false;
      } else {
        if (isValidPos(r, c, rows, cols)) return false;
      }
    }
  }

  return true;
}

// 同じ列に自分の歩があるか（二歩チェック）
function hasPawnInColumn(board: Board, col: number, player: Player): boolean {
  for (let row = 0; row < board.length; row++) {
    const piece = board[row][col];
    if (piece && piece.owner === player && piece.type === "pawn") {
      return true;
    }
  }
  return false;
}

// 玉の位置を探す
export function findKing(
  board: Board,
  player: Player,
  boardSize: { rows: number; cols: number }
): Position | null {
  for (let row = 0; row < boardSize.rows; row++) {
    for (let col = 0; col < boardSize.cols; col++) {
      const piece = board[row][col];
      if (piece && piece.owner === player && piece.type === "king") {
        return { row, col };
      }
    }
  }
  return null;
}

// 指定マスに特定プレイヤーが利いているか
export function isSquareAttacked(
  state: GameState,
  pos: Position,
  attackingPlayer: Player,
  variant: RuleVariant = STANDARD_VARIANT
): boolean {
  const pseudoMoves = getPseudoMoves(state, attackingPlayer, variant);
  return pseudoMoves.some(
    (m) => m.type === "move" && m.to.row === pos.row && m.to.col === pos.col
  );
}
