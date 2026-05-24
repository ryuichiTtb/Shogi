"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { flushSync, createPortal } from "react-dom";
import { useRouter } from "next/navigation";

import { LoadingOverlay } from "@/components/loading-overlay";
import { MaskedLink } from "@/components/navigation/masked-link";
import { LOADING_STAGES } from "@/lib/loading-stages";
import { ChevronUp, ChevronDown, Pause, Volume2, VolumeX } from "lucide-react";

import { useCardShogiGame } from "@/hooks/use-card-shogi-game";
import { useSound, playSfxOnce } from "@/hooks/use-sound";
import { useBgm, prepareBgmForNavigation } from "@/hooks/use-bgm";
import { useCardBoardSize } from "@/hooks/use-card-board-size";

import { ShogiBoard, type ShogiBoardHandle } from "../shogi-board";
import { CapturedPieces } from "../captured-pieces";
import { ShogiPiece } from "../shogi-piece";
import { CardShogiHistory } from "./card-shogi-history";
import { GameControls, GAME_CONTROLS_HEIGHT } from "../game-controls";
import { PromotionDialog } from "../promotion-dialog";
import { BoardOverlay, type OverlayEvent } from "../board-overlay";
import { AiErrorModal } from "../ai-error-modal";
import { RematchErrorBanner } from "../rematch-error-banner";
import { CharacterPanel } from "@/components/character/character-panel";
import { MobileDrawer } from "../mobile-drawer";
import { ThemeSelector } from "../theme-selector";
import { AuthControls } from "@/components/auth/auth-controls";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { getShogiBoardCellSize } from "@/lib/shogi/board-layout";

import { getCharacterById } from "@/data/characters";
import { gameResultText } from "@/lib/shogi/notation";
import { isInCheck } from "@/lib/shogi/moves";
import { unpromotePieceType } from "@/lib/shogi/variants/standard";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";
import { getVariantById } from "@/lib/shogi/variants/index";
import type { Difficulty, GameConfig, GameState, Move, Player, Position } from "@/lib/shogi/types";
import type { CommentaryEvent } from "@/app/actions/commentary";
import type { CardGameState, CardInstance, GameEvent } from "@/lib/shogi/cards/types";
import { CARD_DEFS, CARD_USE_CONDITIONS, DRAW_COST } from "@/lib/shogi/cards/definitions";
import { isValidCardTargetSquare, canEscapeCheckWithCard, hasSameKindTrapPlaced } from "@/lib/shogi/cards/effects";
import type { CardId } from "@/lib/shogi/cards/types";
import { useRematch } from "@/hooks/use-rematch";

import { ManaGauge } from "./mana-gauge";
import { HandArea } from "./hand-area";
import { TrapSlot } from "./trap-slot";
import { DeckPile } from "./deck-pile";
import { CardPlayDialog, CardTargetingNotice } from "./card-play-dialog";
import { DoubleMoveNotice } from "./double-move-notice";
import { ForbiddenMateDialog } from "./forbidden-mate-dialog";
import { DrawFlightCard } from "./draw-flight-card";
import {
  DRAW_FADE_IN_MS,
  PLAY_TOTAL_MS,
  CHECK_OVERLAY_TOTAL_MS,
  TRAP_TRIGGER_OVERLAY_TOTAL_MS,
} from "./animation-constants";
import { deriveAnimationSteps, type AnimationStep } from "./animation-steps";
import { AutoDrawBurst } from "./auto-draw-burst";
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
  // Issue #150 (origin/main): ユーザ環境設定 "サウンド ON/OFF" のゲート。
  // false → useBgm に null を渡し BGM 停止。
  soundEnabled: boolean;
  commentaryEnabled: boolean;
  // Issue #193 / PR1a: CPU vs CPU 観戦モード関連 (gameConfig 経由で useCardShogiGame に伝播)。
  spectatorMode?: boolean;
  difficultyB?: Difficulty;
  characterIdB?: string;
}

interface CardShogiGameProps {
  initialGameState: GameState;
  initialCardState: CardGameState;
  gameId: string;
  gameConfig: SerializableGameConfig;
  debugInitialUi?: {
    drawerOpen?: boolean;
    endCardMinimized?: boolean;
  };
  debugDisableServerEffects?: boolean;
  // Issue #79 (PR 1.7): dev page 等で BGM を抑止したい時に false。
  // default true: 通常対局画面では gameState.status から bgm_game / bgm_game_over を再生
  enableBgm?: boolean;
  // Issue #226: 観戦 (CPU vs CPU) モードの「もう1局」コールバック。観戦は揮発生成
  // (createSpectatorGameState) でページ内描画されるため、通常対局の DB リマッチ
  // (createGame → /game/[id] 遷移) ではなく、本コールバックで親 (/spectate) に
  // 新しい揮発ゲームの再生成を委譲する。未指定 (通常対局) 時は従来の DB リマッチ。
  onSpectatorRematch?: () => void;
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

// 空配列の共有参照。pieceFlight 等で「該当なし」のケースを useMemo に通しても
// 毎レンダー [] を new するとメモ化が無効化されるため、フラグメンテーション回避。
const EMPTY_POSITIONS: Position[] = [];
const EMPTY_STRINGS: string[] = [];

// Issue #222: 各演出ステップの保険タイムアウト (ms)。component の onComplete が
// 来なくてもキューが前進し手番ロックが解除されるよう、実際の演出尺より十分長い値を
// 置く。completeStep は先頭一致時のみ pop、COMMIT_* 系はロック未設定なら no-op の
// ため、本タイマーが万一誤発火しても二重実行されず安全 (#217 系ハング再発防止)。
const CARD_USE_STEP_FALLBACK_MS = 6000;
const CHECK_BREAK_STEP_FALLBACK_MS = 8000;
const DRAW_STEP_FALLBACK_MS = 6000;

// Issue #222: イベントバッチの「手番主体」を導出する。駒移動 / カード使用 /
// トラップ設置の最後の主体を採用する (trapTriggerEvent.player はトラップ所有者 =
// 相手なので採用しない)。王手表示可否 (showCheck) で「相手玉が王手か」を判定する
// 際の基準側を決めるために使う。move/card いずれも無いバッチ (自動ドロー単体等) は
// null を返し、その場合は新たな王手演出を出さない。
function deriveBatchActor(events: GameEvent[]): Player | null {
  let actor: Player | null = null;
  for (const ev of events) {
    if (ev.kind === "moveEvent") actor = ev.move.player;
    else if (ev.kind === "cardPlayEvent" || ev.kind === "trapSetEvent") actor = ev.player;
  }
  return actor;
}

export function CardShogiGame({
  initialGameState,
  initialCardState,
  gameId,
  gameConfig: serializableConfig,
  debugInitialUi,
  debugDisableServerEffects = false,
  enableBgm = true,
  onSpectatorRematch,
}: CardShogiGameProps) {
  const [commentEvent, setCommentEvent] = useState<CommentaryEvent | null>(null);
  const [overlayEvent, setOverlayEvent] = useState<{ event: OverlayEvent; key: number; trapName?: string } | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(() => Boolean(debugInitialUi?.drawerOpen));
  // Step S4 (Issue #107): モバイル/タブレットの終了カードを最小化できるように
  // する。閉じると盤面・持ち駒が見え、再度展開して「もう一局」「ホームへ」を
  // 押せる。
  const [endCardMinimized, setEndCardMinimized] = useState(() => Boolean(debugInitialUi?.endCardMinimized));
  // Issue #78 + #130: ドロー演出キュー (FIFO)。
  // 旧実装は単一スロット (drawFlight) で manual 直後に auto-draw が発火すると
  // setDrawFlight が上書きされ manual 演出が中断されるバグがあった (#130)。
  // FIFO 化により manual → auto の連鎖でも順次 2 枚を再生する。
  // 連鎖時 (同一 ms 内 push) でも key 衝突しないよう ref counter で連番発番。
  type DrawFlightItem = {
    card: CardInstance;
    source: "manual" | "auto";
    key: number;
  };
  const [drawFlightQueue, setDrawFlightQueue] = useState<DrawFlightItem[]>([]);
  const currentDrawFlight = drawFlightQueue[0] ?? null;
  const isDrawAnimating = drawFlightQueue.length > 0;
  // Issue #193 / card-apply: 相手 (AI) ドロー用の独立キュー。自分側と同じ
  // 山札→中央→手札フライトを faceDown で再生する (中央でも裏面のまま)。
  // 自分側 queue とは分離し、既存の自分側演出経路に影響を与えない。
  const [opponentDrawFlightQueue, setOpponentDrawFlightQueue] = useState<DrawFlightItem[]>([]);
  const currentOpponentDrawFlight = opponentDrawFlightQueue[0] ?? null;
  const flightKeyCounterRef = useRef(0);
  const nextFlightKey = useCallback(() => {
    flightKeyCounterRef.current += 1;
    return flightKeyCounterRef.current;
  }, []);
  // Issue #130: AutoDrawBurst は currentDrawFlight が auto に切り替わった瞬間に起動。
  // 単一スロット (origin + key) で、burstKey の更新で AnimatePresence が新規 mount する。
  const [autoBurst, setAutoBurst] = useState<{
    origin: { x: number; y: number };
    scale: "self" | "opponent";
    key: number;
  } | null>(null);
  // Issue #130: aria-live 用の発動通知メッセージ。1500ms debounce。
  const [autoDrawLiveMessage, setAutoDrawLiveMessage] = useState("");
  // Issue #130: 手札着地時の emerald flash (auto-draw 用)。
  // 既存 freshlyDrawnId (amber) と区別するため別 state で持つ。
  const [autoFreshlyDrawnId, setAutoFreshlyDrawnId] = useState<string | null>(null);
  // Issue #130 G-2: 複数 setTimeout を unmount 時に一括 cleanup する共通パターン。
  // ① opponent SFX 100ms 遅延、② aria-live 1500ms debounce、③ emerald flash 700ms
  // クリアの 3 種で使用。timersRef で id を集中管理し、cleanup で全解除。
  const timersRef = useRef<Set<number>>(new Set());
  const scheduleTimer = useCallback((callback: () => void, delay: number): number => {
    const id = window.setTimeout(() => {
      timersRef.current.delete(id);
      callback();
    }, delay);
    timersRef.current.add(id);
    return id;
  }, []);
  useEffect(() => {
    // ref は安定参照だが lint 警告回避のためローカルにコピーしてから cleanup
    const timers = timersRef.current;
    return () => {
      timers.forEach((id) => window.clearTimeout(id));
      timers.clear();
    };
  }, []);
  // aria-live のタイマー id (連続発火時に古いタイマーをキャンセルして 1500ms 維持)
  const liveMessageTimerRef = useRef<number | null>(null);
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
  // hitActive: トラップ発動タイミングで true に切り替わり、ゴースト駒に紫フラッシュ
  //   +シェイク+グローのヒット演出を付与する。
  // flights: 値ありになったらフライト開始。pendingFlightCount=0 で finalize。
  // stagedFlights: Issue #222 修正 — ゴーストカバー (駒を消さないための覆い) は
  //   捕獲された瞬間 (バッチ到着時 prepareCheckBreakCover) に設定し、実際の駒フライト
  //   発火は trap ステップの最終フェーズまで保留する。そのため発火予定のフライト spec を
  //   ここに退避しておき、フライトフェーズで flights へ移す。二手指し等でカード使用演出が
  //   先行しても、その間ゴーストが駒を覆い続け「対象駒が一瞬消える」不具合を防ぐ。
  const [checkBreakAnim, setCheckBreakAnim] = useState<{
    ghosts: Array<{ rect: DOMRect; pieceType: string; owner: Player }>;
    hitActive: boolean;
    flights: PieceFlightSpec[];
    stagedFlights: PieceFlightSpec[];
    flightKeyBase: number;
    hideTargets: FlightHideTarget[];
    pendingFlightCount: number;
  } | null>(null);
  // Issue #222: 演出直列化オーケストレータのキュー。reducer が 1 ターン分の
  // イベントをまとめて eventLog へ積むため、従来は差分監視で各演出が即時・並行
  // 発火し重なっていた。本キューに「カード使用→王手→トラップ→ドロー」の順で
  // ステップを積み、先頭 1 件のみを activate して、完了で pop して次へ進める。
  // これにより 4 種の大きな演出が必ず 1 つずつ完了してから次が再生される。
  const [animationQueue, setAnimationQueue] = useState<AnimationStep[]>([]);
  // 現在 activate 済みの先頭ステップ参照。再レンダー (gameState 変化等) での
  // 二重 activate を防ぐガードに使う (object 参照一致で判定)。
  const activeStepRef = useRef<AnimationStep | null>(null);
  // Issue #82 (二手指し): 2手目で禁止された詰み手をクリックされたときに表示する案内ダイアログ。
  const [forbiddenMateDialogOpen, setForbiddenMateDialogOpen] = useState(false);
  const router = useRouter();
  // Issue #217: 旧 startTransition(async) は createGame 失敗時に永久ハング
  // していた。明示的 loading/error state を持つ共通フックに置換。
  const { isRematching, rematchError, rematch, clearRematchError } =
    useRematch();
  const {
    squareSize,
    isMobile,
    viewportHeight,
    playAreaRef,
    bottomControlsRef,
    bottomControlsHeight,
    debug: layoutDebug,
  } = useCardBoardSize();
  // 開発者用 dev /piece-flight で保存されたフライト演出パラメータ。
  // 未保存時は animation-constants の既定値が返る。
  const flightParams = useFlightParams();
  const boardCellSize = useMemo(() => getShogiBoardCellSize(squareSize), [squareSize]);

  const gameConfig: GameConfig = {
    ...serializableConfig,
    variant: getVariantById(serializableConfig.variantId),
  };
  // Issue #193 / PR1a: 観戦モードでは UI 操作 (手札クリック / 投了 / 待った 等) を完全に
  // 無効化する。useCardShogiGame 側の callback も no-op になっているが、UI 層でも
  // 早期 return して効果音 (card_select 等) の発火やボタン描画を抑止する。
  const spectatorMode = serializableConfig.spectatorMode ?? false;

  const character = getCharacterById(gameConfig.characterId);
  const { playSfx, toggleMute, isMuted, isReady } = useSound();

  const handlePlayAgain = useCallback(() => {
    // Issue #79 派生: forward 遷移 SFX (新規対局画面へ router.push する forward 系)
    playSfx("nav_forward");
    // Issue #226: 観戦 (CPU vs CPU) は揮発生成・ページ内描画のため、通常対局の DB
    // リマッチ (createGame → /game/[id] 遷移) を使うと「ユーザ対 CPU」になってしまう。
    // 観戦時は親 (/spectate) の揮発再生成コールバックに委譲し、同じ 2 キャラの CPU 対
    // CPU を再開する (キャラ・難易度は gameConfig 経由で維持)。
    if (spectatorMode && onSpectatorRematch) {
      onSpectatorRematch();
      return;
    }
    void rematch({
      difficulty: gameConfig.difficulty,
      playerColor: gameConfig.playerColor,
      characterId: gameConfig.characterId,
      variantId: "card-shogi",
    });
  }, [
    spectatorMode,
    onSpectatorRematch,
    gameConfig.difficulty,
    gameConfig.playerColor,
    gameConfig.characterId,
    rematch,
    playSfx,
  ]);

  const handleComment = useCallback((event: string) => {
    setCommentEvent(event as CommentaryEvent);
    setTimeout(() => setCommentEvent(null), 100);
  }, []);

  const {
    gameState,
    selectedSquare,
    selectedHandPiece,
    legalMoves,
    forbiddenMateMoves,
    isAiThinking,
    promotionPendingMove,
    cardState,
    eventLog,
    canUndo: hookCanUndo,
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
    cancelDoubleMove,
    aiError,
    retryAiMove,
    // Issue #193 / PR1a: 観戦モード専用 (一時停止 / 再開)。spectatorMode は
    // serializableConfig 経由で取得済 (上の const spectatorMode = ...)。
    isPaused,
    pauseSpectator,
    resumeSpectator,
  } = useCardShogiGame({
    initialState: initialGameState,
    initialCardState,
    gameId,
    gameConfig,
    onComment: handleComment,
    disableServerSync: debugDisableServerEffects,
    disableAi: debugDisableServerEffects,
  });

  const playerColor = gameConfig.playerColor;
  const aiColor: Player = playerColor === "sente" ? "gote" : "sente";
  const isPlayerTurn = gameState.currentPlayer === playerColor;

  // Issue #193 / PR1a: 観戦モードの「ホームへ戻る」フロー。
  // 1. ボタン押下: 確認ダイアログを表示 + CPU 進行を即時停止 (一時停止と同じ挙動)
  // 2. 確認 OK: ローディングマスクを表示しつつ router.push("/") でホーム画面へ遷移
  // 3. キャンセル: ダイアログを閉じ、ダイアログ表示前の Pause 状態に戻す
  //    (ダイアログ表示前から既に Pause していた場合は Resume しない)
  const [showExitDialog, setShowExitDialog] = useState(false);
  const [isExitingHome, setIsExitingHome] = useState(false);
  // ダイアログ表示時点で既に isPaused=true だったかを保持し、キャンセル時の挙動を分岐する。
  const pausedBeforeExitRef = useRef(false);

  const handleRequestExit = useCallback(() => {
    pausedBeforeExitRef.current = isPaused;
    if (!isPaused) {
      // ダイアログ表示中も CPU を止めるため、まだ Pause されていない場合に PAUSE_GAME を発行。
      pauseSpectator();
    }
    setShowExitDialog(true);
  }, [isPaused, pauseSpectator]);

  const handleConfirmExit = useCallback(() => {
    setShowExitDialog(false);
    setIsExitingHome(true);
    // 他画面のホーム戻りリンク (MaskedLink) と効果音 / BGM 切替を統一する。
    playSfxOnce("nav_back");
    prepareBgmForNavigation("/");
    router.push("/");
  }, [router]);

  const handleCancelExit = useCallback(() => {
    setShowExitDialog(false);
    // ダイアログ表示前から Pause されていた場合は何もしない (ユーザーの Pause を維持)
    if (!pausedBeforeExitRef.current) {
      resumeSpectator();
    }
  }, [resumeSpectator]);

  // BGM (Issue #79):
  //   - useBgm が BGM の単一オーナー。dev tool で event override が設定された
  //     場合 (もしくは manifest 既定が non-empty) のときに再生される。
  //   - dev page は enableBgm=false で抑止。
  //   - soundEnabled が false → null で停止 (#150 のサウンド ON/OFF ゲート)。
  //   - 対局中は loop 継続、対局終了時は現在の loop を完了させた上で停止。
  //     (shouldLoop=false → onend で自然停止)
  //   - status: "active" → bgm_game / それ以外 (resign/checkmate 等) → bgm_game_over
  useBgm(
    !enableBgm || !gameConfig.soundEnabled
      ? null
      : gameState.status === "active"
        ? "bgm_game"
        : "bgm_game_over",
    { shouldLoop: !!enableBgm && gameState.status === "active" },
  );
  const isGameActive = gameState.status === "active";
  const inCheck =
    (isGameActive || gameState.status === "checkmate") &&
    isInCheck(gameState, gameState.currentPlayer, CARD_SHOGI_VARIANT);

  // Issue #132 派生: 二手指し 1 手目で自玉が王手になる過渡状態 (movesLeft===1 + inCheck)
  // を判定するフラグ。仕様上、1 手目自玉王手は 2 手目で必ず解消されるため「王手」を
  // 演出・SFX・ステータスバッジ等で示す UI は抑制する。一方で論理的な「王手中」(card 使用
  // 可否 / drawCard 可否) は inCheck そのものを使い、玉の赤色スタイルも ShogiBoard が
  // inCheck prop 経由で描画するため、それらは抑制対象外。
  // 通常の王手 (相手玉への王手 / AI からの王手) は doubleMove === null のため対象外。
  const isDoubleMoveSelfCheckTransient =
    inCheck && doubleMove !== null && doubleMove.movesLeft === 1;
  // 「王手中」を UI 演出 (Badge / 中央オーバーレイ / SFX) に伝えるための派生値。
  // 上記 transient のときだけ false に倒し、抑制する。
  const displayInCheck = inCheck && !isDoubleMoveSelfCheckTransient;

  // ----- サウンド -----
  // Issue #155: 履歴復元時の演出再発火を抑止する。
  // shogi-game.tsx と同じ「前回値追跡」パターン (StrictMode 二重 effect でも
  // 安全)。詳細は shogi-game.tsx のコメント参照。
  const lastMoveCountRef = useRef(gameState.moveCount);
  const lastStatusRef = useRef(gameState.status);
  const gameStartFiredRef = useRef(false);

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
    // Issue #222: 通常プレイ中の王手演出は eventLog 監視のキュー
    // (deriveAnimationSteps) が「カード使用→王手→トラップ→ドロー」の共通順序で
    // 担う。ここでは詰み時のみ、従来の「王手→詰み」を保つため王手→詰みを発火する
    // (詰みは終局で applyTurnEndEffects が走らずキューに乗らないため、キュー外で扱う)。
    // 詰みは必ず王手中なので displayInCheck で gate せず status のみで判定する。
    if (gameState.status === "checkmate") {
      playSfx("check");
      setOverlayEvent({ event: "check", key: Date.now() });
      // Issue #79 で王手 SFX (check) と分離した専用 checkmate SFX を 1000ms 後に再生。
      setTimeout(() => playSfx("checkmate"), 1000);
      setTimeout(() => setOverlayEvent({ event: "checkmate", key: Date.now() }), 1000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState.moveCount]);

  useEffect(() => {
    if (lastStatusRef.current === gameState.status) return;
    lastStatusRef.current = gameState.status;
    if (gameState.status === "resign") {
      playSfx("game_over");
      setOverlayEvent({ event: "resign", key: Date.now() });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState.status]);

  // ゲーム開始演出。新規対局 (status: "active" + moveCount === 0) のときに
  // 1 度だけ実演出を出す。履歴復元時はフラグを立てずに完全スキップ。
  useEffect(() => {
    if (!isReady) return;
    if (gameStartFiredRef.current) return;
    if (gameState.status !== "active" || gameState.moveCount !== 0) return;
    gameStartFiredRef.current = true;
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

  // Issue #193 / card-apply: 相手 (AI) の山札 / 手札の DOMRect。
  // 本ゲームは将棋の盤面向きの慣習上、相手側が常に画面上部・自分側が下部に
  // 配置される (全レスポンシブレイアウトで一貫)。AI 側専用 ref を全レイアウトに
  // 増設する代わりに、表示中要素のうち最も上 (top 最小) のものを AI 側とみなす。
  // セレクタは山札= [data-card-shogi-deck] (既存)、手札= [data-hand-area]
  // (HandArea の faceDown / stack root = 相手専用に付与) を使う。
  const getTopmostVisibleRect = useCallback((selector: string): DOMRect | null => {
    if (typeof document === "undefined") return null;
    const els = document.querySelectorAll<HTMLElement>(selector);
    let best: DOMRect | null = null;
    for (const el of els) {
      if (el.offsetParent === null) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (!best || rect.top < best.top) best = rect;
    }
    return best;
  }, []);
  const getAiDeckRect = useCallback(
    (): DOMRect | null => getTopmostVisibleRect("[data-card-shogi-deck]"),
    [getTopmostVisibleRect],
  );
  // 相手 (AI) 手札は faceDown / stack 分岐で描画され data-hand-scroll を持た
  // ない。自分側は常に scroll 分岐 (data-hand-scroll)。相手専用マーカー
  // data-hand-area (faceDown / stack root のみ付与) で AI 手札を一意に取得する。
  const getAiHandRect = useCallback(
    (): DOMRect | null => getTopmostVisibleRect("[data-hand-area]"),
    [getTopmostVisibleRect],
  );

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
    // Issue #79 派生: カード使用確定 SFX (default = piece-capture)
    playSfx("card_use_confirm");
    cachePendingCardRect();
    // Issue #82: 駒フライト用 rect キャッシュは handleSquareClick 側 (盤面ターゲット
    // 選択時) で行う。target が要らないカードはここで通過するだけ。
    confirmPlayCard();
    // Issue #106: モバイル手札ドロワーは「使用する」確定時に閉じる
    // (キャンセル時は開いたままにし、再度カードを選び直しやすくする)
    setDrawerOpen(false);
  }, [cachePendingCardRect, confirmPlayCard, playSfx]);

  // Issue #222: 演出ステップを 1 件消化したらキュー先頭を pop する。
  // 「先頭が当該ステップのときだけ」pop することで、component の onComplete と
  // 保険タイマーの両方から呼ばれても二重 pop しない (冪等)。pop により先頭が
  // 次ステップ (別 object) に変わると driver effect が次を activate する。
  const completeStep = useCallback((step: AnimationStep) => {
    setAnimationQueue((q) => (q[0] === step ? q.slice(1) : q));
  }, []);

  // Issue #222 修正: 王手崩しの「ゴーストカバー」をバッチ到着時に即設定する。
  // reducer は王手していた駒を捕獲して盤上から即削除するため、トラップ演出ステップまで
  // ゴースト設定を遅らせると、その手前 (二手指しのカード使用演出など) の間だけ対象駒が
  // 盤上から消えて見える。捕獲された瞬間にゴースト (元位置の駒) と持ち駒側の隠蔽を
  // 設定し、駒を切れ目なく覆う。実際の駒フライト発火は trap ステップ最終フェーズで
  // stagedFlights から行う。
  const prepareCheckBreakCover = useCallback(
    (ev: Extract<GameEvent, { kind: "trapTriggerEvent" }>) => {
      const trapOwner = ev.player;
      const captures = ev.capturedPieces ?? [];
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
        flights.push({ pieceType: cap.pieceType, owner: trapOwner, fromX, fromY, toX, toY });
        hideTargets.push({ kind: "captured", player: trapOwner, pieceType: cap.pieceType });
      }
      pieceFlightKeyRef.current += captures.length;
      const flightKeyBase = pieceFlightKeyRef.current - captures.length + 1;
      setCheckBreakAnim({
        ghosts,
        hitActive: false,
        flights: [], // フライト発火前は空。ゴーストのみ表示。
        stagedFlights: flights, // trap ステップ最終フェーズで flights へ移す。
        flightKeyBase,
        hideTargets,
        pendingFlightCount: flights.length,
      });
    },
    [getBoardSquareRect, findVisibleCapturedPieceRect],
  );

  // Issue #222: キュー先頭ステップを activate (実際の演出を起動) する。DOMRect
  // 解決・SFX・state 反映といった副作用はすべてここで行う (順序決定は純粋関数
  // deriveAnimationSteps が担う)。完了経路はステップ種別ごとに異なるが、いずれにも
  // 保険タイマーを張り、完了通知が来なくてもキューが前進する (#217 系の手番永久
  // ロック再発防止)。completeStep / COMMIT_* は冪等なので保険が誤発火しても安全。
  const activateStep = useCallback(
    (step: AnimationStep) => {
      switch (step.kind) {
        case "cardUse": {
          const ev = step.event;
          const def = CARD_DEFS[ev.instance.defId];
          // カード消費マナの浮遊表示 (自分=使用カード位置 / 相手=相手手札エリア)。
          const manaOrigin =
            ev.player === playerColor
              ? getOriginRect(ev.instance.instanceId)
              : getAiHandRect();
          if (ev.kind === "cardPlayEvent") {
            playSfx("card_play");
            if (def.cost > 0) triggerManaFlight(-def.cost, manaOrigin);
            if (ev.player === playerColor) {
              // Issue #82: 駒移動カードは handleSquareClick 内で flushSync 先回り
              // 発火済み。ここでは pendingPieceFlightRef の新規駒種 (toRect=null)
              // を適用後 DOM から補完するか、駒移動なしカードの中央演出を出す。
              const cardInstance = ev.instance;
              const pending = pendingPieceFlightRef.current;
              if (pending && pending.toRect === null) {
                pendingPieceFlightRef.current = null;
                const toRect = findVisibleCapturedPieceRect(playerColor, pending.pieceType);
                if (toRect) {
                  pieceFlightKeyRef.current += 1;
                  playSfx("piece_flight");
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
                  playFlightKeyRef.current += 1;
                  playSfx("card_use_animation");
                  setPlayFlight({ card: cardInstance, key: playFlightKeyRef.current, isTrap: false });
                }
              } else if (!pendingPlayFlightRef.current) {
                // 駒フライト未発火 (駒移動なしカード or 二歩指し) → 中央カード演出。
                // 王手演出は本ステップでは出さず、後続の check ステップに委譲する
                // (Issue #222: カード使用 → 王手 の順を共通化)。
                playFlightKeyRef.current += 1;
                playSfx("card_use_animation");
                setPlayFlight({ card: cardInstance, key: playFlightKeyRef.current, isTrap: false });
              }
            } else {
              // 相手 (AI) のカード使用。駒戻し/歩戻し (returnedPiece あり) は
              // 盤上→持ち駒の駒フライト → 完了後に中央カード演出 (handlePieceFlightComplete
              // → handlePlayFlightComplete) を再現する。
              const rp = ev.returnedPiece;
              let opponentPieceFlightFired = false;
              if (rp) {
                const fromRect = getBoardSquareRect(rp.row, rp.col);
                const toRect = findVisibleCapturedPieceRect(aiColor, rp.pieceType);
                if (fromRect && toRect) {
                  pieceFlightKeyRef.current += 1;
                  playSfx("piece_flight");
                  setPieceFlight({
                    spec: {
                      pieceType: rp.pieceType,
                      owner: aiColor,
                      fromX: fromRect.left + fromRect.width / 2,
                      fromY: fromRect.top + fromRect.height / 2,
                      toX: toRect.left + toRect.width / 2,
                      toY: toRect.top + toRect.height / 2,
                    },
                    key: pieceFlightKeyRef.current,
                    hideTarget: { kind: "captured", player: aiColor, pieceType: rp.pieceType },
                  });
                  pendingPlayFlightRef.current = { card: ev.instance, isTrap: false };
                  opponentPieceFlightFired = true;
                }
              }
              if (!opponentPieceFlightFired) {
                playFlightKeyRef.current += 1;
                playSfx("card_use_animation");
                setPlayFlight({ card: ev.instance, key: playFlightKeyRef.current, isTrap: false });
              }
            }
          } else {
            // trapSetEvent: トラップ設置。
            playSfx("trap_set");
            if (def.cost > 0) triggerManaFlight(-def.cost, manaOrigin);
            if (ev.player === playerColor) {
              // 自分のトラップ設置は中央へカード本体を表示 (CardPlayFlight)。
              playFlightKeyRef.current += 1;
              setPlayFlight({
                card: { instanceId: ev.instance.instanceId, defId: ev.instance.defId },
                key: playFlightKeyRef.current,
                isTrap: true,
              });
            } else {
              // 相手 (AI) のトラップ設置は隠し情報なので種別を伏せた汎用オーバー
              // レイのみ。中央カード演出を出さないため尺 (PLAY_TOTAL_MS) で
              // finalizePlayCard + pop を予約する。
              setOverlayEvent({ event: "trap_set", key: Date.now() });
              scheduleTimer(() => {
                finalizePlayCard();
                completeStep(step);
              }, PLAY_TOTAL_MS);
            }
          }
          // 保険: 通常カード/自トラップは handlePlayFlightComplete、相手トラップは
          // 上記タイマーで finalize+pop する。万一いずれも来なくても回収する。
          scheduleTimer(() => {
            finalizePlayCard();
            completeStep(step);
          }, CARD_USE_STEP_FALLBACK_MS);
          break;
        }
        case "check": {
          // 王手中央オーバーレイ。ロックを持たない短尺演出のため、尺経過で pop する。
          playSfx("check");
          setOverlayEvent({ event: "check", key: Date.now() });
          scheduleTimer(() => completeStep(step), CHECK_OVERLAY_TOTAL_MS);
          break;
        }
        case "trap": {
          const ev = step.event;
          const trapDef = CARD_DEFS[ev.instance.defId];
          // Issue #82 (王手崩し): 王手 → トラップ発動 → 駒フライト の3段演出。
          // Issue #222 修正: ゴーストカバー (ghosts/hideTargets/stagedFlights) は
          // バッチ到着時 prepareCheckBreakCover で設定済 (カード使用演出が先行しても
          // その間 駒を覆い続ける)。本ステップは尺に沿った演出進行のみを担う。
          if (trapDef.id === "check_break" && ev.capturedPieces && ev.capturedPieces.length > 0) {
            // T=0: 王手中央表示。
            playSfx("check");
            setOverlayEvent({ event: "check", key: Date.now() });
            // T=CHECK_OVERLAY_TOTAL: トラップ発動演出 + ゴースト駒ヒット演出。
            scheduleTimer(() => {
              playSfx("trap_trigger");
              setOverlayEvent({ event: "trap_trigger", key: Date.now(), trapName: trapDef.name });
              setCheckBreakAnim((prev) => (prev ? { ...prev, hitActive: true } : null));
            }, CHECK_OVERLAY_TOTAL_MS);
            // T=CHECK_OVERLAY_TOTAL + TRAP_TRIGGER_OVERLAY_TOTAL: ゴースト消去 + 駒フライト発火
            // (stagedFlights を flights へ移す)。完了は handleCheckBreakFlightComplete
            // (全フライト着地で finalize+pop)。
            scheduleTimer(() => {
              playSfx("piece_flight");
              setCheckBreakAnim((prev) =>
                prev ? { ...prev, ghosts: [], flights: prev.stagedFlights } : null,
              );
            }, CHECK_OVERLAY_TOTAL_MS + TRAP_TRIGGER_OVERLAY_TOTAL_MS);
            // 保険: フライトが 0 件 / onComplete 欠落でもロック解除 + pop する。
            scheduleTimer(() => {
              finalizeCheckBreak();
              setCheckBreakAnim(null);
              completeStep(step);
            }, CHECK_BREAK_STEP_FALLBACK_MS);
          } else {
            // 既存トラップ (no_promote 等): 即時オーバーレイのみ。ロックなしのため
            // 尺経過で pop する。
            playSfx("trap_trigger");
            setOverlayEvent({ event: "trap_trigger", key: Date.now(), trapName: trapDef.name });
            scheduleTimer(() => completeStep(step), TRAP_TRIGGER_OVERLAY_TOTAL_MS);
          }
          break;
        }
        case "draw": {
          const ev = step.event;
          const source = ev.source ?? "manual";
          const isSelf = ev.player === playerColor;
          if (isSelf) {
            // Issue #79: 手動ドロー / 自動ドローを別 SFX に分離。中央到達
            // (T=DRAW_FADE_IN_MS) でレア度別開封 SE。
            playSfx(source === "auto" ? "card_auto_draw" : "card_draw");
            const rarity = CARD_DEFS[ev.instance.defId].rarity;
            scheduleTimer(() => playSfx(`draw_card_open_${rarity}` as never), DRAW_FADE_IN_MS);
            setDrawFlightQueue((q) => [...q, { card: ev.instance, source, key: nextFlightKey() }]);
          } else {
            // 相手 (AI) ドローも同じ山札→中央→手札フライト (faceDown)。開封 SE は
            // レア度非依存 (裏面で札を伏せるため耳でレア度が漏れないよう固定キー)。
            playSfx(source === "auto" ? "card_auto_draw" : "card_draw");
            scheduleTimer(() => playSfx("draw_card_open_common"), DRAW_FADE_IN_MS);
            setOpponentDrawFlightQueue((q) => [...q, { card: ev.instance, source, key: nextFlightKey() }]);
          }
          if (source === "manual" && isSelf) {
            triggerManaFlight(-DRAW_COST, getDeckRect());
          }
          if (source === "auto") {
            // aria-live で自動ドローを通知 (連続発火時は最新のみ 1500ms 維持)。
            if (liveMessageTimerRef.current !== null) {
              window.clearTimeout(liveMessageTimerRef.current);
              timersRef.current.delete(liveMessageTimerRef.current);
            }
            setAutoDrawLiveMessage("自動ドローしました");
            liveMessageTimerRef.current = scheduleTimer(() => {
              setAutoDrawLiveMessage("");
              liveMessageTimerRef.current = null;
            }, 1500);
          }
          // 完了は handleDrawFlightComplete / handleOpponentDrawFlightComplete
          // (finalizeDraw + pop)。保険: onComplete 欠落でもロック解除 + pop する。
          scheduleTimer(() => {
            finalizeDraw();
            completeStep(step);
          }, DRAW_STEP_FALLBACK_MS);
          break;
        }
      }
    },
    [
      playerColor,
      aiColor,
      playSfx,
      triggerManaFlight,
      getOriginRect,
      getAiHandRect,
      getDeckRect,
      getBoardSquareRect,
      findVisibleCapturedPieceRect,
      scheduleTimer,
      nextFlightKey,
      finalizePlayCard,
      finalizeDraw,
      finalizeCheckBreak,
      completeStep,
    ],
  );

  // Issue #222: eventLog の差分を監視し、(1) 直列化しない軽量装飾 (マナ浮遊 /
  // 早指しバッジ) を即時発火、(2) 大きな 4 演出を共通順序 (カード使用→王手→
  // トラップ→ドロー) のステップ列に変換してキューへ積む。実際の演出起動は driver
  // effect → activateStep が 1 件ずつ行う。
  useEffect(() => {
    if (!isReady) return;
    const startIdx = lastEventIndexRef.current;
    const newEvents = eventLog.slice(startIdx);
    lastEventIndexRef.current = eventLog.length;
    if (newEvents.length === 0) return;

    // (1) 装飾: マナ浮遊 (ターン由来=移動先 / カード由来=カード位置) と早指しバッジ。
    for (let i = 0; i < newEvents.length; i++) {
      const ev = newEvents[i];
      if (ev.kind !== "manaChargeEvent") continue;
      if (ev.reason === "card") playSfx("mana_charge");
      if (ev.reason === "turn") {
        const absoluteIdx = startIdx + i;
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
        triggerManaFlight(ev.amount, getOriginRect());
      }
    }

    // (2) 王手崩しのゴーストカバーをバッチ到着時に即設定する (Issue #222 修正)。
    // 捕獲された駒が、後続のカード使用演出 (二手指し) の間に盤上から消えて見える
    // 不具合を防ぐ。実際のトラップ演出進行は trap ステップが担う。
    for (const ev of newEvents) {
      if (
        ev.kind === "trapTriggerEvent" &&
        ev.instance.defId === "check_break" &&
        (ev.capturedPieces?.length ?? 0) > 0
      ) {
        prepareCheckBreakCover(ev);
      }
    }

    // (3) 王手表示可否: バッチの手番主体 (actor) の相手玉が、適用後局面で王手かを
    // 判定する。二手指し 1 手目の過渡状態 (movesLeft===1) は 2 手目で必ず解消される
    // ため抑制する。詰みは終局演出を moveCount effect が担うためここでは出さない。
    const actor = deriveBatchActor(newEvents);
    let showCheck = false;
    if (actor !== null && gameState.status === "active") {
      const checkedSide: Player = actor === "sente" ? "gote" : "sente";
      const inDoubleMoveMidway = doubleMove !== null && doubleMove.movesLeft === 1;
      showCheck = !inDoubleMoveMidway && isInCheck(gameState, checkedSide, CARD_SHOGI_VARIANT);
    }

    const steps = deriveAnimationSteps(newEvents, { showCheck });
    if (steps.length > 0) setAnimationQueue((q) => [...q, ...steps]);
  }, [
    eventLog,
    isReady,
    playSfx,
    triggerManaFlight,
    triggerFastMoveBadge,
    getBoardSquareRect,
    getOriginRect,
    prepareCheckBreakCover,
    gameState,
    doubleMove,
  ]);

  // Issue #222: 演出キューの driver。先頭 1 件のみを activate し、完了 (completeStep)
  // で pop されると先頭が次ステップ (別 object) に変わり本 effect が次を activate する。
  // activeStepRef で「同一先頭の二重 activate」を防ぐ (gameState 等の再レンダーで
  // 再実行されても activate 済み先頭は再起動しない)。
  useEffect(() => {
    const head = animationQueue[0] ?? null;
    if (!head) {
      activeStepRef.current = null;
      return;
    }
    if (activeStepRef.current === head) return;
    activeStepRef.current = head;
    activateStep(head);
  }, [animationQueue, activateStep]);

  // Issue #78 / #82: 演出中(ドロー / カード使用 / 王手崩しトラップ)は盤面・手札・カード操作・背景クリックをロックする
  const handleSquareClick = useCallback(
    (pos: Position) => {
      if (isDrawAnimating || isPlayingCard || isCheckBreakAnimating) return;

      // Issue #82 (二手指し 2手目): 禁止された詰み手のマスをクリック → 説明ダイアログ表示
      // (赤×表示で視覚的にも禁止が分かるが、なぜダメかを文章でも伝えて UX 向上)
      const isForbiddenMateClick = forbiddenMateMoves.some(
        (m) => m.to.row === pos.row && m.to.col === pos.col,
      );
      if (isForbiddenMateClick) {
        setForbiddenMateDialogOpen(true);
        return;
      }

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

        // Issue #173: 二歩指し (double_pawn) は駒フライトを行わず、通常の持駒打ちと
        // 同じ動きにする (Framer Motion の layout アニメーション任せ)。
        // pawn_return / piece_return は引き続きフライト演出 (盤上 → 持駒)。
        if (def.effectId === "pawn_return" || def.effectId === "piece_return") {
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
          // Issue #79: 駒フライト演出 SFX (default = 刀剣・投げナイフ)。
          playSfx("piece_flight");
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
      isCheckBreakAnimating,
      forbiddenMateMoves,
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
      // Issue #193 / PR1a: 観戦モードはユーザー操作不可
      if (spectatorMode) return;
      selectHandPiece(piece);
    },
    [isDrawAnimating, isPlayingCard, isCheckBreakAnimating, spectatorMode, selectHandPiece],
  );
  const handleBeginPlayCard = useCallback(
    (id: string) => {
      if (isDrawAnimating || isPlayingCard || isCheckBreakAnimating) return;
      // Issue #193 / PR1a: 観戦モードはユーザー操作不可。card_select SFX も
      // 鳴らさないよう SFX 呼出より前で早期 return する。
      if (spectatorMode) return;
      // Issue #79 派生: 手札クリックで中央 popup を開く SFX (default = カードをめくる)
      playSfx("card_select");
      beginPlayCard(id);
    },
    [isDrawAnimating, isPlayingCard, isCheckBreakAnimating, spectatorMode, beginPlayCard, playSfx],
  );
  const handleDeselect = useCallback(() => {
    if (isDrawAnimating || isPlayingCard || isCheckBreakAnimating) return;
    // Issue #193 / PR1a: 観戦モードはユーザー操作不可
    if (spectatorMode) return;
    deselect();
  }, [isDrawAnimating, isPlayingCard, isCheckBreakAnimating, spectatorMode, deselect]);

  // 演出中は最新ドローカードを手札表示から除外し、演出完了後に手札に現れたように見せる。
  // FIFO 化により queue 内の全カード ID を hidden 対象にする (#130)。
  const displayedOwnHand = useMemo(() => {
    if (drawFlightQueue.length === 0) return cardState.hand[playerColor];
    const hiddenIds = new Set(drawFlightQueue.map((q) => q.card.instanceId));
    return cardState.hand[playerColor].filter((c) => !hiddenIds.has(c.instanceId));
  }, [cardState.hand, playerColor, drawFlightQueue]);

  // Issue #193 / card-apply: 相手 (AI) も自分側と同様、ドローフライト中は
  // 引いた札を手札表示から除外し、フライト完了後に手札へ現れたように見せる。
  const displayedOpponentHand = useMemo(() => {
    if (opponentDrawFlightQueue.length === 0) return cardState.hand[aiColor];
    const hiddenIds = new Set(opponentDrawFlightQueue.map((q) => q.card.instanceId));
    return cardState.hand[aiColor].filter((c) => !hiddenIds.has(c.instanceId));
  }, [cardState.hand, aiColor, opponentDrawFlightQueue]);

  // Issue #130: queue 先頭が auto に切り替わった瞬間に AutoDrawBurst を起動。
  // burstKey の更新で AnimatePresence が新規 mount し、Burst が再生される。
  // 連続 auto-draw (sente auto → gote auto) でも個別に再生される。
  // 自分側 = 山札 rect 中心、相手側 = AI deck の中心 (= getDeckRect() を流用、
  // self/opponent を distinguish するため別 ref が必要だが、現状は自分側 deck rect
  // のみ参照可能なため相手側演出は scale=opponent + 同 rect 起点で簡略化)。
  const lastBurstFlightKeyRef = useRef<number | null>(null);
  useEffect(() => {
    if (!currentDrawFlight) return;
    if (currentDrawFlight.source !== "auto") return;
    if (lastBurstFlightKeyRef.current === currentDrawFlight.key) return;
    lastBurstFlightKeyRef.current = currentDrawFlight.key;
    const rect = getDeckRect();
    if (!rect) return;
    setAutoBurst({
      origin: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
      // 現状は自分側 deck rect のみ取得可能。AI 側 deck rect は未取得のため、
      // 相手 auto-draw でも同 rect を起点にしつつ scale=opponent で控えめ表現する。
      // 将来 AI 側 deck rect を取得できるようになったら scale 切替条件を更新する。
      scale: "self",
      key: currentDrawFlight.key,
    });
  }, [currentDrawFlight, getDeckRect]);

  // Issue #82 (修正): フローを「カード使用 → 駒フライト → 中央カード演出 → finalize」へ。
  // - cardPlayEvent エフェクト側で「駒フライト or 中央カード演出」のどちらを先に発火するか判断
  // - 駒移動を伴うカードは駒フライトのみ発火し、handlePieceFlightComplete で中央カード演出を予約発火
  // - 中央カード演出完了 (handlePlayFlightComplete) で finalize → COMMIT_PLAY_CARD
  //
  // Issue #173: 二歩指し等で相手玉が王手になるケースは、駒フライト完了直後・
  // 中央カード演出開始前に王手演出を挟む。CONFIRM_PLAY_CARD 時点では
  // currentPlayer 反転が COMMIT まで保留されるため、ここでは opponent 側を
  // 直接判定する (gameState.currentPlayer はカード使用者本人)。
  const handlePieceFlightComplete = useCallback(() => {
    setPieceFlight(null);

    // Issue #222: 王手演出は cardUse ステップの後続 check ステップが担うため、
    // ここでは出さない (カード使用 → 王手 の順を共通化)。本ハンドラは cardUse
    // ステップ内部の遷移 (駒フライト → 中央カード演出) なのでキューは pop しない。
    const pendingPlay = pendingPlayFlightRef.current;
    if (pendingPlay) {
      playFlightKeyRef.current += 1;
      // Issue #79 派生: カード使用演出 SFX (trap セット時は trap_set が別途
      // 発火済のため non-trap のみ鳴らす)
      if (!pendingPlay.isTrap) {
        playSfx("card_use_animation");
      }
      setPlayFlight({
        card: pendingPlay.card,
        key: playFlightKeyRef.current,
        isTrap: pendingPlay.isTrap,
      });
      pendingPlayFlightRef.current = null;
    } else {
      // 中央カード演出が予約されていない異常系: 直接 finalize + キュー pop。
      finalizePlayCard();
      const step = activeStepRef.current;
      if (step) completeStep(step);
    }
  }, [finalizePlayCard, playSfx, completeStep]);

  const handlePlayFlightComplete = useCallback(() => {
    setPlayFlight(null);
    finalizePlayCard();
    // Issue #222: cardUse ステップ完了 → キュー pop して次演出へ。
    const step = activeStepRef.current;
    if (step) completeStep(step);
  }, [finalizePlayCard, completeStep]);

  // ドロー演出完了: queue から先頭を pop し、currentPlayer を相手に渡し、
  // 手札の対象カードを一瞬フラッシュさせる。
  // - manual: amber flash (既存 freshlyDrawnId / 0.9s)
  // - auto:   emerald flash (新規 autoFreshlyDrawnId / 0.7s)
  const handleDrawFlightComplete = useCallback(() => {
    const item = currentDrawFlight;
    setDrawFlightQueue((q) => q.slice(1));
    finalizeDraw();
    // Issue #79: ドローカードが手札に着地した瞬間の SE
    playSfx("card_to_hand");
    if (item) {
      const id = item.card.instanceId;
      if (item.source === "auto") {
        setAutoFreshlyDrawnId(id);
        scheduleTimer(() => {
          setAutoFreshlyDrawnId((prev) => (prev === id ? null : prev));
        }, 700);
      } else {
        setFreshlyDrawnId(id);
        scheduleTimer(() => {
          setFreshlyDrawnId((prev) => (prev === id ? null : prev));
        }, 900);
      }
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
    // Issue #222: draw ステップ完了 → キュー pop して次演出へ。
    const step = activeStepRef.current;
    if (step) completeStep(step);
  }, [currentDrawFlight, finalizeDraw, scheduleTimer, playSfx, completeStep]);

  // Issue #193 / card-apply: 相手 (AI) ドローフライト完了。queue 先頭を pop し、
  // finalizeDraw で COMMIT_DRAW (isDrawing 解除 + 手番交代) を実行。完了 SE は
  // 自分側と同じ card_to_hand。相手手札は裏面表示なので freshlyDrawnId 等の
  // フラッシュ・手札スクロールは行わない (自分側固有の可読性補助のため不要)。
  const handleOpponentDrawFlightComplete = useCallback(() => {
    setOpponentDrawFlightQueue((q) => q.slice(1));
    finalizeDraw();
    playSfx("card_to_hand");
    // Issue #222: 相手ドローステップ完了 → キュー pop して次演出へ。
    const step = activeStepRef.current;
    if (step) completeStep(step);
  }, [finalizeDraw, playSfx, completeStep]);

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
    const result: string[] = [];
    // Issue #193 / card-apply: 相手 (AI) の駒戻し/歩戻しフライト中、着地先の
    // AI 持ち駒を隠す (自分側 hiddenOwnCapturedTypes と対称)。これが無いと
    // 適用済の駒が持ち駒に出たままフライトが重なって二重表示になる。
    if (
      pieceFlight &&
      pieceFlight.hideTarget.kind === "captured" &&
      pieceFlight.hideTarget.player === aiColor
    ) {
      result.push(pieceFlight.hideTarget.pieceType);
    }
    if (checkBreakAnim) {
      for (const ht of checkBreakAnim.hideTargets) {
        if (ht.kind === "captured" && ht.player === aiColor) {
          result.push(ht.pieceType);
        }
      }
    }
    return result.length === 0 ? EMPTY_STRINGS : result;
  }, [pieceFlight, checkBreakAnim, aiColor]);

  // Issue #82 (王手崩し): 1 枚分のフライト完了で pendingFlightCount を減算。
  // 0 になったら finalizeCheckBreak で AI 思考とユーザー操作のロックを解除。
  const handleCheckBreakFlightComplete = useCallback(() => {
    setCheckBreakAnim((prev) => {
      if (!prev) return null;
      const next = prev.pendingFlightCount - 1;
      if (next <= 0) {
        // すべて完了 → finalize + Issue #222: trap ステップ完了でキュー pop。
        finalizeCheckBreak();
        const step = activeStepRef.current;
        if (step) completeStep(step);
        return null;
      }
      return { ...prev, pendingFlightCount: next };
    });
  }, [finalizeCheckBreak, completeStep]);

  // 山札からのドロー可否 (Issue #82: pendingCard 中もドロー禁止に統一)
  // 二手指し中もドロー禁止 (Issue #82)
  const canDrawCard =
    cardState.mana[playerColor] >= DRAW_COST &&
    isPlayerTurn &&
    isGameActive &&
    !inCheck &&
    !isDrawAnimating &&
    !isPlayingCard &&
    !isCheckBreakAnimating &&
    cardState.pendingCard === null &&
    doubleMove === null;

  const opponentDeckPile = (
    <DeckPile
      count={cardState.deck[aiColor].length}
      size="md"
      showDrawCost
      progress={cardState.drawProgress[aiColor]}
    />
  );
  const ownDeckPile = (
    <DeckPile
      count={cardState.deck[playerColor].length}
      canDraw={canDrawCard}
      onDraw={drawCard}
      size="md"
      showDrawCost
      dimmed={!isPlayerTurn || !isGameActive}
      progress={cardState.drawProgress[playerColor]}
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
      progress={cardState.drawProgress[playerColor]}
    />
  );

  const opponentHandFaceDown = (
    <HandArea
      hand={displayedOpponentHand}
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
  // Issue #82 (二手指し): 二手指し中は手札・ドローも無効化 (reducer 側でも弾くが UI でも明示)
  const handDisabled = !isPlayerTurn || !isGameActive || cardState.pendingCard !== null || isDrawAnimating || isPlayingCard || isCheckBreakAnimating || doubleMove !== null;

  // 待った可否 (Issue #149: ヘルパ集約版):
  // - reducer 内部条件 (moveHistory >= 2 / undoSnapshots >= 2 / pendingCard なし / doubleMove なし
  //   / getUndoScope 非 null) はフックの `hookCanUndo` (= undo-policy.canUndoFromState) に集約。
  // - UI 固有条件 (isPlayerTurn / isAiThinking) のみここで wrap する。
  // 旧実装は reducer 内部条件を UI 側で再実装していたが、`undoSnapshots.length >= 2` チェックが
  // 抜けており、待った 1 回直後にボタン活性のまま無反応 (reducer 側だけ no-op) になる問題が発生。
  // ヘルパ集約により UI/reducer の判定ズレを構造的に防ぐ。
  const canUndo = useMemo(() => {
    if (!hookCanUndo) return false;
    if (!isPlayerTurn) return false;
    if (isAiThinking) return false;
    return true;
  }, [hookCanUndo, isPlayerTurn, isAiThinking]);

  // 歩戻し等のターゲット選択時にハイライトする盤面マス
  // (Issue #132): 以前は effectId 別に手書き判定 + 末尾で王手回避フィルタを掛けていたが、
  // pawn_return だけ ピン判定を欠いていた (effects.ts isPawnReturnLegalSquare 旧実装)。
  // クリック時 (handleSquareClick) と reducer (selectSquare) は既に isValidCardTargetSquare で
  // 統一されており、ハイライト計算だけが手書きで非統一だった。本変更で 81 マス走査を 1 ループ
  // + isValidCardTargetSquare 呼出に統一し、pin / 王手回避 / 自駒種別 すべて単一ヘルパで判定する。
  const cardTargetSquares: Position[] = useMemo(() => {
    if (!cardState.pendingCard || cardState.pendingCard.phase !== "selectTarget") return [];
    const def = CARD_DEFS[cardState.pendingCard.instance.defId];
    const targets: Position[] = [];
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (isValidCardTargetSquare(gameState, playerColor, def.id, { row: r, col: c })) {
          targets.push({ row: r, col: c });
        }
      }
    }
    return targets;
  }, [cardState.pendingCard, gameState, playerColor]);

  // no_promote の永続マーク (両プレイヤー分をまとめて盤面に渡す)
  const noPromoteSquares: Position[] = useMemo(
    () => [...cardState.noPromoteMarks.sente, ...cardState.noPromoteMarks.gote],
    [cardState.noPromoteMarks],
  );

  // マナ以外の使用条件を満たさないカードIDを集計し、HandArea で非活性化する (Issue #82)。
  // - 通常時: CARD_USE_CONDITIONS の defId 別関数で判定
  // - 王手中: checkUsage フラグで判定 (Issue #82 / 二段ゲート)
  //   - "forbidden":     無条件で非活性 (動的判定スキップ → 計算節約)
  //   - "conditional":   target あり → 王手回避できる配置先が1つでも存在するか動的判定
  //                      target なし → CARD_USE_CONDITIONS 側で個別判定 (現状未使用)
  //   - "unconditional": そのまま使用可 (動的判定スキップ → 計算節約)
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
      const cardUseCondition = CARD_USE_CONDITIONS[inst.defId];
      if (cardUseCondition && !cardUseCondition(gameState, playerColor, cardState)) {
        set.add(inst.defId);
        continue;
      }
      // Issue #82: 王手中の使用可否は checkUsage フラグで二段ゲート
      if (inCheck) {
        if (def.checkUsage === "forbidden") {
          set.add(inst.defId);
          continue;
        }
        if (def.checkUsage === "conditional" && def.targeting !== "none") {
          // target あり: 1 マスでも王手回避になる配置先があるか早期 return 版で検証
          // (Issue #107 Step 3 で計算量を 30-50% 削減した実装をそのまま流用)
          if (!canEscapeCheckWithCard(gameState, playerColor, inst.defId as CardId)) {
            set.add(inst.defId);
            continue;
          }
        }
        // unconditional / target なし conditional は通す
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
      autoFlashCardId={autoFreshlyDrawnId}
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
        {/* Issue #132 派生: ステータスバッジは displayInCheck (= 二手指し 1 手目自玉王手の
            過渡状態を除いた inCheck) を見る。玉赤スタイルは ShogiBoard 側で inCheck 直参照のため維持。 */}
        {displayInCheck && (
          <Badge variant="destructive" className="animate-pulse text-xs">
            王手！
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{gameState.moveCount}手目</span>
        <AuthControls variant="indicator" />
        <ThemeSelector />
      </div>
    </div>
  );

  return (
    <div
      data-card-shogi-root
      data-card-shogi-layout-mode={layoutDebug?.mode}
      data-card-shogi-square-size={squareSize}
      className="shogi-game-area w-full overflow-hidden flex flex-col"
      style={{
        height: viewportHeight,
        "--card-shogi-bottom-controls-height": `${bottomControlsHeight}px`,
        "--card-shogi-square-size": `${squareSize}px`,
      } as CSSProperties}
      onClick={handleDeselect}
    >
      {/* モバイル: ステータスバーを画面最上段に配置 (Issue #105) */}
      <div data-card-shogi-status className="md:hidden shrink-0 bg-card border-b">{statusBarContent}</div>
      {/* ===== 相手ゾーン ===== */}
      {/* PC タブレット相当 (md..xl-1): 詳細ゾーン */}
      <section
        data-card-shogi-opponent-area
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
        data-card-shogi-opponent-area
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
              hand={displayedOpponentHand}
              currentMana={0}
              faceDown
              layout="stack"
              size="sm"
              emptyLabel=""
              stackMaxVisible={5}
            />
          </div>
          <DeckPile
            count={cardState.deck[aiColor].length}
            size="sm"
            showDrawCost
            progress={cardState.drawProgress[aiColor]}
          />
          <TrapSlot trap={cardState.trap[aiColor]} faceDown size="sm" />
        </div>
      </section>

      {/* ===== 中央: 盤面 + 持ち駒 + (PCサイドパネル) ===== xl 未満で表示 */}
      <div className="xl:hidden flex-1 min-h-0 flex flex-col lg:flex-row max-w-5xl mx-auto w-full overflow-hidden">
        <div
          ref={playAreaRef}
          data-card-shogi-play-area
          className="flex flex-col items-center flex-1 min-h-0 px-2 py-0.5 lg:py-2"
        >
          {/* ステータスバー (タブレット用)。モバイルでは画面最上段に分離配置済 (Issue #105) */}
          <div className="hidden md:block w-full">{statusBarContent}</div>

          {/* 相手の持ち駒 (モバイルでは compact で縦幅を詰める) */}
          <div data-card-shogi-captured="opponent" className="w-full shrink-0" style={{ maxWidth: squareSize * 9 + 60 }}>
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
          <div data-card-shogi-board className="relative shrink-0 my-0.5">
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
              forbiddenMateSquares={forbiddenMateMoves.map((m) => m.to)}
            />
            <BoardOverlay
              key={overlayEvent?.key}
              event={overlayEvent?.event ?? null}
              trapName={overlayEvent?.trapName}
            />
          </div>

          {/* 自分の持ち駒 (モバイルでは compact で縦幅を詰める) */}
          <div data-card-shogi-captured="self" className="w-full shrink-0" style={{ maxWidth: squareSize * 9 + 60 }}>
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
                <MaskedLink href="/" loadingVariant="spinner">
                  <Button size="sm" variant="outline">ホームへ</Button>
                </MaskedLink>
                <Button size="sm" onClick={handlePlayAgain} disabled={isRematching}>
                  {isRematching ? "準備中..." : "もう一局"}
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
            isPending={isRematching}
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
          data-card-shogi-end-card
          className={cn(
            "xl:hidden fixed left-0 right-0 z-30 transition-transform duration-300",
            endCardMinimized ? "translate-y-full" : "translate-y-0",
          )}
          style={{ bottom: "var(--card-shogi-bottom-controls-height)" }}
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
                  <MaskedLink href="/" loadingVariant="spinner">
                    <Button size="sm" variant="outline">ホームへ</Button>
                  </MaskedLink>
                  <Button size="sm" onClick={handlePlayAgain} disabled={isRematching}>
                    {isRematching ? "準備中..." : "もう一局"}
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
        ref={bottomControlsRef}
        data-card-shogi-bottom-controls
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
          {/* Issue #132: タブレット (md..xl) でも待ったボタンを有効化。
              旧実装では onUndo={NOOP_UNDO} / canUndo={false} で配線が空関数になっており、
              タブレットだけ待った不可になっていた。xl/モバイルと同じ undo/canUndo に揃える。 */}
          <GameControls
            onResign={resign}
            onUndo={undo}
            isMuted={isMuted}
            onToggleMute={toggleMute}
            canUndo={canUndo}
            gameActive={isGameActive}
            spectatorMode={spectatorMode}
            isPaused={isPaused}
            onPauseSpectator={pauseSpectator}
            onExitSpectator={handleRequestExit}
          />
        </div>
      </section>

      {/* モバイル (<md): 下端 3カラム構成 (P20) */}
      {/* 左ブロック(2段): 段1=待った/投了、段2=手札ボタン+マナゲージ
        * Issue #105: 段2幅を段1 (GameControls) と同じ自然幅に揃え、
        * 余った横幅は右のトラップ列が flex-1 で取り込む。 */}
      <section
        ref={bottomControlsRef}
        data-card-shogi-bottom-controls
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
                spectatorMode={spectatorMode}
                isPaused={isPaused}
                onPauseSpectator={pauseSpectator}
                onExitSpectator={handleRequestExit}
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
        data-card-shogi-drawer
        className={cn(
          "md:hidden fixed left-0 right-0 z-20 bg-card border-t-2 border-primary shadow-2xl transition-transform duration-300",
          drawerOpen ? "translate-y-0" : "translate-y-full",
        )}
        style={{
          bottom: "var(--card-shogi-bottom-controls-height)",
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
            autoFlashCardId={autoFreshlyDrawnId}
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
        data-card-shogi-xl-layout
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
            {/* Issue #132 派生: 二手指し 1 手目自玉王手の過渡状態は Badge を抑制 (玉赤は維持) */}
            {displayInCheck && (
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

        {/* Col 1: 自分カードエリア(縦並び、横幅一杯+中央揃え)
            Issue #150: PC (xl 以上) では「相手エリア=右側」レイアウトのため、
            ヘッダー右端ではなく「自分エリア先頭の ▲ 自分 ラベル」横に
            ログインインジケータを配置する。
            ラッパーに py-1 を持たせて、aside の overflow-hidden で
            アバターの緑 ring が上下に見切れないよう余白を確保する。 */}
        <aside className="flex flex-col gap-2 border-r pr-2 min-h-0 overflow-hidden">
          <div className="flex items-center justify-center gap-2 self-center shrink-0 py-1">
            <AuthControls variant="indicator" />
            <Badge variant="default">▲ 自分</Badge>
          </div>
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
                progress={cardState.drawProgress[playerColor]}
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
              autoFlashCardId={autoFreshlyDrawnId}
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
              spectatorMode={spectatorMode}
              isPaused={isPaused}
              onPauseSpectator={pauseSpectator}
              onExitSpectator={handleRequestExit}
            />
          </div>
        </aside>

        {/* Col 2: 中央(盤面 + 持ち駒) */}
        <main
          ref={playAreaRef}
          data-card-shogi-play-area
          className="flex flex-col items-center gap-1 min-h-0 overflow-hidden"
        >
          <div data-card-shogi-captured="opponent" className="w-full shrink-0" style={{ maxWidth: squareSize * 9 + 60 }}>
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
          <div data-card-shogi-board className="relative shrink-0">
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
              forbiddenMateSquares={forbiddenMateMoves.map((m) => m.to)}
            />
            <BoardOverlay
              key={overlayEvent?.key}
              event={overlayEvent?.event ?? null}
              trapName={overlayEvent?.trapName}
            />
          </div>
          <div data-card-shogi-captured="self" className="w-full shrink-0" style={{ maxWidth: squareSize * 9 + 60 }}>
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
                <MaskedLink href="/" loadingVariant="spinner">
                  <Button size="sm" variant="outline">ホームへ</Button>
                </MaskedLink>
                <Button size="sm" onClick={handlePlayAgain} disabled={isRematching}>
                  {isRematching ? "準備中..." : "もう一局"}
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
              <DeckPile
                count={cardState.deck[aiColor].length}
                size="lg"
                fullWidth
                showDrawCost
                progress={cardState.drawProgress[aiColor]}
              />
            </div>
            <div className="flex-1 min-w-0">
              <TrapSlot trap={cardState.trap[aiColor]} faceDown size="lg" fullWidth />
            </div>
          </div>
          <div className="text-xs text-muted-foreground font-medium shrink-0 text-center">手札 {displayedOpponentHand.length}枚</div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            <HandArea
              hand={displayedOpponentHand}
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
      {/* Issue #82 (二手指し): 2手目で禁止された詰み手をクリックした時のお知らせダイアログ */}
      <ForbiddenMateDialog
        open={forbiddenMateDialogOpen}
        onClose={() => setForbiddenMateDialogOpen(false)}
      />
      {/* Issue #82: 二手指し (double_move) 中の上端バナー + 戻すボタン + キャンセルボタン */}
      {doubleMove && !isPlayingCard && (
        <DoubleMoveNotice
          movesLeft={doubleMove.movesLeft}
          canUndoFirst={
            doubleMove.movesLeft === 1 &&
            isGameActive &&
            !isCheckBreakAnimating &&
            !isPlayingCard
          }
          canCancel={
            isGameActive &&
            !isCheckBreakAnimating &&
            !isPlayingCard
          }
          onUndoFirst={undoDoubleMoveFirst}
          onCancel={cancelDoubleMove}
        />
      )}

      {/* Issue #78: ドロー中央演出 (山札→中央→手札の DOMRect 追従)。
          Issue #130: variant ごとに色味を切替 (manual=amber, auto=emerald + 自動ドローラベル)。
          FIFO 化により queue 先頭のみを描画、onComplete で pop して次の演出に移る。 */}
      <DrawFlightCard
        cardInstance={currentDrawFlight?.card ?? null}
        flightKey={currentDrawFlight?.key ?? null}
        variant={currentDrawFlight?.source ?? "manual"}
        deckRectGetter={getDeckRect}
        handRectGetter={getHandRect}
        onComplete={handleDrawFlightComplete}
      />

      {/* Issue #193 / card-apply: 相手 (AI) ドロー用フライト。自分側と同じ
          山札→中央→手札アニメだが faceDown で中央でも裏面のまま (何を引いたか
          見せない)。山札/手札 rect は AI 側 (画面上部) を取得。 */}
      <DrawFlightCard
        cardInstance={currentOpponentDrawFlight?.card ?? null}
        flightKey={currentOpponentDrawFlight?.key ?? null}
        variant={currentOpponentDrawFlight?.source ?? "manual"}
        deckRectGetter={getAiDeckRect}
        handRectGetter={getAiHandRect}
        onComplete={handleOpponentDrawFlightComplete}
        faceDown
      />

      {/* Issue #130: 自動ドロー専用 Burst 演出 (ring collapse + particles + trail)。
          DrawFlightCard より z-index 1 階層上 (z-[70])、currentDrawFlight が
          source="auto" に切り替わった瞬間に useEffect から起動される。 */}
      <AutoDrawBurst
        origin={autoBurst?.origin ?? null}
        scale={autoBurst?.scale ?? "self"}
        burstKey={autoBurst?.key}
      />

      {/* Issue #130: 自動ドロー発動の SR 通知。1500ms debounce で連続発火時は最後の通知のみ。 */}
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {autoDrawLiveMessage}
      </span>

      {/* Issue #106: カード使用/トラップセット時の中央演出 (中央にパッと出現+キラッと光る) */}
      <CardPlayFlight
        cardInstance={playFlight?.card ?? null}
        flightKey={playFlight?.key ?? null}
        isTrap={playFlight?.isTrap ?? false}
        onComplete={handlePlayFlightComplete}
      />

      {/* Issue #82: 駒移動カード(歩戻し / 駒戻し / 二歩指し)の駒回転フライト演出。
          pieceWidth / pieceHeight は盤上マス実寸を渡し、フライト中の駒サイズを
          実際の盤駒と揃える。speed/rotation/min/ease は dev /piece-flight の
          保存値 (なければ animation-constants の既定値) を反映。 */}
      <PieceFlight
        spec={pieceFlight?.spec ?? null}
        flightKey={pieceFlight?.key ?? null}
        playerColor={playerColor}
        pieceWidth={boardCellSize.width}
        pieceHeight={boardCellSize.height}
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
          pieceWidth={boardCellSize.width}
          pieceHeight={boardCellSize.height}
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
                    viewBox={`0 0 ${g.rect.width} ${g.rect.height}`}
                    preserveAspectRatio="none"
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    aria-hidden
                  >
                    <line
                      x1={g.rect.width}
                      y1="0"
                      x2="0"
                      y2={g.rect.height}
                      stroke="#ef4444"
                      strokeWidth={Math.max(3, Math.min(5, g.rect.width * 0.12))}
                      strokeLinecap="round"
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

      {/* Issue #193 / PR1a: 観戦モード一時停止中の中央インジケータ。
          オーバーレイ自体がクリック可能で、どこをクリックしても resumeSpectator が
          発火して観戦を再開できる。半透明 + 軽い backdrop-blur で全体がぼんやり
          マスクされた状態を表現する。 */}
      {spectatorMode && isPaused && !isExitingHome && (
        <button
          type="button"
          onClick={resumeSpectator}
          aria-label="クリックで観戦を再開"
          className="fixed inset-0 z-40 flex items-center justify-center bg-background/40 backdrop-blur-[2px] cursor-pointer"
        >
          <div className="flex flex-col items-center gap-2 bg-card/95 px-6 py-5 sm:px-8 sm:py-6 rounded-2xl shadow-xl border-2 border-primary/30 pointer-events-none">
            <Pause className="w-12 h-12 sm:w-16 sm:h-16 text-primary" strokeWidth={2.5} />
            <div className="text-base sm:text-lg font-bold">一時停止中</div>
            <div className="text-xs text-muted-foreground text-center">
              画面をクリックで再開
            </div>
          </div>
        </button>
      )}

      {/* Issue #193 / PR1a: 観戦モードのホーム戻り確認ダイアログ。
          ダイアログ表示中は CPU を pause した状態を維持し、確認 OK で
          ローディングマスク (LoadingOverlay) を表示しつつ router.push("/") する。 */}
      <Dialog
        open={showExitDialog}
        onOpenChange={(open) => {
          if (!open) handleCancelExit();
        }}
      >
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>ホームへ戻りますか？</DialogTitle>
            <DialogDescription>
              観戦を中断してホーム画面に戻ります。観戦結果は保存されません。
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 justify-end mt-2">
            <Button variant="outline" onClick={handleCancelExit}>
              キャンセル
            </Button>
            <Button onClick={handleConfirmExit}>ホームへ戻る</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Issue #163: 「もう一局」(=createGame Server Action 後 router.push) 中のローディングマスク。
          xl/xl 未満/モバイル の各レイアウトで同じ isRematching を共有しているため Overlay 1 つで全カバー。
          ビジュアルは他のリッチローディング (回転カード + プログレスバー + ステージ文言) に統一。
          Issue #193 / PR1a: 観戦モードのホーム戻り (isExitingHome) も同 Overlay を流用、
          ステージ文言は LOADING_STAGES.homeNavigate に切替。 */}
      <LoadingOverlay
        show={isRematching || isExitingHome}
        fullScreen
        card
        progress
        stages={isExitingHome ? LOADING_STAGES.homeNavigate : LOADING_STAGES.matchRestart}
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
    </div>
  );
}
