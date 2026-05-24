import type { GameState, Player, RuleVariant } from "../../types";

// 成り込み脅威検知。
//
// Issue #193 / PR2: evaluate.ts から分離。閾値・係数・判定順は分離元から
// 1 文字も変えていない (evaluate-equivalence.test.ts で担保)。

// 成り可能な駒タイプ（成りゾーン脅威検知用）
const PROMOTABLE_TYPES = new Set(["pawn", "lance", "knight", "silver", "bishop", "rook"]);

// 成り込み脅威ペナルティ（成りゾーン内）
const PROMOTION_THREAT: Record<string, number> = {
  rook: 150, bishop: 120, silver: 30, pawn: 100, lance: 80, knight: 20,
};

// 成りゾーン1マス手前のペナルティ（次の手で成りゾーンに入れる）
const PROMOTION_IMMINENT_THREAT: Record<string, number> = {
  pawn: 60, lance: 50,
};

// 相手の未成り駒が成りゾーンに侵入している場合のペナルティ
// Issue #193 / PR1c: PR1c-2/PR1d/PR2 で外部参照するため export 化。本体ロジック不変。
export function evaluatePromotionThreats(
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
      } else {
        // 成りゾーンの1マス手前にいるか判定（次の手で成れる）
        const oneStepFromZone = opponent === "sente"
          ? row === zoneRows      // senteの成りゾーンはrow < 3、row=3が1マス手前
          : row === rows - zoneRows - 1; // goteの成りゾーンはrow >= 6、row=5が1マス手前

        if (oneStepFromZone) {
          const imminentPenalty = PROMOTION_IMMINENT_THREAT[piece.type];
          if (imminentPenalty) {
            penalty -= imminentPenalty;
          }
        }
      }
    }
  }

  return penalty;
}
