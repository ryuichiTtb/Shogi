import type { GameState, Player, RuleVariant } from "../../types";

// 駒の働き評価 (飛車のオープンファイル)。
//
// Issue #193 / PR2: evaluate.ts から分離。係数・走査順は分離元から
// 1 文字も変えていない (evaluate-equivalence.test.ts で担保)。

// 飛車のオープンファイル評価
// Issue #193 / PR1c: PR1c-2/PR1d/PR2 で外部参照するため export 化。本体ロジック不変。
export function evaluateRookFiles(
  state: GameState,
  player: Player,
  variant: RuleVariant
): number {
  let bonus = 0;
  const { rows, cols } = variant.boardSize;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const piece = state.board[row][col];
      if (!piece || piece.owner !== player) continue;
      if (piece.type !== "rook" && piece.type !== "promoted_rook") continue;

      // 同列に自分の歩がないか確認
      let hasFriendlyPawn = false;
      let hasEnemyPawn = false;
      for (let r = 0; r < rows; r++) {
        const p = state.board[r][col];
        if (p && p.type === "pawn") {
          if (p.owner === player) hasFriendlyPawn = true;
          else hasEnemyPawn = true;
        }
      }

      if (!hasFriendlyPawn && !hasEnemyPawn) {
        bonus += 30; // オープンファイル
      } else if (!hasFriendlyPawn) {
        bonus += 15; // セミオープンファイル
      }
    }
  }

  return bonus;
}
