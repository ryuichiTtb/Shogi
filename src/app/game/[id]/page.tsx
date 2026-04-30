export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { getGame } from "@/app/actions/game";
import { GameLayout } from "@/components/game/game-layout";

interface GamePageProps {
  params: Promise<{ id: string }>;
}

export default async function GamePage({ params }: GamePageProps) {
  const { id } = await params;
  const game = await getGame(id);

  if (!game) {
    notFound();
  }

  // variant(関数を含む)は Client Component に渡せないためシリアライズ可能な値のみ渡す
  const serializableConfig = {
    variantId: game.variantId,
    difficulty: game.gameConfig.difficulty,
    playerColor: game.gameConfig.playerColor,
    characterId: game.gameConfig.characterId,
    soundEnabled: game.gameConfig.soundEnabled,
    commentaryEnabled: game.gameConfig.commentaryEnabled,
  };

  return (
    <GameLayout
      initialGameState={game.boardState}
      initialCardState={game.cardState}
      gameId={id}
      gameConfig={serializableConfig}
    />
  );
}
