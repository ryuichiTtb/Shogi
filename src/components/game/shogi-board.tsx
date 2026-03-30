"use client";

import { memo, useMemo, useCallback } from "react";
import { cn } from "@/lib/utils";
import { ShogiPiece } from "./shogi-piece";
import type { Board, Move, Player, Position, Piece } from "@/lib/shogi/types";

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
}

// 先手目線のラベル
const FILE_LABELS_SENTE = ["9", "8", "7", "6", "5", "4", "3", "2", "1"];
const RANK_LABELS_SENTE = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];

// 後手目線のラベル（逆順）
const FILE_LABELS_GOTE = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
const RANK_LABELS_GOTE = ["九", "八", "七", "六", "五", "四", "三", "二", "一"];

// --- BoardCell: 個別セルを React.memo でラップ ---

interface BoardCellProps {
  rowIdx: number;
  colIdx: number;
  piece: Piece | null;
  isSelected: boolean;
  isLegalTarget: boolean;
  isLastMoveSq: boolean;
  isKingInCheck: boolean;
  isPlayerTurn: boolean;
  isAiThinking: boolean;
  playerColor: Player;
  onSquareClick: (pos: Position) => void;
}

const BoardCell = memo(function BoardCell({
  rowIdx,
  colIdx,
  piece,
  isSelected,
  isLegalTarget,
  isLastMoveSq,
  isKingInCheck,
  isPlayerTurn,
  isAiThinking,
  playerColor,
  onSquareClick,
}: BoardCellProps) {
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onSquareClick({ row: rowIdx, col: colIdx });
    },
    [rowIdx, colIdx, onSquareClick]
  );

  return (
    <div
      onClick={handleClick}
      className={cn(
        "border border-amber-700/60 relative flex items-center justify-center",
        "cursor-pointer transition-colors duration-100",
        "bg-amber-50",
        isLastMoveSq && !isSelected && "bg-emerald-200",
        isKingInCheck && "bg-red-300",
        isSelected && "bg-blue-200",
        isLegalTarget && !piece && "bg-blue-200/70",
        isLegalTarget && piece && "bg-red-200/70",
        (!isPlayerTurn || isAiThinking) && "cursor-not-allowed",
        isPlayerTurn && !isAiThinking && "hover:bg-amber-100"
      )}
    >
      {/* 合法手ドット（空きマス） — サイズをセル比率で指定 */}
      {isLegalTarget && !piece && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-[30%] h-[30%] rounded-full bg-blue-500/50" />
        </div>
      )}
      {piece && (
        <div className="absolute inset-0">
          <ShogiPiece
            piece={piece}
            isSelected={isSelected}
            isInCheck={isKingInCheck}
            playerColor={playerColor}
          />
        </div>
      )}
    </div>
  );
});

// --- ShogiBoard: メモ化 + 動的サイズ ---

export const ShogiBoard = memo(function ShogiBoard({
  board,
  currentPlayer,
  playerColor,
  selectedSquare,
  legalMoves,
  lastMove,
  isAiThinking,
  inCheck,
  onSquareClick,
}: ShogiBoardProps) {
  const legalMoveSet = useMemo(
    () => new Set(legalMoves.map((m) => `${m.to.row}-${m.to.col}`)),
    [legalMoves]
  );

  const lastMoveSquares = useMemo(() => {
    if (!lastMove) return new Set<string>();
    const set = new Set<string>();
    set.add(`${lastMove.to.row}-${lastMove.to.col}`);
    if (lastMove.from) set.add(`${lastMove.from.row}-${lastMove.from.col}`);
    return set;
  }, [lastMove]);

  const isPlayerTurn = currentPlayer === playerColor;
  const isGote = playerColor === "gote";

  const rowIndices = isGote ? [8, 7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const colIndices = isGote ? [8, 7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const fileLabels = isGote ? FILE_LABELS_GOTE : FILE_LABELS_SENTE;
  const rankLabels = isGote ? RANK_LABELS_GOTE : RANK_LABELS_SENTE;

  return (
    // 親の flex-1 min-h-0 を満たすため h-full w-full で展開
    <div className="h-full w-full flex items-center justify-center">
      {/* 正方形コンテナ: 高さを基準に aspect-ratio で幅を決定 */}
      <div
        className="flex flex-col"
        style={{ height: "100%", aspectRatio: "1 / 1", maxWidth: "100%" }}
      >
        {/* ファイルラベル（上） — 左スペーサー + 9列 + 右スペーサーで盤面と揃える */}
        <div className="flex shrink-0">
          <div className="w-5 shrink-0" />
          {fileLabels.map((label) => (
            <div
              key={label}
              className="flex-1 flex items-center justify-center leading-none py-0.5 text-[clamp(0.4rem,1.2vw,0.65rem)] text-muted-foreground"
            >
              {label}
            </div>
          ))}
          <div className="w-5 shrink-0" />
        </div>

        {/* ランクラベル + 盤面グリッド */}
        <div className="flex flex-1 min-h-0">
          {/* ランクラベル（左） */}
          <div className="flex flex-col w-5 shrink-0">
            {rankLabels.map((label) => (
              <div
                key={label}
                className="flex-1 flex items-center justify-center leading-none text-[clamp(0.4rem,1.2vw,0.65rem)] text-muted-foreground"
              >
                {label}
              </div>
            ))}
          </div>

          {/* 盤面グリッド — 1fr でセルを自動サイズ化 */}
          <div
            className="flex-1 grid border-2 border-amber-800"
            style={{
              gridTemplateColumns: "repeat(9, 1fr)",
              gridTemplateRows: "repeat(9, 1fr)",
            }}
          >
            {rowIndices.map((rowIdx) =>
              colIndices.map((colIdx) => {
                const piece = board[rowIdx][colIdx];
                const key = `${rowIdx}-${colIdx}`;
                const isSelected =
                  selectedSquare?.row === rowIdx &&
                  selectedSquare?.col === colIdx;
                const isLegalTarget = legalMoveSet.has(key);
                const isLastMoveSq = lastMoveSquares.has(key);
                const isKingInCheck =
                  inCheck &&
                  piece?.type === "king" &&
                  piece.owner === currentPlayer;

                return (
                  <BoardCell
                    key={key}
                    rowIdx={rowIdx}
                    colIdx={colIdx}
                    piece={piece}
                    isSelected={isSelected}
                    isLegalTarget={isLegalTarget}
                    isLastMoveSq={isLastMoveSq}
                    isKingInCheck={isKingInCheck}
                    isPlayerTurn={isPlayerTurn}
                    isAiThinking={isAiThinking}
                    playerColor={playerColor}
                    onSquareClick={onSquareClick}
                  />
                );
              })
            )}
          </div>

          {/* 右スペーサー（ランクラベルと同幅で視覚的バランスを保つ） */}
          <div className="w-5 shrink-0" />
        </div>
      </div>
    </div>
  );
});
