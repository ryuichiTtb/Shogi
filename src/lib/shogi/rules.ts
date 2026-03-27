import type { GameState, Player, RuleVariant } from "./types";
import { STANDARD_VARIANT } from "./variants/standard";
import { isInCheck, isCheckmate, getFullLegalMoves, findKing } from "./moves";

export { isInCheck, isCheckmate };

// 千日手判定（同一局面が4回出現）
export function isRepetition(state: GameState): boolean {
  const current = state.positionHistory[state.positionHistory.length - 1];
  let count = 0;
  for (const pos of state.positionHistory) {
    if (pos === current) count++;
  }
  return count >= 4;
}

// 連続王手の千日手（打ち歩詰めと類似、王手し続けた側が負け）
export function isPerpetualCheck(state: GameState, variant: RuleVariant = STANDARD_VARIANT): boolean {
  if (!isRepetition(state)) return false;

  // 直近の繰り返しが全て王手だった場合
  const lastMoves = state.moveHistory.slice(-8);
  if (lastMoves.length < 8) return false;

  // 繰り返しパターンの中で常に王手をかけ続けた側を特定
  // 簡易実装: 最後の4手が全て王手だった側を判定
  // TODO: より正確な実装
  return false;
}

// 持将棋判定（双方の玉が入玉し、どちらも詰められない状態）
export function checkImpasse(
  state: GameState,
  variant: RuleVariant = STANDARD_VARIANT
): { isImpasse: boolean; winner?: Player | "draw" } {
  if (!variant.rules.allowImpasse) return { isImpasse: false };

  const { impassePoints } = variant.rules;
  const { rows } = variant.boardSize;
  const promotionZoneRows = variant.rules.promotionZoneRows;

  // 両玉が入玉しているか確認
  const senteKing = findKing(state.board, "sente", variant.boardSize);
  const goteKing = findKing(state.board, "gote", variant.boardSize);

  if (!senteKing || !goteKing) return { isImpasse: false };

  const senteInZone = senteKing.row < promotionZoneRows;
  const goteInZone = goteKing.row >= rows - promotionZoneRows;

  if (!senteInZone || !goteInZone) return { isImpasse: false };

  // 点数計算
  const senteScore = calculateImpasseScore(state, "sente", variant);
  const goteScore = calculateImpasseScore(state, "gote", variant);

  const threshold = 24;

  if (senteScore >= threshold && goteScore >= threshold) {
    return { isImpasse: true, winner: "draw" };
  } else if (senteScore >= threshold) {
    return { isImpasse: true, winner: "sente" };
  } else if (goteScore >= threshold) {
    return { isImpasse: true, winner: "gote" };
  }

  return { isImpasse: true, winner: "draw" };
}

// 持将棋の点数計算
function calculateImpasseScore(
  state: GameState,
  player: Player,
  variant: RuleVariant
): number {
  const { impassePoints, promotionZoneRows } = variant.rules;
  const { rows } = variant.boardSize;
  const MAJOR_PIECES = new Set(["rook", "bishop", "promoted_rook", "promoted_bishop"]);

  let score = 0;

  // 入玉ゾーン内の駒を数える
  const startRow = player === "sente" ? 0 : rows - promotionZoneRows;
  const endRow = player === "sente" ? promotionZoneRows : rows;

  for (let row = startRow; row < endRow; row++) {
    for (let col = 0; col < variant.boardSize.cols; col++) {
      const piece = state.board[row][col];
      if (piece && piece.owner === player && piece.type !== "king") {
        score += MAJOR_PIECES.has(piece.type)
          ? impassePoints.major
          : impassePoints.minor;
      }
    }
  }

  // 手駒
  for (const [type, count] of Object.entries(state.hand[player])) {
    if (!count) continue;
    score += (MAJOR_PIECES.has(type) ? impassePoints.major : impassePoints.minor) * count;
  }

  return score;
}

// ゲーム終了状態を確認・更新
export function evaluateGameEnd(
  state: GameState,
  variant: RuleVariant = STANDARD_VARIANT
): GameState {
  if (state.status !== "active") return state;

  const currentPlayer = state.currentPlayer;

  // 王手詰み
  if (isCheckmate(state, currentPlayer, variant)) {
    const winner: Player = currentPlayer === "sente" ? "gote" : "sente";
    return { ...state, status: "checkmate", winner };
  }

  // 合法手なし（ステールメート - 将棋では極めて稀）
  if (getFullLegalMoves(state, currentPlayer, variant).length === 0) {
    const winner: Player = currentPlayer === "sente" ? "gote" : "sente";
    return { ...state, status: "stalemate", winner };
  }

  // 千日手
  if (isRepetition(state)) {
    return { ...state, status: "repetition", winner: "draw" };
  }

  // 持将棋チェック（必要に応じて）
  const impasseResult = checkImpasse(state, variant);
  if (impasseResult.isImpasse) {
    return { ...state, status: "impasse", winner: impasseResult.winner };
  }

  return state;
}
