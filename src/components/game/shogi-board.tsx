"use client";

import { forwardRef, memo, useCallback, useImperativeHandle, useRef } from "react";

import { cn } from "@/lib/utils";
import { ShogiPiece } from "./shogi-piece";
import { useTouchHandler } from "@/hooks/use-touch-handler";
import {
  SHOGI_BOARD_GAP,
  getShogiBoardCellSize,
  getShogiBoardLabelSize,
} from "@/lib/shogi/board-layout";
import type { Board, Move, Piece, Player, Position } from "@/lib/shogi/types";

export interface ShogiBoardHandle {
  getSquareRect: (row: number, col: number) => DOMRect | null;
}

interface ShogiBoardProps {
  board: Board;
  currentPlayer: Player;
  playerColor: Player;
  selectedSquare: Position | null;
  legalMoves: Move[];
  lastMove: Move | null;
  isAiThinking: boolean;
  inCheck: boolean;
  onSquareClick: (pos: Position) => void;
  squareSize: number;
  isMobile: boolean;
  // カード将棋: 歩戻し等のターゲット選択時にハイライトするマス。標準将棋では未指定。
  cardTargetSquares?: Position[];
  // カード将棋: no_promote の永続「成り不可」マーク位置 (両プレイヤー分をまとめて指定)。
  noPromoteSquares?: Position[];
  // カード将棋 (Issue #82): 駒フライト中、着地点の駒を非表示にするためのマス。
  // 指定したマスの駒は visibility: hidden で消す (レイアウトは保持)。
  hiddenSquares?: Position[];
  // カード将棋 (Issue #82 二手指し): 「禁止された詰み手」のマス。
  // 赤背景 + × アイコンを表示し、クリック時にダイアログで禁止理由を説明する。
  // クリック自体は通常通り onSquareClick が発火するので、禁止マスかどうかの判定は呼出元 (UI) で行う。
  forbiddenMateSquares?: Position[];
}

// 先手目線のラベル
const FILE_LABELS_SENTE = ["9", "8", "7", "6", "5", "4", "3", "2", "1"];
const RANK_LABELS_SENTE = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];

// 後手目線のラベル（逆順）
const FILE_LABELS_GOTE = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
const RANK_LABELS_GOTE = ["九", "八", "七", "六", "五", "四", "三", "二", "一"];

// マスごとの ref 登録/解除を行う関数の型。親側で安定化して BoardSquare に渡す。
type RegisterSquareRef = (row: number, col: number, el: HTMLDivElement | null) => void;

interface BoardSquareProps {
  rowIdx: number;
  colIdx: number;
  piece: Piece | null;
  isSelected: boolean;
  isLegalTarget: boolean;
  isCardTarget: boolean;
  isForbiddenMate: boolean;
  isNoPromote: boolean;
  isHidden: boolean;
  isLastMoveSq: boolean;
  isKingInCheck: boolean;
  isStarPoint: boolean;
  canHover: boolean;
  cellWidth: number;
  cellHeight: number;
  dotSize: number;
  playerColor: Player;
  registerRef: RegisterSquareRef;
}

// 81 マスの 1 マス分。React.memo でラップし、変わっていないマスの再描画を skip する。
// onClick 系は親 grid の pointerHandlers (useTouchHandler) で一括処理しているため、
// BoardSquare 自身は受け取らない。
const BoardSquare = memo(function BoardSquare({
  rowIdx,
  colIdx,
  piece,
  isSelected,
  isLegalTarget,
  isCardTarget,
  isForbiddenMate,
  isNoPromote,
  isHidden,
  isLastMoveSq,
  isKingInCheck,
  isStarPoint,
  canHover,
  cellWidth,
  cellHeight,
  dotSize,
  playerColor,
  registerRef,
}: BoardSquareProps) {
  // ref 登録は registerRef + (rowIdx, colIdx) で stabilize。BoardSquare が memo で
  // 再描画 skip されると、ref callback の identity も変わらない。
  const setRef = useCallback(
    (el: HTMLDivElement | null) => registerRef(rowIdx, colIdx, el),
    [rowIdx, colIdx, registerRef],
  );

  return (
    <div
      ref={setRef}
      data-legal={isLegalTarget}
      className={cn(
        "shogi-square relative flex items-center justify-center",
        "cursor-pointer",
        // 通常背景
        "bg-amber-50 dark:bg-amber-950",
        // 直前の手（移動前・移動後）
        isLastMoveSq && !isSelected && "bg-emerald-200 dark:bg-emerald-800/60",
        // 王手中の王
        isKingInCheck && "bg-red-300 dark:bg-red-800/70",
        // 選択マス
        isSelected && "bg-blue-200 dark:bg-blue-800/60",
        // 合法手ハイライト
        isLegalTarget && !piece && "bg-blue-200/70 dark:bg-blue-700/40",
        isLegalTarget && piece && "bg-red-200/70 dark:bg-red-700/40",
        // カード効果のターゲット候補(歩戻し等) - 既存の合法手ハイライトより優先
        isCardTarget && "bg-amber-300/80 dark:bg-amber-500/40 ring-2 ring-inset ring-amber-500 dark:ring-amber-300 animate-pulse",
        // 二手指し 2手目で禁止された詰み手 (Issue #82) - 合法手ハイライトより優先
        isForbiddenMate && "bg-red-400/60 dark:bg-red-700/50 ring-2 ring-inset ring-red-600 dark:ring-red-400",
        // プレイヤーのターンでない・AI思考中は操作不可
        !canHover && !isCardTarget && "cursor-not-allowed",
        // ホバー
        canHover && "hover:bg-amber-100 dark:hover:bg-amber-800/50"
      )}
      style={{ width: cellWidth, height: cellHeight }}
    >
      {/* 星目（中央3×3四隅の交差点） */}
      {isStarPoint && (
        <div
          className="absolute z-10 rounded-full bg-amber-900 dark:bg-amber-400 pointer-events-none"
          style={{
            width: Math.max(4, cellWidth * 0.08),
            height: Math.max(4, cellWidth * 0.08),
            bottom: 0,
            right: 0,
            transform: "translate(50%, 50%)",
          }}
        />
      )}

      {/* 合法手ドット（空きマス） */}
      {isLegalTarget && !piece && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div
            className="rounded-full bg-blue-500/50"
            style={{ width: dotSize, height: dotSize }}
          />
        </div>
      )}

      {/* 二手指し 2手目: 禁止された詰み手 (Issue #82) - 赤背景 + × アイコン */}
      {isForbiddenMate && (
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none z-30"
          aria-label="禁止された詰み手"
        >
          <span
            className="text-red-700 dark:text-red-300 font-bold leading-none select-none"
            style={{
              fontSize: Math.max(20, cellWidth * 0.6),
              filter: "drop-shadow(0 0 3px rgba(255,255,255,0.8))",
            }}
          >
            ×
          </span>
        </div>
      )}

      {/* 駒 (Issue #82: hiddenSquares 指定時はフライト中につき非表示) */}
      {piece && (
        <div
          className="absolute inset-0"
          style={isHidden ? { opacity: 0, pointerEvents: "none" } : undefined}
        >
          <ShogiPiece
            piece={piece}
            isSelected={isSelected}
            isInCheck={isKingInCheck}
            playerColor={playerColor}
            squareSize={cellWidth}
          />
        </div>
      )}

      {/* no_promote 永続マーク (紫枠 + 🚫) */}
      {isNoPromote && (
        <div
          className="absolute inset-0 pointer-events-none z-20 ring-2 ring-inset ring-purple-500 dark:ring-purple-300"
          aria-label="成り不可"
        >
          <span
            className="absolute leading-none select-none"
            style={{
              right: 1,
              top: 1,
              fontSize: Math.max(10, cellWidth * 0.32),
              filter: "drop-shadow(0 0 2px rgba(168,85,247,0.9))",
            }}
          >
            🚫
          </span>
        </div>
      )}
    </div>
  );
});

export const ShogiBoard = memo(forwardRef<ShogiBoardHandle, ShogiBoardProps>(function ShogiBoard(
  {
    board,
    currentPlayer,
    playerColor,
    selectedSquare,
    legalMoves,
    lastMove,
    isAiThinking,
    inCheck,
    onSquareClick,
    squareSize,
    isMobile,
    cardTargetSquares,
    noPromoteSquares,
    hiddenSquares,
    forbiddenMateSquares,
  },
  forwardedRef,
) {
  const squareRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useImperativeHandle(
    forwardedRef,
    () => ({
      getSquareRect: (row, col) => {
        const el = squareRefs.current.get(`${row}-${col}`);
        return el ? el.getBoundingClientRect() : null;
      },
    }),
    [],
  );

  // ref 登録/解除を BoardSquare に渡す。useCallback で stable 化することで
  // BoardSquare の memo 比較を維持する (deps なし)。
  const registerSquareRef = useCallback<RegisterSquareRef>((row, col, el) => {
    const key = `${row}-${col}`;
    if (el) squareRefs.current.set(key, el);
    else squareRefs.current.delete(key);
  }, []);

  const legalMoveSet = new Set(
    legalMoves.map((m) => `${m.to.row}-${m.to.col}`)
  );
  const cardTargetSet = new Set(
    (cardTargetSquares ?? []).map((p) => `${p.row}-${p.col}`)
  );
  const noPromoteSet = new Set(
    (noPromoteSquares ?? []).map((p) => `${p.row}-${p.col}`)
  );
  const hiddenSet = new Set(
    (hiddenSquares ?? []).map((p) => `${p.row}-${p.col}`)
  );
  const forbiddenMateSet = new Set(
    (forbiddenMateSquares ?? []).map((p) => `${p.row}-${p.col}`)
  );

  const isGote = playerColor === "gote";
  const cellSize = getShogiBoardCellSize(squareSize);
  // タップスナップ対象は legalMoves + forbiddenMateMoves。
  // 禁止マスもタップで反応する (UI 側で禁止理由ダイアログを表示する) ため、スナップ対象に含める。
  const tapSnapMoves = forbiddenMateSquares && forbiddenMateSquares.length > 0
    ? [
        ...legalMoves,
        ...forbiddenMateSquares.map((p) => ({
          type: "move" as const,
          to: p,
          piece: "",
          player: currentPlayer,
        })),
      ]
    : legalMoves;
  const { gridRef, pointerHandlers } = useTouchHandler({
    cellWidth: cellSize.width,
    cellHeight: cellSize.height,
    legalMoves: tapSnapMoves,
    selectedSquare,
    isGote,
    onSquareClick,
  });

  const isLastMoveSquare = (row: number, col: number): boolean => {
    if (!lastMove) return false;
    const matchTo = lastMove.to.row === row && lastMove.to.col === col;
    const matchFrom = !!lastMove.from && lastMove.from.row === row && lastMove.from.col === col;
    return matchTo || matchFrom;
  };

  const isPlayerTurn = currentPlayer === playerColor;
  const canHover = isPlayerTurn && !isAiThinking;

  // 後手番時は行・列を逆順にして後手目線の盤面にする
  const rowIndices = isGote ? [8, 7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const colIndices = isGote ? [8, 7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const fileLabels = isGote ? FILE_LABELS_GOTE : FILE_LABELS_SENTE;
  const rankLabels = isGote ? RANK_LABELS_GOTE : RANK_LABELS_SENTE;

  const labelSize = getShogiBoardLabelSize(squareSize, isMobile);
  const dotSize = Math.max(8, cellSize.width * 0.22);

  return (
    <div className="flex flex-col items-center gap-0.5">
      {/* ファイルラベル（上） */}
      <div className="flex" style={{ marginLeft: labelSize + 4 }}>
        {fileLabels.map((label) => (
          <div
            key={label}
            className="flex items-center justify-center text-muted-foreground"
            style={{ width: cellSize.width, height: labelSize, fontSize: labelSize * 0.75 }}
          >
            {label}
          </div>
        ))}
      </div>

      <div className="flex">
        {/* 左側スペーサー（段ラベルと同幅で盤面を中央に揃える、モバイルでは省略） */}
        {!isMobile && <div style={{ width: labelSize + 6 }} />}

        {/* 盤面グリッド */}
        <div
          ref={gridRef}
          data-shogi-board-grid="1"
          role="grid"
          aria-label="将棋盤"
          className="grid border border-amber-800 dark:border-amber-400 bg-amber-800/60 dark:bg-amber-400/60 relative"
          style={{
            gridTemplateColumns: `repeat(9, ${cellSize.width}px)`,
            gridTemplateRows: `repeat(9, ${cellSize.height}px)`,
            gap: SHOGI_BOARD_GAP,
            touchAction: "none",
          }}
          onClick={(e) => e.stopPropagation()}
          {...pointerHandlers}
        >
          {rowIndices.map((rowIdx, visualRow) =>
            colIndices.map((colIdx, visualCol) => {
              const piece = board[rowIdx][colIdx];
              const isSelected =
                selectedSquare?.row === rowIdx &&
                selectedSquare?.col === colIdx;
              const isLegalTarget = legalMoveSet.has(`${rowIdx}-${colIdx}`);
              const isCardTarget = cardTargetSet.has(`${rowIdx}-${colIdx}`);
              const isForbiddenMate = forbiddenMateSet.has(`${rowIdx}-${colIdx}`);
              const isNoPromote = noPromoteSet.has(`${rowIdx}-${colIdx}`);
              const isHidden = hiddenSet.has(`${rowIdx}-${colIdx}`);
              const isLastMoveSq = isLastMoveSquare(rowIdx, colIdx);
              const isKingInCheck =
                inCheck &&
                piece?.type === "king" &&
                piece.owner === currentPlayer;
              const isStarPoint =
                (visualRow === 2 || visualRow === 5) &&
                (visualCol === 2 || visualCol === 5);

              return (
                <BoardSquare
                  key={`${rowIdx}-${colIdx}`}
                  rowIdx={rowIdx}
                  colIdx={colIdx}
                  piece={piece}
                  isSelected={isSelected}
                  isLegalTarget={isLegalTarget}
                  isCardTarget={isCardTarget}
                  isForbiddenMate={isForbiddenMate}
                  isNoPromote={isNoPromote}
                  isHidden={isHidden}
                  isLastMoveSq={isLastMoveSq}
                  isKingInCheck={isKingInCheck}
                  isStarPoint={isStarPoint}
                  canHover={canHover}
                  cellWidth={cellSize.width}
                  cellHeight={cellSize.height}
                  dotSize={dotSize}
                  playerColor={playerColor}
                  registerRef={registerSquareRef}
                />
              );
            })
          )}
        </div>

        {/* ランクラベル（右） */}
        <div className="flex flex-col" style={{ marginLeft: 2 }}>
          {rankLabels.map((label) => (
            <div
              key={label}
              className="flex items-center justify-center text-muted-foreground"
              style={{ height: cellSize.height, width: labelSize, fontSize: labelSize * 0.75 }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}));
