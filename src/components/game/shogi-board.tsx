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
  isAiThinking,
  onSquareClick,
}: ShogiBoardProps) {
  const legalMoveSet = new Set(
    legalMoves.map((m) => `${m.to.row}-${m.to.col}`)
  );

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

              return (
                <div
                  key={`${rowIdx}-${colIdx}`}
                  onClick={() => onSquareClick(pos)}
                  className={cn(
                    "w-10 h-10 border border-amber-700/60 relative flex items-center justify-center",
                    "cursor-pointer transition-colors duration-100",
                    // 交互に少し異なる背景
                    "bg-amber-50",
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

      {/* AI思考中インジケータ */}
      {isAiThinking && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
          <div className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce"
                style={{ animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </div>
          <span>思考中...</span>
        </div>
      )}
    </div>
  );
}
