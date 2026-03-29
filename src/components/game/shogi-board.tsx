"use client";

import { cn } from "@/lib/utils";
import { ShogiPiece } from "./shogi-piece";
import type { Board, Move, Player, Position } from "@/lib/shogi/types";

interface ShogiBoardProps {
  board: Board;
  currentPlayer: Player;
  playerColor: Player;
  selectedSquare: Position | null;
  legalMoves: Move[];
  lastMove: Move | null;
  isAiThinking: boolean;
  onSquareClick: (pos: Position) => void;
}

// 列ラベル（筋）: col=0 → 9, col=8 → 1
const FILE_LABELS = ["9", "8", "7", "6", "5", "4", "3", "2", "1"];
// 行ラベル（段）
const RANK_LABELS = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];

export function ShogiBoard({
  board,
  currentPlayer,
  playerColor,
  selectedSquare,
  legalMoves,
  lastMove,
  isAiThinking,
  onSquareClick,
}: ShogiBoardProps) {
  const legalMoveSet = new Set(
    legalMoves.map((m) => `${m.to.row}-${m.to.col}`)
  );

  const isLastMoveSquare = (row: number, col: number) => {
    if (!lastMove) return false;
    const matchTo = lastMove.to.row === row && lastMove.to.col === col;
    const matchFrom = lastMove.from && lastMove.from.row === row && lastMove.from.col === col;
    return matchTo || matchFrom;
  };

  const isPlayerTurn = currentPlayer === playerColor;

  return (
    <div className="flex flex-col items-center gap-1">
      {/* ファイルラベル（上） */}
      <div className="flex ml-6">
        {FILE_LABELS.map((label) => (
          <div
            key={label}
            className="w-10 h-4 flex items-center justify-center text-xs text-muted-foreground"
          >
            {label}
          </div>
        ))}
      </div>

      <div className="flex">
        {/* ランクラベル（左） */}
        <div className="flex flex-col mr-1">
          {RANK_LABELS.map((label) => (
            <div
              key={label}
              className="h-10 w-5 flex items-center justify-center text-xs text-muted-foreground"
            >
              {label}
            </div>
          ))}
        </div>

        {/* 盤面グリッド */}
        <div
          className={cn(
            "grid border-2 border-amber-800",
            "relative"
          )}
          style={{ gridTemplateColumns: "repeat(9, 2.5rem)", gridTemplateRows: "repeat(9, 2.5rem)" }}
        >
          {board.map((row, rowIdx) =>
            row.map((piece, colIdx) => {
              const pos = { row: rowIdx, col: colIdx };
              const isSelected =
                selectedSquare?.row === rowIdx &&
                selectedSquare?.col === colIdx;
              const isLegalTarget = legalMoveSet.has(`${rowIdx}-${colIdx}`);
              const isLastRank =
                rowIdx === board.length - 1 && colIdx === row.length - 1;
              const isLastMoveSq = isLastMoveSquare(rowIdx, colIdx);

              return (
                <div
                  key={`${rowIdx}-${colIdx}`}
                  onClick={() => onSquareClick(pos)}
                  className={cn(
                    "w-10 h-10 border border-amber-700/60 relative flex items-center justify-center",
                    "cursor-pointer transition-colors duration-100",
                    // 通常背景
                    "bg-amber-50",
                    // 直前の手（移動前・移動後）
                    isLastMoveSq && !isSelected && "bg-yellow-200",
                    // 選択マス
                    isSelected && "bg-blue-200",
                    // 合法手ハイライト
                    isLegalTarget && !piece && "bg-green-200/70",
                    isLegalTarget && piece && "bg-red-200/70",
                    // プレイヤーのターンでない・AI思考中は操作不可
                    (!isPlayerTurn || isAiThinking) && "cursor-not-allowed",
                    // ホバー
                    isPlayerTurn && !isAiThinking && "hover:bg-amber-100"
                  )}
                >
                  {/* 合法手ドット（空きマス） */}
                  {isLegalTarget && !piece && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="w-3 h-3 rounded-full bg-green-500/50" />
                    </div>
                  )}

                  {/* 駒 */}
                  {piece && (
                    <div className="absolute inset-0.5">
                      <ShogiPiece
                        piece={piece}
                        isSelected={isSelected}
                      />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

    </div>
  );
}
