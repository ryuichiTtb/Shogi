"use client";

import { useReducer, useCallback, useEffect, useRef } from "react";
import type {
  GameConfig,
  GameState,
  Move,
  Player,
  Position,
} from "@/lib/shogi/types";
import { applyMove } from "@/lib/shogi/board";
import {
  getPieceMoves,
  getLegalDropMoves,
  isInCheck,
} from "@/lib/shogi/moves";
import { evaluateGameEnd } from "@/lib/shogi/rules";
import { moveToNotation } from "@/lib/shogi/notation";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";
import { getAiMove } from "@/app/actions/ai";
import { updateGameStatus, saveCardShogiMove } from "@/app/actions/game";

import type {
  CardAction,
  CardGameState,
  CardTarget,
  GameEvent,
} from "@/lib/shogi/cards/types";
import { CARD_DEFS, PHASE0_DRAW_COST, PHASE0_MANA_PER_TURN, PHASE0_MANA_FAST_BONUS, PHASE0_FAST_THRESHOLD_MS } from "@/lib/shogi/cards/definitions";
import {
  applyManaUp,
  applyPawnReturn,
  applyTrapSet,
  applyTrapClear,
  consumeNormalCard,
} from "@/lib/shogi/cards/effects";

type ShogiAction =
  | { type: "SELECT_SQUARE"; pos: Position }
  | { type: "DESELECT" }
  | { type: "SELECT_HAND_PIECE"; pieceType: string }
  | { type: "MAKE_MOVE"; move: Move }
  | { type: "SET_AI_THINKING"; thinking: boolean }
  | { type: "SHOW_PROMOTION_DIALOG"; move: Move }
  | { type: "CONFIRM_PROMOTION"; promote: boolean }
  | { type: "CANCEL_PROMOTION" }
  | { type: "RESIGN" }
  | { type: "BEGIN_TURN_TIMER"; player: Player };

type Action = ShogiAction | CardAction;

interface CardShogiGameStateInternal {
  gameState: GameState;
  selectedSquare: Position | null;
  selectedHandPiece: string | null;
  legalMoves: Move[];
  isAiThinking: boolean;
  promotionPendingMove: Move | null;
  cardState: CardGameState;
  eventLog: GameEvent[];
}

// 移動 + マナチャージ + トラップフィルタ を一括適用。
// CONFIRM_PROMOTION と MAKE_MOVE の両方から呼ばれる。
function makeMoveWithEffects(
  gameState: GameState,
  cardState: CardGameState,
  move: Move,
): {
  gameState: GameState;
  cardState: CardGameState;
  events: GameEvent[];
  finalMove: Move;
} {
  const opponent: Player = move.player === "sente" ? "gote" : "sente";
  const events: GameEvent[] = [];

  // 1. トラップフィルタ: 相手のトラップが no_promote でこの手が成りなら、promote を強制 false
  let finalMove = move;
  let cardStateNext = cardState;
  const opponentTrap = cardState.trap[opponent];
  if (move.promote && opponentTrap && opponentTrap.defId === "no_promote") {
    finalMove = { ...move, promote: false };
    cardStateNext = applyTrapClear(cardStateNext, opponent);
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
  const evaluated = evaluateGameEnd(nextGameState, CARD_SHOGI_VARIANT);
  events.push({ kind: "moveEvent", move: finalMove, at: Date.now() });

  // 3. マナチャージ(指した側、早指し判定)
  const lastStarted = cardStateNext.lastTurnStartedAt[move.player];
  const isFastMove =
    lastStarted !== null && Date.now() - lastStarted < PHASE0_FAST_THRESHOLD_MS;
  const manaAmount =
    PHASE0_MANA_PER_TURN + (isFastMove ? PHASE0_MANA_FAST_BONUS : 0);
  cardStateNext = {
    ...cardStateNext,
    mana: {
      ...cardStateNext.mana,
      [move.player]: Math.min(
        cardStateNext.manaCap,
        cardStateNext.mana[move.player] + manaAmount,
      ),
    },
    // 指した側のタイマーはクリア。次の自分の番開始時に再セット
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
    at: Date.now(),
  });

  return {
    gameState: evaluated,
    cardState: cardStateNext,
    events,
    finalMove,
  };
}

function isKingInCheckAfterMove(gameState: GameState, move: Move): boolean {
  const nextState = applyMove(gameState, move);
  return isInCheck(nextState, move.player, CARD_SHOGI_VARIANT);
}

function reducer(
  state: CardShogiGameStateInternal,
  action: Action,
): CardShogiGameStateInternal {
  // pendingCard 中は通常の駒指しを弾く(ただし target 選択フェーズでは盤面クリックを SELECT_CARD_TARGET に変換するのは呼び出し側)
  switch (action.type) {
    case "DESELECT":
      return { ...state, selectedSquare: null, selectedHandPiece: null, legalMoves: [] };

    case "SELECT_SQUARE": {
      if (state.cardState.pendingCard) return state;
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
          const filtered = moves.filter((m) => !isKingInCheckAfterMove(gameState, m));
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

    case "CHARGE_MANA": {
      // 主にカード効果からの追加チャージ用(applyManaUp 経由)
      const next = Math.min(
        state.cardState.manaCap,
        state.cardState.mana[action.player] + action.amount,
      );
      return {
        ...state,
        cardState: {
          ...state.cardState,
          mana: { ...state.cardState.mana, [action.player]: next },
        },
        eventLog: [
          ...state.eventLog,
          { kind: "manaChargeEvent", player: action.player, amount: action.amount, reason: action.reason, at: Date.now() },
        ],
      };
    }

    case "DRAW_CARD": {
      const deck = state.cardState.deck[action.player];
      if (deck.length === 0) return state;
      if (state.cardState.mana[action.player] < PHASE0_DRAW_COST) return state;
      const [top, ...rest] = deck;
      return {
        ...state,
        cardState: {
          ...state.cardState,
          mana: {
            ...state.cardState.mana,
            [action.player]: state.cardState.mana[action.player] - PHASE0_DRAW_COST,
          },
          deck: { ...state.cardState.deck, [action.player]: rest },
          hand: {
            ...state.cardState.hand,
            [action.player]: [...state.cardState.hand[action.player], top],
          },
        },
        eventLog: [
          ...state.eventLog,
          { kind: "drawEvent", player: action.player, instance: top, at: Date.now() },
        ],
      };
    }

    case "BEGIN_PLAY_CARD": {
      if (state.cardState.pendingCard) return state;
      const card = state.cardState.hand[action.player].find(
        (c) => c.instanceId === action.instanceId,
      );
      if (!card) return state;
      const def = CARD_DEFS[card.defId];
      if (state.cardState.mana[action.player] < def.cost) return state;
      const phase = def.targeting === "none" || def.kind === "trap" ? "confirm" : "selectTarget";
      return {
        ...state,
        cardState: {
          ...state.cardState,
          pendingCard: { instance: card, player: action.player, phase },
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
      return {
        ...state,
        cardState: {
          ...state.cardState,
          pendingCard: { ...pending, target: action.target, phase: "confirm" },
        },
      };
    }

    case "CONFIRM_PLAY_CARD": {
      const pending = state.cardState.pendingCard;
      if (!pending) return state;
      const def = CARD_DEFS[pending.instance.defId];
      const player = pending.player;

      // ターゲット必須カードでターゲット未選択 → 何もしない
      if (def.targeting !== "none" && def.kind !== "trap" && !pending.target) {
        return state;
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
        const newGameState = applyPawnReturn(state.gameState, player, {
          row: pending.target.row,
          col: pending.target.col,
        });
        if (!newGameState) return state;
        nextGameState = newGameState;
        const afterConsume = consumeNormalCard(state.cardState, player, pending.instance.instanceId, def.cost);
        if (!afterConsume) return state;
        nextCardState = afterConsume;
      } else {
        return state;
      }

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
        cardState: { ...nextCardState, pendingCard: null },
        eventLog: [...state.eventLog, event],
      };
    }

    case "CANCEL_PLAY_CARD": {
      if (!state.cardState.pendingCard) return state;
      return {
        ...state,
        cardState: { ...state.cardState, pendingCard: null },
      };
    }

    case "SET_TRAP": {
      // 直接トラップセット(BEGIN_PLAY_CARD → CONFIRM_PLAY_CARD と等価のショートカット)
      const card = state.cardState.hand[action.player].find(
        (c) => c.instanceId === action.instanceId,
      );
      if (!card) return state;
      const def = CARD_DEFS[card.defId];
      if (def.kind !== "trap") return state;
      if (state.cardState.mana[action.player] < def.cost) return state;
      const afterMana = {
        ...state.cardState,
        mana: { ...state.cardState.mana, [action.player]: state.cardState.mana[action.player] - def.cost },
      };
      const afterSet = applyTrapSet(afterMana, action.player, action.instanceId);
      if (!afterSet) return state;
      return {
        ...state,
        cardState: afterSet,
        eventLog: [
          ...state.eventLog,
          {
            kind: "trapSetEvent",
            player: action.player,
            instance: { instanceId: card.instanceId, defId: card.defId, owner: action.player },
            at: Date.now(),
          },
        ],
      };
    }

    case "TRIGGER_TRAP": {
      const trap = state.cardState.trap[action.player];
      if (!trap) return state;
      return {
        ...state,
        cardState: applyTrapClear(state.cardState, action.player),
        eventLog: [
          ...state.eventLog,
          {
            kind: "trapTriggerEvent",
            player: action.player,
            instance: trap,
            reason: action.reason,
            at: Date.now(),
          },
        ],
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

    default:
      return state;
  }
}

interface UseCardShogiGameOptions {
  initialState: GameState;
  initialCardState: CardGameState;
  gameId: string;
  gameConfig: GameConfig;
  onComment?: (event: string) => void;
}

export function useCardShogiGame({
  initialState,
  initialCardState,
  gameId,
  gameConfig,
  onComment,
}: UseCardShogiGameOptions) {
  const [state, dispatch] = useReducer(reducer, {
    gameState: initialState,
    selectedSquare: null,
    selectedHandPiece: null,
    legalMoves: [],
    isAiThinking: false,
    promotionPendingMove: null,
    cardState: initialCardState,
    eventLog: [],
  });

  const aiPlayer: Player = gameConfig.playerColor === "sente" ? "gote" : "sente";

  // currentPlayer が自分に戻ってきたタイミングで早指しタイマーを開始
  useEffect(() => {
    if (
      state.gameState.status === "active" &&
      state.gameState.currentPlayer === gameConfig.playerColor &&
      state.cardState.lastTurnStartedAt[gameConfig.playerColor] === null
    ) {
      dispatch({ type: "RESET_TURN_TIMER", player: gameConfig.playerColor });
    }
  }, [state.gameState.currentPlayer, state.gameState.status, gameConfig.playerColor, state.cardState.lastTurnStartedAt]);

  // AI 自動応手
  useEffect(() => {
    const { gameState } = state;
    if (
      gameState.status !== "active" ||
      gameState.currentPlayer !== aiPlayer ||
      state.isAiThinking ||
      state.cardState.pendingCard !== null
    ) {
      return;
    }

    dispatch({ type: "SET_AI_THINKING", thinking: true });

    getAiMove({
      gameState,
      player: aiPlayer,
      difficulty: gameConfig.difficulty,
      variantId: gameConfig.variant.id,
    }).then((move) => {
      if (!move) {
        dispatch({ type: "SET_AI_THINKING", thinking: false });
        return;
      }

      setTimeout(() => {
        // 駒移動を適用(reducer 内でトラップフィルタ適用)
        dispatch({ type: "MAKE_MOVE", move });
        dispatch({ type: "SET_AI_THINKING", thinking: false });
        onComment?.("ai_move");
      }, 500);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.gameState.currentPlayer, state.gameState.status, state.cardState.pendingCard]);

  // DB 保存(state 変更を監視して、最新の moveCount で保存)
  const lastSavedMoveCountRef = useRef(initialState.moveCount);
  useEffect(() => {
    const moveCount = state.gameState.moveCount;
    if (moveCount <= lastSavedMoveCountRef.current) return;
    const lastMove = state.gameState.moveHistory[state.gameState.moveHistory.length - 1];
    if (!lastMove) return;
    const notation = moveToNotation(
      lastMove,
      state.gameState.moveHistory[state.gameState.moveHistory.length - 2]?.to,
    );
    lastSavedMoveCountRef.current = moveCount;
    saveCardShogiMove(gameId, lastMove, state.gameState, state.cardState, notation, moveCount);
  }, [state.gameState, state.cardState, gameId]);

  // ----- 公開API -----

  // 駒指しを発火する内部関数(MAKE_MOVE を dispatch)
  const makePlayerMove = useCallback((move: Move) => {
    dispatch({ type: "MAKE_MOVE", move });
  }, []);

  const selectSquare = useCallback(
    (pos: Position) => {
      const { gameState, cardState, selectedSquare, selectedHandPiece, legalMoves } = state;
      if (gameState.status !== "active") return;
      if (gameState.currentPlayer !== gameConfig.playerColor) return;

      // pendingCard が selectTarget フェーズなら、盤面クリックをターゲット指定として扱う
      if (cardState.pendingCard && cardState.pendingCard.phase === "selectTarget") {
        dispatch({
          type: "SELECT_CARD_TARGET",
          target: { kind: "square", row: pos.row, col: pos.col },
        });
        return;
      }
      if (cardState.pendingCard) return;

      // 手駒選択中: 打ち駒
      if (selectedHandPiece) {
        const dropMove = legalMoves.find(
          (m) =>
            m.type === "drop" &&
            m.to.row === pos.row &&
            m.to.col === pos.col &&
            m.dropPiece === selectedHandPiece,
        );
        if (dropMove) {
          makePlayerMove(dropMove);
        }
        dispatch({ type: "SELECT_SQUARE", pos });
        return;
      }

      // 同じマス再クリック → 解除
      if (selectedSquare?.row === pos.row && selectedSquare?.col === pos.col) {
        dispatch({ type: "DESELECT" });
        return;
      }

      // 駒移動先指定
      if (selectedSquare) {
        const targetMove = legalMoves.find(
          (m) =>
            m.type === "move" &&
            m.to.row === pos.row &&
            m.to.col === pos.col &&
            !m.promote,
        );
        const promoteMove = legalMoves.find(
          (m) =>
            m.type === "move" &&
            m.to.row === pos.row &&
            m.to.col === pos.col &&
            m.promote,
        );

        if (targetMove && promoteMove) {
          // 成り確認ダイアログ
          dispatch({ type: "SHOW_PROMOTION_DIALOG", move: targetMove });
          return;
        }
        if (promoteMove && !targetMove) {
          makePlayerMove(promoteMove);
          dispatch({ type: "SELECT_SQUARE", pos });
          return;
        }
        if (targetMove) {
          makePlayerMove(targetMove);
          dispatch({ type: "SELECT_SQUARE", pos });
          return;
        }
      }

      // 通常の選択(駒選択 / 解除)
      dispatch({ type: "SELECT_SQUARE", pos });
    },
    [state, gameConfig.playerColor, makePlayerMove],
  );

  const selectHandPiece = useCallback(
    (pieceType: string) => {
      if (state.cardState.pendingCard) return;
      if (state.gameState.currentPlayer !== gameConfig.playerColor) return;
      dispatch({ type: "SELECT_HAND_PIECE", pieceType });
    },
    [state.gameState.currentPlayer, gameConfig.playerColor, state.cardState.pendingCard],
  );

  const confirmPromotion = useCallback((promote: boolean) => {
    dispatch({ type: "CONFIRM_PROMOTION", promote });
  }, []);

  const cancelPromotion = useCallback(() => {
    dispatch({ type: "CANCEL_PROMOTION" });
  }, []);

  const resign = useCallback(() => {
    dispatch({ type: "RESIGN" });
    const winner: Player = state.gameState.currentPlayer === "sente" ? "gote" : "sente";
    updateGameStatus(gameId, "resign", winner);
  }, [state.gameState.currentPlayer, gameId]);

  const deselect = useCallback(() => {
    dispatch({ type: "DESELECT" });
  }, []);

  const drawCard = useCallback(() => {
    dispatch({ type: "DRAW_CARD", player: gameConfig.playerColor });
  }, [gameConfig.playerColor]);

  const beginPlayCard = useCallback(
    (instanceId: string) => {
      dispatch({ type: "BEGIN_PLAY_CARD", player: gameConfig.playerColor, instanceId });
    },
    [gameConfig.playerColor],
  );

  const selectCardTarget = useCallback((target: CardTarget) => {
    dispatch({ type: "SELECT_CARD_TARGET", target });
  }, []);

  const confirmPlayCard = useCallback(() => {
    dispatch({ type: "CONFIRM_PLAY_CARD" });
  }, []);

  const cancelPlayCard = useCallback(() => {
    dispatch({ type: "CANCEL_PLAY_CARD" });
  }, []);

  return {
    gameState: state.gameState,
    selectedSquare: state.selectedSquare,
    selectedHandPiece: state.selectedHandPiece,
    legalMoves: state.legalMoves,
    isAiThinking: state.isAiThinking,
    promotionPendingMove: state.promotionPendingMove,
    cardState: state.cardState,
    eventLog: state.eventLog,
    selectSquare,
    selectHandPiece,
    confirmPromotion,
    cancelPromotion,
    resign,
    deselect,
    drawCard,
    beginPlayCard,
    selectCardTarget,
    confirmPlayCard,
    cancelPlayCard,
  };
}
