"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { flushSync, createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronUp, ChevronDown, Volume2, VolumeX } from "lucide-react";

import { useCardShogiGame } from "@/hooks/use-card-shogi-game";
import { useSound } from "@/hooks/use-sound";
import { useCardBoardSize } from "@/hooks/use-card-board-size";

import { ShogiBoard, type ShogiBoardHandle } from "../shogi-board";
import { CapturedPieces } from "../captured-pieces";
import { ShogiPiece } from "../shogi-piece";
import { CardShogiHistory } from "./card-shogi-history";
import { GameControls, GAME_CONTROLS_HEIGHT } from "../game-controls";
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
import { unpromotePieceType } from "@/lib/shogi/variants/standard";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";
import { getVariantById } from "@/lib/shogi/variants/index";
import type { Difficulty, GameConfig, GameState, Move, Player, Position } from "@/lib/shogi/types";
import type { CommentaryEvent } from "@/app/actions/commentary";
import type { CardGameState, CardInstance } from "@/lib/shogi/cards/types";
import { CARD_DEFS, CARD_USE_CONDITIONS, DRAW_COST } from "@/lib/shogi/cards/definitions";
import { isDoublePawnLegalSquare, isPieceReturnLegalSquare, isValidCardTargetSquare, simulateCardEffect, canEscapeCheckWithCard, hasSameKindTrapPlaced } from "@/lib/shogi/cards/effects";
import type { CardId } from "@/lib/shogi/cards/types";
import { createGame } from "@/app/actions/game";

import { ManaGauge } from "./mana-gauge";
import { HandArea } from "./hand-area";
import { TrapSlot } from "./trap-slot";
import { DeckPile } from "./deck-pile";
import { CardPlayDialog, CardTargetingNotice } from "./card-play-dialog";
import { DoubleMoveNotice } from "./double-move-notice";
import { DrawFlightCard } from "./draw-flight-card";
import { CardPlayFlight } from "./card-play-flight";
import { PieceFlight, type PieceFlightSpec } from "./piece-flight";
import { useFlightParams } from "@/lib/dev/flight-params";
import { ManaFlightLayer } from "./mana-flight";
import { FastMoveBadgeLayer } from "./fast-move-badge";
import { useManaFlightLayer } from "./use-mana-flight-layer";
import { useFastMoveBadgeLayer } from "./use-fast-move-badge-layer";

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

// 子コンポーネント (CapturedPieces 等) に渡す noop。
// インライン `() => {}` を毎レンダー新しい関数として渡すと React.memo の浅い比較が
// 無効化されてしまうため、モジュールスコープで定義して安定化する (Step 2 / Issue #107)。
const NOOP_PIECE_CLICK: (pieceType: string) => void = () => {};
const NOOP_UNDO: () => void = () => {};

// 空配列の共有参照。pieceFlight 等で「該当なし」のケースを useMemo に通しても
// 毎レンダー [] を new するとメモ化が無効化されるため、フラグメンテーション回避。
const EMPTY_POSITIONS: Position[] = [];
const EMPTY_STRINGS: string[] = [];

export function CardShogiGame({
  initialGameState,
  initialCardState,
  gameId,
  gameConfig: serializableConfig,
}: CardShogiGameProps) {
  const [commentEvent, setCommentEvent] = useState<CommentaryEvent | null>(null);
  const [overlayEvent, setOverlayEvent] = useState<{ event: OverlayEvent; key: number; trapName?: string } | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Step S4 (Issue #107): モバイル/タブレットの終了カードを最小化できるように
  // する。閉じると盤面・持ち駒が見え、再度展開して「もう一局」「ホームへ」を
  // 押せる。
  const [endCardMinimized, setEndCardMinimized] = useState(false);
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
  // Step 5 (Issue #107): state / id ref / trigger / remove は useManaFlightLayer
  // フックに集約。再描画 skip は useState 内部の参照比較任せのため変更なし。
  const { items: manaFlights, trigger: triggerManaFlight, remove: removeManaFlight } = useManaFlightLayer();
  // 早指し時のバッジ。マナ +N と同じ駒位置イベントから派生し、駒の少し下に表示。
  const { items: fastMoveBadges, trigger: triggerFastMoveBadge, remove: removeFastMoveBadge } = useFastMoveBadgeLayer();
  // カード使用時、reducer がカードを hand から削除する前に DOMRect を保管する。
  // cardPlayEvent / trapSetEvent / マナUP の manaChargeEvent(reason: card) の起点として使う。
  const playedCardRectRef = useRef<{ id: string; rect: DOMRect } | null>(null);
  // Issue #82: カード使用後の駒移動アニメ用 spec。
  // フロー(改): カード使用 → 駒フライト → 中央カード演出 → finalize
  // hideTarget: フライト中、着地点(to)に既に表示されている駒/持ち駒を非表示にする情報。
  type FlightHideTarget =
    | { kind: "board"; row: number; col: number }
    | { kind: "captured"; player: Player; pieceType: string };
  const [pieceFlight, setPieceFlight] = useState<{
    spec: PieceFlightSpec;
    key: number;
    hideTarget: FlightHideTarget;
  } | null>(null);
  const pieceFlightKeyRef = useRef(0);
  // 適用前にしか取れない rect (二歩指しの持ち駒位置 / 駒戻しの戻る駒種など) を保管。
  const pendingPieceFlightRef = useRef<{
    pieceType: string;
    fromRect: DOMRect;
    toRect: DOMRect | null; // 歩戻し / 駒戻しは適用後の持ち駒位置を後から補完
  } | null>(null);
  // 駒フライト完了後に発火する中央カード演出の予約。
  const pendingPlayFlightRef = useRef<{ card: CardInstance; isTrap: boolean } | null>(null);
  // Issue #82 (王手崩し): トラップ発動による複数駒フライト演出。
  // null: 演出なし。
  // ghosts: 王手中央表示+トラップ発動演出の間、reducer は既に駒を盤上から除去
  //   しているため、駒の元位置に「ゴースト駒」を絶対配置で重ね描きする。
  //   フライト開始時にクリア。
  // hitActive: トラップ発動タイミング (T=1600) で true に切り替わり、
  //   ゴースト駒に紫フラッシュ+シェイク+グローのヒット演出を付与する。
  // flights: 値ありになったらフライト開始。pendingFlightCount=0 で finalize。
  const [checkBreakAnim, setCheckBreakAnim] = useState<{
    ghosts: Array<{ rect: DOMRect; pieceType: string; owner: Player }>;
    hitActive: boolean;
    flights: PieceFlightSpec[];
    flightKeyBase: number;
    hideTargets: FlightHideTarget[];
    pendingFlightCount: number;
  } | null>(null);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { squareSize, isMobile, viewportHeight } = useCardBoardSize();
  // 開発者用 dev /piece-flight で保存されたフライト演出パラメータ。
  // 未保存時は animation-constants の既定値が返る。
  const flightParams = useFlightParams();

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
    finalizePlayCard,
    cancelPlayCard,
    finalizeCheckBreak,
    isPlayingCard,
    isCheckBreakAnimating,
    doubleMove,
    undoDoubleMoveFirst,
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

  // 表示中の持ち駒(captured-piece ボタン)から DOMRect を返す。レイアウト切替で
  // 複数描画されているうち visible なものを採用 (Issue #82)。
  const findVisibleCapturedPieceRect = useCallback(
    (player: Player, pieceType: string): DOMRect | null => {
      if (typeof document === "undefined") return null;
      const els = document.querySelectorAll<HTMLElement>(
        `[data-captured-piece="${player}-${pieceType}"]`,
      );
      for (const el of els) {
        if (el.offsetParent !== null) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) return rect;
        }
      }
      return null;
    },
    [],
  );

  // reducer が hand からカードを削除する前に、使用カードの矩形を捕捉する。
  // 後続イベント (cardPlayEvent / trapSetEvent / manaChargeEvent reason="card") で起点として参照される。
  const cachePendingCardRect = useCallback(() => {
    const pc = cardState.pendingCard;
    if (!pc) return;
    const rect = findVisibleCardRect(pc.instance.instanceId);
    if (rect) playedCardRectRef.current = { id: pc.instance.instanceId, rect };
  }, [cardState.pendingCard, findVisibleCardRect]);

  // 直前に使用したカードの DOMRect を取得 (triggerManaFlight 等の起点として利用)。
  // instanceId 指定時 (cardPlayEvent / trapSetEvent): キャッシュの id 一致を確認、
  //   不一致なら手札中央にフォールバック。
  // instanceId 未指定時 (manaChargeEvent reason="card"): キャッシュ rect をそのまま再利用。
  const getOriginRect = useCallback(
    (instanceId?: string): DOMRect | null => {
      const cached = playedCardRectRef.current;
      if (instanceId !== undefined) {
        return cached?.id === instanceId ? cached.rect : getHandRect();
      }
      return cached?.rect ?? getHandRect();
    },
    [getHandRect],
  );

  const handleConfirmPlayCard = useCallback(() => {
    cachePendingCardRect();
    // Issue #82: 駒フライト用 rect キャッシュは handleSquareClick 側 (盤面ターゲット
    // 選択時) で行う。target が要らないカードはここで通過するだけ。
    confirmPlayCard();
    // Issue #106: モバイル手札ドロワーは「使用する」確定時に閉じる
    // (キャンセル時は開いたままにし、再度カードを選び直しやすくする)
    setDrawerOpen(false);
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
            triggerManaFlight(-def.cost, getOriginRect(ev.instance.instanceId));
          }
          // Issue #82: 駒移動カード(歩戻し/駒戻し/二歩指し)は handleSquareClick 内で
          // flushSync により先回り発火済み。ここでは:
          //  - pendingPieceFlightRef に新規駒種(toRect=null)ケースだけが残っている →
          //    適用後の DOM から toRect を補完して発火
          //  - それ以外(駒移動なしカード / 既に発火済み)→ 中央カード演出を即発火
          if (ev.player === playerColor) {
            const cardInstance = ev.instance;
            const pending = pendingPieceFlightRef.current;
            if (pending && pending.toRect === null) {
              // 新規駒種: 適用後の DOM から to rect を取る
              pendingPieceFlightRef.current = null;
              const toRect = findVisibleCapturedPieceRect(playerColor, pending.pieceType);
              if (toRect) {
                pieceFlightKeyRef.current += 1;
                setPieceFlight({
                  spec: {
                    pieceType: pending.pieceType,
                    owner: playerColor,
                    fromX: pending.fromRect.left + pending.fromRect.width / 2,
                    fromY: pending.fromRect.top + pending.fromRect.height / 2,
                    toX: toRect.left + toRect.width / 2,
                    toY: toRect.top + toRect.height / 2,
                  },
                  key: pieceFlightKeyRef.current,
                  hideTarget: { kind: "captured", player: playerColor, pieceType: pending.pieceType },
                });
                pendingPlayFlightRef.current = { card: cardInstance, isTrap: false };
              } else {
                // 取得失敗 → 中央カード演出のみ
                playFlightKeyRef.current += 1;
                setPlayFlight({ card: cardInstance, key: playFlightKeyRef.current, isTrap: false });
              }
            } else if (!pendingPlayFlightRef.current) {
              // 駒フライト未発火 (= 駒移動なしカード) → 中央カード演出を即発火
              playFlightKeyRef.current += 1;
              setPlayFlight({ card: cardInstance, key: playFlightKeyRef.current, isTrap: false });
            }
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
            triggerManaFlight(ev.amount, getOriginRect());
          }
          break;
        case "trapSetEvent": {
          playSfx("card_play");
          const def = CARD_DEFS[ev.instance.defId];
          if (def.cost > 0) {
            triggerManaFlight(-def.cost, getOriginRect(ev.instance.instanceId));
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
        case "trapTriggerEvent": {
          const trapDef = CARD_DEFS[ev.instance.defId];
          // Issue #82 (王手崩し): 王手 → トラップ発動 → 駒フライト の3段演出
          if (trapDef.id === "check_break" && ev.capturedPieces && ev.capturedPieces.length > 0) {
            const trapOwner = ev.player;
            const captures = ev.capturedPieces;
            // reducer は適用済 (盤上から駒除去・持ち駒に追加) なので、
            // 王手中央表示+トラップ発動演出の間は元位置にゴースト駒を重ね描きする。
            // fromRect: 元の盤面マス (空マスになっているがマス自体は存在)
            // toRect: 持ち駒として既に追加されている表示位置 (hideTargets で隠す)
            const ghosts: Array<{ rect: DOMRect; pieceType: string; owner: Player }> = [];
            const flights: PieceFlightSpec[] = [];
            const hideTargets: FlightHideTarget[] = [];
            for (const cap of captures) {
              const fromRect = getBoardSquareRect(cap.row, cap.col);
              const toRect = findVisibleCapturedPieceRect(trapOwner, cap.pieceType);
              if (!fromRect) continue;
              ghosts.push({
                rect: fromRect,
                pieceType: cap.originalPieceType,
                owner: cap.originalOwner,
              });
              const fromX = fromRect.left + fromRect.width / 2;
              const fromY = fromRect.top + fromRect.height / 2;
              const toX = toRect ? toRect.left + toRect.width / 2 : fromX;
              const toY = toRect ? toRect.top + toRect.height / 2 : fromY;
              flights.push({
                pieceType: cap.pieceType,
                owner: trapOwner,
                fromX,
                fromY,
                toX,
                toY,
              });
              hideTargets.push({ kind: "captured", player: trapOwner, pieceType: cap.pieceType });
            }
            // 演出ロックは reducer 側で isCheckBreakAnimating=true がセット済。
            // ゴースト駒を盤面に重ね描きしつつ、持ち駒側はフライト着地まで隠す。
            pieceFlightKeyRef.current += captures.length;
            const flightKeyBase = pieceFlightKeyRef.current - captures.length + 1;
            setCheckBreakAnim({
              ghosts,
              hitActive: false,
              flights: [],   // フライト発火前は空配列。ゴーストのみ表示。
              flightKeyBase,
              hideTargets,
              pendingFlightCount: flights.length,
            });
            // T=0: 王手中央表示 (1600ms = 100 fadeIn + 1000 hold + 500 fadeOut)
            playSfx("check");
            setOverlayEvent({ event: "check", key: Date.now() });
            // T=1600: トラップ発動演出 (2300ms = 200 fadeIn + 1500 hold + 600 fadeOut)
            //   + ゴースト駒へヒット演出 (紫フラッシュ + シェイク + 持続グロー)
            window.setTimeout(() => {
              playSfx("trap_trigger");
              setOverlayEvent({
                event: "trap_trigger",
                key: Date.now(),
                trapName: trapDef.name,
              });
              setCheckBreakAnim((prev) => (prev ? { ...prev, hitActive: true } : null));
            }, 1600);
            // T=3900: ゴーストを消し、駒フライト並行発火
            window.setTimeout(() => {
              setCheckBreakAnim((prev) => (prev ? { ...prev, ghosts: [], flights } : null));
            }, 1600 + 2300);
            break;
          }
          // 既存トラップ (no_promote 等): 即時オーバーレイ
          playSfx("trap_trigger");
          setOverlayEvent({
            event: "trap_trigger",
            key: Date.now(),
            trapName: trapDef.name,
          });
          break;
        }
      }
    }
    lastEventIndexRef.current = eventLog.length;
  }, [eventLog, isReady, playSfx, playerColor, triggerManaFlight, triggerFastMoveBadge, getDeckRect, getOriginRect, getBoardSquareRect, findVisibleCapturedPieceRect]);

  // Issue #78 / #82: 演出中(ドロー / カード使用 / 王手崩しトラップ)は盤面・手札・カード操作・背景クリックをロックする
  const handleSquareClick = useCallback(
    (pos: Position) => {
      if (isDrawAnimating || isPlayingCard || isCheckBreakAnimating) return;
      // 歩戻し等のターゲット選択フェーズで盤面クリックが confirm に直結するため、ここでも矩形を捕捉
      if (cardState.pendingCard) cachePendingCardRect();

      // Issue #82: ターゲット選択フェーズでは盤面クリックが SELECT_CARD_TARGET 経由で
      // reducer 内で CONFIRM_PLAY_CARD を即時再帰実行するため、handleConfirmPlayCard
      // を経由しない。駒フライト用 rect / spec を取り、可能なら効果適用前に
      // flushSync で setPieceFlight を発火して「効果適用 → 駒出現」の隙間を消す。
      // Step S1 (Issue #107): 無効マスをタップした場合は selectSquare 側で弾かれるが、
      // それより前に flushSync で駒フライトを起動してしまうとフライト + 中央カード
      // 演出が空振りする。ここで isValidCardTargetSquare を先行ガードする。
      if (cardState.pendingCard && cardState.pendingCard.phase === "selectTarget") {
        const def = CARD_DEFS[cardState.pendingCard.instance.defId];
        if (!isValidCardTargetSquare(gameState, playerColor, def.id, pos)) {
          selectSquare(pos);
          return;
        }
        const cardInstance = cardState.pendingCard.instance;
        pendingPieceFlightRef.current = null;

        let fromRect: DOMRect | null = null;
        let toRect: DOMRect | null = null;
        let pieceType: string | null = null;
        let hideTarget: FlightHideTarget | null = null;

        if (def.effectId === "double_pawn") {
          fromRect = findVisibleCapturedPieceRect(playerColor, "pawn");
          toRect = getBoardSquareRect(pos.row, pos.col);
          pieceType = "pawn";
          hideTarget = { kind: "board", row: pos.row, col: pos.col };
        } else if (def.effectId === "pawn_return" || def.effectId === "piece_return") {
          const piece = gameState.board[pos.row]?.[pos.col];
          if (piece) {
            fromRect = getBoardSquareRect(pos.row, pos.col);
            pieceType = unpromotePieceType(piece.type);
            // 既存駒種の持ち駒位置 (適用前から DOM が存在するなら取れる)
            toRect = findVisibleCapturedPieceRect(playerColor, pieceType);
            hideTarget = { kind: "captured", player: playerColor, pieceType };
          }
        }

        if (fromRect && toRect && pieceType && hideTarget) {
          // 効果適用前に flushSync で setPieceFlight を即時反映 →
          // hidden が先に効くので、効果適用で駒が +1 されても見えない
          pieceFlightKeyRef.current += 1;
          const newKey = pieceFlightKeyRef.current;
          const spec = {
            pieceType,
            owner: playerColor,
            fromX: fromRect.left + fromRect.width / 2,
            fromY: fromRect.top + fromRect.height / 2,
            toX: toRect.left + toRect.width / 2,
            toY: toRect.top + toRect.height / 2,
          };
          const ht = hideTarget;
          flushSync(() => {
            setPieceFlight({ spec, key: newKey, hideTarget: ht });
          });
          pendingPlayFlightRef.current = { card: cardInstance, isTrap: false };
        } else if (fromRect && pieceType && hideTarget) {
          // 新規駒種ケース (持ち駒に該当駒種が無い): toRect 未確定。
          // cardPlayEvent エフェクトで適用後に補完する。
          pendingPieceFlightRef.current = { pieceType, fromRect, toRect: null };
        }
      }

      selectSquare(pos);
    },
    [
      isDrawAnimating,
      isPlayingCard,
      selectSquare,
      cardState.pendingCard,
      cachePendingCardRect,
      playerColor,
      gameState,
      findVisibleCapturedPieceRect,
      getBoardSquareRect,
    ],
  );
  const handleHandPieceClick = useCallback(
    (piece: Parameters<typeof selectHandPiece>[0]) => {
      if (isDrawAnimating || isPlayingCard || isCheckBreakAnimating) return;
      selectHandPiece(piece);
    },
    [isDrawAnimating, isPlayingCard, isCheckBreakAnimating, selectHandPiece],
  );
  const handleBeginPlayCard = useCallback(
    (id: string) => {
      if (isDrawAnimating || isPlayingCard || isCheckBreakAnimating) return;
      beginPlayCard(id);
    },
    [isDrawAnimating, isPlayingCard, isCheckBreakAnimating, beginPlayCard],
  );
  const handleDeselect = useCallback(() => {
    if (isDrawAnimating || isPlayingCard || isCheckBreakAnimating) return;
    deselect();
  }, [isDrawAnimating, isPlayingCard, isCheckBreakAnimating, deselect]);

  // 演出中は最新ドローカードを手札表示から除外し、演出完了後に手札に現れたように見せる
  const displayedOwnHand = useMemo(() => {
    if (!drawFlight) return cardState.hand[playerColor];
    return cardState.hand[playerColor].filter((c) => c.instanceId !== drawFlight.card.instanceId);
  }, [cardState.hand, playerColor, drawFlight]);

  // Issue #82 (修正): フローを「カード使用 → 駒フライト → 中央カード演出 → finalize」へ。
  // - cardPlayEvent エフェクト側で「駒フライト or 中央カード演出」のどちらを先に発火するか判断
  // - 駒移動を伴うカードは駒フライトのみ発火し、handlePieceFlightComplete で中央カード演出を予約発火
  // - 中央カード演出完了 (handlePlayFlightComplete) で finalize → COMMIT_PLAY_CARD
  const handlePieceFlightComplete = useCallback(() => {
    setPieceFlight(null);
    const pendingPlay = pendingPlayFlightRef.current;
    if (pendingPlay) {
      playFlightKeyRef.current += 1;
      setPlayFlight({
        card: pendingPlay.card,
        key: playFlightKeyRef.current,
        isTrap: pendingPlay.isTrap,
      });
      pendingPlayFlightRef.current = null;
    } else {
      // 中央カード演出が予約されていない異常系: 直接 finalize
      finalizePlayCard();
    }
  }, [finalizePlayCard]);

  const handlePlayFlightComplete = useCallback(() => {
    setPlayFlight(null);
    finalizePlayCard();
  }, [finalizePlayCard]);

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
    // Issue #82: 手札スクロールを最後尾へ。PC は縦スクロール、モバイルは横スクロール。
    // どちらの場合でも scrollTop / scrollLeft を最大に設定すれば、該当しない軸は無視される。
    //
    // 堅牢化: setDrawFlight(null) 後の React re-render → DOM commit → paint を
    // 確実に待つため double rAF を使用。さらに paint 後の scrollHeight 取得時点
    // でも新カードが反映されていない稀ケース(または smooth スクロール中の DOM
    // 変動)に備えて、120ms 後にも再度スクロール (保険)。
    if (typeof window !== "undefined") {
      const scrollHandToEnd = () => {
        document.querySelectorAll<HTMLElement>("[data-hand-scroll]").forEach((el) => {
          if (el.offsetParent === null) return; // 非表示レイアウトはスキップ
          el.scrollTo({ top: el.scrollHeight, left: el.scrollWidth, behavior: "smooth" });
        });
      };
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          scrollHandToEnd();
          window.setTimeout(scrollHandToEnd, 120);
        });
      });
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
  // モバイル下端用の TrapSlot。山札 md と高さを揃えるため md サイズ。
  // Issue #105: 親 div に flex-1 で残り幅を割り当てるため fullWidth で追従させる。
  const ownTrapSlotMobile = <TrapSlot trap={cardState.trap[playerColor]} size="md" fullWidth />;

  // Issue #82: 駒フライト中、着地点を非表示にするための props 計算。
  // Step 2 (Issue #107): useMemo + 空配列の共有参照で ShogiBoard / CapturedPieces の
  // memo を効かせる。
  const hiddenBoardSquares = useMemo<Position[]>(() => {
    if (!pieceFlight || pieceFlight.hideTarget.kind !== "board") return EMPTY_POSITIONS;
    return [{ row: pieceFlight.hideTarget.row, col: pieceFlight.hideTarget.col }];
  }, [pieceFlight]);
  const hiddenOwnCapturedTypes = useMemo<string[]>(() => {
    const result: string[] = [];
    if (
      pieceFlight &&
      pieceFlight.hideTarget.kind === "captured" &&
      pieceFlight.hideTarget.player === playerColor
    ) {
      result.push(pieceFlight.hideTarget.pieceType);
    }
    // Issue #82 (王手崩し): トラップ演出中、自分側の持ち駒に流入する駒種を隠す
    if (checkBreakAnim) {
      for (const ht of checkBreakAnim.hideTargets) {
        if (ht.kind === "captured" && ht.player === playerColor) {
          result.push(ht.pieceType);
        }
      }
    }
    return result.length === 0 ? EMPTY_STRINGS : result;
  }, [pieceFlight, playerColor, checkBreakAnim]);
  // Issue #82 (王手崩し): 相手側 (AI) のトラップ発動時、相手の持ち駒に流入する駒種を隠す
  const hiddenOpponentCapturedTypes = useMemo<string[]>(() => {
    if (!checkBreakAnim) return EMPTY_STRINGS;
    const result: string[] = [];
    for (const ht of checkBreakAnim.hideTargets) {
      if (ht.kind === "captured" && ht.player === aiColor) {
        result.push(ht.pieceType);
      }
    }
    return result.length === 0 ? EMPTY_STRINGS : result;
  }, [checkBreakAnim, aiColor]);

  // Issue #82 (王手崩し): 1 枚分のフライト完了で pendingFlightCount を減算。
  // 0 になったら finalizeCheckBreak で AI 思考とユーザー操作のロックを解除。
  const handleCheckBreakFlightComplete = useCallback(() => {
    setCheckBreakAnim((prev) => {
      if (!prev) return null;
      const next = prev.pendingFlightCount - 1;
      if (next <= 0) {
        // すべて完了 → finalize
        finalizeCheckBreak();
        return null;
      }
      return { ...prev, pendingFlightCount: next };
    });
  }, [finalizeCheckBreak]);

  // 山札からのドロー可否 (Issue #82: pendingCard 中もドロー禁止に統一)
  const canDrawCard =
    cardState.mana[playerColor] >= DRAW_COST &&
    isPlayerTurn &&
    isGameActive &&
    !inCheck &&
    !isDrawAnimating &&
    !isPlayingCard &&
    !isCheckBreakAnimating &&
    cardState.pendingCard === null;

  const opponentDeckPile = <DeckPile count={cardState.deck[aiColor].length} size="md" showDrawCost />;
  const ownDeckPile = (
    <DeckPile
      count={cardState.deck[playerColor].length}
      canDraw={canDrawCard}
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
      canDraw={canDrawCard}
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

  // 手札の操作可否 (Issue #82 で王手仕様変更):
  // - 王手中も「王手回避になるカードのみ使用可」とする方針に変更したため、inCheck で
  //   一律 disabled にはしない。個別カードの非活性化は unusableCardIds 側で制御する。
  // - ドロー演出中・カード使用演出中・別カード使用中・王手崩し演出中は引き続き全体ロック
  const handDisabled = !isPlayerTurn || !isGameActive || cardState.pendingCard !== null || isDrawAnimating || isPlayingCard || isCheckBreakAnimating;

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
    let targets: Position[] = [];
    if (def.effectId === "pawn_return") {
      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          const piece = gameState.board[r]?.[c];
          if (piece && piece.owner === playerColor && (piece.type === "pawn" || piece.type === "promoted_pawn")) {
            targets.push({ row: r, col: c });
          }
        }
      }
    } else if (def.effectId === "piece_return") {
      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          if (isPieceReturnLegalSquare(gameState, playerColor, { row: r, col: c })) {
            targets.push({ row: r, col: c });
          }
        }
      }
    } else if (def.effectId === "double_pawn") {
      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          if (isDoublePawnLegalSquare(gameState, playerColor, { row: r, col: c })) {
            targets.push({ row: r, col: c });
          }
        }
      }
    }
    // 王手中は、王手回避になる配置先のみハイライト (Issue #82)
    if (inCheck) {
      targets = targets.filter((pos) => {
        const after = simulateCardEffect(gameState, playerColor, def.id, {
          kind: "square",
          row: pos.row,
          col: pos.col,
        });
        return after && !isInCheck(after, playerColor, CARD_SHOGI_VARIANT);
      });
    }
    return targets;
  }, [cardState.pendingCard, gameState, playerColor, inCheck]);

  // no_promote の永続マーク (両プレイヤー分をまとめて盤面に渡す)
  const noPromoteSquares: Position[] = useMemo(
    () => [...cardState.noPromoteMarks.sente, ...cardState.noPromoteMarks.gote],
    [cardState.noPromoteMarks],
  );

  // マナ以外の使用条件を満たさないカードIDを集計し、HandArea で非活性化する (Issue #82)。
  // - 通常時: CARD_USE_CONDITIONS の defId 別関数で判定
  // - 王手中: そのカードで王手回避できなければ非活性 (王手回避手段がない=不可)
  // - トラップ: 同種トラップが既に盤面にあれば非活性 (Issue #105)
  // 手札に存在する defId のみ評価する。
  const unusableCardIds = useMemo(() => {
    const set = new Set<string>();
    const seen = new Set<string>();
    for (const inst of displayedOwnHand) {
      if (seen.has(inst.defId)) continue;
      seen.add(inst.defId);
      const def = CARD_DEFS[inst.defId];
      // Issue #105: 同種トラップが盤面に存在すれば、その種別の手札カードは使用不可
      if (def.kind === "trap" && hasSameKindTrapPlaced(cardState, playerColor, inst.defId)) {
        set.add(inst.defId);
        continue;
      }
      const useCond = CARD_USE_CONDITIONS[inst.defId];
      if (useCond && !useCond(gameState, playerColor, cardState)) {
        set.add(inst.defId);
        continue;
      }
      // 王手中: 王手回避できないカードは非活性。Step 3 (Issue #107):
      // 1 マスでも回避可能なら true を返す早期 return 版で、王手中の
      // 計算量を 30-50% 削減する。
      if (inCheck) {
        if (!canEscapeCheckWithCard(gameState, playerColor, inst.defId as CardId)) {
          set.add(inst.defId);
        }
      }
    }
    return set;
  }, [displayedOwnHand, gameState, cardState, playerColor, inCheck]);

  const ownHand = (
    <HandArea
      hand={displayedOwnHand}
      currentMana={cardState.mana[playerColor]}
      onCardClick={handleBeginPlayCard}
      size="md"
      disabled={handDisabled}
      flashCardId={freshlyDrawnId}
      unusableCardIds={unusableCardIds}
    />
  );

  // Issue #105: モバイルでは画面最上段、タブレット以降は中央エリア先頭に配置する
  // (タブレット動作維持のため両所でレンダリング)。
  const statusBarContent = (
    <div className="flex items-center justify-between w-full px-2 shrink-0" style={{ height: 28 }}>
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
  );

  return (
    <div
      className="shogi-game-area w-full overflow-hidden flex flex-col"
      style={{ height: viewportHeight }}
      onClick={handleDeselect}
    >
      {/* モバイル: ステータスバーを画面最上段に配置 (Issue #105) */}
      <div className="md:hidden shrink-0 bg-card border-b">{statusBarContent}</div>
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
      {/* モバイル (<md): 上端バー (Issue #105 でカードデザイン化)
        * 左: △ ラベル + マナゲージ (縦積み)
        * 右: 手札 stack (max 10) + 山札 + トラップ (sm カードデザインで横幅統一) */}
      <section
        className="md:hidden shrink-0 px-2 py-1 border-b bg-muted/40 flex items-end gap-2 text-xs"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 左: △ ラベル + マナゲージ (縦積み) */}
        <div className="flex flex-col items-stretch gap-1 shrink-0 self-center">
          <Badge variant="outline" className="shrink-0 text-[10px] px-1.5 py-0 self-center">△</Badge>
          <div className="shrink-0">{opponentManaGauge}</div>
        </div>
        {/* 右ブロック: 手札・山札・トラップを右揃え (sm カードデザイン、手札 stack 高さに統一) */}
        <div className="ml-auto flex items-end gap-1.5">
          <div className="shrink-0 flex items-end">
            <HandArea
              hand={cardState.hand[aiColor]}
              currentMana={0}
              faceDown
              layout="stack"
              size="sm"
              emptyLabel=""
              stackMaxVisible={10}
            />
          </div>
          <DeckPile count={cardState.deck[aiColor].length} size="sm" showDrawCost />
          <TrapSlot trap={cardState.trap[aiColor]} faceDown size="sm" />
        </div>
      </section>

      {/* ===== 中央: 盤面 + 持ち駒 + (PCサイドパネル) ===== xl 未満で表示 */}
      <div className="xl:hidden flex-1 min-h-0 flex flex-col lg:flex-row max-w-5xl mx-auto w-full overflow-hidden">
        <div className="flex flex-col items-center flex-1 min-h-0 px-2 py-0.5 lg:py-2">
          {/* ステータスバー (タブレット用)。モバイルでは画面最上段に分離配置済 (Issue #105) */}
          <div className="hidden md:block w-full">{statusBarContent}</div>

          {/* 相手の持ち駒 (モバイルでは compact で縦幅を詰める) */}
          <div className="w-full shrink-0" style={{ maxWidth: squareSize * 9 + 60 }}>
            <CapturedPieces
              hand={gameState.hand}
              player={aiColor}
              playerColor={playerColor}
              isCurrentPlayer={gameState.currentPlayer === aiColor && isGameActive}
              selectedHandPiece={null}
              onPieceClick={NOOP_PIECE_CLICK}
              label={character.name}
              squareSize={squareSize}
              compact={isMobile}
              hiddenPieceTypes={hiddenOpponentCapturedTypes}
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
              noPromoteSquares={noPromoteSquares}
              hiddenSquares={hiddenBoardSquares}
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
              hiddenPieceTypes={hiddenOwnCapturedTypes}
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
            homeHref="/"
            cardEventLog={eventLog}
            hideEndCard
          />
        </div>
      </div>

      {/* ゲーム終了表示 (card-shogi 専用、xl 未満レイアウト用)。 */}
      {/* MobileDrawer の終了 Card は hideEndCard で抑止しているため、ここで自前表示。 */}
      {/* Step S5 (Issue #107): 手札ドロワーと同じ slide-up 演出で開閉。
          閉じると盤面・持ち駒が完全に見え、開くボタンは GameControls スロットに配置。
          fixed 配置で他レイアウトに影響を与えない。bottom = 下端 3 カラムセクション
          上端 (≒100px + safe-area)、translate-y-full で完全に画面外へスライド。 */}
      {!isGameActive && (
        <div
          className={cn(
            "xl:hidden fixed left-0 right-0 z-30 transition-transform duration-300",
            endCardMinimized ? "translate-y-full" : "translate-y-0",
          )}
          style={{ bottom: "calc(100px + env(safe-area-inset-bottom))" }}
          aria-hidden={endCardMinimized}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="bg-card border-t-2 border-primary/40 shadow-2xl">
            {/* 手札ドロワーと同じヘッダ + 「閉じる」ラベルボタン構造 (Step S5 改修) */}
            <div className="px-3 py-1.5 border-b flex items-center justify-between">
              <span className="text-sm font-bold">結果</span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => setEndCardMinimized(true)}
              >
                閉じる
              </Button>
            </div>
            <div className="px-3 py-2">
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
          </div>
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
            onUndo={NOOP_UNDO}
            isMuted={isMuted}
            onToggleMute={toggleMute}
            canUndo={false}
            gameActive={isGameActive}
          />
        </div>
      </section>

      {/* モバイル (<md): 下端 3カラム構成 (P20) */}
      {/* 左ブロック(2段): 段1=待った/投了、段2=手札ボタン+マナゲージ
        * Issue #105: 段2幅を段1 (GameControls) と同じ自然幅に揃え、
        * 余った横幅は右のトラップ列が flex-1 で取り込む。 */}
      <section
        className="md:hidden xl:hidden shrink-0 border-t bg-card flex items-stretch gap-2 px-2 py-1.5 z-30"
        style={{ paddingBottom: "max(0.375rem, env(safe-area-inset-bottom))" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 左ブロック: 2段(段1の自然幅に合わせて縮小、shrink-0) */}
        <div className="shrink-0 flex flex-col gap-1">
          {/* 段1: 対局中 = 待った・投了 / 終局時 = 結果カード開閉ボタン (Step S5).
              GameControls は終局時に何も描画しないため、終局時専用に同じ高さ
              の slot を確保し、結果カードが閉じているときだけ「結果」ボタン
              を出す。 */}
          <div className="flex items-center justify-center shrink-0">
            {isGameActive ? (
              <GameControls
                onResign={resign}
                onUndo={undo}
                isMuted={isMuted}
                onToggleMute={toggleMute}
                canUndo={canUndo}
                gameActive={isGameActive}
                hideSound
              />
            ) : (
              /* 終局時: 結果ボタンを常時表示。蛍光緑、現状の約 2 倍幅、結果カード
                 表示中は非活性 (Step S5 改修) */
              <div className="flex items-center" style={{ height: GAME_CONTROLS_HEIGHT }}>
                <Button
                  size="sm"
                  className={cn(
                    "h-9 w-32 gap-1 text-xs font-bold",
                    "bg-lime-400 hover:bg-lime-500 text-lime-950",
                    "dark:bg-lime-500 dark:hover:bg-lime-400 dark:text-lime-50",
                    "shadow-md shadow-lime-400/40 dark:shadow-lime-500/40",
                    "disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none",
                  )}
                  onClick={() => setEndCardMinimized(false)}
                  disabled={!endCardMinimized}
                  aria-label={endCardMinimized ? "結果を表示" : "結果は表示中"}
                >
                  <ChevronUp className="w-4 h-4" aria-hidden />
                  結果
                </Button>
              </div>
            )}
          </div>
          {/* 段2: 手札ボタン + マナゲージ (段1 の幅に揃え、ゲージは残り分を吸収) */}
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
        {/* 右: トラップ (左ブロック・山札を引いた残り横幅を取る、Issue #105) */}
        <div className="flex-1 min-w-0 flex">{ownTrapSlotMobile}</div>
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
            onCardClick={handleBeginPlayCard}
            unusableCardIds={unusableCardIds}
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
                canDraw={canDrawCard}
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
          <div
            ref={ownHandXlRef}
            data-hand-scroll="vertical"
            className="flex-1 min-h-0 overflow-y-auto"
          >
            <HandArea
              hand={displayedOwnHand}
              currentMana={cardState.mana[playerColor]}
              layout="vertical"
              size="md"
              disabled={handDisabled}
              fullWidth
              flashCardId={freshlyDrawnId}
              onCardClick={handleBeginPlayCard}
              unusableCardIds={unusableCardIds}
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
              onPieceClick={NOOP_PIECE_CLICK}
              label={character.name}
              squareSize={squareSize}
              hiddenPieceTypes={hiddenOpponentCapturedTypes}
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
              noPromoteSquares={noPromoteSquares}
              hiddenSquares={hiddenBoardSquares}
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
              hiddenPieceTypes={hiddenOwnCapturedTypes}
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
      {/* Issue #82: 二手指し (double_move) 中の上端バナー + 戻すボタン */}
      {doubleMove && !isPlayingCard && (
        <DoubleMoveNotice
          movesLeft={doubleMove.movesLeft}
          canUndoFirst={
            doubleMove.movesLeft === 1 &&
            isGameActive &&
            !isCheckBreakAnimating &&
            !isPlayingCard
          }
          onUndoFirst={undoDoubleMoveFirst}
        />
      )}

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

      {/* Issue #82: 駒移動カード(歩戻し / 駒戻し / 二歩指し)の駒回転フライト演出。
          pieceSize は盤上マスサイズ (squareSize) を渡し、フライト中の駒サイズを
          実際の盤駒と揃える。speed/rotation/min/ease は dev /piece-flight の
          保存値 (なければ animation-constants の既定値) を反映。 */}
      <PieceFlight
        spec={pieceFlight?.spec ?? null}
        flightKey={pieceFlight?.key ?? null}
        playerColor={playerColor}
        pieceSize={squareSize}
        speedPxPerSec={flightParams.speedPxPerSec}
        rotationSecPerTurn={flightParams.rotationSecPerTurn}
        minDurationMs={flightParams.minDurationMs}
        ease={flightParams.ease}
        onComplete={handlePieceFlightComplete}
      />

      {/* Issue #82 (王手崩し): トラップ発動による複数駒並行フライト演出 */}
      {checkBreakAnim?.flights.map((spec, idx) => (
        <PieceFlight
          key={`cb-${checkBreakAnim.flightKeyBase + idx}`}
          spec={spec}
          flightKey={checkBreakAnim.flightKeyBase + idx}
          playerColor={playerColor}
          pieceSize={squareSize}
          speedPxPerSec={flightParams.speedPxPerSec}
          rotationSecPerTurn={flightParams.rotationSecPerTurn}
          minDurationMs={flightParams.minDurationMs}
          ease={flightParams.ease}
          onComplete={handleCheckBreakFlightComplete}
        />
      ))}

      {/* Issue #82 (王手崩し): 演出中のゴースト駒。reducer は既に駒を盤上から
          除去しているので、王手中央表示+トラップ発動演出の間だけ元位置に重ねる。
          z-[5] は BoardOverlay (z-10) より下、ShogiBoard 本体 (z-auto/0) より上
          になるよう意図的に低く設定 (王手・トラップ発動の中央演出をゴーストより
          手前に表示するため)。 */}
      {checkBreakAnim && checkBreakAnim.ghosts.length > 0 && typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 pointer-events-none z-[5]">
            {checkBreakAnim.ghosts.map((g, i) => (
              <div
                key={`ghost-${i}`}
                className={cn(checkBreakAnim.hitActive && "animate-ghost-trap-hit")}
                style={{
                  position: "fixed",
                  left: g.rect.left,
                  top: g.rect.top,
                  width: g.rect.width,
                  height: g.rect.height,
                  // 紫グローや scale が transform で動くため、変換中心を中央に固定
                  transformOrigin: "center center",
                }}
              >
                <ShogiPiece
                  piece={{ type: g.pieceType, owner: g.owner }}
                  playerColor={playerColor}
                  squareSize={g.rect.width}
                />
                {/* Issue #82 (王手崩し): 刀で斬られたような赤い斬撃 (右上→左下)。
                    hitActive=true (=トラップ発動) と同時に SVG が mount され
                    ghost-slash アニメーション (stroke-dasharray 描画) が走る。
                    親の hit アニメーション (シェイク・スケール) と同時並行。 */}
                {checkBreakAnim.hitActive && (
                  <svg
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    aria-hidden
                  >
                    <line
                      x1="100"
                      y1="0"
                      x2="0"
                      y2="100"
                      stroke="#ef4444"
                      strokeWidth="5"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                      className="ghost-slash-line"
                    />
                  </svg>
                )}
              </div>
            ))}
          </div>,
          document.body,
        )}

      {/* Issue #77: マナ加減算の浮遊テキスト (起点 UI 付近に表示) */}
      <ManaFlightLayer items={manaFlights} onComplete={removeManaFlight} />

      {/* Issue #81: 早指し時に駒の少し下に表示するバッジ */}
      <FastMoveBadgeLayer items={fastMoveBadges} onComplete={removeFastMoveBadge} />
    </div>
  );
}

