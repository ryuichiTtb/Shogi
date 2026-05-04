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
import { applyMove, createInitialGameState } from "@/lib/shogi/board";
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

import type { CardAction, CardGameState, GameEvent } from "@/lib/shogi/cards/types";
import {
  CARD_DEFS,
  CARD_USE_CONDITIONS,
  DRAW_COST,
  MANA_PER_TURN,
  MANA_FAST_BONUS,
  FAST_THRESHOLD_MS,
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
  // Issue #82 (二手指し): 1手目を取り消して preState から復元するアクション。
  | { type: "UNDO_DOUBLE_MOVE_FIRST" }
  | { type: "BEGIN_TURN_TIMER"; player: Player };

export type Action = ShogiAction | CardAction;

export interface CardShogiGameStateInternal {
  gameState: GameState;
  selectedSquare: Position | null;
  selectedHandPiece: string | null;
  legalMoves: Move[];
  isAiThinking: boolean;
  promotionPendingMove: Move | null;
  cardState: CardGameState;
  eventLog: GameEvent[];
  // Issue #78: ドロー演出中フラグ。DRAW_CARD で true、演出完了時の COMMIT_DRAW で false。
  // true の間は currentPlayer 反転を保留し、AI 自動応手をブロックする。
  isDrawing: boolean;
  pendingDrawPlayer: Player | null;
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
  // - 2手目完了で null クリア (MAKE_MOVE)
  // - 「戻す」ボタン (UNDO_DOUBLE_MOVE_FIRST) で preState から復元、movesLeft=2 へ
  // 永続化しない (DB save は 2手目完了で 1回のみ)。リロード時は in-memory のみ消失し
  // DB は カード使用前 (二手指し中は save スキップなのでカード未使用) に戻る。
  doubleMove: {
    active: Player;
    movesLeft: 1 | 2;
    mateInOneAvailable: boolean;
    preState: {
      gameState: GameState;
      cardState: CardGameState;
      eventLog: GameEvent[];
    };
  } | null;
}

// 移動処理のモード切替 (Issue #82 二手指し)。
// - "normal": 通常の指し手 (マナチャージ + 早指しタイマークリア)
// - "double_move_first": 二手指しの 1手目 (マナチャージなし + タイマークリアなし、ターン継続中)
// - "double_move_second": 二手指しの 2手目 (マナチャージなし、タイマークリアあり、ターン交代)
// 二手指しはカード使用扱いのため、1手目・2手目とも通常のマナチャージ (+1〜+2) は発生しない
// (カードコスト -6 のみ消費、これは CONFIRM_PLAY_CARD 側で処理済み)。
export type MakeMoveMode = "normal" | "double_move_first" | "double_move_second";

// 移動 + マナチャージ + トラップフィルタ を一括適用。
// CONFIRM_PROMOTION と MAKE_MOVE の両方から呼ばれる。
function makeMoveWithEffects(
  gameState: GameState,
  cardState: CardGameState,
  move: Move,
  options?: { mode?: MakeMoveMode },
): {
  gameState: GameState;
  cardState: CardGameState;
  events: GameEvent[];
  finalMove: Move;
  // 王手崩しトラップが発動した場合のみ true。MAKE_MOVE 側で isCheckBreakAnimating をセットする。
  triggeredCheckBreak: boolean;
} {
  const mode: MakeMoveMode = options?.mode ?? "normal";
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
    const isFastMove =
      lastStarted !== null && Date.now() - lastStarted < FAST_THRESHOLD_MS;
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

// Issue #82 (二手指し): 1手目候補のフィルタ。
// 「玉が即座に取られない」+「∃ 2手目 (詰み禁止フィルタ済) または 1手目で詰み」を満たす手のみ返す。
// 王手中の場合は王手放置を許す (RELAXED ルール)、王手中でない場合は通常の合法性 + 上記条件。
function filterDoubleMoveFirstCandidates(
  gameState: GameState,
  player: Player,
  candidates: Move[],
  mateInOneAvailable: boolean,
): Move[] {
  const opponent: Player = player === "sente" ? "gote" : "sente";
  const inCheck = isInCheck(gameState, player, CARD_SHOGI_VARIANT);

  return candidates.filter((m1) => {
    // 王手中でない場合: 通常の合法性 (自玉の王手放置不可)
    if (!inCheck && isKingInCheckAfterMove(gameState, m1)) return false;

    const after1 = applyMove(gameState, m1);

    // RELAXED でも玉が直接取られる手は除外 (King-safe)
    const king = findKing(after1.board, player, CARD_SHOGI_VARIANT.boardSize);
    if (!king) return false;

    // 1手目で相手玉に詰みなら 2手目不要 → OK
    if (isCheckmate(after1, opponent, CARD_SHOGI_VARIANT)) return true;

    // 2手目候補 ≥ 1 必須 (詰み禁止フィルタ済)
    const second = legalSecondMoves(after1, player, mateInOneAvailable);
    return second.length > 0;
  });
}

// 2手目候補 (詰み禁止フィルタ済)。getLegalMoves(全合法手) + drop の合法手の合計
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

// 2手目フィルタ: 通常の合法性 + (mateInOneAvailable=false なら詰み手除外)
function filterDoubleMoveSecondCandidates(
  gameState: GameState,
  player: Player,
  candidates: Move[],
  mateInOneAvailable: boolean,
): Move[] {
  const opponent: Player = player === "sente" ? "gote" : "sente";
  return candidates.filter((m) => {
    if (isKingInCheckAfterMove(gameState, m)) return false;
    if (mateInOneAvailable) return true;
    return !isCheckmate(applyMove(gameState, m), opponent, CARD_SHOGI_VARIANT);
  });
}

// 駒選択時の合法手生成。doubleMove モード切替を含む。
// noPromote マークと doubleMove フィルタを統一して適用。
function legalMovesForPieceSelect(
  state: CardShogiGameStateInternal,
  pos: Position,
): Move[] {
  const { gameState } = state;
  const piece = gameState.board[pos.row]?.[pos.col];
  if (!piece || piece.owner !== gameState.currentPlayer) return [];

  const moves = getPieceMoves(gameState, pos, gameState.currentPlayer, CARD_SHOGI_VARIANT);
  const noPromote = hasNoPromoteMark(state.cardState, gameState.currentPlayer, pos);
  let filtered = moves.filter((m) => !(noPromote && m.type === "move" && m.promote));

  const dm = state.doubleMove;
  if (dm && dm.movesLeft === 2) {
    filtered = filterDoubleMoveFirstCandidates(gameState, gameState.currentPlayer, filtered, dm.mateInOneAvailable);
  } else if (dm && dm.movesLeft === 1) {
    filtered = filterDoubleMoveSecondCandidates(gameState, gameState.currentPlayer, filtered, dm.mateInOneAvailable);
  } else {
    filtered = filtered.filter((m) => !isKingInCheckAfterMove(gameState, m));
  }
  return filtered;
}

// 手駒選択時の合法手生成。doubleMove モード切替を含む。
function legalDropMovesForHandSelect(
  state: CardShogiGameStateInternal,
  pieceType: string,
): Move[] {
  const { gameState } = state;
  const dm = state.doubleMove;

  // 1手目 RELAXED + 王手中: 王手放置を許す pseudo-legal drops を使う必要がある
  const inCheckAndFirstMove =
    dm?.movesLeft === 2 && isInCheck(gameState, gameState.currentPlayer, CARD_SHOGI_VARIANT);

  const baseDrops = inCheckAndFirstMove
    ? getDropMoves(gameState, gameState.currentPlayer, CARD_SHOGI_VARIANT)
    : getLegalDropMoves(gameState, gameState.currentPlayer, CARD_SHOGI_VARIANT);

  let candidates = baseDrops.filter((m) => m.type === "drop" && m.dropPiece === pieceType);

  if (dm && dm.movesLeft === 2) {
    candidates = filterDoubleMoveFirstCandidates(gameState, gameState.currentPlayer, candidates, dm.mateInOneAvailable);
  } else if (dm && dm.movesLeft === 1) {
    // getLegalDropMoves は王手放置を既に除外済なので、ここでは詰み禁止のみ追加
    candidates = filterDoubleMoveSecondCandidates(gameState, gameState.currentPlayer, candidates, dm.mateInOneAvailable);
  }
  return candidates;
}

export function reducer(
  state: CardShogiGameStateInternal,
  action: Action,
): CardShogiGameStateInternal {
  // pendingCard 中は通常の駒指しを弾く(ただし target 選択フェーズでは盤面クリックを SELECT_CARD_TARGET に変換するのは呼び出し側)
  switch (action.type) {
    case "DESELECT":
      return { ...state, selectedSquare: null, selectedHandPiece: null, legalMoves: [] };

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
          };
        }
        return { ...state, selectedHandPiece: null, selectedSquare: null, legalMoves: [] };
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
            };
          }
          return { ...state, selectedSquare: null, legalMoves: [] };
        }

        const filtered = legalMovesForPieceSelect(state, pos);
        const piece = gameState.board[pos.row]?.[pos.col];
        if (piece && piece.owner === gameState.currentPlayer) {
          return { ...state, selectedSquare: pos, legalMoves: filtered };
        }
        return { ...state, selectedSquare: null, legalMoves: [] };
      }

      const piece = gameState.board[pos.row]?.[pos.col];
      if (piece && piece.owner === gameState.currentPlayer) {
        const filtered = legalMovesForPieceSelect(state, pos);
        return { ...state, selectedSquare: pos, selectedHandPiece: null, legalMoves: filtered };
      }

      return state;
    }

    case "SELECT_HAND_PIECE": {
      if (state.cardState.pendingCard) return state;
      // ドロー演出 / カード使用演出中は手駒選択禁止 (Issue #82)
      if (state.isDrawing || state.isPlayingCard) return state;
      const movesForPiece = legalDropMovesForHandSelect(state, action.pieceType);
      return {
        ...state,
        selectedHandPiece: action.pieceType,
        selectedSquare: null,
        legalMoves: movesForPiece,
      };
    }

    case "MAKE_MOVE": {
      // ゲーム終了後の指し手は無視 (防御的)
      if (state.gameState.status !== "active") return state;

      const dm = state.doubleMove;

      // 二手指し中の 1手目 (movesLeft === 2)
      if (dm && dm.movesLeft === 2) {
        const result = makeMoveWithEffects(state.gameState, state.cardState, action.move, {
          mode: "double_move_first",
        });
        // 1手目で詰みが成立 (相手玉) したら即終了
        const gameOver = result.gameState.status !== "active";
        return {
          ...state,
          // 1手目で詰みなら gameState はそのまま (status="checkmate")。
          // 詰みでないなら currentPlayer を dm.active (自分) に戻して 2手目へ。
          gameState: gameOver
            ? result.gameState
            : { ...result.gameState, currentPlayer: dm.active },
          cardState: result.cardState,
          eventLog: [...state.eventLog, ...result.events],
          selectedSquare: null,
          selectedHandPiece: null,
          legalMoves: [],
          promotionPendingMove: null,
          doubleMove: gameOver ? null : { ...dm, movesLeft: 1 },
          isCheckBreakAnimating: result.triggeredCheckBreak || state.isCheckBreakAnimating,
        };
      }

      // 二手指し中の 2手目 (movesLeft === 1)
      if (dm && dm.movesLeft === 1) {
        const result = makeMoveWithEffects(state.gameState, state.cardState, action.move, {
          mode: "double_move_second",
        });
        return {
          ...state,
          gameState: result.gameState, // currentPlayer は applyMove で正しく opponent に
          cardState: result.cardState,
          eventLog: [...state.eventLog, ...result.events],
          selectedSquare: null,
          selectedHandPiece: null,
          legalMoves: [],
          promotionPendingMove: null,
          doubleMove: null, // 二手指し終了
          isCheckBreakAnimating: result.triggeredCheckBreak || state.isCheckBreakAnimating,
        };
      }

      // 通常 MAKE_MOVE
      const result = makeMoveWithEffects(state.gameState, state.cardState, action.move);
      return {
        ...state,
        gameState: result.gameState,
        cardState: result.cardState,
        eventLog: [...state.eventLog, ...result.events],
        selectedSquare: null,
        selectedHandPiece: null,
        legalMoves: [],
        promotionPendingMove: null,
        isCheckBreakAnimating: result.triggeredCheckBreak || state.isCheckBreakAnimating,
      };
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

      const dm = state.doubleMove;

      // 二手指し中の 1手目: mode=double_move_first
      if (dm && dm.movesLeft === 2) {
        const result = makeMoveWithEffects(state.gameState, state.cardState, moveWithPromote, {
          mode: "double_move_first",
        });
        const gameOver = result.gameState.status !== "active";
        return {
          ...state,
          gameState: gameOver
            ? result.gameState
            : { ...result.gameState, currentPlayer: dm.active },
          cardState: result.cardState,
          eventLog: [...state.eventLog, ...result.events],
          promotionPendingMove: null,
          selectedSquare: null,
          selectedHandPiece: null,
          legalMoves: [],
          doubleMove: gameOver ? null : { ...dm, movesLeft: 1 },
          isCheckBreakAnimating: result.triggeredCheckBreak || state.isCheckBreakAnimating,
        };
      }

      // 二手指し中の 2手目: mode=double_move_second
      if (dm && dm.movesLeft === 1) {
        const result = makeMoveWithEffects(state.gameState, state.cardState, moveWithPromote, {
          mode: "double_move_second",
        });
        return {
          ...state,
          gameState: result.gameState,
          cardState: result.cardState,
          eventLog: [...state.eventLog, ...result.events],
          promotionPendingMove: null,
          selectedSquare: null,
          selectedHandPiece: null,
          legalMoves: [],
          doubleMove: null,
          isCheckBreakAnimating: result.triggeredCheckBreak || state.isCheckBreakAnimating,
        };
      }

      // 通常 CONFIRM_PROMOTION
      const result = makeMoveWithEffects(state.gameState, state.cardState, moveWithPromote);
      return {
        ...state,
        gameState: result.gameState,
        cardState: result.cardState,
        eventLog: [...state.eventLog, ...result.events],
        promotionPendingMove: null,
        selectedSquare: null,
        legalMoves: [],
        isCheckBreakAnimating: result.triggeredCheckBreak || state.isCheckBreakAnimating,
      };
    }

    case "CANCEL_PROMOTION":
      return {
        ...state,
        promotionPendingMove: null,
        selectedSquare: null,
        legalMoves: [],
      };

    case "RESIGN": {
      const winner: Player = state.gameState.currentPlayer === "sente" ? "gote" : "sente";
      return {
        ...state,
        gameState: { ...state.gameState, status: "resign", winner },
      };
    }

    case "UNDO": {
      // Issue #82 (二手指し): 二手指し中は通常の「待った」を不可。
      // 1手目戻しは UNDO_DOUBLE_MOVE_FIRST 専用アクションを使う。
      if (state.doubleMove) return state;
      // 駒指しの最後の 2 手 (プレイヤー + AI) を巻き戻す。
      // 仕様 (P28): 過去 2 手の間にカード操作 (drawCard/cardPlay/trapSet/trapTrigger) が含まれる場合は undo 不可。
      // 含まれない場合は、移動巻き戻し + その 2 手分のターンチャージマナを巻き戻す。
      const history = state.gameState.moveHistory;
      if (history.length < 2) return state;

      // eventLog の末尾から moveEvent 2 件分のスコープを確認し、間にカード操作があるか判定
      const log = state.eventLog;
      let movesSeen = 0;
      let hasCardOp = false;
      let scopeStartIndex = 0; // この index 以降が undo 対象スコープ
      for (let i = log.length - 1; i >= 0; i--) {
        const ev = log[i];
        if (ev.kind === "moveEvent") {
          movesSeen++;
          if (movesSeen === 2) {
            scopeStartIndex = i;
            break;
          }
        } else if (
          ev.kind === "cardPlayEvent" ||
          ev.kind === "drawEvent" ||
          ev.kind === "trapSetEvent" ||
          ev.kind === "trapTriggerEvent"
        ) {
          hasCardOp = true;
          break;
        }
      }
      if (hasCardOp) return state;
      if (movesSeen < 2) return state;

      // 巻き戻すターンチャージマナを集計
      let revertSenteMana = 0;
      let revertGoteMana = 0;
      for (let i = scopeStartIndex; i < log.length; i++) {
        const ev = log[i];
        if (ev.kind === "manaChargeEvent" && ev.reason === "turn") {
          if (ev.player === "sente") revertSenteMana += ev.amount;
          else revertGoteMana += ev.amount;
        }
      }

      // 駒指しを 2 手前まで再適用
      const initialState = createInitialGameState(CARD_SHOGI_VARIANT);
      const movesToApply = history.slice(0, -2);
      let newGameState = initialState;
      for (const m of movesToApply) {
        newGameState = applyMove(newGameState, m);
      }

      return {
        ...state,
        gameState: newGameState,
        selectedSquare: null,
        selectedHandPiece: null,
        legalMoves: [],
        promotionPendingMove: null,
        cardState: {
          ...state.cardState,
          mana: {
            sente: Math.max(0, state.cardState.mana.sente - revertSenteMana),
            gote: Math.max(0, state.cardState.mana.gote - revertGoteMana),
          },
          // 早指しタイマーは undo 後に自分の番が来た時点で再セットされるため null に
          lastTurnStartedAt: { sente: null, gote: null },
          // pendingCard は undo の前提で常にクリア
          pendingCard: null,
        },
        // eventLog も undo スコープ前まで戻す
        eventLog: log.slice(0, scopeStartIndex),
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
        eventLog: [
          ...state.eventLog,
          { kind: "drawEvent", player: action.player, instance: top, at: Date.now() },
        ],
        isDrawing: true,
        pendingDrawPlayer: action.player,
      };
    }

    case "COMMIT_DRAW": {
      if (!state.isDrawing || !state.pendingDrawPlayer) return state;
      const drawer = state.pendingDrawPlayer;
      const opponent: Player = drawer === "sente" ? "gote" : "sente";
      return {
        ...state,
        gameState: { ...state.gameState, currentPlayer: opponent },
        cardState: {
          ...state.cardState,
          lastTurnStartedAt: {
            ...state.cardState.lastTurnStartedAt,
            [drawer]: null,
          },
        },
        isDrawing: false,
        pendingDrawPlayer: null,
      };
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
      const useCond = CARD_USE_CONDITIONS[card.defId];
      if (useCond && !useCond(state.gameState, action.player, state.cardState)) {
        return state;
      }
      // 王手中: カード使用は王手回避できる場合のみ可。
      // (Issue #82: 「王手中一律不可」から「王手回避になるカードのみ可」に変更)
      // 配置先のチェックは SELECT_CARD_TARGET / CONFIRM_PLAY_CARD でも行う。
      // double_move (二手指し) は即時の盤面効果がなく getCheckEscapingSquares が
      // 常に空を返すため、この secondary ガードは skip する。
      // (王手中の使用可否は CARD_USE_CONDITIONS.double_move = canEscapeCheckWithDoubleMove で判定済)
      if (isInCheck(state.gameState, action.player, CARD_SHOGI_VARIANT) && card.defId !== "double_move") {
        const escapingSquares = getCheckEscapingSquares(state.gameState, action.player, card.defId);
        if (escapingSquares.length === 0) return state;
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
        // Issue #82 (二手指し): カード消費 + マナ -6 + 二手指しモード突入。
        // 盤面は変化しない。1手目・2手目はカード使用後の MAKE_MOVE で順に処理される。
        const afterConsume = consumeNormalCard(state.cardState, player, pending.instance.instanceId, def.cost);
        if (!afterConsume) return state;
        nextCardState = afterConsume;
        // gameState は変化しないが、王手中ガードが evaluateGameEnd の結果を要求するためそのまま継承
      } else {
        return state;
      }

      // 王手中の最終ガード (Issue #82): 王手中だった場合、適用後の盤面で
      // 王手が解除されている必要がある。解除されない手は不正なので状態変更しない。
      // double_move は即時の盤面効果がなく 2手以内に解消する設計のため、このガード対象外。
      // (王手中の使用可否は既に BEGIN_PLAY_CARD の use condition で判定済)
      if (def.effectId !== "double_move" && isInCheck(state.gameState, player, CARD_SHOGI_VARIANT)) {
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

      // Issue #82 (二手指し): double_move カード使用直後に二手指しモードを開始
      const isDoubleMove = def.effectId === "double_move";
      const doubleMove = isDoubleMove
        ? {
            active: player,
            movesLeft: 2 as const,
            mateInOneAvailable: hasOneMoveMate(state.gameState, player, CARD_SHOGI_VARIANT),
            // preState はカード使用直後 (cardPlayEvent 含む) のスナップショット。
            // 戻すボタンでカード使用は維持しつつ 1手目だけ取り消せるように。
            preState: {
              gameState: nextGameState,
              cardState: nextCardState,
              eventLog: nextEventLog,
            },
          }
        : state.doubleMove;

      return {
        ...state,
        gameState: nextGameState,
        cardState: nextCardState,
        // 駒選択状態もクリア
        selectedSquare: null,
        selectedHandPiece: null,
        legalMoves: [],
        eventLog: nextEventLog,
        isPlayingCard: true,
        pendingPlayCardOpponent: opponent,
        doubleMove,
      };
    }

    case "COMMIT_PLAY_CARD": {
      if (!state.isPlayingCard || !state.pendingPlayCardOpponent) return state;

      // Issue #82 (二手指し): doubleMove モード中は currentPlayer 反転と
      // lastTurnStartedAt クリアを skip (これらは 2手目完了で MAKE_MOVE 内 makeMoveWithEffects が処理)
      if (state.doubleMove) {
        return {
          ...state,
          isPlayingCard: false,
          pendingPlayCardOpponent: null,
        };
      }

      const opponent = state.pendingPlayCardOpponent;
      const player: Player = opponent === "sente" ? "gote" : "sente";
      return {
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

      return {
        ...state,
        gameState: dm.preState.gameState,
        cardState: dm.preState.cardState,
        eventLog: dm.preState.eventLog,
        selectedSquare: null,
        selectedHandPiece: null,
        legalMoves: [],
        promotionPendingMove: null,
        // 演出系フラグも明示リセット (preState 時点では当然 false)
        isCheckBreakAnimating: false,
        doubleMove: { ...dm, movesLeft: 2 },
      };
    }

    default:
      return state;
  }
}
