"use client";

import { useCallback, useEffect, useState } from "react";
import { useShogiGame } from "@/hooks/use-shogi-game";
import { useSound } from "@/hooks/use-sound";
import { ShogiBoard } from "./shogi-board";
import { CapturedPieces } from "./captured-pieces";
import { MoveHistory } from "./move-history";
import { GameControls } from "./game-controls";
import { PromotionDialog } from "./promotion-dialog";
import { CharacterPanel } from "@/components/character/character-panel";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getCharacterById } from "@/data/characters";
import { gameResultText } from "@/lib/shogi/notation";
import { isInCheck } from "@/lib/shogi/moves";
import { STANDARD_VARIANT } from "@/lib/shogi/variants/standard";
import { getVariantById } from "@/lib/shogi/variants/index";
import type { GameConfig, GameState, Difficulty, Player } from "@/lib/shogi/types";
import type { CommentaryEvent } from "@/app/actions/commentary";
import Link from "next/link";

// Server→Client props に関数を含められないため、シリアライズ可能な型を定義
interface SerializableGameConfig {
  variantId: string;
  difficulty: Difficulty;
  playerColor: Player;
  characterId: string;
  soundEnabled: boolean;
  commentaryEnabled: boolean;
}

interface ShogiGameProps {
  initialGameState: GameState;
  gameId: string;
  gameConfig: SerializableGameConfig;
}

export function ShogiGame({ initialGameState, gameId, gameConfig: serializableConfig }: ShogiGameProps) {
  const [commentEvent, setCommentEvent] = useState<CommentaryEvent | null>(null);

  // クライアント側でバリアントを復元（関数を含むため props では渡せない）
  const gameConfig: GameConfig = {
    ...serializableConfig,
    variant: getVariantById(serializableConfig.variantId),
  };

  const character = getCharacterById(gameConfig.characterId);
  const { playSfx, toggleMute, isMuted, isReady } = useSound(
    gameConfig.soundEnabled ? character.bgmTrack : undefined
  );

  const handleComment = useCallback((event: string) => {
    setCommentEvent(event as CommentaryEvent);
    setTimeout(() => setCommentEvent(null), 100);
  }, []);

  const {
    gameState,
    selectedSquare,
    selectedHandPiece,
    legalMoves,
    isAiThinking,
    promotionPendingMove,
    selectSquare,
    selectHandPiece,
    confirmPromotion,
    resign,
    undo,
  } = useShogiGame({
    initialState: initialGameState,
    gameId,
    gameConfig,
    onComment: handleComment,
  });

  const playerColor = gameConfig.playerColor;
  const aiColor = playerColor === "sente" ? "gote" : "sente";
  const isPlayerTurn = gameState.currentPlayer === playerColor;
  const isGameActive = gameState.status === "active";
  const inCheck = isGameActive && isInCheck(gameState, gameState.currentPlayer, STANDARD_VARIANT);

  // サウンドエフェクト
  useEffect(() => {
    const lastMove = gameState.moveHistory[gameState.moveHistory.length - 1];
    if (!lastMove) return;

    if (lastMove.captured) {
      playSfx("piece_capture");
    } else if (lastMove.type === "drop") {
      playSfx("piece_drop");
    } else if (lastMove.promote) {
      playSfx("piece_promote");
    } else {
      playSfx("piece_move");
    }

    if (inCheck) playSfx("check");
    // 詰みは手を指した後なので1秒遅延
    if (gameState.status === "checkmate") {
      setTimeout(() => playSfx("game_over"), 1000);
    }
  }, [gameState.moveCount]);

  // 投了時（moveCountが変わらないため別途監視）
  useEffect(() => {
    if (gameState.status === "resign") {
      playSfx("game_over");
    }
  }, [gameState.status]);

  // ゲーム開始時のコメント・サウンド（Howler初期化完了後に再生）
  useEffect(() => {
    if (!isReady) return;
    playSfx("game_start");
    setTimeout(() => handleComment("game_start"), 500);
  }, [isReady]);

  return (
    <div className="flex flex-col lg:flex-row gap-4 w-full max-w-5xl mx-auto p-4">
      {/* メインエリア */}
      <div className="flex flex-col gap-3 flex-1">
        {/* ステータスバー */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant={isPlayerTurn ? "default" : "secondary"}>
              {isPlayerTurn ? "あなたの番" : "相手の番"}
            </Badge>
            {inCheck && (
              <Badge variant="destructive" className="animate-pulse">
                王手！
              </Badge>
            )}
          </div>
          <span className="text-sm text-muted-foreground">
            {gameState.moveCount}手目
          </span>
        </div>

        {/* 後手（AI）の持ち駒 */}
        <CapturedPieces
          hand={gameState.hand}
          player={aiColor}
          isCurrentPlayer={gameState.currentPlayer === aiColor && isGameActive}
          selectedHandPiece={null}
          onPieceClick={() => {}}
          label={character.name}
        />

        {/* 将棋盤 */}
        <ShogiBoard
          board={gameState.board}
          currentPlayer={gameState.currentPlayer}
          playerColor={playerColor}
          selectedSquare={selectedSquare}
          legalMoves={legalMoves}
          isAiThinking={isAiThinking}
          onSquareClick={selectSquare}
        />

        {/* 先手（プレイヤー）の持ち駒 */}
        <CapturedPieces
          hand={gameState.hand}
          player={playerColor}
          isCurrentPlayer={isPlayerTurn && isGameActive}
          selectedHandPiece={selectedHandPiece}
          onPieceClick={selectHandPiece}
          label="あなた"
        />

        {/* ゲームコントロール */}
        <GameControls
          onResign={resign}
          onUndo={undo}
          isMuted={isMuted}
          onToggleMute={toggleMute}
          canUndo={gameState.moveHistory.length >= 2}
          gameActive={isGameActive}
        />
      </div>

      {/* サイドパネル */}
      <div className="flex flex-col gap-3 w-full lg:w-56">
        {/* キャラクターパネル */}
        <Card className="p-3">
          <CharacterPanel
            character={character}
            commentEvent={commentEvent}
            isAiThinking={isAiThinking}
          />
        </Card>

        {/* 棋譜 */}
        <Card className="p-3 flex-1 min-h-48">
          <MoveHistory moves={gameState.moveHistory} />
        </Card>

        {/* ゲーム終了 */}
        {!isGameActive && (
          <Card className="p-3 text-center border-2 border-primary/20 bg-primary/5">
            <p className="text-sm font-bold mb-2">
              {gameResultText(gameState.status, gameState.winner)}
            </p>
            <div className="flex gap-2 justify-center">
              <Link href="/">
                <Button size="sm" variant="outline">
                  ホームへ
                </Button>
              </Link>
              <Link href={`/?replay=${gameId}`}>
                <Button size="sm">
                  もう一局
                </Button>
              </Link>
            </div>
          </Card>
        )}
      </div>

      {/* 成りダイアログ */}
      <PromotionDialog
        move={promotionPendingMove}
        onConfirm={confirmPromotion}
      />
    </div>
  );
}
