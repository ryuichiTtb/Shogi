"use client";

import { useReducer, useCallback, useEffect, useRef } from "react";
import type {
  Difficulty,
  GameConfig,
  GameState,
  Move,
  Player,
  Position,
  RuleVariant,
} from "@/lib/shogi/types";
import {
  applyMove,
  createInitialGameState,
  cloneGameState,
} from "@/lib/shogi/board";
import {
  getFullLegalMoves,
  getPieceMoves,
  getLegalDropMoves,
  isInCheck,
} from "@/lib/shogi/moves";
import { evaluateGameEnd } from "@/lib/shogi/rules";
import { moveToNotation } from "@/lib/shogi/notation";
import { STANDARD_VARIANT } from "@/lib/shogi/variants/standard";
import { getAiMove } from "@/app/actions/ai";
import { saveMove, updateGameStatus } from "@/app/actions/game";

type GameAction =
  | { type: "SELECT_SQUARE"; pos: Position }
  | { type: "DESELECT" }
  | { type: "SELECT_HAND_PIECE"; pieceType: string }
  | { type: "MAKE_MOVE"; move: Move }
  | { type: "SET_STATE"; state: GameState }
  | { type: "SET_AI_THINKING"; thinking: boolean }
  | { type: "SHOW_PROMOTION_DIALOG"; move: Move }
  | { type: "CONFIRM_PROMOTION"; promote: boolean }
  | { type: "CANCEL_PROMOTION" }
  | { type: "RESIGN" }
  | { type: "UNDO" };

interface ShogiGameState {
  gameState: GameState;
  selectedSquare: Position | null;
  selectedHandPiece: string | null;
  legalMoves: Move[];
  isAiThinking: boolean;
  promotionPendingMove: Move | null;
}

function shogiReducer(state: ShogiGameState, action: GameAction): ShogiGameState {
  switch (action.type) {
    case "DESELECT":
      return { ...state, selectedSquare: null, selectedHandPiece: null, legalMoves: [] };

    case "SELECT_SQUARE": {
      const { pos } = action;
      const { gameState, selectedSquare, selectedHandPiece, legalMoves } = state;

      // 手駒が選択されている場合: 打ち駒
      if (selectedHandPiece) {
        const dropMove = legalMoves.find(
          (m) =>
            m.type === "drop" &&
            m.to.row === pos.row &&
            m.to.col === pos.col &&
            m.dropPiece === selectedHandPiece
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

      // 駒が選択されている場合: 移動先の指定
      if (selectedSquare) {
        const targetMove = legalMoves.find(
          (m) =>
            m.type === "move" &&
            m.to.row === pos.row &&
            m.to.col === pos.col &&
            !m.promote
        );
        const promoteMove = legalMoves.find(
          (m) =>
            m.type === "move" &&
            m.to.row === pos.row &&
            m.to.col === pos.col &&
            m.promote
        );

        if (targetMove || promoteMove) {
          // 成り確認が必要な場合
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

        // 別の自駒を選択
        const piece = gameState.board[pos.row]?.[pos.col];
        if (piece && piece.owner === gameState.currentPlayer) {
          const moves = getPieceMoves(gameState, pos, gameState.currentPlayer, STANDARD_VARIANT);
          const filtered = moves.filter((m) => !isKingInCheckAfterMove(gameState, m));
          return {
            ...state,
            selectedSquare: pos,
            legalMoves: filtered,
          };
        }

        return { ...state, selectedSquare: null, legalMoves: [] };
      }

      // 駒の選択
      const piece = gameState.board[pos.row]?.[pos.col];
      if (piece && piece.owner === gameState.currentPlayer) {
        const moves = getPieceMoves(gameState, pos, gameState.currentPlayer, STANDARD_VARIANT);
        const filtered = moves.filter((m) => !isKingInCheckAfterMove(gameState, m));
        return {
          ...state,
          selectedSquare: pos,
          selectedHandPiece: null,
          legalMoves: filtered,
        };
      }

      return state;
    }

    case "SELECT_HAND_PIECE": {
      const { gameState } = state;
      const dropMoves = getLegalDropMoves(gameState, gameState.currentPlayer, STANDARD_VARIANT);
      const movesForPiece = dropMoves.filter((m) => m.dropPiece === action.pieceType);
      return {
        ...state,
        selectedHandPiece: action.pieceType,
        selectedSquare: null,
        legalMoves: movesForPiece,
      };
    }

    case "MAKE_MOVE": {
      const nextGameState = applyMove(state.gameState, action.move);
      const evaluated = evaluateGameEnd(nextGameState, STANDARD_VARIANT);
      return {
        ...state,
        gameState: evaluated,
        selectedSquare: null,
        selectedHandPiece: null,
        legalMoves: [],
        promotionPendingMove: null,
      };
    }

    case "SET_STATE":
      return { ...state, gameState: action.state };

    case "SET_AI_THINKING":
      return { ...state, isAiThinking: action.thinking };

    case "SHOW_PROMOTION_DIALOG":
      return { ...state, promotionPendingMove: action.move };

    case "CONFIRM_PROMOTION": {
      const pendingMove = state.promotionPendingMove;
      if (!pendingMove) return state;

      const finalMove = action.promote
        ? { ...pendingMove, promote: true }
        : pendingMove;

      const nextState = applyMove(state.gameState, finalMove);
      const evaluated = evaluateGameEnd(nextState, STANDARD_VARIANT);
      return {
        ...state,
        gameState: evaluated,
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

    case "UNDO": {
      // 最後の2手（プレイヤーとAI）を取り消す
      const history = state.gameState.moveHistory;
      if (history.length < 2) return state;

      // 初期状態から再適用
      const initialState = createInitialGameState(STANDARD_VARIANT);
      const movesToApply = history.slice(0, -2);
      let newState = initialState;
      for (const m of movesToApply) {
        newState = applyMove(newState, m);
      }

      return {
        ...state,
        gameState: newState,
        selectedSquare: null,
        selectedHandPiece: null,
        legalMoves: [],
      };
    }

    default:
      return state;
  }
}

function isKingInCheckAfterMove(gameState: GameState, move: Move): boolean {
  const nextState = applyMove(gameState, move);
  return isInCheck(nextState, move.player, STANDARD_VARIANT);
}

interface UseShogiGameOptions {
  initialState: GameState;
  gameId: string;
  gameConfig: GameConfig;
  onComment?: (event: string) => void;
}

export function useShogiGame({
  initialState,
  gameId,
  gameConfig,
  onComment,
}: UseShogiGameOptions) {
  const [state, dispatch] = useReducer(shogiReducer, {
    gameState: initialState,
    selectedSquare: null,
    selectedHandPiece: null,
    legalMoves: [],
    isAiThinking: false,
    promotionPendingMove: null,
  });

  const moveCountRef = useRef(initialState.moveCount);

  const aiPlayer: Player = gameConfig.playerColor === "sente" ? "gote" : "sente";

  // AI自動応手
  useEffect(() => {
    const { gameState } = state;
    if (
      gameState.status !== "active" ||
      gameState.currentPlayer !== aiPlayer ||
      state.isAiThinking
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

      // 少し遅延（思考中感）
      setTimeout(() => {
        dispatch({ type: "MAKE_MOVE", move });
        dispatch({ type: "SET_AI_THINKING", thinking: false });

        // DB保存
        const nextState = applyMove(gameState, move);
        const notation = moveToNotation(move, gameState.moveHistory.slice(-1)[0]?.to);
        moveCountRef.current = nextState.moveCount;
        saveMove(gameId, move, nextState, notation, nextState.moveCount);
        onComment?.("ai_move");
      }, 500);
    });
  }, [state.gameState.currentPlayer, state.gameState.status]);

  // プレイヤーの手を指す
  const makePlayerMove = useCallback(
    (move: Move) => {
      dispatch({ type: "MAKE_MOVE", move });

      const nextState = applyMove(state.gameState, move);
      const notation = moveToNotation(move, state.gameState.moveHistory.slice(-1)[0]?.to);
      saveMove(gameId, move, nextState, notation, nextState.moveCount);

      if (move.captured && ["rook", "bishop", "promoted_rook", "promoted_bishop"].includes(move.captured)) {
        onComment?.("capture_major");
      }
      if (isInCheck(nextState, aiPlayer, STANDARD_VARIANT)) {
        onComment?.("check");
      }
    },
    [state.gameState, gameId, aiPlayer, onComment]
  );

  const selectSquare = useCallback((pos: Position) => {
    const { gameState, selectedSquare, selectedHandPiece, legalMoves } = state;

    if (gameState.status !== "active") return;
    if (gameState.currentPlayer !== gameConfig.playerColor) return;

    // 手駒選択中: 打ち駒
    if (selectedHandPiece) {
      const dropMove = legalMoves.find(
        (m) =>
          m.type === "drop" &&
          m.to.row === pos.row &&
          m.to.col === pos.col &&
          m.dropPiece === selectedHandPiece
      );
      if (dropMove) {
        makePlayerMove(dropMove);
      }
      dispatch({ type: "SELECT_SQUARE", pos });
      return;
    }

    // 選択中の駒を再クリック → 選択解除
    if (selectedSquare?.row === pos.row && selectedSquare?.col === pos.col) {
      dispatch({ type: "DESELECT" });
      return;
    }

    // 駒移動
    if (selectedSquare) {
      const targetMove = legalMoves.find(
        (m) =>
          m.type === "move" &&
          m.to.row === pos.row &&
          m.to.col === pos.col &&
          !m.promote
      );
      const promoteMove = legalMoves.find(
        (m) =>
          m.type === "move" &&
          m.to.row === pos.row &&
          m.to.col === pos.col &&
          m.promote
      );

      if (targetMove && promoteMove) {
        // 成り確認ダイアログを表示
        dispatch({ type: "SHOW_PROMOTION_DIALOG", move: targetMove });
        return;
      }
      if (promoteMove && !targetMove) {
        // 強制成り
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

    dispatch({ type: "SELECT_SQUARE", pos });
  }, [state, gameConfig.playerColor, makePlayerMove]);

  const selectHandPiece = useCallback((pieceType: string) => {
    if (state.gameState.currentPlayer !== gameConfig.playerColor) return;
    dispatch({ type: "SELECT_HAND_PIECE", pieceType });
  }, [state.gameState.currentPlayer, gameConfig.playerColor]);

  const confirmPromotion = useCallback(
    (promote: boolean) => {
      const { promotionPendingMove } = state;
      if (promotionPendingMove) {
        const finalMove = { ...promotionPendingMove, promote };
        makePlayerMove(finalMove);
      }
      dispatch({ type: "CONFIRM_PROMOTION", promote });
    },
    [state.promotionPendingMove, makePlayerMove]
  );

  const resign = useCallback(() => {
    dispatch({ type: "RESIGN" });
    const winner: Player = state.gameState.currentPlayer === "sente" ? "gote" : "sente";
    updateGameStatus(gameId, "resign", winner);
  }, [state.gameState.currentPlayer, gameId]);

  const undo = useCallback(() => {
    if (state.gameState.moveHistory.length < 2) return;
    dispatch({ type: "UNDO" });
  }, [state.gameState.moveHistory.length]);

  const deselect = useCallback(() => {
    dispatch({ type: "DESELECT" });
  }, []);

  const cancelPromotion = useCallback(() => {
    dispatch({ type: "CANCEL_PROMOTION" });
  }, []);

  return {
    gameState: state.gameState,
    selectedSquare: state.selectedSquare,
    selectedHandPiece: state.selectedHandPiece,
    legalMoves: state.legalMoves,
    isAiThinking: state.isAiThinking,
    promotionPendingMove: state.promotionPendingMove,
    selectSquare,
    selectHandPiece,
    confirmPromotion,
    cancelPromotion,
    resign,
    undo,
    deselect,
  };
}
