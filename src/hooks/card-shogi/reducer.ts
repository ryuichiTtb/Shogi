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
import { getPieceMoves, getLegalDropMoves, isInCheck } from "@/lib/shogi/moves";
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

        const piece = gameState.board[pos.row]?.[pos.col];
        if (piece && piece.owner === gameState.currentPlayer) {
          const moves = getPieceMoves(gameState, pos, gameState.currentPlayer, CARD_SHOGI_VARIANT);
          const noPromote = hasNoPromoteMark(state.cardState, gameState.currentPlayer, pos);
          const filtered = moves
            .filter((m) => !(noPromote && m.type === "move" && m.promote))
            .filter((m) => !isKingInCheckAfterMove(gameState, m));
          return { ...state, selectedSquare: pos, legalMoves: filtered };
        }
        return { ...state, selectedSquare: null, legalMoves: [] };
      }

      const piece = gameState.board[pos.row]?.[pos.col];
      if (piece && piece.owner === gameState.currentPlayer) {
        const moves = getPieceMoves(gameState, pos, gameState.currentPlayer, CARD_SHOGI_VARIANT);
        const filtered = moves.filter((m) => !isKingInCheckAfterMove(gameState, m));
        return { ...state, selectedSquare: pos, selectedHandPiece: null, legalMoves: filtered };
      }

      return state;
    }

    case "SELECT_HAND_PIECE": {
      if (state.cardState.pendingCard) return state;
      // ドロー演出 / カード使用演出中は手駒選択禁止 (Issue #82)
      if (state.isDrawing || state.isPlayingCard) return state;
      const { gameState } = state;
      const dropMoves = getLegalDropMoves(gameState, gameState.currentPlayer, CARD_SHOGI_VARIANT);
      const movesForPiece = dropMoves.filter((m) => m.dropPiece === action.pieceType);
      return {
        ...state,
        selectedHandPiece: action.pieceType,
        selectedSquare: null,
        legalMoves: movesForPiece,
      };
    }

    case "MAKE_MOVE": {
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
      const moveWithPromote: Move = action.promote
        ? { ...pendingMove, promote: true }
        : pendingMove;
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
      if (isInCheck(state.gameState, action.player, CARD_SHOGI_VARIANT)) {
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

      return {
        ...state,
        gameState: nextGameState,
        cardState: nextCardState,
        // 駒選択状態もクリア
        selectedSquare: null,
        selectedHandPiece: null,
        legalMoves: [],
        eventLog: [...state.eventLog, event],
        isPlayingCard: true,
        pendingPlayCardOpponent: opponent,
      };
    }

    case "COMMIT_PLAY_CARD": {
      if (!state.isPlayingCard || !state.pendingPlayCardOpponent) return state;
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

    default:
      return state;
  }
}
