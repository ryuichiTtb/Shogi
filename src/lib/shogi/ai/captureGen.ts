import type { GameState, Move, Player, Position, RuleVariant } from "../types";
import { STANDARD_VARIANT, PIECE_DEF_MAP } from "../variants/standard";
import { applyMoveForSearch } from "../board";
import { isInCheck } from "../moves";

// 駒の価値テーブル（MVV-LVA用）
const MVV_LVA_VALUES: Record<string, number> = {
  pawn: 100, lance: 300, knight: 400, silver: 500, gold: 600,
  bishop: 800, rook: 1000, promoted_pawn: 600, promoted_lance: 600,
  promoted_knight: 600, promoted_silver: 600, promoted_bishop: 1100,
  promoted_rook: 1300, king: 10000,
};

// 成りゾーン判定
function inPromotionZone(row: number, player: Player, rows: number, zoneRows: number): boolean {
  return player === "sente" ? row < zoneRows : row >= rows - zoneRows;
}

// 探索用の取り駒生成（全合法手生成を避け、取り駒のみ直接生成）
// 王手放置チェック付き、MVV-LVAソート済み
export function getCaptureMovesForSearch(
  state: GameState,
  player: Player,
  variant: RuleVariant = STANDARD_VARIANT
): Move[] {
  const captures: Move[] = [];
  const { rows, cols } = variant.boardSize;
  const board = state.board;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const piece = board[row][col];
      if (!piece || piece.owner !== player) continue;

      const def = PIECE_DEF_MAP.get(piece.type);
      if (!def) continue;

      for (const pattern of def.movePatterns) {
        for (const [dr, dc] of pattern.directions) {
          const actualDr = player === "sente" ? dr : -dr;
          const actualDc = player === "sente" ? dc : -dc;

          if (pattern.type === "step" || pattern.type === "jump") {
            const toRow = row + actualDr;
            const toCol = col + actualDc;
            if (toRow < 0 || toRow >= rows || toCol < 0 || toCol >= cols) continue;

            const target = board[toRow][toCol];
            if (!target || target.owner === player) continue; // 取り駒のみ

            const from: Position = { row, col };
            const to: Position = { row: toRow, col: toCol };
            const mustPromote = mustPromoteAfterMove(to, piece.type, player, variant);
            const canPromote = canPromoteMoveFast(from, to, player, rows, piece.type, variant);

            if (mustPromote) {
              captures.push({
                type: "move", from, to, piece: piece.type,
                captured: target.type, promote: true, player,
              });
            } else {
              captures.push({
                type: "move", from, to, piece: piece.type,
                captured: target.type, promote: false, player,
              });
              if (canPromote) {
                captures.push({
                  type: "move", from, to, piece: piece.type,
                  captured: target.type, promote: true, player,
                });
              }
            }
          } else if (pattern.type === "slide") {
            let r = row + actualDr;
            let c = col + actualDc;
            while (r >= 0 && r < rows && c >= 0 && c < cols) {
              const target = board[r][c];
              if (target) {
                if (target.owner !== player) {
                  const from: Position = { row, col };
                  const to: Position = { row: r, col: c };
                  const mustPromote = mustPromoteAfterMove(to, piece.type, player, variant);
                  const canPromote = canPromoteMoveFast(from, to, player, rows, piece.type, variant);

                  if (mustPromote) {
                    captures.push({
                      type: "move", from, to, piece: piece.type,
                      captured: target.type, promote: true, player,
                    });
                  } else {
                    captures.push({
                      type: "move", from, to, piece: piece.type,
                      captured: target.type, promote: false, player,
                    });
                    if (canPromote) {
                      captures.push({
                        type: "move", from, to, piece: piece.type,
                        captured: target.type, promote: true, player,
                      });
                    }
                  }
                }
                break;
              }
              r += actualDr;
              c += actualDc;
            }
          }
        }
      }
    }
  }

  // 王手放置チェック
  const legalCaptures = captures.filter((move) => {
    const nextState = applyMoveForSearch(state, move);
    return !isInCheck(nextState, player, variant);
  });

  // MVV-LVAソート
  return legalCaptures.sort((a, b) => {
    const aVal = (MVV_LVA_VALUES[a.captured!] ?? 0) - (MVV_LVA_VALUES[a.piece] ?? 0) * 0.1;
    const bVal = (MVV_LVA_VALUES[b.captured!] ?? 0) - (MVV_LVA_VALUES[b.piece] ?? 0) * 0.1;
    return bVal - aVal;
  });
}

function mustPromoteAfterMove(
  to: Position, pieceType: string, player: Player, variant: RuleVariant
): boolean {
  const def = PIECE_DEF_MAP.get(pieceType);
  if (!def || !def.mustPromoteRows) return false;
  const { rows } = variant.boardSize;
  if (player === "sente") return to.row < def.mustPromoteRows;
  return to.row >= rows - def.mustPromoteRows;
}

function canPromoteMoveFast(
  from: Position, to: Position, player: Player, rows: number,
  pieceType: string, variant: RuleVariant
): boolean {
  const def = PIECE_DEF_MAP.get(pieceType);
  if (!def || !def.canPromote || !def.promotesTo) return false;
  const zone = variant.rules.promotionZoneRows;
  const fromInZone = inPromotionZone(from.row, player, rows, zone);
  const toInZone = inPromotionZone(to.row, player, rows, zone);
  return fromInZone || toInZone;
}
