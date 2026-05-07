"use client";

import { ShogiGame } from "./shogi-game";
import { CardShogiGame } from "./card-shogi/card-shogi-game";
import { AppBackground } from "@/components/layout/app-background";
import { LoadingOverlay } from "@/components/loading-overlay";
import { useIsBoardLayoutReady } from "@/components/board-layout/board-layout-provider";
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
//
// Issue #177: 対局画面全体背景は共通の AppBackground (青海波 + オーブ) で統一。
// 将棋盤マス背景は app/layout.tsx 配下の BoardLayoutProvider が永続化した
// ユーザー選択を ShogiBoard 内で読み取って適用する (/board-design ページから設定)。
//
// Issue #177 派生: 木目テクスチャ画像が未ロードの間は LoadingOverlay で待つ。
// 初回マウント時に「単色 → テクスチャ」のフラッシュが起きないよう描画を保留する。
export function GameLayout({
  initialGameState,
  initialCardState,
  gameId,
  gameConfig,
}: GameLayoutProps) {
  const boardReady = useIsBoardLayoutReady();

  if (!boardReady) {
    return (
      <>
        <AppBackground variant="setup" />
        <LoadingOverlay show fullScreen card progress />
      </>
    );
  }

  if (gameConfig.variantId === "card-shogi") {
    if (!initialCardState) {
      throw new Error("card-shogi variant requires initialCardState");
    }
    return (
      <>
        <AppBackground variant="setup" />
        <CardShogiGame
          initialGameState={initialGameState}
          initialCardState={initialCardState}
          gameId={gameId}
          gameConfig={gameConfig}
        />
      </>
    );
  }

  return (
    <>
      <AppBackground variant="setup" />
      <ShogiGame
        initialGameState={initialGameState}
        gameId={gameId}
        gameConfig={gameConfig}
      />
    </>
  );
}
