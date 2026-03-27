export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { getGame } from "@/app/actions/game";
import { ShogiGame } from "@/components/game/shogi-game";
import { deserializeGameState } from "@/lib/shogi/board";
import { getVariantById } from "@/lib/shogi/variants/index";
import type { GameConfig } from "@/lib/shogi/types";

interface GamePageProps {
  params: Promise<{ id: string }>;
}

export default async function GamePage({ params }: GamePageProps) {
  const { id } = await params;
  const game = await getGame(id);

  if (!game) {
    notFound();
  }

  const gameState = deserializeGameState(game.boardState as object);
  const gameConfig = game.gameConfig as GameConfig;

  // バリアントIDからバリアントを復元
  try {
    const variant = getVariantById(game.variantId);
    gameConfig.variant = variant;
  } catch {
    const { STANDARD_VARIANT } = await import("@/lib/shogi/variants/standard");
    gameConfig.variant = STANDARD_VARIANT;
  }

  return (
    <main className="min-h-screen py-4">
      <ShogiGame
        initialGameState={gameState}
        gameId={id}
        gameConfig={gameConfig}
      />
    </main>
  );
}
