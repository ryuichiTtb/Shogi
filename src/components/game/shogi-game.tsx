"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useShogiGame } from "@/hooks/use-shogi-game";
import { useSound } from "@/hooks/use-sound";
import { useBoardSize } from "@/hooks/use-board-size";
import { ShogiBoard } from "./shogi-board";
import { CapturedPieces } from "./captured-pieces";
import { MoveHistory } from "./move-history";
import { GameControls } from "./game-controls";
import { PromotionDialog } from "./promotion-dialog";
import { BoardOverlay } from "./board-overlay";
import type { OverlayEvent } from "./board-overlay";
import { CharacterPanel } from "@/components/character/character-panel";
import { MobileDrawer } from "@/components/game/mobile-drawer";
import { ThemeSelector } from "@/components/game/theme-selector";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getCharacterById } from "@/data/characters";
import { gameResultText } from "@/lib/shogi/notation";
import { isInCheck } from "@/lib/shogi/moves";
import { STANDARD_VARIANT } from "@/lib/shogi/variants/standard";
import { getVariantById } from "@/lib/shogi/variants/index";
import type { GameConfig, GameState, Difficulty, Move, Player } from "@/lib/shogi/types";
import type { CommentaryEvent } from "@/app/actions/commentary";
import { createGame } from "@/app/actions/game";
import Link from "next/link";
import { useRouter } from "next/navigation";

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

function shouldPlayJumpSfx(move: Move): boolean {
  if (move.type !== "move" || !move.from) return false;
  if (move.piece === "knight") return true;

  const rowDiff = Math.abs(move.to.row - move.from.row);
  const colDiff = Math.abs(move.to.col - move.from.col);
  return Math.max(rowDiff, colDiff) >= 2;
}

export function ShogiGame({ initialGameState, gameId, gameConfig: serializableConfig }: ShogiGameProps) {
  const [commentEvent, setCommentEvent] = useState<CommentaryEvent | null>(null);
  const [overlayEvent, setOverlayEvent] = useState<{ event: OverlayEvent; key: number } | null>(null);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { squareSize, viewportHeight } = useBoardSize();

  // クライアント側でバリアントを復元（関数を含むため props では渡せない）
  const gameConfig: GameConfig = {
    ...serializableConfig,
    variant: getVariantById(serializableConfig.variantId),
  };

  const character = getCharacterById(gameConfig.characterId);
  const { playSfx, toggleMute, isMuted, isReady } = useSound(
    gameConfig.soundEnabled ? character.bgmTrack : undefined
  );

  const handlePlayAgain = useCallback(() => {
    startTransition(async () => {
      const newGameId = await createGame(
        gameConfig.difficulty,
        gameConfig.playerColor,
        gameConfig.characterId
      );
      router.push(`/game/${newGameId}`);
    });
  }, [gameConfig.difficulty, gameConfig.playerColor, gameConfig.characterId, router]);

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
    cancelPromotion,
    resign,
    undo,
    deselect,
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
  const inCheck = (isGameActive || gameState.status === "checkmate") && isInCheck(gameState, gameState.currentPlayer, STANDARD_VARIANT);

  // サウンドエフェクト
  useEffect(() => {
    const lastMove = gameState.moveHistory[gameState.moveHistory.length - 1];
    if (!lastMove) return;

    if (lastMove.type === "drop") {
      playSfx("piece_drop");
    } else if (shouldPlayJumpSfx(lastMove)) {
      playSfx("piece_jump");
    } else if (lastMove.captured) {
      playSfx("piece_capture");
      if (lastMove.promote) playSfx("piece_promote");
    } else if (lastMove.promote) {
      playSfx("piece_promote");
    } else {
      playSfx("piece_move");
    }

    if (inCheck) {
      playSfx("check");
      setOverlayEvent({ event: "check", key: Date.now() });
    }
    // 詰みは手を指した後なので1秒遅延
    if (gameState.status === "checkmate") {
      setTimeout(() => playSfx("game_over"), 1000);
      setTimeout(() => setOverlayEvent({ event: "checkmate", key: Date.now() }), 1000);
    }
  }, [gameState.moveCount]);

  // 投了時（moveCountが変わらないため別途監視）
  useEffect(() => {
    if (gameState.status === "resign") {
      playSfx("game_over");
      setOverlayEvent({ event: "resign", key: Date.now() });
    }
  }, [gameState.status]);

  // ゲーム開始時のコメント・サウンド（Howler初期化完了後に再生）
  useEffect(() => {
    if (!isReady) return;
    playSfx("game_start");
    setOverlayEvent({ event: "game_start", key: Date.now() });
    setTimeout(() => handleComment("game_start"), 500);
  }, [isReady]);

  return (
    <div
      className="shogi-game-area w-full overflow-hidden"
      style={{ height: viewportHeight }}
      onClick={deselect}
    >
      <div className="flex flex-col lg:flex-row h-full w-full max-w-5xl mx-auto overflow-hidden">
        {/* メインエリア */}
        <div className="flex flex-col items-center flex-1 min-h-0 px-2 py-0.5 lg:py-2">
          {/* ステータスバー（固定高さ 28px） */}
          <div className="flex items-center justify-between w-full px-1 shrink-0" style={{ height: 28 }}>
            <div className="flex items-center gap-2">
              <Badge variant={isPlayerTurn ? "default" : "secondary"} className="text-xs">
                {isPlayerTurn ? "あなたの番" : "相手の番"}
              </Badge>
              {inCheck && (
                <Badge variant="destructive" className="animate-pulse text-xs">
                  王手！
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {gameState.moveCount}手目
              </span>
              <ThemeSelector />
            </div>
          </div>

          {/* 後手（AI）の持ち駒 */}
          <div className="w-full shrink-0" style={{ maxWidth: squareSize * 9 + 60 }}>
            <CapturedPieces
              hand={gameState.hand}
              player={aiColor}
              playerColor={playerColor}
              isCurrentPlayer={gameState.currentPlayer === aiColor && isGameActive}
              selectedHandPiece={null}
              onPieceClick={() => {}}
              label={character.name}
              squareSize={squareSize}
            />
          </div>

          {/* 将棋盤 */}
          <div className="relative shrink-0 my-0.5">
            <ShogiBoard
              board={gameState.board}
              currentPlayer={gameState.currentPlayer}
              playerColor={playerColor}
              selectedSquare={selectedSquare}
              legalMoves={legalMoves}
              lastMove={gameState.moveHistory[gameState.moveHistory.length - 1] ?? null}
              isAiThinking={isAiThinking}
              inCheck={inCheck}
              onSquareClick={selectSquare}
              squareSize={squareSize}
            />
            <BoardOverlay key={overlayEvent?.key} event={overlayEvent?.event ?? null} />
          </div>

          {/* 先手（プレイヤー）の持ち駒 */}
          <div className="w-full shrink-0" style={{ maxWidth: squareSize * 9 + 60 }}>
            <CapturedPieces
              hand={gameState.hand}
              player={playerColor}
              playerColor={playerColor}
              isCurrentPlayer={isPlayerTurn && isGameActive}
              selectedHandPiece={selectedHandPiece}
              onPieceClick={selectHandPiece}
              label="あなた"
              squareSize={squareSize}
            />
          </div>

          {/* ゲームコントロール */}
          <div className="shrink-0 mt-0.5">
            <GameControls
              onResign={resign}
              onUndo={undo}
              isMuted={isMuted}
              onToggleMute={toggleMute}
              canUndo={gameState.moveHistory.length >= 2 && isPlayerTurn && !isAiThinking}
              gameActive={isGameActive}
            />
          </div>
        </div>

        {/* デスクトップ: サイドパネル */}
        <div className="hidden lg:flex flex-col gap-3 w-56 py-2 pr-2">
          {/* キャラクターパネル */}
          <Card className="p-3">
            <CharacterPanel
              character={character}
              commentEvent={commentEvent}
              isAiThinking={isAiThinking}
            />
          </Card>

          {/* 棋譜 */}
          <Card className="p-3 flex-1 min-h-0 flex flex-col">
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
                <Button size="sm" onClick={handlePlayAgain} disabled={isPending}>
                  {isPending ? "準備中..." : "もう一局"}
                </Button>
              </div>
            </Card>
          )}
        </div>

        {/* モバイル: ドロワー */}
        <div className="lg:hidden">
          <MobileDrawer
            character={character}
            commentEvent={commentEvent}
            isAiThinking={isAiThinking}
            moves={gameState.moveHistory}
            isGameActive={isGameActive}
            gameStatus={gameState.status}
            gameWinner={gameState.winner}
            onPlayAgain={handlePlayAgain}
            isPending={isPending}
          />
        </div>
      </div>

      {/* 成りダイアログ */}
      <PromotionDialog
        move={promotionPendingMove}
        playerColor={playerColor}
        onConfirm={confirmPromotion}
        onCancel={cancelPromotion}
      />
    </div>
  );
}
