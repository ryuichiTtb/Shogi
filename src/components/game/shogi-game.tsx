"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useShogiGame } from "@/hooks/use-shogi-game";
import { useSound } from "@/hooks/use-sound";
import { useBgm } from "@/hooks/use-bgm";
import { useBoardSize } from "@/hooks/use-board-size";
import { ShogiBoard, type ShogiBoardHandle } from "./shogi-board";
import { KingSlashOverlay } from "./king-slash-overlay";
import { CapturedPieces } from "./captured-pieces";
import { MoveHistory } from "./move-history";
import { GameControls } from "./game-controls";
import { PromotionDialog } from "./promotion-dialog";
import { BoardOverlay } from "./board-overlay";
import type { OverlayEvent } from "./board-overlay";
import { AiErrorModal } from "./ai-error-modal";
import { RematchErrorBanner } from "./rematch-error-banner";
import { CharacterPanel } from "@/components/character/character-panel";
import { MobileDrawer } from "@/components/game/mobile-drawer";
import { ThemeSelector } from "@/components/game/theme-selector";
import { AuthControls } from "@/components/auth/auth-controls";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getCharacterById } from "@/data/characters";
import { gameResultText } from "@/lib/shogi/notation";
import { isInCheck, findKing } from "@/lib/shogi/moves";
import { STANDARD_VARIANT } from "@/lib/shogi/variants/standard";
import { getVariantById } from "@/lib/shogi/variants/index";
import type { GameConfig, GameState, Difficulty, Move, Player } from "@/lib/shogi/types";
import type { CommentaryEvent } from "@/app/actions/commentary";
import { LoadingOverlay } from "@/components/loading-overlay";
import { MaskedLink } from "@/components/navigation/masked-link";
import { LOADING_STAGES } from "@/lib/loading-stages";
import { useRematch } from "@/hooks/use-rematch";

// Server→Client props に関数を含められないため、シリアライズ可能な型を定義
interface SerializableGameConfig {
  variantId: string;
  difficulty: Difficulty;
  playerColor: Player;
  characterId: string;
  // Issue #150 (origin/main): ユーザ環境設定 "サウンド ON/OFF" のゲート。
  // false なら useBgm に null を渡して BGM 停止 (SFX は既存 isMuted で別経路)。
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
  // Issue #225: 盤マス矩形取得用 ref (詰み時に玉マスへ斬撃演出を重ねるため)。
  const boardRef = useRef<ShogiBoardHandle>(null);
  // Issue #225: 詰み時の玉への赤い斬撃演出 (負けた側の玉マスに重ねる)。null で非表示。
  const [kingSlash, setKingSlash] = useState<{
    rect: DOMRect;
    owner: Player;
    key: number;
  } | null>(null);
  // Issue #217: 旧 startTransition(async) は createGame 失敗時に永久ハング
  // していた。明示的 loading/error state を持つ共通フックに置換 (router.push は
  // フック内部で行うため本コンポーネントの useRouter は不要になった)。
  const { isRematching, rematchError, rematch, clearRematchError } =
    useRematch();
  const { squareSize, isMobile, viewportHeight } = useBoardSize();

  // クライアント側でバリアントを復元（関数を含むため props では渡せない）
  const gameConfig: GameConfig = {
    ...serializableConfig,
    variant: getVariantById(serializableConfig.variantId),
  };

  const character = getCharacterById(gameConfig.characterId);
  const { playSfx, toggleMute, isMuted, isReady } = useSound();

  const handlePlayAgain = useCallback(() => {
    // Issue #79 派生: forward 遷移 SFX (新規対局画面へ router.push する forward 系)
    playSfx("nav_forward");
    void rematch({
      difficulty: gameConfig.difficulty,
      playerColor: gameConfig.playerColor,
      characterId: gameConfig.characterId,
    });
  }, [gameConfig.difficulty, gameConfig.playerColor, gameConfig.characterId, rematch, playSfx]);

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
    aiError,
    selectSquare,
    selectHandPiece,
    confirmPromotion,
    cancelPromotion,
    resign,
    undo,
    deselect,
    retryAiMove,
  } = useShogiGame({
    initialState: initialGameState,
    gameId,
    gameConfig,
    onComment: handleComment,
  });

  const playerColor = gameConfig.playerColor;
  const aiColor = playerColor === "sente" ? "gote" : "sente";

  // BGM (Issue #79):
  //   - useBgm が BGM の単一オーナー。dev tool で event override が設定された
  //     場合 (もしくは manifest 既定が non-empty) のときに再生される。
  //   - soundEnabled が false → null で停止 (#150 のサウンド ON/OFF ゲート)。
  //   - 対局中は loop 継続、対局終了時は現在の loop を完了させた上で停止。
  //     (shouldLoop=false → onend で自然停止)
  useBgm(
    gameConfig.soundEnabled
      ? gameState.status === "active"
        ? "bgm_game"
        : "bgm_game_over"
      : null,
    { shouldLoop: gameState.status === "active" },
  );
  const isPlayerTurn = gameState.currentPlayer === playerColor;
  const isGameActive = gameState.status === "active";
  const inCheck = (isGameActive || gameState.status === "checkmate") && isInCheck(gameState, gameState.currentPlayer, STANDARD_VARIANT);

  // Issue #155: 履歴復元時の演出再発火を抑止する。
  //
  // 旧実装は [moveCount] / [status] / [isReady] 監視がいずれも「初回マウント時に
  // fire する」性質を持ち、履歴から終局済対局を復元したときに最後の手の駒音・
  // 王手・詰み・投了演出や対局開始演出が意図せず再生されていた。
  //
  // 各 useEffect に「前回値追跡」パターンを適用:
  //   - useRef を初回 render 時の値で初期化し、effect 内で「前回値と一致」なら
  //     skip。実際に値が変化したときだけ副作用を出す。
  //   - StrictMode (dev) で effect が 2 回 fire しても、ref 値が等しいので
  //     副作用は再生されず安全。単純な「初回フラグを倒す」方式より堅牢。
  //
  // 例外: game_start 演出は「新規対局のときに必ず 1 度発火」したいため、別途
  // 「既に発火したか」のフラグを持つ (lastReadyRef)。
  const lastMoveCountRef = useRef(gameState.moveCount);
  const lastStatusRef = useRef(gameState.status);
  const gameStartFiredRef = useRef(false);

  // サウンドエフェクト (駒音・王手・詰み)
  useEffect(() => {
    if (lastMoveCountRef.current === gameState.moveCount) return;
    lastMoveCountRef.current = gameState.moveCount;
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
      // moveCount 変化に同期した SFX & 演出発火。前回値 ref 追跡で 1 回だけ走るため
      // cascading にはならない。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOverlayEvent({ event: "check", key: Date.now() });
    }
    // 詰みは手を指した後なので1秒遅延。Issue #79: 王手 SFX (check) と分離した
    // 専用 checkmate SFX を再生 (default = 血しぶき・飛び散る03)。
    if (gameState.status === "checkmate") {
      setTimeout(() => playSfx("checkmate"), 1000);
      setTimeout(() => setOverlayEvent({ event: "checkmate", key: Date.now() }), 1000);
      // Issue #225: 詰み表示と同タイミングで、負けた側の玉へ赤い斬撃演出を重ねる。
      const loser: Player = gameState.winner === "sente" ? "gote" : "sente";
      setTimeout(() => {
        const kingPos = findKing(gameState.board, loser, STANDARD_VARIANT.boardSize);
        const rect = kingPos
          ? boardRef.current?.getSquareRect(kingPos.row, kingPos.col) ?? null
          : null;
        if (rect) setKingSlash({ rect, owner: loser, key: Date.now() });
      }, 1000);
      // 斬撃尺 (ghost-slash 1.5s) 経過後にクリアし、下の実盤の玉表示へ戻す。
      setTimeout(() => setKingSlash(null), 2700);
    }
  }, [gameState.moveCount]);

  // 投了時 (moveCountが変わらないため別途監視)。
  // 前回値追跡で「実際に status が変化したとき」だけ fire する。
  useEffect(() => {
    if (lastStatusRef.current === gameState.status) return;
    lastStatusRef.current = gameState.status;
    if (gameState.status === "resign") {
      playSfx("game_over");
      // status 変化に同期した投了演出。前回値 ref 追跡で 1 回だけ走る。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOverlayEvent({ event: "resign", key: Date.now() });
    }
  }, [gameState.status]);

  // ゲーム開始時のコメント・サウンド (Howler 初期化完了後に再生)。
  // gameStartFiredRef で「同一マウント内で 1 回だけ」発火し、新規対局
  // (status: "active" + moveCount === 0) のときのみ実演出を出す。履歴から
  // 終局済 / 途中対局を復元した場合は ref を立てずに完全スキップ (将来何かの
  // タイミングで再評価されても発火しない)。
  useEffect(() => {
    if (!isReady) return;
    if (gameStartFiredRef.current) return;
    if (gameState.status !== "active" || gameState.moveCount !== 0) return;
    gameStartFiredRef.current = true;
    playSfx("game_start");
    // mount 1 回限りの対局開始演出。gameStartFiredRef ガードで再発火しない。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOverlayEvent({ event: "game_start", key: Date.now() });
    setTimeout(() => handleComment("game_start"), 500);
  }, [isReady]);

  return (
    <>
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
              <AuthControls variant="indicator" />
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
              ref={boardRef}
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
            />
            <BoardOverlay key={overlayEvent?.key} event={overlayEvent?.event ?? null} />
            {/* Issue #225: 詰み時に負けた側の玉へ赤い斬撃演出を重ねる */}
            <KingSlashOverlay
              rect={kingSlash?.rect ?? null}
              kingOwner={kingSlash?.owner ?? null}
              playerColor={playerColor}
              animationKey={kingSlash?.key ?? 0}
            />
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
                <MaskedLink href="/classic" loadingVariant="spinner">
                  <Button size="sm" variant="outline">
                    ホームへ
                  </Button>
                </MaskedLink>
                <Button size="sm" onClick={handlePlayAgain} disabled={isRematching}>
                  {isRematching ? "準備中..." : "もう一局"}
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
            isPending={isRematching}
            homeHref="/classic"
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
    {/* Issue #163: 「もう一局」(=createGame Server Action 後 router.push) 中のローディングマスク。
        PC/モバイル両方の同 isRematching を共有しているため Overlay 1 つで両ボタンをカバー。
        ビジュアルは他のリッチローディング (回転カード + プログレスバー + ステージ文言) に統一。 */}
    <LoadingOverlay
      show={isRematching}
      fullScreen
      card
      progress
      stages={LOADING_STAGES.matchRestart}
    />
    {/* Issue #217: もう一局 (createGame) 失敗時のエラー通知 + 再試行 */}
    <RematchErrorBanner
      message={rematchError}
      onRetry={handlePlayAgain}
      onDismiss={clearRematchError}
    />
    {/* Issue #176: AI 思考が連続失敗した場合のリカバリ UI */}
    <AiErrorModal
      open={aiError !== null}
      error={aiError}
      onRetry={retryAiMove}
      onResign={resign}
    />
    </>
  );
}
