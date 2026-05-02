"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronUp, ChevronDown, Volume2, VolumeX } from "lucide-react";

import { useCardShogiGame } from "@/hooks/use-card-shogi-game";
import { useSound } from "@/hooks/use-sound";
import { useCardBoardSize } from "@/hooks/use-card-board-size";

import { ShogiBoard, type ShogiBoardHandle } from "../shogi-board";
import { CapturedPieces } from "../captured-pieces";
import { CardShogiHistory } from "./card-shogi-history";
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
import type { CardGameState, CardInstance } from "@/lib/shogi/cards/types";
import { CARD_DEFS, DRAW_COST } from "@/lib/shogi/cards/definitions";
import { createGame } from "@/app/actions/game";

import { ManaGauge } from "./mana-gauge";
import { HandArea } from "./hand-area";
import { TrapSlot } from "./trap-slot";
import { DeckPile } from "./deck-pile";
import { CardPlayDialog, CardTargetingNotice } from "./card-play-dialog";
import { DrawFlightCard } from "./draw-flight-card";
import { CardPlayFlight } from "./card-play-flight";
import { ManaFlightLayer, type ManaFlightItem } from "./mana-flight";
import { FastMoveBadgeLayer, type FastMoveBadgeItem } from "./fast-move-badge";

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
  const [overlayEvent, setOverlayEvent] = useState<{ event: OverlayEvent; key: number; trapName?: string } | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Issue #78: ドロー演出 (山札→中央→手札)。演出完了まで自分の手番継続・操作ロック。
  const [drawFlight, setDrawFlight] = useState<{ card: CardInstance; key: number } | null>(null);
  const isDrawAnimating = drawFlight !== null;
  // Issue #106: カード使用/トラップセット時の中央演出 (中央にパッと出現+キラッと光る)。
  // ドロー演出と異なり手番をロックせず短時間 (~1.2s) で抜ける。
  const [playFlight, setPlayFlight] = useState<{
    card: CardInstance;
    key: number;
    isTrap: boolean;
  } | null>(null);
  // 連続プレイ時に Date.now() が同 ms に丸まると AnimatePresence が
  // 同一 key と判定し新 inner を mount しない。単調増加カウンタで防ぐ。
  const playFlightKeyRef = useRef(0);
  // 演出完了直後に手札の対象カードを一瞬光らせる (Issue #78)
  const [freshlyDrawnId, setFreshlyDrawnId] = useState<string | null>(null);
  // 各レイアウトの山札・手札 DOM ref。表示中のものから矩形を取得する。
  const ownDeckPileTabletRef = useRef<HTMLDivElement>(null);
  const ownDeckPileMobileRef = useRef<HTMLDivElement>(null);
  const ownDeckPileXlRef = useRef<HTMLDivElement>(null);
  const ownHandTabletRef = useRef<HTMLDivElement>(null);
  const ownHandMobileBtnRef = useRef<HTMLDivElement>(null);
  const ownHandXlRef = useRef<HTMLDivElement>(null);
  // 各レイアウトの ShogiBoard ref。表示中のものから盤面マスの矩形を取得する。
  const boardTabletRef = useRef<ShogiBoardHandle>(null);
  const boardXlRef = useRef<ShogiBoardHandle>(null);
  // マナ増減の浮遊テキスト (Issue #77)。各イベントを起点 UI 付近で表示する。
  const [manaFlights, setManaFlights] = useState<ManaFlightItem[]>([]);
  const manaFlightIdRef = useRef(0);
  // 早指し時のバッジ。マナ +N と同じ駒位置イベントから派生し、駒の少し下に表示。
  const [fastMoveBadges, setFastMoveBadges] = useState<FastMoveBadgeItem[]>([]);
  const fastMoveBadgeIdRef = useRef(0);
  // カード使用時、reducer がカードを hand から削除する前に DOMRect を保管する。
  // cardPlayEvent / trapSetEvent / マナUP の manaChargeEvent(reason: card) の起点として使う。
  const playedCardRectRef = useRef<{ id: string; rect: DOMRect } | null>(null);
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
    undo,
    deselect,
    drawCard,
    finalizeDraw,
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

  const lastEventIndexRef = useRef(0);

  // 表示中の山札ラッパーから矩形を取得 (xl 以上 → タブレット → モバイル の順に visibility 判定)
  const getDeckRect = useCallback((): DOMRect | null => {
    for (const ref of [ownDeckPileXlRef, ownDeckPileTabletRef, ownDeckPileMobileRef]) {
      const el = ref.current;
      if (el && el.offsetParent !== null) {
        return el.getBoundingClientRect();
      }
    }
    return null;
  }, []);

  // 表示中の手札ラッパーから矩形を取得 (モバイルでドロワー閉のとき手札ボタン位置に着地)
  const getHandRect = useCallback((): DOMRect | null => {
    for (const ref of [ownHandXlRef, ownHandTabletRef, ownHandMobileBtnRef]) {
      const el = ref.current;
      if (el && el.offsetParent !== null) {
        return el.getBoundingClientRect();
      }
    }
    return null;
  }, []);

  // 盤面マスの DOMRect。表示中の ShogiBoard (xl→タブレット) から取得する。
  const getBoardSquareRect = useCallback((row: number, col: number): DOMRect | null => {
    for (const ref of [boardXlRef, boardTabletRef]) {
      const handle = ref.current;
      if (!handle) continue;
      const rect = handle.getSquareRect(row, col);
      if (rect && rect.width > 0 && rect.height > 0) return rect;
    }
    return null;
  }, []);

  const triggerManaFlight = useCallback((delta: number, rect: DOMRect | null) => {
    if (!rect || delta === 0) return;
    manaFlightIdRef.current += 1;
    const id = manaFlightIdRef.current;
    setManaFlights((prev) => [...prev, { id, delta, rect }]);
  }, []);

  const removeManaFlight = useCallback((id: number) => {
    setManaFlights((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const triggerFastMoveBadge = useCallback((rect: DOMRect | null) => {
    if (!rect) return;
    fastMoveBadgeIdRef.current += 1;
    const id = fastMoveBadgeIdRef.current;
    setFastMoveBadges((prev) => [...prev, { id, rect }]);
  }, []);

  const removeFastMoveBadge = useCallback((id: number) => {
    setFastMoveBadges((prev) => prev.filter((b) => b.id !== id));
  }, []);

  // 表示中の手札の中から該当カード DOM を見つけて DOMRect を返す。
  const findVisibleCardRect = useCallback((instanceId: string): DOMRect | null => {
    if (typeof document === "undefined") return null;
    const els = document.querySelectorAll<HTMLElement>(`[data-card-id="${instanceId}"]`);
    for (const el of els) {
      if (el.offsetParent !== null) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) return rect;
      }
    }
    return null;
  }, []);

  // reducer が hand からカードを削除する前に、使用カードの矩形を捕捉する。
  // 後続イベント (cardPlayEvent / trapSetEvent / manaChargeEvent reason="card") で起点として参照される。
  const cachePendingCardRect = useCallback(() => {
    const pc = cardState.pendingCard;
    if (!pc) return;
    const rect = findVisibleCardRect(pc.instance.instanceId);
    if (rect) playedCardRectRef.current = { id: pc.instance.instanceId, rect };
  }, [cardState.pendingCard, findVisibleCardRect]);

  const handleConfirmPlayCard = useCallback(() => {
    cachePendingCardRect();
    confirmPlayCard();
  }, [cachePendingCardRect, confirmPlayCard]);

  // カードイベント由来の SE 再生・画面演出・マナ浮遊テキストを eventLog の差分監視で発火
  useEffect(() => {
    if (!isReady) return;
    const startIdx = lastEventIndexRef.current;
    const newEvents = eventLog.slice(startIdx);
    for (let i = 0; i < newEvents.length; i++) {
      const ev = newEvents[i];
      const absoluteIdx = startIdx + i;
      switch (ev.kind) {
        case "drawEvent":
          playSfx("card_draw");
          // Issue #78: 自分のドローのみ中央演出 (AI ドローは Phase 0 では発生しない想定だが防御的に絞る)
          if (ev.player === playerColor) {
            setDrawFlight({ card: ev.instance, key: Date.now() });
          }
          // Issue #77: 山札の位置で -5 マナ表示
          triggerManaFlight(-DRAW_COST, getDeckRect());
          break;
        case "cardPlayEvent": {
          playSfx("card_play");
          const def = CARD_DEFS[ev.instance.defId];
          if (def.cost > 0) {
            const cached = playedCardRectRef.current;
            const rect = cached?.id === ev.instance.instanceId ? cached.rect : getHandRect();
            triggerManaFlight(-def.cost, rect);
          }
          // Issue #106: カード使用時に中央へカード本体を表示 (自分プレイヤーのみ)
          if (ev.player === playerColor) {
            playFlightKeyRef.current += 1;
            setPlayFlight({
              card: ev.instance,
              key: playFlightKeyRef.current,
              isTrap: false,
            });
          }
          break;
        }
        case "manaChargeEvent":
          // ターン由来の自動チャージは駒移動 SE と被るため、カード由来のみ鳴らす
          if (ev.reason === "card") playSfx("mana_charge");
          // Issue #77: マナ加算を起点 UI 付近に表示
          if (ev.reason === "turn") {
            // 直前の同 player の moveEvent を遡って探し、移動先マスに表示
            let moveTo: { row: number; col: number } | null = null;
            for (let j = absoluteIdx - 1; j >= 0; j--) {
              const m = eventLog[j];
              if (m.kind === "moveEvent" && m.move.player === ev.player) {
                moveTo = m.move.to;
                break;
              }
            }
            const rect = moveTo ? getBoardSquareRect(moveTo.row, moveTo.col) : null;
            triggerManaFlight(ev.amount, rect);
            if (ev.fastMove) triggerFastMoveBadge(rect);
          } else {
            // カード由来 (マナUP等): 直前に使用したカードの位置 (なければ手札中央)
            const cached = playedCardRectRef.current;
            const rect = cached?.rect ?? getHandRect();
            triggerManaFlight(ev.amount, rect);
          }
          break;
        case "trapSetEvent": {
          playSfx("card_play");
          const def = CARD_DEFS[ev.instance.defId];
          if (def.cost > 0) {
            const cached = playedCardRectRef.current;
            const rect = cached?.id === ev.instance.instanceId ? cached.rect : getHandRect();
            triggerManaFlight(-def.cost, rect);
          }
          // Issue #106: トラップセット時も中央へカード本体を表示
          // CardInstance に詰め直し (TrapInstance.owner は CardView 側で参照しないため捨てる)
          if (ev.player === playerColor) {
            playFlightKeyRef.current += 1;
            setPlayFlight({
              card: { instanceId: ev.instance.instanceId, defId: ev.instance.defId },
              key: playFlightKeyRef.current,
              isTrap: true,
            });
          }
          break;
        }
        case "trapTriggerEvent":
          playSfx("trap_trigger");
          // R16/R20: トラップ発動を画面中央オーバーレイで明示、トラップ名も併記
          setOverlayEvent({
            event: "trap_trigger",
            key: Date.now(),
            trapName: CARD_DEFS[ev.instance.defId].name,
          });
          break;
      }
    }
    lastEventIndexRef.current = eventLog.length;
  }, [eventLog, isReady, playSfx, playerColor, triggerManaFlight, triggerFastMoveBadge, getDeckRect, getHandRect, getBoardSquareRect]);

  // Issue #78: 演出中は盤面・手札・カード操作・背景クリックをロックする
  const handleSquareClick = useCallback(
    (pos: Position) => {
      if (isDrawAnimating) return;
      // 歩戻し等のターゲット選択フェーズで盤面クリックが confirm に直結するため、ここでも矩形を捕捉
      if (cardState.pendingCard) cachePendingCardRect();
      selectSquare(pos);
    },
    [isDrawAnimating, selectSquare, cardState.pendingCard, cachePendingCardRect],
  );
  const handleHandPieceClick = useCallback(
    (piece: Parameters<typeof selectHandPiece>[0]) => {
      if (isDrawAnimating) return;
      selectHandPiece(piece);
    },
    [isDrawAnimating, selectHandPiece],
  );
  const handleBeginPlayCard = useCallback(
    (id: string) => {
      if (isDrawAnimating) return;
      beginPlayCard(id);
    },
    [isDrawAnimating, beginPlayCard],
  );
  const handleDeselect = useCallback(() => {
    if (isDrawAnimating) return;
    deselect();
  }, [isDrawAnimating, deselect]);

  // 演出中は最新ドローカードを手札表示から除外し、演出完了後に手札に現れたように見せる
  const displayedOwnHand = useMemo(() => {
    if (!drawFlight) return cardState.hand[playerColor];
    return cardState.hand[playerColor].filter((c) => c.instanceId !== drawFlight.card.instanceId);
  }, [cardState.hand, playerColor, drawFlight]);

  // Issue #106: カード使用演出は中央に固定出現するため startRect は不要
  const handlePlayFlightComplete = useCallback(() => setPlayFlight(null), []);

  // ドロー演出完了: currentPlayer を相手に渡し、手札の対象カードを一瞬フラッシュさせる
  const handleDrawFlightComplete = useCallback(() => {
    const id = drawFlight?.card.instanceId ?? null;
    setDrawFlight(null);
    finalizeDraw();
    if (id) {
      setFreshlyDrawnId(id);
      window.setTimeout(() => {
        setFreshlyDrawnId((prev) => (prev === id ? null : prev));
      }, 900);
    }
  }, [drawFlight, finalizeDraw]);

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
  // モバイル下端用の TrapSlot。山札 md と高さを揃えるため md サイズ
  const ownTrapSlotMobile = <TrapSlot trap={cardState.trap[playerColor]} size="md" />;

  const opponentDeckPile = <DeckPile count={cardState.deck[aiColor].length} size="md" showDrawCost />;
  const ownDeckPile = (
    <DeckPile
      count={cardState.deck[playerColor].length}
      canDraw={cardState.mana[playerColor] >= DRAW_COST && isPlayerTurn && isGameActive && !inCheck && !isDrawAnimating}
      onDraw={drawCard}
      size="md"
      showDrawCost
      dimmed={!isPlayerTurn || !isGameActive}
    />
  );
  // モバイル細バー(上端)の相手山札はテキストバッジ形式に変更したため別途インラインで表示 (P22)。
  // モバイル下端用の自分山札。md サイズで縦幅を抑える (P25)
  const ownDeckPileMobile = (
    <DeckPile
      count={cardState.deck[playerColor].length}
      canDraw={cardState.mana[playerColor] >= DRAW_COST && isPlayerTurn && isGameActive && !inCheck && !isDrawAnimating}
      onDraw={drawCard}
      size="md"
      showDrawCost
      dimmed={!isPlayerTurn || !isGameActive}
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

  // 王手中はカード使用・ドロー禁止 (P10) → 駒指しでの王手回避のみ可能
  // ドロー演出中も操作ロック (Issue #78)
  const handDisabled = !isPlayerTurn || !isGameActive || cardState.pendingCard !== null || inCheck || isDrawAnimating;

  // 待った可否 (P28): 駒指し2手以上 / 自分の手番 / AI 思考中でない / pendingCard 無し / 過去2手の間にカード操作なし
  const canUndo = useMemo(() => {
    if (gameState.moveHistory.length < 2) return false;
    if (!isPlayerTurn) return false;
    if (isAiThinking) return false;
    if (cardState.pendingCard) return false;
    let movesSeen = 0;
    for (let i = eventLog.length - 1; i >= 0; i--) {
      const ev = eventLog[i];
      if (ev.kind === "moveEvent") {
        movesSeen++;
        if (movesSeen === 2) break;
      } else if (
        ev.kind === "cardPlayEvent" ||
        ev.kind === "drawEvent" ||
        ev.kind === "trapSetEvent" ||
        ev.kind === "trapTriggerEvent"
      ) {
        return false;
      }
    }
    return movesSeen >= 2;
  }, [gameState.moveHistory.length, isPlayerTurn, isAiThinking, cardState.pendingCard, eventLog]);

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
      hand={displayedOwnHand}
      currentMana={cardState.mana[playerColor]}
      onCardClick={handleBeginPlayCard}
      size="md"
      disabled={handDisabled}
      flashCardId={freshlyDrawnId}
    />
  );

  return (
    <div
      className="shogi-game-area w-full overflow-hidden flex flex-col"
      style={{ height: viewportHeight }}
      onClick={handleDeselect}
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
      {/* モバイル (<md): 細バー (P29 右揃え、山札・TRAP は手札 stack の高さに合わせて伸縮) */}
      <section
        className="md:hidden shrink-0 px-2 py-1 border-b bg-muted/40 flex items-stretch gap-1.5 text-xs"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 左: 相手ラベル + マナゲージ (固定) */}
        <div className="flex items-center gap-1.5 shrink-0">
          <Badge variant="outline" className="shrink-0 text-[10px] px-1.5 py-0">△</Badge>
          <div className="shrink-0">{opponentManaGauge}</div>
        </div>
        {/* 右ブロック: 手札・山札・TRAP を右揃え。手札の左に余白を取り、増減に対応 */}
        <div className="ml-auto flex items-stretch gap-1.5">
          <div className="shrink-0 flex items-center">
            <HandArea
              hand={cardState.hand[aiColor]}
              currentMana={0}
              faceDown
              layout="stack"
              size="sm"
              emptyLabel=""
            />
          </div>
          {/* 山札・トラップは items-stretch で手札 stack の高さに揃う */}
          <DeckPile count={cardState.deck[aiColor].length} horizontal showDrawCost />
          <TrapSlot trap={cardState.trap[aiColor]} faceDown horizontal />
        </div>
      </section>

      {/* ===== 中央: 盤面 + 持ち駒 + (PCサイドパネル) ===== xl 未満で表示 */}
      <div className="xl:hidden flex-1 min-h-0 flex flex-col lg:flex-row max-w-5xl mx-auto w-full overflow-hidden">
        <div className="flex flex-col items-center flex-1 min-h-0 px-2 py-0.5 lg:py-2">
          {/* ステータスバー (モバイルでは音アイコンもここに集約) */}
          <div className="flex items-center justify-between w-full px-1 shrink-0" style={{ height: 28 }}>
            <div className="flex items-center gap-1.5">
              <Badge variant={isPlayerTurn ? "default" : "secondary"} className="text-xs">
                {isPlayerTurn ? "あなたの番" : "相手の番"}
              </Badge>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                onClick={toggleMute}
                aria-label={isMuted ? "ミュート中" : "音あり"}
                title={isMuted ? "ミュート中" : "音あり"}
              >
                {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
              </Button>
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

          {/* 相手の持ち駒 (モバイルでは compact で縦幅を詰める) */}
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
              compact={isMobile}
            />
          </div>

          {/* 盤面 */}
          <div className="relative shrink-0 my-0.5">
            <ShogiBoard
              ref={boardTabletRef}
              board={gameState.board}
              currentPlayer={gameState.currentPlayer}
              playerColor={playerColor}
              selectedSquare={selectedSquare}
              legalMoves={legalMoves}
              lastMove={gameState.moveHistory[gameState.moveHistory.length - 1] ?? null}
              isAiThinking={isAiThinking}
              inCheck={inCheck}
              onSquareClick={handleSquareClick}
              squareSize={squareSize}
              isMobile={isMobile}
              cardTargetSquares={cardTargetSquares}
            />
            <BoardOverlay
              key={overlayEvent?.key}
              event={overlayEvent?.event ?? null}
              trapName={overlayEvent?.trapName}
            />
          </div>

          {/* 自分の持ち駒 (モバイルでは compact で縦幅を詰める) */}
          <div className="w-full shrink-0" style={{ maxWidth: squareSize * 9 + 60 }}>
            <CapturedPieces
              hand={gameState.hand}
              player={playerColor}
              playerColor={playerColor}
              isCurrentPlayer={isPlayerTurn && isGameActive}
              selectedHandPiece={selectedHandPiece}
              onPieceClick={handleHandPieceClick}
              label="あなた"
              squareSize={squareSize}
              compact={isMobile}
            />
          </div>
        </div>

        {/* PC: サイドパネル */}
        <div className="hidden lg:flex flex-col gap-3 w-56 py-2 pr-2">
          <Card className="p-3">
            <CharacterPanel character={character} commentEvent={commentEvent} isAiThinking={isAiThinking} />
          </Card>
          <Card className="p-3 flex-1 min-h-0 flex flex-col">
            <CardShogiHistory eventLog={eventLog} />
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
            cardEventLog={eventLog}
            hideEndCard
          />
        </div>
      </div>

      {/* ゲーム終了表示 (card-shogi 専用、自分カードエリアの上に表示)。 */}
      {/* MobileDrawer の終了 Card は hideEndCard で抑止しているため、ここで自前表示。 */}
      {!isGameActive && (
        <div className="xl:hidden shrink-0 px-3 py-2 border-t border-primary/30 bg-primary/5">
          <Card className="p-2.5 text-center border-2 border-primary/20 bg-primary/5">
            <p className="text-sm font-bold mb-1.5">{gameResultText(gameState.status, gameState.winner)}</p>
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

      {/* ===== 自分ゾーン (xl 未満) ===== */}
      {/* PC タブレット相当 (md..xl-1): 詳細ゾーン (GameControls を統合) */}
      <section
        className="hidden md:flex xl:hidden shrink-0 px-2 py-1.5 border-t bg-muted/40 items-end gap-2 overflow-x-auto"
        style={{ paddingBottom: "max(0.375rem, env(safe-area-inset-bottom))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <Badge className="shrink-0" variant="default">▲ 自分</Badge>
        {ownTrapSlot}
        <div ref={ownHandTabletRef} className="flex-1 min-w-0">{ownHand}</div>
        <div ref={ownDeckPileTabletRef} className="shrink-0">{ownDeckPile}</div>
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

      {/* モバイル (<md): 下端 3カラム構成 (P20) */}
      {/* 左ブロック(2段): 段1=待った/投了(右寄せ、薄め)、段2=手札ボタン+マナゲージ */}
      {/* 中央ブロック: 山札 (左ブロック2段分の高さ) */}
      {/* 右ブロック: トラップ (同上の高さ) */}
      <section
        className="md:hidden xl:hidden shrink-0 border-t bg-card flex items-stretch gap-2 px-2 py-1.5 z-30"
        style={{ paddingBottom: "max(0.375rem, env(safe-area-inset-bottom))" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 左ブロック: 2段(右の山札と同じ高さに伸縮、各段 flex-1 で半分ずつ) */}
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          {/* 段1: 待った・投了 (中央揃え、縦幅小さめ) */}
          <div className="flex items-center justify-center shrink-0">
            <GameControls
              onResign={resign}
              onUndo={undo}
              isMuted={isMuted}
              onToggleMute={toggleMute}
              canUndo={canUndo}
              gameActive={isGameActive}
              hideSound
            />
          </div>
          {/* 段2: 手札ボタン + マナゲージ (flex-1 で残り高さを取る) */}
          <div className="flex-1 flex items-center gap-2">
            <div ref={ownHandMobileBtnRef} className="shrink-0">
              <Button
                size="sm"
                variant={drawerOpen ? "outline" : "default"}
                className="h-9 gap-1 text-xs"
                onClick={() => setDrawerOpen((v) => !v)}
              >
                {drawerOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                手札 {displayedOwnHand.length}
              </Button>
            </div>
            <div className="flex-1 min-w-0">{ownManaGaugeCompact}</div>
          </div>
        </div>
        {/* 中央: 山札 (左2段の高さに合わせて伸びる) */}
        <div ref={ownDeckPileMobileRef} className="shrink-0 flex">{ownDeckPileMobile}</div>
        {/* 右: トラップ */}
        <div className="shrink-0 flex">{ownTrapSlotMobile}</div>
      </section>

      {/* モバイル: 手札ドロワー(下からスライドアップ) */}
      {/* bottom 値は下端 3カラムセクションの高さ (山札 md = 80px + padding) に合わせる */}
      <div
        className={cn(
          "md:hidden fixed left-0 right-0 z-20 bg-card border-t-2 border-primary shadow-2xl transition-transform duration-300",
          drawerOpen ? "translate-y-0" : "translate-y-full",
        )}
        style={{
          bottom: "calc(100px + env(safe-area-inset-bottom))",
          maxHeight: "55dvh",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3 py-2 border-b flex items-center justify-between">
          <span className="text-sm font-bold">あなたの手札</span>
          <Button size="sm" variant="ghost" onClick={() => setDrawerOpen(false)}>閉じる</Button>
        </div>
        <div className="p-3 overflow-x-auto">
          {/* Issue #106: モバイル手札は幅が狭くトラップラベルとカード名が
            * 被るため、効果記述は非表示。トラップ用バッジは CardView 側で
            * カード名の下に再配置される。 */}
          <HandArea
            hand={displayedOwnHand}
            currentMana={cardState.mana[playerColor]}
            size="md"
            disabled={handDisabled}
            flashCardId={freshlyDrawnId}
            hideCardDescription
            onCardClick={(id) => {
              handleBeginPlayCard(id);
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
      <div
        className="hidden xl:grid xl:grid-cols-[220px_1fr_240px_220px] xl:grid-rows-[auto_minmax(0,1fr)] xl:gap-2 xl:p-2 h-full"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー (全列スパン)、音量トグルは「あなたの番」横に分離配置 (R15) */}
        <div className="col-span-4 flex items-center justify-between px-2 py-1 shrink-0">
          <div className="flex items-center gap-2">
            <Badge variant={isPlayerTurn ? "default" : "secondary"} className="text-xs">
              {isPlayerTurn ? "あなたの番" : "相手の番"}
            </Badge>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={toggleMute}
              aria-label={isMuted ? "ミュート中" : "音あり"}
              title={isMuted ? "ミュート中" : "音あり"}
            >
              {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </Button>
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
            <div ref={ownDeckPileXlRef} className="flex-1 min-w-0">
              <DeckPile
                count={cardState.deck[playerColor].length}
                canDraw={cardState.mana[playerColor] >= DRAW_COST && isPlayerTurn && isGameActive && !inCheck && !isDrawAnimating}
                onDraw={drawCard}
                size="lg"
                showDrawCost
                fullWidth
                dimmed={!isPlayerTurn || !isGameActive}
              />
            </div>
            <div className="flex-1 min-w-0">
              <TrapSlot trap={cardState.trap[playerColor]} size="lg" fullWidth />
            </div>
          </div>
          <div className="text-xs text-muted-foreground font-medium shrink-0 text-center">手札 {displayedOwnHand.length}枚</div>
          <div ref={ownHandXlRef} className="flex-1 min-h-0 overflow-y-auto">
            <HandArea
              hand={displayedOwnHand}
              currentMana={cardState.mana[playerColor]}
              layout="vertical"
              size="md"
              disabled={handDisabled}
              fullWidth
              flashCardId={freshlyDrawnId}
              onCardClick={handleBeginPlayCard}
            />
          </div>
          <div className="shrink-0 pt-2 border-t flex justify-center">
            {/* R15: 音量はヘッダーへ分離、ここは「待った」「投了」のみ(文字付き) */}
            <GameControls
              onResign={resign}
              onUndo={undo}
              isMuted={isMuted}
              onToggleMute={toggleMute}
              canUndo={canUndo}
              gameActive={isGameActive}
              hideSound
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
              ref={boardXlRef}
              board={gameState.board}
              currentPlayer={gameState.currentPlayer}
              playerColor={playerColor}
              selectedSquare={selectedSquare}
              legalMoves={legalMoves}
              lastMove={gameState.moveHistory[gameState.moveHistory.length - 1] ?? null}
              isAiThinking={isAiThinking}
              inCheck={inCheck}
              onSquareClick={handleSquareClick}
              squareSize={squareSize}
              isMobile={isMobile}
              cardTargetSquares={cardTargetSquares}
            />
            <BoardOverlay
              key={overlayEvent?.key}
              event={overlayEvent?.event ?? null}
              trapName={overlayEvent?.trapName}
            />
          </div>
          <div className="w-full shrink-0" style={{ maxWidth: squareSize * 9 + 60 }}>
            <CapturedPieces
              hand={gameState.hand}
              player={playerColor}
              playerColor={playerColor}
              isCurrentPlayer={isPlayerTurn && isGameActive}
              selectedHandPiece={selectedHandPiece}
              onPieceClick={handleHandPieceClick}
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
            <CardShogiHistory eventLog={eventLog} />
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
              <DeckPile count={cardState.deck[aiColor].length} size="lg" fullWidth showDrawCost />
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
        onConfirm={handleConfirmPlayCard}
        onCancel={cancelPlayCard}
      />
      <CardTargetingNotice
        pendingCard={cardState.pendingCard}
        onCancel={cancelPlayCard}
      />

      {/* Issue #78: ドロー中央演出 (山札→中央→手札の DOMRect 追従) */}
      <DrawFlightCard
        cardInstance={drawFlight?.card ?? null}
        flightKey={drawFlight?.key ?? null}
        deckRectGetter={getDeckRect}
        handRectGetter={getHandRect}
        onComplete={handleDrawFlightComplete}
      />

      {/* Issue #106: カード使用/トラップセット時の中央演出 (中央にパッと出現+キラッと光る) */}
      <CardPlayFlight
        cardInstance={playFlight?.card ?? null}
        flightKey={playFlight?.key ?? null}
        isTrap={playFlight?.isTrap ?? false}
        onComplete={handlePlayFlightComplete}
      />

      {/* Issue #77: マナ加減算の浮遊テキスト (起点 UI 付近に表示) */}
      <ManaFlightLayer items={manaFlights} onComplete={removeManaFlight} />

      {/* Issue #81: 早指し時に駒の少し下に表示するバッジ */}
      <FastMoveBadgeLayer items={fastMoveBadges} onComplete={removeFastMoveBadge} />
    </div>
  );
}

