"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronUp, ChevronDown } from "lucide-react";

import { useCardShogiGame } from "@/hooks/use-card-shogi-game";
import { useSound } from "@/hooks/use-sound";
import { useCardBoardSize } from "@/hooks/use-card-board-size";

import { ShogiBoard } from "../shogi-board";
import { CapturedPieces } from "../captured-pieces";
import { MoveHistory } from "../move-history";
import { GameControls } from "../game-controls";
import { PromotionDialog } from "../promotion-dialog";
import { BoardOverlay, type OverlayEvent } from "../board-overlay";
import { CharacterPanel } from "@/components/character/character-panel";
import { MobileDrawer } from "../mobile-drawer";
import { ThemeSelector } from "../theme-selector";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { getCharacterById } from "@/data/characters";
import { gameResultText } from "@/lib/shogi/notation";
import { isInCheck } from "@/lib/shogi/moves";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";
import { getVariantById } from "@/lib/shogi/variants/index";
import type { Difficulty, GameConfig, GameState, Move, Player, Position } from "@/lib/shogi/types";
import type { CommentaryEvent } from "@/app/actions/commentary";
import type { CardGameState } from "@/lib/shogi/cards/types";
import { CARD_DEFS } from "@/lib/shogi/cards/definitions";
import { createGame } from "@/app/actions/game";

import { ManaGauge } from "./mana-gauge";
import { HandArea } from "./hand-area";
import { TrapSlot } from "./trap-slot";
import { DeckPile } from "./deck-pile";
import { CardPlayDialog, CardTargetingNotice } from "./card-play-dialog";

interface SerializableGameConfig {
  variantId: string;
  difficulty: Difficulty;
  playerColor: Player;
  characterId: string;
  soundEnabled: boolean;
  commentaryEnabled: boolean;
}

interface CardShogiGameProps {
  initialGameState: GameState;
  initialCardState: CardGameState;
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

export function CardShogiGame({
  initialGameState,
  initialCardState,
  gameId,
  gameConfig: serializableConfig,
}: CardShogiGameProps) {
  const [commentEvent, setCommentEvent] = useState<CommentaryEvent | null>(null);
  const [overlayEvent, setOverlayEvent] = useState<{ event: OverlayEvent; key: number } | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { squareSize, isMobile, viewportHeight } = useCardBoardSize();

  const gameConfig: GameConfig = {
    ...serializableConfig,
    variant: getVariantById(serializableConfig.variantId),
  };

  const character = getCharacterById(gameConfig.characterId);
  const { playSfx, toggleMute, isMuted, isReady } = useSound(
    gameConfig.soundEnabled ? character.bgmTrack : undefined,
  );

  const handlePlayAgain = useCallback(() => {
    startTransition(async () => {
      const newGameId = await createGame(
        gameConfig.difficulty,
        gameConfig.playerColor,
        gameConfig.characterId,
        "card-shogi",
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
    cardState,
    eventLog,
    selectSquare,
    selectHandPiece,
    confirmPromotion,
    cancelPromotion,
    resign,
    deselect,
    drawCard,
    beginPlayCard,
    confirmPlayCard,
    cancelPlayCard,
  } = useCardShogiGame({
    initialState: initialGameState,
    initialCardState,
    gameId,
    gameConfig,
    onComment: handleComment,
  });

  const playerColor = gameConfig.playerColor;
  const aiColor: Player = playerColor === "sente" ? "gote" : "sente";
  const isPlayerTurn = gameState.currentPlayer === playerColor;
  const isGameActive = gameState.status === "active";
  const inCheck =
    (isGameActive || gameState.status === "checkmate") &&
    isInCheck(gameState, gameState.currentPlayer, CARD_SHOGI_VARIANT);

  // ----- サウンド -----
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
    if (gameState.status === "checkmate") {
      setTimeout(() => playSfx("game_over"), 1000);
      setTimeout(() => setOverlayEvent({ event: "checkmate", key: Date.now() }), 1000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState.moveCount]);

  useEffect(() => {
    if (gameState.status === "resign") {
      playSfx("game_over");
      setOverlayEvent({ event: "resign", key: Date.now() });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState.status]);

  useEffect(() => {
    if (!isReady) return;
    playSfx("game_start");
    setOverlayEvent({ event: "game_start", key: Date.now() });
    setTimeout(() => handleComment("game_start"), 500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady]);

  // カードイベント由来の SE を再生 (eventLog の差分監視)
  const lastEventIndexRef = useRef(0);
  useEffect(() => {
    if (!isReady) return;
    const newEvents = eventLog.slice(lastEventIndexRef.current);
    for (const ev of newEvents) {
      switch (ev.kind) {
        case "drawEvent":
          playSfx("card_draw");
          break;
        case "cardPlayEvent":
          playSfx("card_play");
          break;
        case "manaChargeEvent":
          // ターン由来の自動チャージは駒移動 SE と被るため、カード由来のみ鳴らす
          if (ev.reason === "card") playSfx("mana_charge");
          break;
        case "trapSetEvent":
          playSfx("card_play");
          break;
        case "trapTriggerEvent":
          playSfx("trap_trigger");
          break;
      }
    }
    lastEventIndexRef.current = eventLog.length;
  }, [eventLog, isReady, playSfx]);

  // ----- レイアウト用ヘルパ -----

  const opponentManaGauge = (
    <ManaGauge current={cardState.mana[aiColor]} cap={cardState.manaCap} compact />
  );
  const ownManaGauge = <ManaGauge current={cardState.mana[playerColor]} cap={cardState.manaCap} />;
  const ownManaGaugeCompact = (
    <ManaGauge current={cardState.mana[playerColor]} cap={cardState.manaCap} compact />
  );

  const opponentTrapSlot = (
    <TrapSlot trap={cardState.trap[aiColor]} faceDown size="md" />
  );
  const ownTrapSlot = <TrapSlot trap={cardState.trap[playerColor]} size="md" />;
  const opponentTrapSlotSm = (
    <TrapSlot trap={cardState.trap[aiColor]} faceDown size="sm" />
  );
  const ownTrapSlotSm = <TrapSlot trap={cardState.trap[playerColor]} size="sm" />;

  const opponentDeckPile = <DeckPile count={cardState.deck[aiColor].length} size="md" />;
  const ownDeckPile = (
    <DeckPile
      count={cardState.deck[playerColor].length}
      canDraw={cardState.mana[playerColor] >= 5 && isPlayerTurn && isGameActive}
      onDraw={drawCard}
      size="md"
      showDrawCost
    />
  );
  const opponentDeckPileSm = <DeckPile count={cardState.deck[aiColor].length} size="sm" />;
  const ownDeckPileSm = (
    <DeckPile
      count={cardState.deck[playerColor].length}
      canDraw={cardState.mana[playerColor] >= 5 && isPlayerTurn && isGameActive}
      onDraw={drawCard}
      size="sm"
      showDrawCost
    />
  );

  const opponentHandFaceDown = (
    <HandArea
      hand={cardState.hand[aiColor]}
      currentMana={cardState.mana[aiColor]}
      faceDown
      size="sm"
      emptyLabel=""
    />
  );

  const handDisabled = !isPlayerTurn || !isGameActive || cardState.pendingCard !== null;

  // 歩戻し等のターゲット選択時にハイライトする盤面マス
  const cardTargetSquares: Position[] = useMemo(() => {
    if (!cardState.pendingCard || cardState.pendingCard.phase !== "selectTarget") return [];
    const def = CARD_DEFS[cardState.pendingCard.instance.defId];
    if (def.effectId === "pawn_return") {
      const targets: Position[] = [];
      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          const piece = gameState.board[r]?.[c];
          if (piece && piece.owner === playerColor && (piece.type === "pawn" || piece.type === "promoted_pawn")) {
            targets.push({ row: r, col: c });
          }
        }
      }
      return targets;
    }
    return [];
  }, [cardState.pendingCard, gameState.board, playerColor]);
  const ownHand = (
    <HandArea
      hand={cardState.hand[playerColor]}
      currentMana={cardState.mana[playerColor]}
      onCardClick={(id) => beginPlayCard(id)}
      size="md"
      disabled={handDisabled}
    />
  );

  return (
    <div
      className="shogi-game-area w-full overflow-hidden flex flex-col"
      style={{ height: viewportHeight }}
      onClick={deselect}
    >
      {/* ===== 相手ゾーン ===== */}
      {/* PC タブレット相当 (md..xl-1): 詳細ゾーン */}
      <section
        className="hidden md:flex xl:hidden shrink-0 px-2 py-1.5 border-b bg-muted/40 items-center gap-2 overflow-x-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <Badge variant="outline" className="shrink-0">△ 相手</Badge>
        {opponentTrapSlot}
        <div className="shrink-0">{opponentHandFaceDown}</div>
        {opponentDeckPile}
        <div className="ml-auto shrink-0">{opponentManaGauge}</div>
      </section>
      {/* モバイル (<md): 細バー、相手手札はカード裏向きの重ね表示 */}
      <section
        className="md:hidden shrink-0 px-2 py-1 border-b bg-muted/40 flex items-center gap-2 text-xs"
        onClick={(e) => e.stopPropagation()}
      >
        <Badge variant="outline" className="shrink-0 text-[10px] px-1.5 py-0">△</Badge>
        <div className="shrink-0">{opponentManaGauge}</div>
        <div className="shrink-0">
          <HandArea
            hand={cardState.hand[aiColor]}
            currentMana={0}
            faceDown
            layout="stack"
            size="sm"
            emptyLabel=""
          />
        </div>
        <div className="shrink-0">{opponentDeckPileSm}</div>
        <div className="ml-auto shrink-0">{opponentTrapSlotSm}</div>
      </section>

      {/* ===== 中央: 盤面 + 持ち駒 + (PCサイドパネル) ===== xl 未満で表示 */}
      <div className="xl:hidden flex-1 min-h-0 flex flex-col lg:flex-row max-w-5xl mx-auto w-full overflow-hidden">
        <div className="flex flex-col items-center flex-1 min-h-0 px-2 py-0.5 lg:py-2">
          {/* ステータスバー */}
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
              <span className="text-xs text-muted-foreground">{gameState.moveCount}手目</span>
              <ThemeSelector />
            </div>
          </div>

          {/* 相手の持ち駒 */}
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

          {/* 盤面 */}
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
              isMobile={isMobile}
              cardTargetSquares={cardTargetSquares}
            />
            <BoardOverlay key={overlayEvent?.key} event={overlayEvent?.event ?? null} />
          </div>

          {/* 自分の持ち駒 */}
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
        </div>

        {/* PC: サイドパネル */}
        <div className="hidden lg:flex flex-col gap-3 w-56 py-2 pr-2">
          <Card className="p-3">
            <CharacterPanel character={character} commentEvent={commentEvent} isAiThinking={isAiThinking} />
          </Card>
          <Card className="p-3 flex-1 min-h-0 flex flex-col">
            <MoveHistory moves={gameState.moveHistory} />
          </Card>
          {!isGameActive && (
            <Card className="p-3 text-center border-2 border-primary/20 bg-primary/5">
              <p className="text-sm font-bold mb-2">{gameResultText(gameState.status, gameState.winner)}</p>
              <div className="flex gap-2 justify-center">
                <Link href="/">
                  <Button size="sm" variant="outline">ホームへ</Button>
                </Link>
                <Button size="sm" onClick={handlePlayAgain} disabled={isPending}>
                  {isPending ? "準備中..." : "もう一局"}
                </Button>
              </div>
            </Card>
          )}
        </div>

        {/* モバイル/タブレット: キャラ・履歴ドロワー */}
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

      {/* ===== 自分ゾーン (xl 未満) ===== */}
      {/* PC タブレット相当 (md..xl-1): 詳細ゾーン (GameControls を統合) */}
      <section
        className="hidden md:flex xl:hidden shrink-0 px-2 py-1.5 border-t bg-muted/40 items-end gap-2 overflow-x-auto"
        style={{ paddingBottom: "max(0.375rem, env(safe-area-inset-bottom))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <Badge className="shrink-0" variant="default">▲ 自分</Badge>
        {ownTrapSlot}
        <div className="flex-1 min-w-0">{ownHand}</div>
        {ownDeckPile}
        <div className="shrink-0">{ownManaGauge}</div>
        <div className="shrink-0 ml-2 border-l pl-2">
          <GameControls
            onResign={resign}
            onUndo={() => {}}
            isMuted={isMuted}
            onToggleMute={toggleMute}
            canUndo={false}
            gameActive={isGameActive}
          />
        </div>
      </section>

      {/* モバイル (<md): 下端コンパクトバー (上段: ゲーム操作 / 下段: カード) */}
      <section
        className="md:hidden xl:hidden shrink-0 border-t bg-card flex flex-col z-30"
        style={{ paddingBottom: "max(0.375rem, env(safe-area-inset-bottom))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-2 py-1 border-b flex items-center justify-end">
          <GameControls
            onResign={resign}
            onUndo={() => {}}
            isMuted={isMuted}
            onToggleMute={toggleMute}
            canUndo={false}
            gameActive={isGameActive}
          />
        </div>
        <div className="px-2 py-1.5 flex items-center gap-2">
          <Button
            size="sm"
            variant={drawerOpen ? "outline" : "default"}
            className="h-9 gap-1 text-xs shrink-0"
            onClick={() => setDrawerOpen((v) => !v)}
          >
            {drawerOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            手札 {cardState.hand[playerColor].length}
          </Button>
          <div className="shrink-0">{ownManaGaugeCompact}</div>
          {ownDeckPileSm}
          <div className="ml-auto shrink-0">{ownTrapSlotSm}</div>
        </div>
      </section>

      {/* モバイル: 手札ドロワー(下からスライドアップ) */}
      <div
        className={cn(
          "md:hidden fixed left-0 right-0 z-20 bg-card border-t-2 border-primary shadow-2xl transition-transform duration-300",
          drawerOpen ? "translate-y-0" : "translate-y-full",
        )}
        style={{
          bottom: "calc(56px + env(safe-area-inset-bottom))",
          maxHeight: "55dvh",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3 py-2 border-b flex items-center justify-between">
          <span className="text-sm font-bold">あなたの手札</span>
          <Button size="sm" variant="ghost" onClick={() => setDrawerOpen(false)}>閉じる</Button>
        </div>
        <div className="p-3 overflow-x-auto">
          <HandArea
            hand={cardState.hand[playerColor]}
            currentMana={cardState.mana[playerColor]}
            size="lg"
            disabled={handDisabled}
            onCardClick={(id) => {
              beginPlayCard(id);
              setDrawerOpen(false);
            }}
          />
        </div>
      </div>

      {/* モバイル: ドロワー背景 */}
      {drawerOpen && (
        <div
          className="md:hidden fixed inset-0 z-10 bg-black/40"
          onClick={() => setDrawerOpen(false)}
          aria-hidden
        />
      )}

      {/* ===== xl 以上: 4列レイアウト ===== */}
      {/* 列幅: 自分カード 220px / 中央 1fr / キャラ・棋譜 240px / 相手カード 220px */}
      {/* 220px は GameControls(音あり/待った/投了 計216px)が折り返し無く収まる最小幅 */}
      <div
        className="hidden xl:grid xl:grid-cols-[220px_1fr_240px_220px] xl:grid-rows-[auto_minmax(0,1fr)] xl:gap-2 xl:p-2 h-full"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー (全列スパン) */}
        <div className="col-span-4 flex items-center justify-between px-2 py-1 shrink-0">
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
            <span className="text-xs text-muted-foreground">{gameState.moveCount}手目</span>
            <ThemeSelector />
          </div>
        </div>

        {/* Col 1: 自分カードエリア(縦並び、横幅一杯+中央揃え) */}
        <aside className="flex flex-col gap-2 border-r pr-2 min-h-0 overflow-hidden">
          <Badge variant="default" className="self-center shrink-0">▲ 自分</Badge>
          <div className="shrink-0 w-full">{ownManaGauge}</div>
          <div className="flex gap-2 shrink-0 w-full">
            <div className="flex-1 min-w-0">
              <DeckPile
                count={cardState.deck[playerColor].length}
                canDraw={cardState.mana[playerColor] >= 5 && isPlayerTurn && isGameActive}
                onDraw={drawCard}
                size="lg"
                showDrawCost
                fullWidth
              />
            </div>
            <div className="flex-1 min-w-0">
              <TrapSlot trap={cardState.trap[playerColor]} size="lg" fullWidth />
            </div>
          </div>
          <div className="text-xs text-muted-foreground font-medium shrink-0 text-center">手札 {cardState.hand[playerColor].length}枚</div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            <HandArea
              hand={cardState.hand[playerColor]}
              currentMana={cardState.mana[playerColor]}
              layout="vertical"
              size="md"
              disabled={handDisabled}
              fullWidth
              onCardClick={(id) => beginPlayCard(id)}
            />
          </div>
          <div className="shrink-0 pt-2 border-t flex justify-center">
            <GameControls
              onResign={resign}
              onUndo={() => {}}
              isMuted={isMuted}
              onToggleMute={toggleMute}
              canUndo={false}
              gameActive={isGameActive}
            />
          </div>
        </aside>

        {/* Col 2: 中央(盤面 + 持ち駒) */}
        <main className="flex flex-col items-center gap-1 min-h-0 overflow-hidden">
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
          <div className="relative shrink-0">
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
              isMobile={isMobile}
              cardTargetSquares={cardTargetSquares}
            />
            <BoardOverlay key={overlayEvent?.key} event={overlayEvent?.event ?? null} />
          </div>
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
        </main>

        {/* Col 3: キャラパネル + 棋譜 */}
        <aside className="flex flex-col gap-3 min-h-0 overflow-hidden">
          <Card className="p-3 shrink-0">
            <CharacterPanel character={character} commentEvent={commentEvent} isAiThinking={isAiThinking} />
          </Card>
          <Card className="p-3 flex-1 min-h-0 flex flex-col">
            <MoveHistory moves={gameState.moveHistory} />
          </Card>
          {!isGameActive && (
            <Card className="p-3 text-center border-2 border-primary/20 bg-primary/5 shrink-0">
              <p className="text-sm font-bold mb-2">{gameResultText(gameState.status, gameState.winner)}</p>
              <div className="flex gap-2 justify-center">
                <Link href="/">
                  <Button size="sm" variant="outline">ホームへ</Button>
                </Link>
                <Button size="sm" onClick={handlePlayAgain} disabled={isPending}>
                  {isPending ? "準備中..." : "もう一局"}
                </Button>
              </div>
            </Card>
          )}
        </aside>

        {/* Col 4: 相手カードエリア(縦並び、裏向き、横幅一杯+中央揃え) */}
        <aside className="flex flex-col gap-2 border-l pl-2 min-h-0 overflow-hidden">
          <Badge variant="outline" className="self-center shrink-0">△ 相手</Badge>
          <div className="shrink-0 w-full">{opponentManaGauge}</div>
          <div className="flex gap-2 shrink-0 w-full">
            <div className="flex-1 min-w-0">
              <DeckPile count={cardState.deck[aiColor].length} size="lg" fullWidth />
            </div>
            <div className="flex-1 min-w-0">
              <TrapSlot trap={cardState.trap[aiColor]} faceDown size="lg" fullWidth />
            </div>
          </div>
          <div className="text-xs text-muted-foreground font-medium shrink-0 text-center">手札 {cardState.hand[aiColor].length}枚</div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            <HandArea
              hand={cardState.hand[aiColor]}
              currentMana={0}
              faceDown
              layout="vertical"
              size="md"
              fullWidth
              emptyLabel=""
            />
          </div>
        </aside>
      </div>

      {/* ===== ダイアログ群 ===== */}
      <PromotionDialog
        move={promotionPendingMove}
        playerColor={playerColor}
        onConfirm={confirmPromotion}
        onCancel={cancelPromotion}
      />
      <CardPlayDialog
        pendingCard={cardState.pendingCard}
        onConfirm={confirmPlayCard}
        onCancel={cancelPlayCard}
      />
      <CardTargetingNotice
        pendingCard={cardState.pendingCard}
        onCancel={cancelPlayCard}
      />
    </div>
  );
}

