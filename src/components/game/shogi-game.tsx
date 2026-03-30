"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useShogiGame } from "@/hooks/use-shogi-game";
import { useSound } from "@/hooks/use-sound";
import { ShogiBoard } from "./shogi-board";
import { CapturedPieces } from "./captured-pieces";
import { MoveHistory } from "./move-history";
import { GameControls } from "./game-controls";
import { PromotionDialog } from "./promotion-dialog";
import { BoardOverlay } from "./board-overlay";
import type { OverlayEvent } from "./board-overlay";
import { CharacterPanel } from "@/components/character/character-panel";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  const [showMobileHistory, setShowMobileHistory] = useState(false);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

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

  // Ref で最新値を保持（useEffect 内から参照してもクロージャが古くならない）
  const playSfxRef = useRef(playSfx);
  playSfxRef.current = playSfx;
  const inCheckRef = useRef(inCheck);
  inCheckRef.current = inCheck;
  const handleCommentRef = useRef(handleComment);
  handleCommentRef.current = handleComment;

  // サウンドエフェクト（moveCount の変化で発火）
  useEffect(() => {
    const lastMove = gameState.moveHistory[gameState.moveHistory.length - 1];
    if (!lastMove) return;

    const sfx = playSfxRef.current;

    if (lastMove.type === "drop") {
      sfx("piece_drop");
    } else if (shouldPlayJumpSfx(lastMove)) {
      sfx("piece_jump");
    } else if (lastMove.captured) {
      sfx("piece_capture");
      if (lastMove.promote) sfx("piece_promote");
    } else if (lastMove.promote) {
      sfx("piece_promote");
    } else {
      sfx("piece_move");
    }

    if (inCheckRef.current) {
      sfx("check");
      setOverlayEvent({ event: "check", key: Date.now() });
    }
    // 詰みは手を指した後なので1秒遅延
    if (gameState.status === "checkmate") {
      const t1 = setTimeout(() => playSfxRef.current("game_over"), 1000);
      const t2 = setTimeout(() => setOverlayEvent({ event: "checkmate", key: Date.now() }), 1000);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
  }, [gameState.moveCount]);

  // 投了時（moveCountが変わらないため別途監視）
  useEffect(() => {
    if (gameState.status === "resign") {
      playSfxRef.current("game_over");
      setOverlayEvent({ event: "resign", key: Date.now() });
    }
  }, [gameState.status]);

  // ゲーム開始時のコメント・サウンド（Howler初期化完了後に再生）
  useEffect(() => {
    if (!isReady) return;
    playSfxRef.current("game_start");
    setOverlayEvent({ event: "game_start", key: Date.now() });
    const t = setTimeout(() => handleCommentRef.current("game_start"), 500);
    return () => clearTimeout(t);
  }, [isReady]);

  // ゲーム結果カード（PC サイドパネル・モバイルダイアログ共通）
  const gameResultCard = !isGameActive && (
    <Card className="p-3 text-center border-2 border-primary/20 bg-primary/5 shrink-0">
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
  );

  return (
    <div className="h-full w-full" onClick={deselect}>
      {/* メインレイアウト */}
      <div
        className="h-full flex flex-col lg:flex-row gap-1 lg:gap-4 max-w-5xl mx-auto p-2 lg:p-4"
        style={{ paddingBottom: "calc(0.5rem + var(--safe-bottom, 0px))" }}
      >
        {/* メインエリア */}
        <div className="flex flex-col gap-1 lg:gap-3 flex-1 min-h-0">
          {/* ステータスバー */}
          <div className="flex items-center justify-between shrink-0">
            <div className="flex items-center gap-1.5 lg:gap-2">
              <Badge variant={isPlayerTurn ? "default" : "secondary"} className="text-xs">
                {isPlayerTurn ? "あなたの番" : "相手の番"}
              </Badge>
              {inCheck && (
                <Badge variant="destructive" className="animate-pulse text-xs">
                  王手！
                </Badge>
              )}
            </div>
            <span className="text-xs lg:text-sm text-muted-foreground">
              {gameState.moveCount}手目
            </span>
          </div>

          {/* 後手（AI）の持ち駒 */}
          <CapturedPieces
            hand={gameState.hand}
            player={aiColor}
            playerColor={playerColor}
            isCurrentPlayer={gameState.currentPlayer === aiColor && isGameActive}
            selectedHandPiece={null}
            onPieceClick={() => {}}
            label={character.name}
          />

          {/* 将棋盤 — flex-1 min-h-0 で残りスペースを全て使用 */}
          <div className="flex-1 min-h-0 relative">
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
            />
            <BoardOverlay key={overlayEvent?.key} event={overlayEvent?.event ?? null} />
          </div>

          {/* 先手（プレイヤー）の持ち駒 */}
          <CapturedPieces
            hand={gameState.hand}
            player={playerColor}
            playerColor={playerColor}
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
            canUndo={gameState.moveHistory.length >= 2 && isPlayerTurn && !isAiThinking}
            gameActive={isGameActive}
            onShowHistory={() => setShowMobileHistory(true)}
          />
        </div>

        {/* サイドパネル — PC のみ表示 */}
        <div className="hidden lg:flex flex-col gap-3 w-56 shrink-0">
          <Card className="p-3 shrink-0">
            <CharacterPanel
              character={character}
              commentEvent={commentEvent}
              isAiThinking={isAiThinking}
            />
          </Card>

          <Card className="p-3 flex-1 flex flex-col min-h-0">
            <MoveHistory moves={gameState.moveHistory} />
          </Card>

          {gameResultCard}
        </div>
      </div>

      {/* モバイル: ゲーム終了オーバーレイ（自動表示） */}
      {!isGameActive && (
        <div
          className="lg:hidden fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
          onClick={(e) => e.stopPropagation()}
        >
          <Card className="p-4 text-center border-2 border-primary/20 bg-card w-full max-w-xs">
            <p className="text-sm font-bold mb-3">
              {gameResultText(gameState.status, gameState.winner)}
            </p>
            <div className="flex gap-2 justify-center">
              <Link href="/">
                <Button size="sm" variant="outline">ホームへ</Button>
              </Link>
              <Button size="sm" onClick={handlePlayAgain} disabled={isPending}>
                {isPending ? "準備中..." : "もう一局"}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* モバイル: 棋譜/キャラクターダイアログ */}
      <Dialog open={showMobileHistory} onOpenChange={setShowMobileHistory}>
        <DialogContent className="max-h-[90dvh] flex flex-col gap-3 overflow-y-auto">
          <DialogHeader>
            <DialogTitle>キャラクター・棋譜</DialogTitle>
          </DialogHeader>
          <CharacterPanel
            character={character}
            commentEvent={commentEvent}
            isAiThinking={isAiThinking}
          />
          <div className="h-56">
            <MoveHistory moves={gameState.moveHistory} />
          </div>
          {gameResultCard}
        </DialogContent>
      </Dialog>

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
