"use client";

import { ShogiGame } from "./shogi-game";
import { CardShogiGame } from "./card-shogi/card-shogi-game";
import type { Difficulty, GameState, Player } from "@/lib/shogi/types";
import type { CardGameState } from "@/lib/shogi/cards/types";

interface SerializableGameConfig {
  variantId: string;
  difficulty: Difficulty;
  playerColor: Player;
  characterId: string;
  soundEnabled: boolean;
  commentaryEnabled: boolean;
}

interface GameLayoutProps {
  initialGameState: GameState;
  initialCardState: CardGameState | null;
  gameId: string;
  gameConfig: SerializableGameConfig;
}

// variantId に応じて適切なゲーム画面コンポーネントをレンダリングする。
// 標準将棋(standard)は既存の <ShogiGame> を無修正で呼ぶ(回帰防止)。
// カード将棋(card-shogi)は新規 <CardShogiGame> を呼ぶ。
export function GameLayout({
  initialGameState,
  initialCardState,
  gameId,
  gameConfig,
}: GameLayoutProps) {
  if (gameConfig.variantId === "card-shogi") {
    if (!initialCardState) {
      throw new Error("card-shogi variant requires initialCardState");
    }
    return (
      <CardShogiGame
        initialGameState={initialGameState}
        initialCardState={initialCardState}
        gameId={gameId}
        gameConfig={gameConfig}
      />
    );
  }

  return (
    <ShogiGame
      initialGameState={initialGameState}
      gameId={gameId}
      gameConfig={gameConfig}
    />
  );
}
