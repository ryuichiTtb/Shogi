"use client";

import { useReducer, useCallback, useEffect, useRef } from "react";
import type {
  GameConfig,
  GameState,
  Move,
  Player,
  Position,
} from "@/lib/shogi/types";
import { moveToNotation } from "@/lib/shogi/notation";
import { getAiMove } from "@/app/actions/ai";
import { updateGameStatus, saveCardShogiMove, undoCardShogiGameState, persistCardShogiState } from "@/app/actions/game";

import type { CardGameState } from "@/lib/shogi/cards/types";
import { isValidCardTargetSquare } from "@/lib/shogi/cards/effects";

// Step 5 (Issue #107): reducer (Action 型 / state 型 / makeMoveWithEffects /
// reducer 関数本体) は src/hooks/card-shogi/reducer.ts に分離。本ファイルは
// useReducer + useEffect + useCallback の薄いフックとして公開 API のみを担う。
import { reducer } from "./card-shogi/reducer";

interface UseCardShogiGameOptions {
  initialState: GameState;
  initialCardState: CardGameState;
  gameId: string;
  gameConfig: GameConfig;
  onComment?: (event: string) => void;
  disableServerSync?: boolean;
  disableAi?: boolean;
}

export function useCardShogiGame({
  initialState,
  initialCardState,
  gameId,
  gameConfig,
  onComment,
  disableServerSync = false,
  disableAi = false,
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
    isDrawing: false,
    pendingDrawPlayer: null,
    pendingDrawSource: null,
    isPlayingCard: false,
    pendingPlayCardOpponent: null,
    isCheckBreakAnimating: false,
    doubleMove: null,
    forbiddenMateMoves: [],
    undoSnapshots: [],
  });

  const aiPlayer: Player = gameConfig.playerColor === "sente" ? "gote" : "sente";

  // 番が回ってきた時点で早指しタイマーを開始する。
  // 自分・AI 双方に適用しないと AI 側だけ常に通常チャージ(+1)扱いになる。
  useEffect(() => {
    const cp = state.gameState.currentPlayer;
    if (
      state.gameState.status === "active" &&
      state.cardState.lastTurnStartedAt[cp] === null
    ) {
      dispatch({ type: "RESET_TURN_TIMER", player: cp });
    }
  }, [state.gameState.currentPlayer, state.gameState.status, state.cardState.lastTurnStartedAt]);

  // AI 自動応手
  useEffect(() => {
    const { gameState } = state;
    if (
      gameState.status !== "active" ||
      gameState.currentPlayer !== aiPlayer ||
      disableAi ||
      state.isAiThinking ||
      state.cardState.pendingCard !== null ||
      // Issue #78: ドロー演出中は AI 思考をブロック (COMMIT_DRAW 後に再評価される)
      state.isDrawing ||
      // Issue #82: カード使用演出中は AI 思考をブロック (COMMIT_PLAY_CARD 後に再評価)
      state.isPlayingCard ||
      // Issue #82 (王手崩し): トラップ演出中は AI 思考をブロック (COMMIT_CHECK_BREAK 後に再評価)
      state.isCheckBreakAnimating
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

      // Step 3 (Issue #107): 旧実装は AI 着手後にさらに 500ms 待機していた。
      // getAiMove 自体に 100-300ms かかる上に固定 500ms で体感が重くなるため
      // 撤廃し即時 dispatch する。React 19 では Promise.then 内の連続 dispatch
      // も自動 batch されるため複数 re-render は発生しない想定。
      dispatch({ type: "MAKE_MOVE", move });
      dispatch({ type: "SET_AI_THINKING", thinking: false });
      onComment?.("ai_move");
    });
    // 依存配列の補足:
    // - isPlayingCard: 旧仕様では「演出 → ターン交代」の順で、ターン交代時には isPlayingCard=false
    //   になっていたため deps に入れる必要がなかった。
    //   新仕様 (Issue #82 二手指し) では「2手目 (= ターン交代) → 演出」の順となり、ターン交代時に
    //   isPlayingCard=true がセットされる。COMMIT_PLAY_CARD で false に戻った瞬間に AI 思考を
    //   再開する必要があるため deps に必須。
    // - isCheckBreakAnimating: 同種の理由 (演出後にフラグ降りた瞬間に AI 思考を再開できるよう)。
    //   実プレイで顕在化しにくいシナリオだが念のため deps に含める。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.gameState.currentPlayer,
    state.gameState.status,
    state.cardState.pendingCard,
    state.isDrawing,
    state.isPlayingCard,
    state.isCheckBreakAnimating,
    disableAi,
  ]);

  // DB 保存(state 変更を監視して、最新の moveCount で保存)
  const lastSavedMoveCountRef = useRef(initialState.moveCount);
  useEffect(() => {
    // Issue #82 (二手指し): 二手指し中 (1手目完了直後 等) は save しない。
    // 2手目完了で doubleMove=null になった時に通常通り save 発火する。
    // これにより 1手目分の GameMove レコードは作られず、リロード時の DB 状態は
    // カード使用前にロールバックする (二手指しキャンセル相当)。
    if (disableServerSync) return;
    if (state.doubleMove !== null) return;

    const moveCount = state.gameState.moveCount;
    if (moveCount <= lastSavedMoveCountRef.current) return;
    const lastMove = state.gameState.moveHistory[state.gameState.moveHistory.length - 1];
    if (!lastMove) return;
    const notation = moveToNotation(
      lastMove,
      state.gameState.moveHistory[state.gameState.moveHistory.length - 2]?.to,
    );
    lastSavedMoveCountRef.current = moveCount;
    // Issue #117 (#128): Server Action 失敗を unhandled rejection にしない。
    // 保存失敗は致命ではない (state は client にあり、画面遷移で消えるが対局自体は継続可能)
    // のでログのみ。Vercel cold start や一時的な接続失敗で落ちなくする。
    saveCardShogiMove(
      gameId,
      lastMove,
      state.gameState,
      state.cardState,
      notation,
      moveCount,
    ).catch((e) => {
      console.error("saveCardShogiMove failed", e);
    });
  }, [state.gameState, state.cardState, state.doubleMove, gameId, disableServerSync]);

  // Issue #132: カード使用 / ドロー / トラップ設置直後の cardState 即時保存。
  // 駒指し以外のカード操作は moveCount を増やさないため、上の save useEffect では発火しない。
  // 結果としてカード使用直後のリロードでカード効果が失われていた (= DB はカード使用前の cardState のまま)。
  // ここでは cardState の参照変化を契機に persistCardShogiState を呼び、GameMove は insert せず
  // Game.boardState / cardState / status のみ更新する。
  // 駒指しと同タイミングの場合は save useEffect が moveCount を進めて GameMove も insert するため、
  // 本 useEffect の更新は重複するが (Game の同値更新)、データ不整合は起きない。
  //
  // 発火ガード:
  // - 二手指し中 (doubleMove !== null): saveCardShogiMove と同じく save スキップ
  // - 演出中 (isPlayingCard / isDrawing / isCheckBreakAnimating): 演出完了 (COMMIT_*) で
  //   cardState は最終形になっているため、演出中の中間 state を保存しないようガード
  // - cardState 参照不変: 変更がなければ何もしない
  const lastPersistedCardStateRef = useRef(state.cardState);
  useEffect(() => {
    if (state.doubleMove !== null) return;
    if (disableServerSync) return;
    if (state.isPlayingCard || state.isDrawing || state.isCheckBreakAnimating) return;
    if (state.cardState === lastPersistedCardStateRef.current) return;
    lastPersistedCardStateRef.current = state.cardState;
    persistCardShogiState(gameId, state.gameState, state.cardState).catch((e) => {
      console.error("persistCardShogiState failed", e);
    });
  }, [
    state.cardState,
    state.gameState,
    state.doubleMove,
    state.isPlayingCard,
    state.isDrawing,
    state.isCheckBreakAnimating,
    gameId,
    disableServerSync,
  ]);

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
      // ドロー演出 / カード使用演出中は盤面操作禁止 (Issue #82)。
      // ※ pendingCard.selectTarget 時は currentPlayer 反転前なのでここを通る必要があるため、
      //   isDrawing / isPlayingCard だけを弾く。
      if (state.isDrawing || state.isPlayingCard) return;
      // Issue #82 (王手崩し): トラップ演出中は盤面操作禁止
      if (state.isCheckBreakAnimating) return;

      // pendingCard が selectTarget フェーズなら、盤面クリックをターゲット指定として扱う。
      // カード種別ごとの妥当性 + 王手中の王手回避要件は isValidCardTargetSquare に集約
      // (Step S1 / Issue #107: handleSquareClick 側のフライト起動ガードと検証順を揃える)。
      if (cardState.pendingCard && cardState.pendingCard.phase === "selectTarget") {
        if (
          !isValidCardTargetSquare(
            gameState,
            gameConfig.playerColor,
            cardState.pendingCard.instance.defId,
            pos,
          )
        ) {
          return;
        }
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
      if (state.isDrawing || state.isPlayingCard) return; // Issue #82: 演出中は弾く
      if (state.isCheckBreakAnimating) return; // Issue #82 (王手崩し): トラップ演出中
      if (state.gameState.currentPlayer !== gameConfig.playerColor) return;
      dispatch({ type: "SELECT_HAND_PIECE", pieceType });
    },
    [state.gameState.currentPlayer, gameConfig.playerColor, state.cardState.pendingCard, state.isDrawing, state.isPlayingCard, state.isCheckBreakAnimating],
  );

  const confirmPromotion = useCallback((promote: boolean) => {
    dispatch({ type: "CONFIRM_PROMOTION", promote });
  }, []);

  const cancelPromotion = useCallback(() => {
    dispatch({ type: "CANCEL_PROMOTION" });
  }, []);

  const resign = useCallback(() => {
    dispatch({ type: "RESIGN" });
    if (disableServerSync) return;
    const winner: Player = state.gameState.currentPlayer === "sente" ? "gote" : "sente";
    updateGameStatus(gameId, "resign", winner);
  }, [state.gameState.currentPlayer, gameId, disableServerSync]);

  // Issue #132: 待った時に DB 側も巻き戻す。reducer dispatch は同期に state を更新しないため、
  // ref フラグを立てて next render の useEffect (後述) で post-UNDO state を確定後にサーバーアクションを呼ぶ。
  const pendingUndoSyncRef = useRef(false);
  const undo = useCallback(() => {
    if (state.gameState.moveHistory.length < 2) return;
    if (state.cardState.pendingCard) return;
    pendingUndoSyncRef.current = true;
    dispatch({ type: "UNDO" });
  }, [state.gameState.moveHistory.length, state.cardState.pendingCard]);

  // Issue #132: UNDO 完了後の DB 巻き戻し + 保存カウンタリセット。
  // pendingUndoSyncRef フラグが立っている時のみ実行し、巻き戻し後の state を DB に反映する。
  // 保存カウンタ (lastSavedMoveCountRef) はリセットしないと、次の指し手で moveCount <= ref により
  // save useEffect が空振りし、新しい手が DB に保存されない (旧バグ)。
  // サーバーアクションは fire-and-forget で、失敗時はログのみ (致命ではないため UI は止めない)。
  // 既知の race: 巻き戻し中にユーザーが新しい手を指すと、後で undo サーバーアクションの
  // deleteMany が新規保存を消す可能性がある。実用上は transaction が短く稀。回避は将来課題。
  useEffect(() => {
    if (!pendingUndoSyncRef.current) return;
    pendingUndoSyncRef.current = false;
    lastSavedMoveCountRef.current = state.gameState.moveCount;
    if (disableServerSync) return;
    undoCardShogiGameState(
      gameId,
      state.gameState,
      state.cardState,
      state.gameState.moveCount,
    ).catch((e) => {
      console.error("undoCardShogiGameState failed", e);
    });
  }, [state.gameState, state.cardState, gameId, disableServerSync]);

  const deselect = useCallback(() => {
    dispatch({ type: "DESELECT" });
  }, []);

  const drawCard = useCallback(() => {
    dispatch({ type: "DRAW_CARD", player: gameConfig.playerColor });
  }, [gameConfig.playerColor]);

  // Issue #78: ドロー演出完了時に呼ぶ。currentPlayer を相手に渡し AI 思考を解禁する。
  const finalizeDraw = useCallback(() => {
    dispatch({ type: "COMMIT_DRAW" });
  }, []);

  const beginPlayCard = useCallback(
    (instanceId: string) => {
      dispatch({ type: "BEGIN_PLAY_CARD", player: gameConfig.playerColor, instanceId });
    },
    [gameConfig.playerColor],
  );

  const confirmPlayCard = useCallback(() => {
    dispatch({ type: "CONFIRM_PLAY_CARD" });
  }, []);

  // Issue #82: カード使用演出完了時に呼ぶ。currentPlayer を相手に渡し AI 思考を解禁する。
  const finalizePlayCard = useCallback(() => {
    dispatch({ type: "COMMIT_PLAY_CARD" });
  }, []);

  const cancelPlayCard = useCallback(() => {
    dispatch({ type: "CANCEL_PLAY_CARD" });
  }, []);

  // Issue #82 (王手崩し): トラップ演出完了時に呼ぶ。AI 思考とユーザー操作のロックを解除。
  const finalizeCheckBreak = useCallback(() => {
    dispatch({ type: "COMMIT_CHECK_BREAK" });
  }, []);

  // Issue #82 (二手指し): 1手目を取り消して preFirstMoveState から復元。
  // movesLeft===1 の時のみ動作。カードはまだ使用したまま、もう一度 1手目を選び直せる。
  const undoDoubleMoveFirst = useCallback(() => {
    dispatch({ type: "UNDO_DOUBLE_MOVE_FIRST" });
  }, []);

  // Issue #82 (二手指し / 新仕様): カード使用自体をキャンセル。
  // preCardState から完全復元、カードは手札に戻り、マナも消費されない。
  // movesLeft=2 (1手目前) でも movesLeft=1 (1手目後) でも実行可能。
  const cancelDoubleMove = useCallback(() => {
    dispatch({ type: "CANCEL_DOUBLE_MOVE" });
  }, []);

  return {
    gameState: state.gameState,
    selectedSquare: state.selectedSquare,
    selectedHandPiece: state.selectedHandPiece,
    legalMoves: state.legalMoves,
    // Issue #82 (二手指し): 2手目で「禁止された詰み手」(mateInOneAvailable=false 時)。
    // UI で赤×表示し、クリック時にダイアログで禁止理由を説明するため legalMoves と別管理。
    forbiddenMateMoves: state.forbiddenMateMoves,
    isAiThinking: state.isAiThinking,
    promotionPendingMove: state.promotionPendingMove,
    cardState: state.cardState,
    eventLog: state.eventLog,
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
    undoDoubleMoveFirst,
    cancelDoubleMove,
    isDrawing: state.isDrawing,
    isPlayingCard: state.isPlayingCard,
    isCheckBreakAnimating: state.isCheckBreakAnimating,
    doubleMove: state.doubleMove,
  };
}
