import { CardShogiGame } from "@/components/game/card-shogi/card-shogi-game";
import {
  getCardShogiLayoutFixture,
  normalizeCardShogiLayoutScenario,
} from "@/lib/dev/card-shogi-layout-fixtures";

interface CardShogiLayoutDevPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CardShogiLayoutDevPage({ searchParams }: CardShogiLayoutDevPageProps) {
  const params = await searchParams;
  const scenario = normalizeCardShogiLayoutScenario(
    Array.isArray(params.scenario) ? params.scenario[0] : params.scenario,
  );
  const fixture = getCardShogiLayoutFixture(scenario);

  return (
    <CardShogiGame
      initialGameState={fixture.gameState}
      initialCardState={fixture.cardState}
      gameId={`dev-card-shogi-layout-${scenario}`}
      gameConfig={{
        variantId: "card-shogi",
        difficulty: "beginner",
        playerColor: "sente",
        characterId: "sakura",
        soundEnabled: false,
        commentaryEnabled: false,
      }}
      debugInitialUi={fixture.debugInitialUi}
      debugDisableServerEffects
      enableBgm={false}
    />
  );
}
