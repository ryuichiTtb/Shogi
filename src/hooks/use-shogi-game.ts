"use client";

import { useReducer, useCallback, useEffect, useRef, useState } from "react";
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
import { saveMove, saveResign } from "@/app/actions/game";
import { useAiRequest, type AiRequestError } from "@/hooks/ai/use-ai-request";

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

  // Issue #176: AI 思考リクエストを Route Handler 経由に統一する。
  // - 連続失敗時は aiError をセットして UI でモーダル表示
  // - retry trigger は aiRetryCounter で effect 再走させる
  const [aiError, setAiError] = useState<AiRequestError | null>(null);
  const [aiRetryCounter, setAiRetryCounter] = useState(0);
  const handleAiError = useCallback((err: AiRequestError) => {
    setAiError(err);
    dispatch({ type: "SET_AI_THINKING", thinking: false });
  }, []);
  const { requestMove: aiRequestMove, cancel: cancelAiRequest } = useAiRequest({
    onError: handleAiError,
  });

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

    void (async () => {
      const result = await aiRequestMove({
        gameId,
        gameState,
        player: aiPlayer,
        difficulty: gameConfig.difficulty,
        variantId: gameConfig.variant.id,
        clientMoveCount: gameState.moveCount,
      });
      if (result.stale) {
        // 待った / 終局 / unmount / 上書きで stale 化、あるいは onError で
        // 既に setAiError 済み。ここでは isAiThinking のクリーンアップのみ。
        // aiError がセットされていない場合は単純に終局済 / cancel 経由。
        dispatch({ type: "SET_AI_THINKING", thinking: false });
        return;
      }
      const move = result.response.move;
      if (!move) {
        dispatch({ type: "SET_AI_THINKING", thinking: false });
        return;
      }
      // Issue #176: 旧実装にあった固定 500ms 待ちを撤廃。Route Handler 化により
      // AI 応答が独立したため、追加待機は体感を悪化させるだけ。
      dispatch({ type: "MAKE_MOVE", move });
      dispatch({ type: "SET_AI_THINKING", thinking: false });
      const nextState = applyMove(gameState, move);
      const notation = moveToNotation(move, gameState.moveHistory.slice(-1)[0]?.to);
      moveCountRef.current = nextState.moveCount;
      // Issue #117 / #176: saveMove の失敗を unhandled rejection にしない。
      saveMove(gameId, move, nextState, notation, nextState.moveCount).catch((err) => {
        console.error("[use-shogi-game] saveMove (AI) failed", err);
      });
      onComment?.("ai_move");
    })();
    // aiRetryCounter を deps に含め、retry callback で effect を再走させる。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.gameState.currentPlayer, state.gameState.status, aiRetryCounter]);

  // unmount / 終局時に in-flight を必ず止める
  useEffect(() => {
    if (state.gameState.status !== "active") {
      cancelAiRequest();
    }
  }, [state.gameState.status, cancelAiRequest]);

  const dismissAiError = useCallback(() => setAiError(null), []);
  const retryAiMove = useCallback(() => {
    setAiError(null);
    setAiRetryCounter((c) => c + 1);
  }, []);

  // プレイヤーの手を指す
  const makePlayerMove = useCallback(
    (move: Move) => {
      dispatch({ type: "MAKE_MOVE", move });

      const nextState = applyMove(state.gameState, move);
      const notation = moveToNotation(move, state.gameState.moveHistory.slice(-1)[0]?.to);
      // Issue #117 / #176: プレイヤー側の saveMove も unhandled rejection を防ぐ。
      saveMove(gameId, move, nextState, notation, nextState.moveCount).catch((err) => {
        console.error("[use-shogi-game] saveMove (player) failed", err);
      });

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
    // Issue #155: DB 保存は dispatch 結果が反映された state を見て useEffect 経由で
    // 行う。reducer の dispatch は同期的だが結果 state を直接掴めないため、
    // useEffect で gameState.status === "resign" を検知して saveResign を await
    // する方式 (重複保存防止に resignedRef を使う) を採用している。
    dispatch({ type: "RESIGN" });
  }, []);

  // Issue #155: 投了確定後の DB 保存。
  //   - saveResign は boardState (JSON) も同時に "resign" 状態で永続化する。
  //     これにより履歴復元時に途中対局として開かれるバグを根治する。
  //   - resignedRef で「同じ対局内での重複保存」を防ぐ (StrictMode の二重 effect・
  //     status が再度 "resign" に評価される再レンダー等への保険)。
  //   - saveResign 失敗時の UI フォールバックは現時点では出さない (旧実装も
  //     fire-and-forget で UI 側エラー処理がなかった)。Issue #109 観点での
  //     改善余地として残すが、本 Issue のスコープ外。
  const resignedRef = useRef(false);
  useEffect(() => {
    if (state.gameState.status !== "resign") return;
    if (resignedRef.current) return;
    resignedRef.current = true;
    const winner = state.gameState.winner ?? "";
    void saveResign(gameId, state.gameState, winner);
    // gameState 全体を依存に入れると status 不変ターンでも fire するため、
    // status のみで trigger する (effect 内では closure の最新 state を参照)。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.gameState.status, gameId]);

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
    aiError,
    selectSquare,
    selectHandPiece,
    confirmPromotion,
    cancelPromotion,
    resign,
    undo,
    deselect,
    dismissAiError,
    retryAiMove,
  };
}
