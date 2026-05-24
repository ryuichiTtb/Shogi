import type { GameState } from "../../types";

// 持ち駒価値評価。
//
// Issue #193 / PR2: evaluate.ts にインライン展開されていた手駒ループを純粋関数
// として抽出。evaluate / evaluateWithBreakdown の双方から本関数を呼ぶことで
// Object.entries の列挙順・係数・加減算順を完全一致させる
// (evaluate-equivalence.test.ts で担保)。

// 手駒の価値（盤上より少し高い - 柔軟性のため）
export const HAND_PIECE_VALUES: Record<string, number> = {
  pawn: 110,
  lance: 330,
  knight: 440,
  silver: 550,
  gold: 660,
  bishop: 880,
  rook: 1100,
};

// 手駒の評価 (先手 +、後手 -)。
export function computeHandValue(state: GameState): number {
  let hand = 0;

  for (const [type, count] of Object.entries(state.hand.sente)) {
    hand += (HAND_PIECE_VALUES[type] ?? 100) * (count ?? 0);
  }
  for (const [type, count] of Object.entries(state.hand.gote)) {
    hand -= (HAND_PIECE_VALUES[type] ?? 100) * (count ?? 0);
  }

  return hand;
}
