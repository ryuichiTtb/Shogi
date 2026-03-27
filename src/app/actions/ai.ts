"use server";

import { calculateAiMove } from "@/lib/shogi/ai/engine";
import { STANDARD_VARIANT, getVariantById } from "@/lib/shogi/variants/index";
import type { Difficulty, GameState, Move, Player } from "@/lib/shogi/types";

interface AiMoveRequest {
  gameState: GameState;
  player: Player;
  difficulty: Difficulty;
  variantId?: string;
}

// AIの最善手を計算するサーバーアクション
export async function getAiMove(request: AiMoveRequest): Promise<Move | null> {
  const { gameState, player, difficulty, variantId } = request;

  const variant = variantId ? getVariantById(variantId) : STANDARD_VARIANT;

  // サーバー側でAI計算（CPUを使うためサーバー側が適切）
  const move = calculateAiMove(gameState, player, difficulty, variant);

  return move;
}
