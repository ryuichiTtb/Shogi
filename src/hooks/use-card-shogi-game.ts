"use client";

import { useReducer, useCallback, useEffect, useRef, useState } from "react";
import type {
  GameConfig,
  GameState,
  Move,
  Player,
  Position,
} from "@/lib/shogi/types";
import { moveToNotation } from "@/lib/shogi/notation";
import { saveCardShogiMove, saveCardShogiResign, undoCardShogiGameState, persistCardShogiState } from "@/app/actions/game";
import { useAiRequest, type AiRequestError } from "@/hooks/ai/use-ai-request";

import type { CardGameState } from "@/lib/shogi/cards/types";
import { isValidCardTargetSquare } from "@/lib/shogi/cards/effects";

// Step 5 (Issue #107): reducer (Action 型 / state 型 / makeMoveWithEffects /
// reducer 関数本体) は src/hooks/card-shogi/reducer.ts に分離。本ファイルは
// useReducer + useEffect + useCallback の薄いフックとして公開 API のみを担う。
import { reducer } from "./card-shogi/reducer";
import { canUndoFromState } from "./card-shogi/undo-policy";
import { useDbPersistenceGuard } from "./card-shogi/use-db-persistence-guard";
import { SPECTATOR_MAX_MOVES } from "@/lib/shogi/ai/strategy";
import type { Difficulty } from "@/lib/shogi/types";

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
    // Issue #193 / PR1a: gameConfig に spectatorMode が含まれる場合 (CPU vs CPU 観戦)
    // のみ true、人間プレイ時は false で完全に従来挙動を保持。段階7 で gameConfig 型を
    // 拡張して観戦モード createGame 経路を整備する想定 (現時点では未指定なら false)。
    spectatorMode: gameConfig.spectatorMode ?? false,
    isPaused: false,
  });

  // Issue #193 / PR1a: 観戦モードでは playerColor が意味を持たないため、useEffect 内で
  // gameState.currentPlayer に応じて動的に aiPlayer を計算する (E-1 対応)。
  // ここでの aiPlayer 変数は通常モード用 (= 後方互換ガード)。
  const aiPlayer: Player = gameConfig.playerColor === "sente" ? "gote" : "sente";

  // PR1a: 観戦モード時の DB 保存スキップ判定 (B-1 対応)。spectatorMode=false の人間プレイ時は
  // 常に canPersist=true で従来挙動を保持。
  const { canPersist } = useDbPersistenceGuard(state.spectatorMode);

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

  // Issue #176: AI 思考リクエストを Route Handler 経由に統一する。
  const [aiError, setAiError] = useState<AiRequestError | null>(null);
  const [aiRetryCounter, setAiRetryCounter] = useState(0);
  const handleAiError = useCallback((err: AiRequestError) => {
    setAiError(err);
    dispatch({ type: "SET_AI_THINKING", thinking: false });
  }, []);
  const { requestMove: aiRequestMove, cancel: cancelAiRequest } = useAiRequest({
    onError: handleAiError,
  });

  // AI 自動応手
  useEffect(() => {
    const { gameState } = state;
    // Issue #193 / PR1a: 観戦モードでは両プレイヤー AI 駆動。currentPlayer に応じて
    // 該当する difficulty で request する (E-1 対応)。先手=difficulty、後手=difficultyB
    // (未指定なら difficulty にフォールバック)。
    const effectiveAiPlayer: Player = state.spectatorMode
      ? gameState.currentPlayer
      : aiPlayer;
    const effectiveDifficulty: Difficulty = state.spectatorMode
      ? gameState.currentPlayer === "sente"
        ? gameConfig.difficulty
        : gameConfig.difficultyB ?? gameConfig.difficulty
      : gameConfig.difficulty;

    if (
      gameState.status !== "active" ||
      gameState.currentPlayer !== effectiveAiPlayer ||
      // PR1a: 観戦モードのポーズ中は AI 思考をブロック (F-3 進行中チェックリスト関連)
      state.isPaused ||
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

    void (async () => {
      const result = await aiRequestMove({
        gameId,
        gameState,
        player: effectiveAiPlayer,
        difficulty: effectiveDifficulty,
        variantId: gameConfig.variant.id,
        clientMoveCount: gameState.moveCount,
        // PR1a (E-2 silent ignore): cardState を route に渡す。route 側で受け取るだけで使わない (PR1d で活用)。
        cardState: state.cardState,
        // PR1a (E-1): 観戦モード時は route 側で timeLimitMs を SPECTATOR_TIME_LIMIT_MS=1500ms に短縮する。
        spectatorMode: state.spectatorMode,
      });
      if (result.stale) {
        // 待った / 終局 / unmount / 上書き / onError 経由の早期 abort。
        // 既に setAiError 済みかキャンセル済みなので thinking 解除のみ。
        dispatch({ type: "SET_AI_THINKING", thinking: false });
        return;
      }
      const move = result.response.move;
      if (!move) {
        // Issue #193 / PR1a (I-5): AI が move=null を返すのは合法手なし (詰み・stalemate)
        // のケース。reducer 側で gameState.status は既に "checkmate" / "stalemate" 等の
        // 終局状態に変化済 (= 直前の MAKE_MOVE で evaluateGameEnd が判定済み) のため、
        // ここでは isAiThinking フラグのみ解除して終局演出を妨げないようにする。
        // 観戦モード両 CPU 駆動でも同様に動作 (どちらかが詰めば AI useEffect の
        // gameState.status !== "active" ガードで以後の request は発火しない)。
        dispatch({ type: "SET_AI_THINKING", thinking: false });
        return;
      }
      // Step 3 (Issue #107) / Issue #176: 旧実装の固定 500ms 待ちを撤廃。
      // Route Handler 化により AI 応答が独立したため、追加待機は体感悪化のみ。
      dispatch({ type: "MAKE_MOVE", move });
      dispatch({ type: "SET_AI_THINKING", thinking: false });
      onComment?.("ai_move");
    })();
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
    // PR1a: 観戦モードのポーズ解除時に AI 思考を再開できるよう依存配列に追加 (F-3 関連)
    state.isPaused,
    disableAi,
    aiRetryCounter,
  ]);

  // 終局時に in-flight な AI 探索をキャンセル
  useEffect(() => {
    if (state.gameState.status !== "active") {
      cancelAiRequest();
    }
  }, [state.gameState.status, cancelAiRequest]);

  // Issue #193 / PR1a (C-5): 観戦モード固有の強制終局判定。
  // 終了条件優先順位: 千日手 (最優先、既存 status 判定で repetition / perpetual_check に変わる) →
  // カードアクション上限 5 回 (PR1a では未発動、PR3 のルール変更時の安全弁) →
  // SPECTATOR_MAX_MOVES (200 手) 到達で強制引き分け。
  useEffect(() => {
    if (!state.spectatorMode) return;
    if (state.gameState.status !== "active") return;
    if (state.gameState.moveCount >= SPECTATOR_MAX_MOVES) {
      dispatch({ type: "END_SPECTATOR_GAME" });
    }
  }, [state.spectatorMode, state.gameState.status, state.gameState.moveCount]);

  const dismissAiError = useCallback(() => setAiError(null), []);
  const retryAiMove = useCallback(() => {
    setAiError(null);
    setAiRetryCounter((c) => c + 1);
  }, []);

  // DB 保存(state 変更を監視して、最新の moveCount で保存)
  const lastSavedMoveCountRef = useRef(initialState.moveCount);
  useEffect(() => {
    // Issue #82 (二手指し): 二手指し中 (1手目完了直後 等) は save しない。
    // 2手目完了で doubleMove=null になった時に通常通り save 発火する。
    // これにより 1手目分の GameMove レコードは作られず、リロード時の DB 状態は
    // カード使用前にロールバックする (二手指しキャンセル相当)。
    if (disableServerSync) return;
    // Issue #193 / PR1a (B-1): 観戦モード (CPU vs CPU) では DB 保存しない (揮発モード)。
    if (!canPersist) return;
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
    // Issue #193 / PR1a: canPersist は spectatorMode から派生し対局中は変化しないため
    // deps 追加で実害なし、react-hooks/exhaustive-deps 要件を満たす。
  }, [state.gameState, state.cardState, state.doubleMove, gameId, disableServerSync, canPersist]);

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
    // Issue #193 / PR1a (B-1): 観戦モード時は DB 保存しない (揮発モード)。
    if (!canPersist) return;
    if (state.isPlayingCard || state.isDrawing || state.isCheckBreakAnimating) return;
    if (state.cardState === lastPersistedCardStateRef.current) return;
    lastPersistedCardStateRef.current = state.cardState;
    persistCardShogiState(gameId, state.gameState, state.cardState).catch((e) => {
      console.error("persistCardShogiState failed", e);
    });
    // Issue #193 / PR1a: canPersist deps 追加 (理由は上の useEffect と同じ)。
  }, [
    state.cardState,
    state.gameState,
    state.doubleMove,
    state.isPlayingCard,
    state.isDrawing,
    state.isCheckBreakAnimating,
    gameId,
    disableServerSync,
    canPersist,
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
      // Issue #193 / PR1a: 観戦モード (CPU vs CPU) ではユーザー操作を完全に無効化する。
      // 両プレイヤー AI 駆動の進行を妨げないため、selectSquare / selectHandPiece /
      // drawCard / beginPlayCard / confirmPlayCard / cancelPlayCard / undo /
      // resign / undoDoubleMoveFirst / cancelDoubleMove のすべてに同等のガードを追加。
      if (state.spectatorMode) return;
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
      // Issue #193 / PR1a: 観戦モードはユーザー操作不可
      if (state.spectatorMode) return;
      if (state.cardState.pendingCard) return;
      if (state.isDrawing || state.isPlayingCard) return; // Issue #82: 演出中は弾く
      if (state.isCheckBreakAnimating) return; // Issue #82 (王手崩し): トラップ演出中
      if (state.gameState.currentPlayer !== gameConfig.playerColor) return;
      dispatch({ type: "SELECT_HAND_PIECE", pieceType });
    },
    [state.spectatorMode, state.gameState.currentPlayer, gameConfig.playerColor, state.cardState.pendingCard, state.isDrawing, state.isPlayingCard, state.isCheckBreakAnimating],
  );

  const confirmPromotion = useCallback((promote: boolean) => {
    dispatch({ type: "CONFIRM_PROMOTION", promote });
  }, []);

  const cancelPromotion = useCallback(() => {
    dispatch({ type: "CANCEL_PROMOTION" });
  }, []);

  const resign = useCallback(() => {
    // Issue #193 / PR1a: 観戦モードはユーザー投了不可 (両 CPU 駆動の進行のみ)
    if (state.spectatorMode) return;
    // Issue #155: DB 保存は dispatch 結果が反映された state を見て useEffect 経由で
    // 行う (use-shogi-game.ts と同じ方式)。boardState + cardState を一緒に
    // "resign" 状態で永続化するため saveCardShogiResign を使う。
    dispatch({ type: "RESIGN" });
  }, [state.spectatorMode]);

  // Issue #155: 投了確定後の DB 保存 (card-shogi variant)。
  //   - saveCardShogiResign で boardState (status: "resign" を含む) と
  //     cardState (手札・マナ・トラップ等) を同時に永続化する。
  //   - resignedRef で重複保存防止 (StrictMode の二重 effect 等への保険)。
  //   - disableServerSync (テスト・モック用フラグ) は従来通り尊重する。
  const resignedRef = useRef(false);
  useEffect(() => {
    if (state.gameState.status !== "resign") return;
    if (resignedRef.current) return;
    if (disableServerSync) return;
    // Issue #193 / PR1a (B-1): 観戦モード時は DB 保存しない (揮発モード)。
    if (!canPersist) return;
    resignedRef.current = true;
    const winner = state.gameState.winner ?? "";
    void saveCardShogiResign(gameId, state.gameState, state.cardState, winner);
    // 依存配列を status に絞ることで status 不変ターンでの fire を抑止する。
    // gameState / cardState は effect 内で closure の最新値を参照する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.gameState.status, gameId, disableServerSync]);

  // Issue #132: 待った時に DB 側も巻き戻す。reducer dispatch は同期に state を更新しないため、
  // ref フラグを立てて next render の useEffect (後述) で post-UNDO state を確定後にサーバーアクションを呼ぶ。
  const pendingUndoSyncRef = useRef(false);
  const undo = useCallback(() => {
    // Issue #193 / PR1a: 観戦モードは undo 不可 (両 CPU 駆動の進行のみ)
    if (state.spectatorMode) return;
    if (state.gameState.moveHistory.length < 2) return;
    if (state.cardState.pendingCard) return;
    pendingUndoSyncRef.current = true;
    dispatch({ type: "UNDO" });
  }, [state.spectatorMode, state.gameState.moveHistory.length, state.cardState.pendingCard]);

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
    // Issue #193 / PR1a (B-1): 観戦モード時は DB 保存しない (揮発モード)。
    // ただし観戦モードでは UI 側で undo 操作が disable されているため通常はここに来ないが、保険として残す。
    if (!canPersist) return;
    undoCardShogiGameState(
      gameId,
      state.gameState,
      state.cardState,
      state.gameState.moveCount,
    ).catch((e) => {
      console.error("undoCardShogiGameState failed", e);
    });
    // Issue #193 / PR1a: canPersist deps 追加 (上 2 つの useEffect と同様の理由)。
  }, [state.gameState, state.cardState, gameId, disableServerSync, canPersist]);

  const deselect = useCallback(() => {
    dispatch({ type: "DESELECT" });
  }, []);

  const drawCard = useCallback(() => {
    // Issue #193 / PR1a: 観戦モードはユーザー操作不可
    if (state.spectatorMode) return;
    dispatch({ type: "DRAW_CARD", player: gameConfig.playerColor });
  }, [state.spectatorMode, gameConfig.playerColor]);

  // Issue #78: ドロー演出完了時に呼ぶ。currentPlayer を相手に渡し AI 思考を解禁する。
  const finalizeDraw = useCallback(() => {
    dispatch({ type: "COMMIT_DRAW" });
  }, []);

  const beginPlayCard = useCallback(
    (instanceId: string) => {
      // Issue #193 / PR1a: 観戦モードはユーザー操作不可
      if (state.spectatorMode) return;
      dispatch({ type: "BEGIN_PLAY_CARD", player: gameConfig.playerColor, instanceId });
    },
    [state.spectatorMode, gameConfig.playerColor],
  );

  const confirmPlayCard = useCallback(() => {
    // Issue #193 / PR1a: 観戦モードはユーザー操作不可
    if (state.spectatorMode) return;
    dispatch({ type: "CONFIRM_PLAY_CARD" });
  }, [state.spectatorMode]);

  // Issue #82: カード使用演出完了時に呼ぶ。currentPlayer を相手に渡し AI 思考を解禁する。
  const finalizePlayCard = useCallback(() => {
    dispatch({ type: "COMMIT_PLAY_CARD" });
  }, []);

  const cancelPlayCard = useCallback(() => {
    // Issue #193 / PR1a: 観戦モードはユーザー操作不可
    if (state.spectatorMode) return;
    dispatch({ type: "CANCEL_PLAY_CARD" });
  }, [state.spectatorMode]);

  // Issue #82 (王手崩し): トラップ演出完了時に呼ぶ。AI 思考とユーザー操作のロックを解除。
  const finalizeCheckBreak = useCallback(() => {
    dispatch({ type: "COMMIT_CHECK_BREAK" });
  }, []);

  // Issue #82 (二手指し): 1手目を取り消して preFirstMoveState から復元。
  // movesLeft===1 の時のみ動作。カードはまだ使用したまま、もう一度 1手目を選び直せる。
  const undoDoubleMoveFirst = useCallback(() => {
    // Issue #193 / PR1a: 観戦モードはユーザー操作不可
    if (state.spectatorMode) return;
    dispatch({ type: "UNDO_DOUBLE_MOVE_FIRST" });
  }, [state.spectatorMode]);

  // Issue #82 (二手指し / 新仕様): カード使用自体をキャンセル。
  // preCardState から完全復元、カードは手札に戻り、マナも消費されない。
  // movesLeft=2 (1手目前) でも movesLeft=1 (1手目後) でも実行可能。
  const cancelDoubleMove = useCallback(() => {
    // Issue #193 / PR1a: 観戦モードはユーザー操作不可
    if (state.spectatorMode) return;
    dispatch({ type: "CANCEL_DOUBLE_MOVE" });
  }, [state.spectatorMode]);

  // Issue #193 / PR1a: 観戦モード専用の一時停止 / 再開。
  // spectatorMode === true のときのみ動作 (人間プレイ時は no-op)。
  // PAUSE_GAME → reducer が isPaused=true → AI 自動応手 useEffect が
  // isPaused ガードで return → cancelAiRequest で in-flight の探索もキャンセル。
  // RESUME_GAME → isPaused=false → 自動応手再 trigger。
  const pauseSpectator = useCallback(() => {
    if (!state.spectatorMode) return;
    dispatch({ type: "PAUSE_GAME" });
    cancelAiRequest();
  }, [state.spectatorMode, cancelAiRequest]);

  const resumeSpectator = useCallback(() => {
    if (!state.spectatorMode) return;
    dispatch({ type: "RESUME_GAME" });
  }, [state.spectatorMode]);

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
    // Issue #149: 待った可能か (reducer 内部条件のみ)。UI 側で isPlayerTurn / isAiThinking と
    // 合わせて最終判定する。undoSnapshots 自体は公開せず派生値のみ公開し API を最小化。
    canUndo: canUndoFromState(state),
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
    aiError,
    dismissAiError,
    retryAiMove,
    // Issue #193 / PR1a: 観戦モード専用の状態と操作
    spectatorMode: state.spectatorMode,
    isPaused: state.isPaused,
    pauseSpectator,
    resumeSpectator,
  };
}
