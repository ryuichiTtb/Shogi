// Step 5 (Issue #107): use-card-shogi-game.ts (1,070 行) から reducer 関連を
// 切り出し。reducer は (state, action) => state の純関数なので副作用フックの
// useEffect / useCallback とは独立して移管できる。
//
// このファイルが持つ責務:
// - Action 型 (ShogiAction / Action)
// - CardShogiGameStateInternal 型 (useReducer 内部 state)
// - makeMoveWithEffects / isKingInCheckAfterMove (reducer 内部 helper)
// - reducer 関数本体
//
// 移管時にロジックは 1 行も変えず、ファイル境界のみ引いた (move-only)。

import type { GameState, Move, Player, Position } from "@/lib/shogi/types";
import { applyMove, cloneGameState } from "@/lib/shogi/board";
import {
  findKing,
  getDropMoves,
  getLegalDropMoves,
  getPieceMoves,
  hasOneMoveMate,
  isCheckmate,
  isInCheck,
} from "@/lib/shogi/moves";
import { evaluateGameEnd } from "@/lib/shogi/rules";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";

import type { CardAction, CardGameState, CardInstance, GameEvent } from "@/lib/shogi/cards/types";
import {
  CARD_DEFS,
  CARD_USE_CONDITIONS,
  DRAW_COST,
  MANA_PER_TURN,
  MANA_FAST_BONUS,
  FAST_THRESHOLD_MS,
  AUTO_DRAW_INTERVAL,
} from "@/lib/shogi/cards/definitions";
import {
  applyManaUp,
  applyPawnReturn,
  applyPieceReturn,
  applyDoublePawn,
  applyCheckBreak,
  getCheckEscapingSquares,
  applyTrapSet,
  applyTrapClear,
  consumeNormalCard,
  hasNoPromoteMark,
  addNoPromoteMark,
  removeNoPromoteMark,
  moveNoPromoteMark,
  hasSameKindTrapPlaced,
} from "@/lib/shogi/cards/effects";
import { canUndoFromState } from "./undo-policy";

export type ShogiAction =
  | { type: "SELECT_SQUARE"; pos: Position }
  | { type: "DESELECT" }
  | { type: "SELECT_HAND_PIECE"; pieceType: string }
  | { type: "MAKE_MOVE"; move: Move }
  | { type: "SET_AI_THINKING"; thinking: boolean }
  | { type: "SHOW_PROMOTION_DIALOG"; move: Move }
  | { type: "CONFIRM_PROMOTION"; promote: boolean }
  | { type: "CANCEL_PROMOTION" }
  | { type: "RESIGN" }
  | { type: "UNDO" }
  // Issue #82 (二手指し): 1手目を取り消して preFirstMoveState から復元するアクション。
  // カードはまだ使用したまま (movesLeft=2 で再開、もう一度 1手目を選び直せる)。
  | { type: "UNDO_DOUBLE_MOVE_FIRST" }
  // Issue #82 (二手指し / 新仕様): カード使用自体をキャンセル。
  // preCardState から完全復元 → カードは手札に戻り、マナも消費されない。
  // movesLeft=2 でも movesLeft=1 でも実行可能 (= 2手目完了前ならいつでもキャンセル可)。
  | { type: "CANCEL_DOUBLE_MOVE" }
  | { type: "BEGIN_TURN_TIMER"; player: Player }
  // Issue #193 / PR1a: CPU vs CPU 観戦モードのポーズ機能。spectatorMode === true
  // のときのみ実効する (人間プレイ時のポーズは別 Issue で扱う)。reducer は isPaused
  // フラグを更新するだけで、AI 自動応手 useEffect 側がフラグを見て request abort と
  // dispatch ガードを行う。
  | { type: "PAUSE_GAME" }
  | { type: "RESUME_GAME" }
  // Issue #193 / PR1a (C-5): 観戦モード固有の終局判定。SPECTATOR_MAX_MOVES (200 手)
  // 到達時に use-card-shogi-game の useEffect が dispatch する。spectatorMode === false の
  // 人間プレイ時は no-op (= 強制終了は観戦モード専用)。終了条件優先順位: 千日手 (最優先、
  // 既存 status="draw" 判定) → カードアクション上限 → 200 手到達の順。
  | { type: "END_SPECTATOR_GAME" };

export type Action = ShogiAction | CardAction;

export interface CardShogiGameStateInternal {
  gameState: GameState;
  selectedSquare: Position | null;
  selectedHandPiece: string | null;
  legalMoves: Move[];
  // Issue #82 (二手指し): 2手目で「mateInOneAvailable=false なら禁止される詰み手」。
  // legalMoves とは別管理。UI で赤×表示し、クリック時にダイアログで禁止理由を説明するため。
  // 通常時 / 二手指し以外の場面では常に空。
  forbiddenMateMoves: Move[];
  isAiThinking: boolean;
  promotionPendingMove: Move | null;
  cardState: CardGameState;
  eventLog: GameEvent[];
  // Issue #78: ドロー演出中フラグ。DRAW_CARD で true、演出完了時の COMMIT_DRAW で false。
  // true の間は currentPlayer 反転を保留し、AI 自動応手をブロックする。
  isDrawing: boolean;
  pendingDrawPlayer: Player | null;
  // Issue #130: ドロー発火源。"manual" は DRAW_CARD コマンド由来 (currentPlayer 未反転、
  // COMMIT_DRAW で反転 + applyTurnEndEffects 実行)。"auto" は applyTurnEndEffects のしきい値
  // 到達由来 (currentPlayer は呼び元で既に反転済、COMMIT_DRAW ではフラグクリアのみ)。
  pendingDrawSource: "manual" | "auto" | null;
  // カード使用演出中フラグ。CONFIRM_PLAY_CARD で true、演出完了時の COMMIT_PLAY_CARD で false。
  // true の間は currentPlayer 反転を保留し、AI 自動応手・ユーザー操作をブロックする。
  isPlayingCard: boolean;
  pendingPlayCardOpponent: Player | null;
  // 王手崩しトラップ (#82) の演出中フラグ。MAKE_MOVE / CONFIRM_PROMOTION で
  // トラップが発動した直後に true、UI 演出 (王手中央表示 → トラップ発動 → 駒フライト) 完了時の
  // COMMIT_CHECK_BREAK で false。true の間は AI 思考とユーザー操作をブロックする。
  isCheckBreakAnimating: boolean;
  // Issue #82 (二手指し): カード使用後・2手目完了前の二手指しモード状態。
  // null 以外の間は doubleMove.active プレイヤーが続けて 1手目・2手目を指す。
  // - movesLeft=2: カード使用直後 (CONFIRM_PLAY_CARD で設定)、これから 1手目
  // - movesLeft=1: 1手目完了 (MAKE_MOVE で 2 → 1)、これから 2手目
  // - 2手目完了で null クリア (MAKE_MOVE)、ここでカード本体が消費・cardPlayEvent 発行・演出開始
  // - 「1手目を戻す」(UNDO_DOUBLE_MOVE_FIRST) で preFirstMoveState から復元、movesLeft=2 へ
  // - 「キャンセル」(CANCEL_DOUBLE_MOVE) で preCardState から復元、doubleMove=null
  //
  // 重要 (新仕様): カード本体の消費・mana 減算・cardPlayEvent push は CONFIRM_PLAY_CARD では
  // 行わず、2手目完了時 (MAKE_MOVE 内) で初めて確定する。これにより 1手目までの
  // 操作はキャンセル可能 (= カードを使用しなかったことに戻せる)。
  // 永続化しない (DB save は 2手目完了で 1回のみ)。リロード時は in-memory のみ消失し
  // DB は カード使用前 (二手指し中は save スキップなのでカード未使用) に戻る。
  doubleMove: {
    active: Player;
    movesLeft: 1 | 2;
    mateInOneAvailable: boolean;
    // 2手目完了時に消費するカードのインスタンスとコスト。CONFIRM_PLAY_CARD 時に格納。
    cardInstance: CardInstance;
    cardCost: number;
    // 1手目を取り消して 2手目選択前の状態に戻すためのスナップショット。
    // 新仕様では CONFIRM_PLAY_CARD でカード未消費なので、preFirstMoveState は preCardState と同値。
    // 構造を維持するためフィールドは残す (将来 1手目で何か state を変えるカードが出た時の拡張点)。
    preFirstMoveState: {
      gameState: GameState;
      cardState: CardGameState;
      eventLog: GameEvent[];
    };
    // カード使用自体をキャンセルして「カードを使わなかったことに」戻すためのスナップショット。
    // CONFIRM_PLAY_CARD で記録 (= カード使用直前 = pendingCard 確定直前の状態)。
    preCardState: {
      gameState: GameState;
      cardState: CardGameState;
      eventLog: GameEvent[];
    };
  } | null;
  // Issue #132: 待った (UNDO) スナップショットのリングバッファ。
  // MAKE_MOVE / CONFIRM_PROMOTION の先頭で「移動を適用する直前の state」を 1 件 push する。
  // size は最大 2 で固定 (待ったは直近 2 ply まで遡る仕様)。
  // UNDO 時は snapshots[0] (= 2 ply 前の状態) に復元し、ring を 0 件に戻す。
  //
  // 旧実装 (createInitialGameState + moveHistory replay) ではカード効果 (歩戻し / 駒戻し /
  // 二歩指し / 王手崩し / no_promote マーク / トラップ / マナ / 手札 / 山札 / 墓地) が
  // moveHistory に乗らないため UNDO で消失していた。
  // 過去 2 ターンスコープ外にカード操作が落ちたとき、cardOp guard を素通りして UNDO が
  // 許可される結果、戻したはずの駒が盤上に復活する事象も発生していた (Issue #132 再現)。
  // スナップショット方式は state 全量を保持するため、scope-bounds の漏れに依存せず常に正しく復元する。
  //
  // リロード後は in-memory の本フィールドが空 [] となり、UNDO は不可になる
  // (eventLog も空でリロード後 → getUndoScope null → canUndo false が先に効くが、二重に保守的)。
  undoSnapshots: UndoSnapshot[];
  // Issue #193 / PR1a: CPU vs CPU 観戦モードフラグ。対局開始時に確定し、対局中は変化しない。
  // - false (既定): 人間プレイ。早指しボーナス・自動進行・ポーズなどは従来挙動を完全保持。
  // - true: 観戦モード。makeMoveWithEffects の早指し判定をスキップ (= MANA_FAST_BONUS 不発)、
  //   PAUSE_GAME / RESUME_GAME を受付ける。DB 保存は use-card-shogi-game 側で別途スキップ。
  spectatorMode: boolean;
  // Issue #193 / PR1a: 観戦モード専用のポーズフラグ。spectatorMode === false のときは常に false
  // (= PAUSE_GAME / RESUME_GAME を dispatch しても無視)。人間プレイ時のポーズ機能は別 Issue で扱う。
  // ポーズ中は AI 自動応手 useEffect 側で request を cancel し、副作用ある dispatch も
  // ガードする (reducer 自身は本フラグを保持するだけで副作用を生まない)。
  isPaused: boolean;
}

// Issue #132: 待ったスナップショット。reducer 内部で「移動直前の状態」を保持する。
// gameState / cardState / eventLog のみ復元対象 (UI 一時 state や演出フラグは復元時にクリア)。
export interface UndoSnapshot {
  gameState: GameState;
  cardState: CardGameState;
  eventLog: GameEvent[];
}

// 移動処理のモード切替 (Issue #82 二手指し)。
// - "normal": 通常の指し手 (マナチャージ + 早指しタイマークリア)
// - "double_move_first": 二手指しの 1手目 (マナチャージなし + タイマークリアなし、ターン継続中)
// - "double_move_second": 二手指しの 2手目 (マナチャージなし、タイマークリアあり、ターン交代)
// 二手指しはカード使用扱いのため、1手目・2手目とも通常のマナチャージ (+1〜+2) は発生しない
// (カードコスト -6 のみ消費、これは CONFIRM_PLAY_CARD 側で処理済み)。
export type MakeMoveMode = "normal" | "double_move_first" | "double_move_second";

// Issue #132: 待ったスナップショットのリング最大サイズ (= 直近何 ply 分を保持するか)。
// 待った仕様は「直近 2 ply 巻き戻し」なので 2 で十分。これ以上は保持しない (メモリ節約)。
const UNDO_SNAPSHOT_RING_MAX = 2;

// Issue #132: cardState を「待った復元用」に複製する。
// hand / deck / graveyard / noPromoteMarks の配列だけ新参照を作って snapshot との
// 相互独立性を保証する。CardInstance / Position / TrapInstance / pendingCard は
// reducer 内で mutate されない契約のため ref 共有で OK。
function cloneCardStateForSnapshot(s: CardGameState): CardGameState {
  return {
    mana: { ...s.mana },
    manaCap: s.manaCap,
    hand: { sente: [...s.hand.sente], gote: [...s.hand.gote] },
    deck: { sente: [...s.deck.sente], gote: [...s.deck.gote] },
    graveyard: { sente: [...s.graveyard.sente], gote: [...s.graveyard.gote] },
    trap: { sente: s.trap.sente, gote: s.trap.gote },
    pendingCard: s.pendingCard,
    lastTurnStartedAt: { ...s.lastTurnStartedAt },
    noPromoteMarks: {
      sente: [...s.noPromoteMarks.sente],
      gote: [...s.noPromoteMarks.gote],
    },
    drawProgress: { ...s.drawProgress },
  };
}

// Issue #132: 移動を適用する直前の state を snapshot に push し、リングを更新して返す。
// MAKE_MOVE / CONFIRM_PROMOTION の冒頭で呼び、戻り値を返却 state の undoSnapshots に入れる。
// gameState は applyMove → cloneGameState で新参照になるため、ここでも cloneGameState で
// 完全に分離 (board は 2D 配列で参照共有すると以降のターンで mutate される懸念あり)。
function pushUndoSnapshot(state: CardShogiGameStateInternal): UndoSnapshot[] {
  const snap: UndoSnapshot = {
    gameState: cloneGameState(state.gameState),
    cardState: cloneCardStateForSnapshot(state.cardState),
    eventLog: state.eventLog.slice(),
  };
  // ring size を UNDO_SNAPSHOT_RING_MAX で頭打ち。古い snapshot は evict。
  return [...state.undoSnapshots.slice(-(UNDO_SNAPSHOT_RING_MAX - 1)), snap];
}

// 移動 + マナチャージ + トラップフィルタ を一括適用。
// CONFIRM_PROMOTION と MAKE_MOVE の両方から呼ばれる。
function makeMoveWithEffects(
  gameState: GameState,
  cardState: CardGameState,
  move: Move,
  // Issue #193 / PR1a: spectatorMode は CPU vs CPU 観戦モード時に true。
  // 早指し判定 (FAST_THRESHOLD_MS) を完全 disable し、両 CPU の連続指しによる
  // マナ蓄積異常を防ぐ。spectatorMode=false の人間プレイ時は完全に従来挙動を保持。
  options?: { mode?: MakeMoveMode; spectatorMode?: boolean },
): {
  gameState: GameState;
  cardState: CardGameState;
  events: GameEvent[];
  finalMove: Move;
  // 王手崩しトラップが発動した場合のみ true。MAKE_MOVE 側で isCheckBreakAnimating をセットする。
  triggeredCheckBreak: boolean;
} {
  const mode: MakeMoveMode = options?.mode ?? "normal";
  const spectatorMode = options?.spectatorMode ?? false;
  const opponent: Player = move.player === "sente" ? "gote" : "sente";
  const events: GameEvent[] = [];

  // 1. 成り宣言フィルタ
  //   (a) 自分の駒に既に「成り不可」マークがあれば silent ブロック (新規トラップは発火させない)
  //   (b) (a) でなく、相手が no_promote トラップをセット中なら新規発動
  //       → 成りブロック + 移動先位置にマーク追加 + トラップ消費
  let finalMove = move;
  let cardStateNext = cardState;
  let pendingMarkAdd: Position | null = null;

  const opponentTrap = cardState.trap[opponent];
  const ownMarkAtFrom =
    move.from !== undefined &&
    move.from !== null &&
    hasNoPromoteMark(cardState, move.player, move.from);

  if (move.promote && ownMarkAtFrom) {
    // 既マーク済み駒の成り宣言 → silent ブロック (トラップは無関係、消費しない)
    finalMove = { ...move, promote: false };
  } else if (move.promote && opponentTrap && opponentTrap.defId === "no_promote") {
    // 新規発動: 成り宣言を無効化し、移動後位置に永続マーク付与、トラップ消費
    finalMove = { ...move, promote: false };
    cardStateNext = applyTrapClear(cardStateNext, opponent);
    pendingMarkAdd = move.to;
    events.push({
      kind: "trapTriggerEvent",
      player: opponent,
      instance: opponentTrap,
      reason: "promotion_declared",
      at: Date.now(),
    });
  }

  // 2. 駒移動
  const nextGameState = applyMove(gameState, finalMove);

  // 3. 成り不可マークの追従処理 (move 系のみ。drop は対象外)
  if (finalMove.type === "move" && finalMove.from) {
    // (a) 取られた相手駒のマークがあれば削除 (case A: 取られたら消失)
    if (hasNoPromoteMark(cardStateNext, opponent, finalMove.to)) {
      cardStateNext = removeNoPromoteMark(cardStateNext, opponent, finalMove.to);
    }
    // (b) 自分の駒のマークを from → to に移動
    if (hasNoPromoteMark(cardStateNext, finalMove.player, finalMove.from)) {
      cardStateNext = moveNoPromoteMark(
        cardStateNext,
        finalMove.player,
        finalMove.from,
        finalMove.to,
      );
    }
  }

  // 4. トラップ発動分のマーク追加 (成り宣言を無効化した直後の駒位置に付与)
  if (pendingMarkAdd) {
    cardStateNext = addNoPromoteMark(cardStateNext, finalMove.player, pendingMarkAdd);
  }

  // 4.5 王手崩しトラップ (#82)
  // 移動の結果、相手 (= トラップ所有者候補) が王手中になり、かつ check_break
  // トラップがセットされていれば自動発動。王手駒すべてを盤上から除去し、
  // トラップ所有者の持ち駒に unpromote 加算する。
  let postTrapGameState = nextGameState;
  let triggeredCheckBreak = false;
  const opponentTrapPostMove = cardStateNext.trap[opponent];
  if (
    opponentTrapPostMove &&
    opponentTrapPostMove.defId === "check_break" &&
    isInCheck(nextGameState, opponent, CARD_SHOGI_VARIANT)
  ) {
    const result = applyCheckBreak(nextGameState, opponent);
    if (result) {
      postTrapGameState = result.gameState;
      // 取られた相手 (= move.player) の駒に no_promote マークがあれば消失
      for (const cap of result.capturedPieces) {
        if (hasNoPromoteMark(cardStateNext, finalMove.player, { row: cap.row, col: cap.col })) {
          cardStateNext = removeNoPromoteMark(cardStateNext, finalMove.player, {
            row: cap.row,
            col: cap.col,
          });
        }
      }
      cardStateNext = applyTrapClear(cardStateNext, opponent);
      events.push({
        kind: "trapTriggerEvent",
        player: opponent,
        instance: opponentTrapPostMove,
        reason: "check_declared",
        capturedPieces: result.capturedPieces,
        at: Date.now(),
      });
      triggeredCheckBreak = true;
    }
  }

  // 5. ゲーム終了判定 + 移動イベントログ
  const evaluated = evaluateGameEnd(postTrapGameState, CARD_SHOGI_VARIANT);
  events.push({ kind: "moveEvent", move: finalMove, at: Date.now() });

  // 6. マナチャージ + lastTurnStartedAt クリア (mode で挙動を切替)
  if (mode === "normal") {
    // 通常の指し手: マナチャージ + 早指し判定 + タイマークリア
    const lastStarted = cardStateNext.lastTurnStartedAt[move.player];
    // Issue #193 / PR1a: 観戦モード時は早指し判定を完全スキップ (両 CPU が常に <4 秒で
    // 指してマナ蓄積が異常になることを防ぐ)。spectatorMode=false の人間プレイ時は
    // 完全に従来挙動を保持する。
    const isFastMove =
      !spectatorMode &&
      lastStarted !== null &&
      Date.now() - lastStarted < FAST_THRESHOLD_MS;
    const manaAmount =
      MANA_PER_TURN + (isFastMove ? MANA_FAST_BONUS : 0);
    cardStateNext = {
      ...cardStateNext,
      mana: {
        ...cardStateNext.mana,
        [move.player]: Math.min(
          cardStateNext.manaCap,
          cardStateNext.mana[move.player] + manaAmount,
        ),
      },
      lastTurnStartedAt: {
        ...cardStateNext.lastTurnStartedAt,
        [move.player]: null,
      },
    };
    events.push({
      kind: "manaChargeEvent",
      player: move.player,
      amount: manaAmount,
      reason: "turn",
      fastMove: isFastMove,
      at: Date.now(),
    });
  } else if (mode === "double_move_second") {
    // 二手指しの 2手目: マナチャージなし。lastTurnStartedAt のみクリア (ターン交代)
    cardStateNext = {
      ...cardStateNext,
      lastTurnStartedAt: {
        ...cardStateNext.lastTurnStartedAt,
        [move.player]: null,
      },
    };
  }
  // mode === "double_move_first": どちらもしない (ターン継続中のため)

  return {
    gameState: evaluated,
    cardState: cardStateNext,
    events,
    finalMove,
    triggeredCheckBreak,
  };
}

function isKingInCheckAfterMove(gameState: GameState, move: Move): boolean {
  const nextState = applyMove(gameState, move);
  return isInCheck(nextState, move.player, CARD_SHOGI_VARIANT);
}


// Issue #130: 「player の手番が終わった」直後に呼び、自動ドロー進捗を加算する。
// しきい値 (AUTO_DRAW_INTERVAL) 到達 + 山札にカードあり、の条件を満たすと自動ドローを
// 発火する。発火時は drawProgress を 0 にリセットし、isDrawing/pendingDrawPlayer/
// pendingDrawSource をセットして UI 演出を起動する。
//
// 呼び出し規約:
// - 呼び出し元 (MAKE_MOVE / CONFIRM_PROMOTION / COMMIT_DRAW(manual) / COMMIT_PLAY_CARD)
//   で「currentPlayer の反転」は事前に済ませておくこと。本ヘルパーは反転を行わない。
// - player は「手番が終わった = ドロー進捗を加算する側」のプレイヤーを渡す。
//   currentPlayer (= 反転後の手番) ではなく、直前まで指していた側。
//
// 山札枯渇時は drawProgress を加算するだけで発火しない (進捗カップなし、加算は継続)。
// UI 表示は Math.min(progress, AUTO_DRAW_INTERVAL) でクランプ。
function applyTurnEndEffects(
  state: CardShogiGameStateInternal,
  player: Player,
): CardShogiGameStateInternal {
  // Issue #170: 詰み・投了など対局終了後はドロー進捗加算と自動ドロー発火を行わない。
  // 詰ます手で同時にしきい値到達した場合に詰み演出と自動ドロー演出が同時実行される
  // のを防ぐ。終局後は進捗が動いても UI 上で意味がないため、ここで止めてよい。
  if (state.gameState.status !== "active") return state;

  const current = state.cardState.drawProgress[player];
  const next = current + 1;
  const deck = state.cardState.deck[player];

  if (next < AUTO_DRAW_INTERVAL || deck.length === 0) {
    // しきい値未到達、または deck 枯渇で発火不可: 進捗のみ加算
    return {
      ...state,
      cardState: {
        ...state.cardState,
        drawProgress: { ...state.cardState.drawProgress, [player]: next },
      },
    };
  }

  // しきい値到達 + deck あり: 自動ドロー発火
  const [top, ...rest] = deck;
  return {
    ...state,
    // 自動ドロー発火時は駒選択状態をクリア (DRAW_CARD と同じ挙動)
    selectedSquare: null,
    selectedHandPiece: null,
    legalMoves: [],
    forbiddenMateMoves: [],
    cardState: {
      ...state.cardState,
      drawProgress: { ...state.cardState.drawProgress, [player]: 0 },
      deck: { ...state.cardState.deck, [player]: rest },
      hand: { ...state.cardState.hand, [player]: [...state.cardState.hand[player], top] },
    },
    eventLog: [
      ...state.eventLog,
      { kind: "drawEvent", player, instance: top, source: "auto", at: Date.now() },
    ],
    isDrawing: true,
    pendingDrawPlayer: player,
    pendingDrawSource: "auto",
  };
}

// 「相手玉を取る手」かどうか。Move.captured は移動先の駒種が入る。
// 通常将棋では交互ターン不変条件で発生しないが、二手指しでは
// 1手目で王手 → 2手目で玉取り のシーケンスが起きうるため明示的に除外する。
function isKingCaptureMove(move: Move): boolean {
  return move.captured === "king";
}

// Issue #82 (二手指し): 1手目候補のフィルタ。
// 「玉が即座に取られない」+「相手玉を取らない」+「∃ 2手目 (詰み禁止フィルタ済) または 1手目で詰み」を満たす手のみ返す。
//
// 仕様 (RELAXED): 王手中・王手中でないにかかわらず、1手目で自玉が王手になる手も
// 「2手目で必ず王手解消できる」場合は合法として扱う。2手目の合法性チェック (`legalSecondMoves`)
// は内部で `isKingInCheckAfterMove(stateAfterFirst, m)` を適用するため、1手目で発生した
// 王手は 2手目で必ず解消される手のみが通過する。よって 1手目側で self-check を弾く必要はない。
//
// 旧実装 (Issue #132 派生バグ): 王手中でない場合に限り `isKingInCheckAfterMove` で 1手目を
// 弾いていたため、玉を相手駒の利き上に動かす 1手目 (例: 桂馬の効きに玉を進入させ、2手目で
// 玉を逃がす手順) が選択不可になっていた。本来の仕様と矛盾していたためフィルタを撤廃。
function filterDoubleMoveFirstCandidates(
  gameState: GameState,
  player: Player,
  candidates: Move[],
  mateInOneAvailable: boolean,
): Move[] {
  const opponent: Player = player === "sente" ? "gote" : "sente";

  return candidates.filter((m1) => {
    // 相手玉を取る手は不可 (実質的に発生しないが防御的)
    if (isKingCaptureMove(m1)) return false;

    const after1 = applyMove(gameState, m1);

    // RELAXED でも玉が直接取られる手は除外 (King-safe)
    const king = findKing(after1.board, player, CARD_SHOGI_VARIANT.boardSize);
    if (!king) return false;

    // 1手目で相手玉に詰みなら 2手目不要 → OK
    if (isCheckmate(after1, opponent, CARD_SHOGI_VARIANT)) return true;

    // 2手目候補 ≥ 1 必須 (詰み禁止フィルタ済 + 相手玉取り除外済 + 自玉王手解消含意)
    const second = legalSecondMoves(after1, player, mateInOneAvailable);
    return second.length > 0;
  });
}

// 2手目候補 (詰み禁止フィルタ済 + 相手玉取り除外済)。
// getLegalMoves(全合法手) + drop の合法手の合計から「相手玉を取る手」を除外。
function legalSecondMoves(
  stateAfterFirst: GameState,
  player: Player,
  mateInOneAvailable: boolean,
): Move[] {
  // board 移動の合法手
  const boardMoves: Move[] = [];
  const { rows, cols } = CARD_SHOGI_VARIANT.boardSize;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const piece = stateAfterFirst.board[r][c];
      if (piece && piece.owner === player) {
        const moves = getPieceMoves(stateAfterFirst, { row: r, col: c }, player, CARD_SHOGI_VARIANT);
        for (const m of moves) {
          if (isKingCaptureMove(m)) continue;
          if (!isKingInCheckAfterMove(stateAfterFirst, m)) boardMoves.push(m);
        }
      }
    }
  }
  const dropMoves = getLegalDropMoves(stateAfterFirst, player, CARD_SHOGI_VARIANT);
  const all = [...boardMoves, ...dropMoves];
  if (mateInOneAvailable) return all;
  const opponent: Player = player === "sente" ? "gote" : "sente";
  return all.filter((m) => !isCheckmate(applyMove(stateAfterFirst, m), opponent, CARD_SHOGI_VARIANT));
}

// 2手目候補を「合法手」と「禁止された詰み手」に分割する (Issue #82)。
// mateInOneAvailable=false 時に詰み手を UI で「禁止マス (赤×)」として表示し、
// クリック時にダイアログで禁止理由を説明するため、別配列で管理する。
// それ以外のフィルタ条件 (玉取り / 自玉王手放置) は両方から除外。
function partitionDoubleMoveSecondCandidates(
  gameState: GameState,
  player: Player,
  candidates: Move[],
  mateInOneAvailable: boolean,
): { legal: Move[]; forbiddenMate: Move[] } {
  const opponent: Player = player === "sente" ? "gote" : "sente";
  const legal: Move[] = [];
  const forbiddenMate: Move[] = [];
  for (const m of candidates) {
    if (isKingCaptureMove(m)) continue;
    if (isKingInCheckAfterMove(gameState, m)) continue;
    if (mateInOneAvailable) {
      legal.push(m);
      continue;
    }
    if (isCheckmate(applyMove(gameState, m), opponent, CARD_SHOGI_VARIANT)) {
      forbiddenMate.push(m);
    } else {
      legal.push(m);
    }
  }
  return { legal, forbiddenMate };
}

// 駒選択時の合法手 + 禁止された詰み手を生成。doubleMove モード切替を含む。
// noPromote マークと doubleMove フィルタを統一して適用。
// forbiddenMate: 二手指し 2手目で「mateInOneAvailable=false なら禁止」となる詰み手。
// UI で赤×表示し、クリック時にダイアログで禁止理由を説明するため別配列で管理。
function legalMovesForPieceSelect(
  state: CardShogiGameStateInternal,
  pos: Position,
): { legal: Move[]; forbiddenMate: Move[] } {
  const { gameState } = state;
  const piece = gameState.board[pos.row]?.[pos.col];
  if (!piece || piece.owner !== gameState.currentPlayer) return { legal: [], forbiddenMate: [] };

  const moves = getPieceMoves(gameState, pos, gameState.currentPlayer, CARD_SHOGI_VARIANT);
  const noPromote = hasNoPromoteMark(state.cardState, gameState.currentPlayer, pos);
  const filteredByNoPromote = moves.filter((m) => !(noPromote && m.type === "move" && m.promote));

  const dm = state.doubleMove;
  if (dm && dm.movesLeft === 2) {
    return {
      legal: filterDoubleMoveFirstCandidates(gameState, gameState.currentPlayer, filteredByNoPromote, dm.mateInOneAvailable),
      forbiddenMate: [],
    };
  }
  if (dm && dm.movesLeft === 1) {
    return partitionDoubleMoveSecondCandidates(gameState, gameState.currentPlayer, filteredByNoPromote, dm.mateInOneAvailable);
  }
  return {
    legal: filteredByNoPromote.filter((m) => !isKingInCheckAfterMove(gameState, m)),
    forbiddenMate: [],
  };
}

// 手駒選択時の合法手 + 禁止された詰み手を生成。doubleMove モード切替を含む。
function legalDropMovesForHandSelect(
  state: CardShogiGameStateInternal,
  pieceType: string,
): { legal: Move[]; forbiddenMate: Move[] } {
  const { gameState } = state;
  const dm = state.doubleMove;

  // 1手目 RELAXED + 王手中: 王手放置を許す pseudo-legal drops を使う必要がある
  const inCheckAndFirstMove =
    dm?.movesLeft === 2 && isInCheck(gameState, gameState.currentPlayer, CARD_SHOGI_VARIANT);

  const baseDrops = inCheckAndFirstMove
    ? getDropMoves(gameState, gameState.currentPlayer, CARD_SHOGI_VARIANT)
    : getLegalDropMoves(gameState, gameState.currentPlayer, CARD_SHOGI_VARIANT);

  const candidates = baseDrops.filter((m) => m.type === "drop" && m.dropPiece === pieceType);

  if (dm && dm.movesLeft === 2) {
    return {
      legal: filterDoubleMoveFirstCandidates(gameState, gameState.currentPlayer, candidates, dm.mateInOneAvailable),
      forbiddenMate: [],
    };
  }
  if (dm && dm.movesLeft === 1) {
    return partitionDoubleMoveSecondCandidates(gameState, gameState.currentPlayer, candidates, dm.mateInOneAvailable);
  }
  return { legal: candidates, forbiddenMate: [] };
}

// Issue #82 (二手指し / 新仕様): 2手目完了時 (もしくは 1手目で詰みが成立した時) に
// double_move カードを finalize する。CONFIRM_PLAY_CARD 時点ではカード消費を遅延しているため、
// ここで初めて: 手札→graveyard、マナ -cardCost、cardPlayEvent push、isPlayingCard=true (演出開始)。
// pendingPlayCardOpponent は null に設定し、COMMIT_PLAY_CARD で再 currentPlayer flip しないようにする
// (currentPlayer は既に makeMoveWithEffects 内 applyMove で opponent に flip 済)。
function finalizeDoubleMoveCardConsumption(
  state: CardShogiGameStateInternal,
  dm: NonNullable<CardShogiGameStateInternal["doubleMove"]>,
): CardShogiGameStateInternal {
  const consumed = consumeNormalCard(
    state.cardState,
    dm.active,
    dm.cardInstance.instanceId,
    dm.cardCost,
  );
  if (!consumed) {
    // 異常系: 二手指し中に手札からカードが消えるケース (バグ or 競合)。
    // 防御的に演出だけスキップして state はそのまま返す (二手指し終了は維持)。
    return state;
  }
  const event: GameEvent = {
    kind: "cardPlayEvent",
    player: dm.active,
    instance: dm.cardInstance,
    at: Date.now(),
  };
  return {
    ...state,
    cardState: consumed,
    eventLog: [...state.eventLog, event],
    isPlayingCard: true,
    pendingPlayCardOpponent: null, // currentPlayer は既に flip 済なので COMMIT_PLAY_CARD で再 flip しない
  };
}

export function reducer(
  state: CardShogiGameStateInternal,
  action: Action,
): CardShogiGameStateInternal {
  // pendingCard 中は通常の駒指しを弾く(ただし target 選択フェーズでは盤面クリックを SELECT_CARD_TARGET に変換するのは呼び出し側)
  switch (action.type) {
    case "DESELECT":
      return { ...state, selectedSquare: null, selectedHandPiece: null, legalMoves: [], forbiddenMateMoves: [] };

    case "SELECT_SQUARE": {
      if (state.cardState.pendingCard) return state;
      // ドロー演出 / カード使用演出中は駒移動禁止 (Issue #82)
      if (state.isDrawing || state.isPlayingCard) return state;
      const { pos } = action;
      const { gameState, selectedSquare, selectedHandPiece, legalMoves } = state;

      if (selectedHandPiece) {
        const dropMove = legalMoves.find(
          (m) =>
            m.type === "drop" &&
            m.to.row === pos.row &&
            m.to.col === pos.col &&
            m.dropPiece === selectedHandPiece,
        );
        if (dropMove) {
          return {
            ...state,
            selectedHandPiece: null,
            selectedSquare: null,
            legalMoves: [],
            forbiddenMateMoves: [],
          };
        }
        return { ...state, selectedHandPiece: null, selectedSquare: null, legalMoves: [], forbiddenMateMoves: [] };
      }

      if (selectedSquare) {
        const targetMove = legalMoves.find(
          (m) => m.type === "move" && m.to.row === pos.row && m.to.col === pos.col && !m.promote,
        );
        const promoteMove = legalMoves.find(
          (m) => m.type === "move" && m.to.row === pos.row && m.to.col === pos.col && m.promote,
        );
        if (targetMove || promoteMove) {
          if (targetMove && promoteMove) {
            return {
              ...state,
              promotionPendingMove: targetMove,
              selectedSquare: null,
              legalMoves: [],
              forbiddenMateMoves: [],
            };
          }
          return { ...state, selectedSquare: null, legalMoves: [], forbiddenMateMoves: [] };
        }

        const { legal, forbiddenMate } = legalMovesForPieceSelect(state, pos);
        const piece = gameState.board[pos.row]?.[pos.col];
        if (piece && piece.owner === gameState.currentPlayer) {
          return { ...state, selectedSquare: pos, legalMoves: legal, forbiddenMateMoves: forbiddenMate };
        }
        return { ...state, selectedSquare: null, legalMoves: [], forbiddenMateMoves: [] };
      }

      const piece = gameState.board[pos.row]?.[pos.col];
      if (piece && piece.owner === gameState.currentPlayer) {
        const { legal, forbiddenMate } = legalMovesForPieceSelect(state, pos);
        return { ...state, selectedSquare: pos, selectedHandPiece: null, legalMoves: legal, forbiddenMateMoves: forbiddenMate };
      }

      return state;
    }

    case "SELECT_HAND_PIECE": {
      if (state.cardState.pendingCard) return state;
      // ドロー演出 / カード使用演出中は手駒選択禁止 (Issue #82)
      if (state.isDrawing || state.isPlayingCard) return state;
      const { legal, forbiddenMate } = legalDropMovesForHandSelect(state, action.pieceType);
      return {
        ...state,
        selectedHandPiece: action.pieceType,
        selectedSquare: null,
        legalMoves: legal,
        forbiddenMateMoves: forbiddenMate,
      };
    }

    case "MAKE_MOVE": {
      // ゲーム終了後の指し手は無視 (防御的)
      if (state.gameState.status !== "active") return state;

      // Issue #132: 待った用 snapshot を push (移動を適用する直前の state を保存)。
      // dm 中も push する。dm 完了後は cardPlayEvent guard で UNDO がブロックされるため、
      // dm-mid snapshot は使われない (= 害なし)。後続の通常 move で evict される。
      const newSnapshots = pushUndoSnapshot(state);

      const dm = state.doubleMove;

      // 二手指し中の 1手目 (movesLeft === 2)
      if (dm && dm.movesLeft === 2) {
        const result = makeMoveWithEffects(state.gameState, state.cardState, action.move, {
          mode: "double_move_first",
          spectatorMode: state.spectatorMode,
        });
        // 1手目で詰みが成立 (相手玉) したら即終了 + カード finalize (新仕様)
        const gameOver = result.gameState.status !== "active";
        if (gameOver) {
          return finalizeDoubleMoveCardConsumption({
            ...state,
            gameState: result.gameState,
            cardState: result.cardState,
            eventLog: [...state.eventLog, ...result.events],
            selectedSquare: null,
            selectedHandPiece: null,
            legalMoves: [],
            forbiddenMateMoves: [],
            promotionPendingMove: null,
            doubleMove: null,
            isCheckBreakAnimating: result.triggeredCheckBreak || state.isCheckBreakAnimating,
            undoSnapshots: newSnapshots,
          }, dm);
        }
        // 詰みでないなら currentPlayer を dm.active (自分) に戻して 2手目へ。カードはまだ消費しない。
        return {
          ...state,
          gameState: { ...result.gameState, currentPlayer: dm.active },
          cardState: result.cardState,
          eventLog: [...state.eventLog, ...result.events],
          selectedSquare: null,
          selectedHandPiece: null,
          legalMoves: [],
          forbiddenMateMoves: [],
          promotionPendingMove: null,
          doubleMove: { ...dm, movesLeft: 1 },
          isCheckBreakAnimating: result.triggeredCheckBreak || state.isCheckBreakAnimating,
          undoSnapshots: newSnapshots,
        };
      }

      // 二手指し中の 2手目 (movesLeft === 1) → カード finalize (新仕様)
      if (dm && dm.movesLeft === 1) {
        const result = makeMoveWithEffects(state.gameState, state.cardState, action.move, {
          mode: "double_move_second",
          spectatorMode: state.spectatorMode,
        });
        return finalizeDoubleMoveCardConsumption({
          ...state,
          gameState: result.gameState, // currentPlayer は applyMove で正しく opponent に
          cardState: result.cardState,
          eventLog: [...state.eventLog, ...result.events],
          selectedSquare: null,
          selectedHandPiece: null,
          legalMoves: [],
          forbiddenMateMoves: [],
          promotionPendingMove: null,
          doubleMove: null, // 二手指し終了
          isCheckBreakAnimating: result.triggeredCheckBreak || state.isCheckBreakAnimating,
          undoSnapshots: newSnapshots,
        }, dm);
      }

      // 通常 MAKE_MOVE
      const result = makeMoveWithEffects(state.gameState, state.cardState, action.move, {
        spectatorMode: state.spectatorMode,
      });
      const stateAfter: CardShogiGameStateInternal = {
        ...state,
        gameState: result.gameState,
        cardState: result.cardState,
        eventLog: [...state.eventLog, ...result.events],
        selectedSquare: null,
        selectedHandPiece: null,
        legalMoves: [],
        forbiddenMateMoves: [],
        promotionPendingMove: null,
        isCheckBreakAnimating: result.triggeredCheckBreak || state.isCheckBreakAnimating,
        undoSnapshots: newSnapshots,
      };
      // Issue #130: 自分の手番が終わった瞬間 = 自動ドロー進捗 +1
      return applyTurnEndEffects(stateAfter, action.move.player);
    }

    case "SET_AI_THINKING":
      return { ...state, isAiThinking: action.thinking };

    case "SHOW_PROMOTION_DIALOG":
      return { ...state, promotionPendingMove: action.move };

    case "CONFIRM_PROMOTION": {
      const pendingMove = state.promotionPendingMove;
      if (!pendingMove) return state;
      if (state.gameState.status !== "active") return state;

      const moveWithPromote: Move = action.promote
        ? { ...pendingMove, promote: true }
        : pendingMove;

      // Issue #132: 待った用 snapshot を push (移動を適用する直前の state を保存)。
      const newSnapshots = pushUndoSnapshot(state);

      const dm = state.doubleMove;

      // 二手指し中の 1手目: mode=double_move_first
      if (dm && dm.movesLeft === 2) {
        const result = makeMoveWithEffects(state.gameState, state.cardState, moveWithPromote, {
          mode: "double_move_first",
          spectatorMode: state.spectatorMode,
        });
        const gameOver = result.gameState.status !== "active";
        if (gameOver) {
          return finalizeDoubleMoveCardConsumption({
            ...state,
            gameState: result.gameState,
            cardState: result.cardState,
            eventLog: [...state.eventLog, ...result.events],
            promotionPendingMove: null,
            selectedSquare: null,
            selectedHandPiece: null,
            legalMoves: [],
            forbiddenMateMoves: [],
            doubleMove: null,
            isCheckBreakAnimating: result.triggeredCheckBreak || state.isCheckBreakAnimating,
            undoSnapshots: newSnapshots,
          }, dm);
        }
        return {
          ...state,
          gameState: { ...result.gameState, currentPlayer: dm.active },
          cardState: result.cardState,
          eventLog: [...state.eventLog, ...result.events],
          promotionPendingMove: null,
          selectedSquare: null,
          selectedHandPiece: null,
          legalMoves: [],
          forbiddenMateMoves: [],
          doubleMove: { ...dm, movesLeft: 1 },
          isCheckBreakAnimating: result.triggeredCheckBreak || state.isCheckBreakAnimating,
          undoSnapshots: newSnapshots,
        };
      }

      // 二手指し中の 2手目: mode=double_move_second → カード finalize (新仕様)
      if (dm && dm.movesLeft === 1) {
        const result = makeMoveWithEffects(state.gameState, state.cardState, moveWithPromote, {
          mode: "double_move_second",
          spectatorMode: state.spectatorMode,
        });
        return finalizeDoubleMoveCardConsumption({
          ...state,
          gameState: result.gameState,
          cardState: result.cardState,
          eventLog: [...state.eventLog, ...result.events],
          promotionPendingMove: null,
          selectedSquare: null,
          selectedHandPiece: null,
          legalMoves: [],
          forbiddenMateMoves: [],
          doubleMove: null,
          isCheckBreakAnimating: result.triggeredCheckBreak || state.isCheckBreakAnimating,
          undoSnapshots: newSnapshots,
        }, dm);
      }

      // 通常 CONFIRM_PROMOTION
      const result = makeMoveWithEffects(state.gameState, state.cardState, moveWithPromote, {
        spectatorMode: state.spectatorMode,
      });
      const stateAfter: CardShogiGameStateInternal = {
        ...state,
        gameState: result.gameState,
        cardState: result.cardState,
        eventLog: [...state.eventLog, ...result.events],
        promotionPendingMove: null,
        selectedSquare: null,
        legalMoves: [],
        forbiddenMateMoves: [],
        isCheckBreakAnimating: result.triggeredCheckBreak || state.isCheckBreakAnimating,
        undoSnapshots: newSnapshots,
      };
      // Issue #130: 自分の手番が終わった瞬間 = 自動ドロー進捗 +1
      return applyTurnEndEffects(stateAfter, moveWithPromote.player);
    }

    case "CANCEL_PROMOTION":
      return {
        ...state,
        promotionPendingMove: null,
        selectedSquare: null,
        legalMoves: [],
        forbiddenMateMoves: [],
      };

    case "RESIGN": {
      const winner: Player = state.gameState.currentPlayer === "sente" ? "gote" : "sente";
      return {
        ...state,
        gameState: { ...state.gameState, status: "resign", winner },
      };
    }

    case "UNDO": {
      // Issue #149: 待った可否ガードを undo-policy.canUndoFromState() に集約。
      // ガード条件 (二手指し中除外 / moveHistory >= 2 / undoSnapshots >= 2 / pendingCard なし /
      //  getUndoScope 非 null) の単一情報源化により、UI 側の canUndo memo と
      // reducer 側のガードが分裂してズレることを構造的に防ぐ (旧バグ: 1 回 UNDO 直後に
      // ボタン活性のまま無反応 = reducer 側のみ undoSnapshots 不足を検知していた事象)。
      //
      // Issue #132 仕様 (待った = スナップショット復元方式) は維持:
      // - snapshots[0] (= 2 ply 前) を gameState/cardState/eventLog に丸ごと適用
      // - ring を空に戻し、UI 一時 state・演出フラグをすべてクリア
      // - リロード後 (undoSnapshots: []) は canUndoFromState で弾かれて待った不可
      //
      // cardOp guard (getUndoScope) を引き続き保持する理由は Issue #132 と同じ:
      // 「カード使用は確定アクション。カード直後の手だけ取り消すことは UI 仕様上許可しない」
      // ため、snapshot に カード効果が残っていても eventLog の scope 判定で block する。
      if (!canUndoFromState(state)) return state;

      const target = state.undoSnapshots[state.undoSnapshots.length - 2];
      return {
        ...state,
        gameState: target.gameState,
        cardState: {
          ...target.cardState,
          // 早指しタイマーは undo 後に自分の番が来た時点で再セットされるため null に統一
          lastTurnStartedAt: { sente: null, gote: null },
          // pendingCard は undo の前提で常にクリア (snapshot にも基本 null だが防御)
          pendingCard: null,
        },
        eventLog: target.eventLog,
        // UI 一時 state はすべてクリア
        selectedSquare: null,
        selectedHandPiece: null,
        legalMoves: [],
        forbiddenMateMoves: [],
        promotionPendingMove: null,
        // 演出フラグもすべて解除 (Issue #130 / #132: 古い演出が再発火しないよう)
        isDrawing: false,
        pendingDrawPlayer: null,
        pendingDrawSource: null,
        isPlayingCard: false,
        pendingPlayCardOpponent: null,
        isCheckBreakAnimating: false,
        // 二手指しは UNDO で復元しない (= 二手指し中の UNDO は冒頭でブロック済)
        doubleMove: null,
        // 復元した分の snapshot を ring から除去
        undoSnapshots: state.undoSnapshots.slice(0, -2),
      };
    }

    case "BEGIN_TURN_TIMER": {
      return {
        ...state,
        cardState: {
          ...state.cardState,
          lastTurnStartedAt: {
            ...state.cardState.lastTurnStartedAt,
            [action.player]: Date.now(),
          },
        },
      };
    }

    case "DRAW_CARD": {
      const deck = state.cardState.deck[action.player];
      if (deck.length === 0) return state;
      if (state.cardState.mana[action.player] < DRAW_COST) return state;
      // 自分の手番でなければドロー禁止
      if (state.gameState.currentPlayer !== action.player) return state;
      // 王手中はドロー禁止 (P10: 王手回避以外の手は禁止)
      if (isInCheck(state.gameState, action.player, CARD_SHOGI_VARIANT)) return state;
      // 既にドロー演出中なら無視 (連発防止)
      if (state.isDrawing) return state;
      // カード使用中(対象駒選択・確認ポップアップ)はドロー禁止 (Issue #82)
      if (state.cardState.pendingCard) return state;
      // カード使用演出中もドロー禁止
      if (state.isPlayingCard) return state;
      // 二手指し中はドロー禁止 (Issue #82)
      if (state.doubleMove) return state;
      const [top, ...rest] = deck;
      // Issue #78: ドロー = 1手相当だが、currentPlayer 反転は演出完了時の COMMIT_DRAW まで保留。
      // これにより演出中は currentPlayer === playerColor のままで AI 自動応手がブロックされる。
      return {
        ...state,
        cardState: {
          ...state.cardState,
          mana: {
            ...state.cardState.mana,
            [action.player]: state.cardState.mana[action.player] - DRAW_COST,
          },
          deck: { ...state.cardState.deck, [action.player]: rest },
          hand: {
            ...state.cardState.hand,
            [action.player]: [...state.cardState.hand[action.player], top],
          },
        },
        // 駒選択状態もクリア
        selectedSquare: null,
        selectedHandPiece: null,
        legalMoves: [],
        forbiddenMateMoves: [],
        eventLog: [
          ...state.eventLog,
          { kind: "drawEvent", player: action.player, instance: top, source: "manual", at: Date.now() },
        ],
        isDrawing: true,
        pendingDrawPlayer: action.player,
        pendingDrawSource: "manual",
      };
    }

    case "COMMIT_DRAW": {
      if (!state.isDrawing || !state.pendingDrawPlayer) return state;
      const drawer = state.pendingDrawPlayer;
      // Issue #130: 発火源で挙動分岐。
      // - manual: currentPlayer 未反転なので反転 + applyTurnEndEffects (drawProgress +1、
      //   しきい値到達なら auto-draw 連鎖発火)
      // - auto: currentPlayer は呼び元 (MAKE_MOVE / CONFIRM_PROMOTION / COMMIT_PLAY_CARD /
      //   COMMIT_DRAW(manual)) で既に反転済 + drawProgress も同箇所で 0 リセット済。
      //   ここではフラグクリア + lastTurnStartedAt クリアのみ行う。
      const source = state.pendingDrawSource ?? "manual";
      const cleared: CardShogiGameStateInternal = {
        ...state,
        cardState: {
          ...state.cardState,
          lastTurnStartedAt: {
            ...state.cardState.lastTurnStartedAt,
            [drawer]: null,
          },
        },
        isDrawing: false,
        pendingDrawPlayer: null,
        pendingDrawSource: null,
      };
      if (source === "auto") {
        return cleared;
      }
      const opponent: Player = drawer === "sente" ? "gote" : "sente";
      const flipped: CardShogiGameStateInternal = {
        ...cleared,
        gameState: { ...cleared.gameState, currentPlayer: opponent },
      };
      return applyTurnEndEffects(flipped, drawer);
    }

    case "BEGIN_PLAY_CARD": {
      if (state.cardState.pendingCard) return state;
      // 二手指し中は他カード使用禁止 (Issue #82)
      if (state.doubleMove) return state;
      // 自分の手番でなければカード使用禁止
      if (state.gameState.currentPlayer !== action.player) return state;
      const card = state.cardState.hand[action.player].find(
        (c) => c.instanceId === action.instanceId,
      );
      if (!card) return state;
      const def = CARD_DEFS[card.defId];
      if (state.cardState.mana[action.player] < def.cost) return state;
      // 同種トラップの重複配置を防止 (Issue #105)。
      // 自分側トラップスロットに同じ defId のトラップが置かれている場合は使用不可。
      if (def.kind === "trap" && hasSameKindTrapPlaced(state.cardState, action.player, card.defId)) {
        return state;
      }
      // カード固有の使用条件 (Issue #82)。CARD_USE_CONDITIONS 未登録のカードは常に使用可。
      const cardUseCondition = CARD_USE_CONDITIONS[card.defId];
      if (cardUseCondition && !cardUseCondition(state.gameState, action.player, state.cardState)) {
        return state;
      }
      // 王手中: カード使用可否は checkUsage フラグで二段ゲート (Issue #82)。
      // - "forbidden":     盤上駒退避系・盤面に作用しないカード等。動的判定スキップ
      // - "conditional":   target ありなら getCheckEscapingSquares で配置先存在を要求。
      //                    target なし conditional は CARD_USE_CONDITIONS で個別判定済
      //                    (現状未使用)
      // - "unconditional": double_move 等。動的判定スキップ (前提保証で常に使用可)
      // 配置先の妥当性 (王手回避になるか) は SELECT_CARD_TARGET / CONFIRM_PLAY_CARD でも検証。
      if (isInCheck(state.gameState, action.player, CARD_SHOGI_VARIANT)) {
        if (def.checkUsage === "forbidden") return state;
        if (def.checkUsage === "conditional" && def.targeting !== "none") {
          const escapingSquares = getCheckEscapingSquares(state.gameState, action.player, card.defId);
          if (escapingSquares.length === 0) return state;
        }
      }
      // Issue #106: 全カードでまず確認ポップアップ (phase="confirm") を出し、
      // 「使用する」確定後に必要なら selectTarget へ遷移する流れに統一する。
      return {
        ...state,
        cardState: {
          ...state.cardState,
          pendingCard: { instance: card, player: action.player, phase: "confirm" },
        },
        // 通常の駒選択状態はクリア
        selectedSquare: null,
        selectedHandPiece: null,
        legalMoves: [],
        forbiddenMateMoves: [],
      };
    }

    case "SELECT_CARD_TARGET": {
      const pending = state.cardState.pendingCard;
      if (!pending) return state;
      // Issue #106: target が確定したら即座に効果適用に進む (確認ステップは
      // 既に手札選択直後の confirm フェーズで踏んでいる)。
      const stateWithTarget: CardShogiGameStateInternal = {
        ...state,
        cardState: {
          ...state.cardState,
          pendingCard: { ...pending, target: action.target, phase: "confirm" },
        },
      };
      return reducer(stateWithTarget, { type: "CONFIRM_PLAY_CARD" });
    }

    case "CONFIRM_PLAY_CARD": {
      const pending = state.cardState.pendingCard;
      if (!pending) return state;
      const def = CARD_DEFS[pending.instance.defId];
      const player = pending.player;
      const opponent: Player = player === "sente" ? "gote" : "sente";

      // Issue #106: ターゲット必須カードで未選択なら、確認ポップアップから
      // selectTarget フェーズに遷移して盤面選択に進む (効果適用はしない)。
      if (def.targeting !== "none" && def.kind !== "trap" && !pending.target) {
        return {
          ...state,
          cardState: {
            ...state.cardState,
            pendingCard: { ...pending, phase: "selectTarget" },
          },
        };
      }

      // 効果適用
      let nextCardState = state.cardState;
      let nextGameState = state.gameState;

      if (def.kind === "trap") {
        // トラップは consumeNormalCard を使わず、マナ消費 + applyTrapSet
        const card = pending.instance;
        if (state.cardState.mana[player] < def.cost) return state;
        const afterMana = {
          ...state.cardState,
          mana: { ...state.cardState.mana, [player]: state.cardState.mana[player] - def.cost },
        };
        const afterSet = applyTrapSet(afterMana, player, card.instanceId);
        if (!afterSet) return state;
        nextCardState = afterSet;
      } else if (def.effectId === "mana_up") {
        const afterConsume = consumeNormalCard(state.cardState, player, pending.instance.instanceId, def.cost);
        if (!afterConsume) return state;
        nextCardState = applyManaUp(afterConsume, player);
      } else if (def.effectId === "pawn_return") {
        if (!pending.target || pending.target.kind !== "square") return state;
        const targetPos = { row: pending.target.row, col: pending.target.col };
        const newGameState = applyPawnReturn(state.gameState, player, targetPos);
        if (!newGameState) return state;
        nextGameState = newGameState;
        const afterConsume = consumeNormalCard(state.cardState, player, pending.instance.instanceId, def.cost);
        if (!afterConsume) return state;
        // 持ち駒に戻った駒は no_promote マークを失う (案A 仕様)
        nextCardState = removeNoPromoteMark(afterConsume, player, targetPos);
      } else if (def.effectId === "piece_return") {
        if (!pending.target || pending.target.kind !== "square") return state;
        const targetPos = { row: pending.target.row, col: pending.target.col };
        const newGameState = applyPieceReturn(state.gameState, player, targetPos);
        if (!newGameState) return state;
        nextGameState = newGameState;
        const afterConsume = consumeNormalCard(state.cardState, player, pending.instance.instanceId, def.cost);
        if (!afterConsume) return state;
        // 持ち駒に戻った駒は no_promote マークを失う (案A 仕様、pawn_return と同じ)
        nextCardState = removeNoPromoteMark(afterConsume, player, targetPos);
      } else if (def.effectId === "double_pawn") {
        if (!pending.target || pending.target.kind !== "square") return state;
        const targetPos = { row: pending.target.row, col: pending.target.col };
        const newGameState = applyDoublePawn(state.gameState, player, targetPos);
        if (!newGameState) return state;
        nextGameState = newGameState;
        const afterConsume = consumeNormalCard(state.cardState, player, pending.instance.instanceId, def.cost);
        if (!afterConsume) return state;
        nextCardState = afterConsume;
      } else if (def.effectId === "double_move") {
        // Issue #82 (二手指し / 新仕様): CONFIRM 時点ではカード消費・マナ減算・
        // cardPlayEvent push を一切行わず、二手指しモードに突入するだけ。
        // 1手目までの操作はキャンセル可能 (CANCEL_DOUBLE_MOVE で preCardState から復元)。
        // 実際のカード消費・mana 減算・cardPlayEvent push・カード使用演出 (isPlayingCard=true)
        // は 2手目完了時に MAKE_MOVE 内で finalize する。
        // 王手中の使用可否は既に BEGIN_PLAY_CARD の use condition で判定済。
        // pendingCard クリア + doubleMove セット のみで return する (下の共通処理は通らない)。
        //
        // 重要: snapshot 用 cardState は **必ず pendingCard を null にした状態** で記録する。
        // そうしないと CANCEL_DOUBLE_MOVE / UNDO_DOUBLE_MOVE_FIRST で復元した際に
        // pendingCard が再セットされ、CardPlayDialog が再表示されてしまう。
        // 「BEGIN_PLAY_CARD 前の状態と等価」になるよう pendingCard を落として保存する。
        const cardStateWithoutPending = { ...state.cardState, pendingCard: null };
        const preCardSnapshot = {
          gameState: state.gameState,
          cardState: cardStateWithoutPending,
          eventLog: state.eventLog,
        };
        return {
          ...state,
          // pendingCard だけクリア。マナ・手札・eventLog は変えない。
          cardState: cardStateWithoutPending,
          selectedSquare: null,
          selectedHandPiece: null,
          legalMoves: [],
          forbiddenMateMoves: [],
          // isPlayingCard も false のまま (中央演出は 2手目完了後に発火)
          doubleMove: {
            active: player,
            movesLeft: 2,
            mateInOneAvailable: hasOneMoveMate(state.gameState, player, CARD_SHOGI_VARIANT),
            cardInstance: pending.instance,
            cardCost: def.cost,
            preFirstMoveState: preCardSnapshot,
            preCardState: preCardSnapshot,
          },
        };
      } else {
        return state;
      }

      // 王手中の最終ガード (Issue #82): 王手中だった場合、適用後の盤面で
      // 王手が解除されている必要がある。解除されない手は不正なので状態変更しない。
      if (isInCheck(state.gameState, player, CARD_SHOGI_VARIANT)) {
        if (isInCheck(nextGameState, player, CARD_SHOGI_VARIANT)) {
          return state;
        }
      }

      // カード使用 = 1手相当。currentPlayer 反転と lastTurnStartedAt クリアは
      // 演出完了 (COMMIT_PLAY_CARD) まで保留する (AI が演出中に動かないようにする)。
      nextCardState = {
        ...nextCardState,
        pendingCard: null,
      };

      // pendingCard クリア + イベントログ
      const event: GameEvent =
        def.kind === "trap"
          ? {
              kind: "trapSetEvent",
              player,
              instance: { instanceId: pending.instance.instanceId, defId: pending.instance.defId, owner: player },
              at: Date.now(),
            }
          : {
              kind: "cardPlayEvent",
              player,
              instance: pending.instance,
              target: pending.target,
              at: Date.now(),
            };

      const nextEventLog = [...state.eventLog, event];

      return {
        ...state,
        gameState: nextGameState,
        cardState: nextCardState,
        // 駒選択状態もクリア
        selectedSquare: null,
        selectedHandPiece: null,
        legalMoves: [],
        forbiddenMateMoves: [],
        eventLog: nextEventLog,
        isPlayingCard: true,
        pendingPlayCardOpponent: opponent,
      };
    }

    case "COMMIT_PLAY_CARD": {
      if (!state.isPlayingCard) return state;

      // Issue #82 (二手指し / 新仕様): finalizeDoubleMoveCardConsumption 経由で
      // isPlayingCard=true がセットされた場合、pendingPlayCardOpponent は null。
      // currentPlayer は既に 2手目 makeMoveWithEffects で flip 済なので、再 flip しない。
      // Issue #130: cardPlayEvent の player を使い、カード使用分の自動ドロー進捗だけ加算する。
      if (!state.pendingPlayCardOpponent) {
        const lastCardPlay = [...state.eventLog]
          .reverse()
          .find((ev): ev is Extract<GameEvent, { kind: "cardPlayEvent" }> => ev.kind === "cardPlayEvent");
        const cleared: CardShogiGameStateInternal = { ...state, isPlayingCard: false };
        return lastCardPlay ? applyTurnEndEffects(cleared, lastCardPlay.player) : cleared;
      }

      const opponent = state.pendingPlayCardOpponent;
      const player: Player = opponent === "sente" ? "gote" : "sente";
      const stateAfter: CardShogiGameStateInternal = {
        ...state,
        gameState: { ...state.gameState, currentPlayer: opponent },
        cardState: {
          ...state.cardState,
          lastTurnStartedAt: {
            ...state.cardState.lastTurnStartedAt,
            [player]: null,
          },
        },
        isPlayingCard: false,
        pendingPlayCardOpponent: null,
      };
      // Issue #130: カード使用も「自分の手番が終わった瞬間」に該当 → drawProgress +1
      return applyTurnEndEffects(stateAfter, player);
    }

    case "CANCEL_PLAY_CARD": {
      if (!state.cardState.pendingCard) return state;
      return {
        ...state,
        cardState: { ...state.cardState, pendingCard: null },
      };
    }

    case "RESET_TURN_TIMER":
      return {
        ...state,
        cardState: {
          ...state.cardState,
          lastTurnStartedAt: {
            ...state.cardState.lastTurnStartedAt,
            [action.player]: Date.now(),
          },
        },
      };

    case "COMMIT_CHECK_BREAK":
      if (!state.isCheckBreakAnimating) return state;
      return { ...state, isCheckBreakAnimating: false };

    // Issue #82 (二手指し): 1手目を取り消して preState から完全復元する。
    // movesLeft===1 の時のみ動作。詰み確定後・演出中は不可。
    case "UNDO_DOUBLE_MOVE_FIRST": {
      const dm = state.doubleMove;
      if (!dm) return state;
      if (dm.movesLeft !== 1) return state;
      // 詰み確定後は戻せない (1手目で詰めば即終了)
      if (state.gameState.status !== "active") return state;
      // 演出中は戻せない (UI ボタンも disabled だが防御的にガード)
      if (state.isCheckBreakAnimating) return state;
      if (state.isPlayingCard) return state;

      // 1手目だけを取り消す → preFirstMoveState から復元、doubleMove は維持 (movesLeft=2 へ)
      // pendingCard は防御的に null クリア (snapshot に残っていた場合の CardPlayDialog 再表示防止)
      return {
        ...state,
        gameState: dm.preFirstMoveState.gameState,
        cardState: { ...dm.preFirstMoveState.cardState, pendingCard: null },
        eventLog: dm.preFirstMoveState.eventLog,
        selectedSquare: null,
        selectedHandPiece: null,
        legalMoves: [],
        forbiddenMateMoves: [],
        promotionPendingMove: null,
        // 演出系フラグも明示リセット (preFirstMoveState 時点では当然 false)
        isCheckBreakAnimating: false,
        doubleMove: { ...dm, movesLeft: 2 },
      };
    }

    case "CANCEL_DOUBLE_MOVE": {
      const dm = state.doubleMove;
      if (!dm) return state;
      // 詰み確定後はキャンセル不可 (game over で doubleMove は既に null になっているはずだが防御的)
      if (state.gameState.status !== "active") return state;
      // 演出中はキャンセル不可
      if (state.isCheckBreakAnimating) return state;
      if (state.isPlayingCard) return state;

      // カード使用自体を取り消す → preCardState から完全復元、doubleMove=null
      // pendingCard は防御的に null クリア (snapshot に残っていた場合の CardPlayDialog 再表示防止)
      return {
        ...state,
        gameState: dm.preCardState.gameState,
        cardState: { ...dm.preCardState.cardState, pendingCard: null },
        eventLog: dm.preCardState.eventLog,
        selectedSquare: null,
        selectedHandPiece: null,
        legalMoves: [],
        forbiddenMateMoves: [],
        promotionPendingMove: null,
        isCheckBreakAnimating: false,
        doubleMove: null,
      };
    }

    // Issue #193 / PR1a: CPU vs CPU 観戦モードのポーズ機能。
    // spectatorMode === false の人間プレイ時は完全に no-op (= 常に既存挙動を保持)。
    // 観戦時のみ isPaused フラグを切替えるが、reducer は状態を持つだけで副作用は生まない。
    // AI 自動応手 useEffect 側がフラグを見て request abort と dispatch ガードを実施する。
    case "PAUSE_GAME":
      if (!state.spectatorMode) return state;
      return { ...state, isPaused: true };

    case "RESUME_GAME":
      if (!state.spectatorMode) return state;
      return { ...state, isPaused: false };

    // Issue #193 / PR1a (C-5): 観戦モード固有の強制引き分け終局。
    // SPECTATOR_MAX_MOVES 到達で use-card-shogi-game の useEffect から dispatch される。
    // GameStatus に "spectator_max_moves" を追加し winner="draw" 扱い。
    case "END_SPECTATOR_GAME":
      if (!state.spectatorMode) return state;
      if (state.gameState.status !== "active") return state;
      return {
        ...state,
        gameState: { ...state.gameState, status: "spectator_max_moves", winner: "draw" },
      };

    default:
      return state;
  }
}
