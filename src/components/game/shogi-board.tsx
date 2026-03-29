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
  inCheck: boolean;
  onSquareClick: (pos: Position) => void;
}

// 先手目線のラベル
const FILE_LABELS_SENTE = ["9", "8", "7", "6", "5", "4", "3", "2", "1"];
const RANK_LABELS_SENTE = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];

// 後手目線のラベル（逆順）
const FILE_LABELS_GOTE = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
const RANK_LABELS_GOTE = ["九", "八", "七", "六", "五", "四", "三", "二", "一"];

export function ShogiBoard({
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
  const isGote = playerColor === "gote";

  // 後手番時は行・列を逆順にして後手目線の盤面にする
  const rowIndices = isGote ? [8, 7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const colIndices = isGote ? [8, 7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const fileLabels = isGote ? FILE_LABELS_GOTE : FILE_LABELS_SENTE;
  const rankLabels = isGote ? RANK_LABELS_GOTE : RANK_LABELS_SENTE;

  return (
    <div className="flex flex-col items-center gap-1">
      {/* ファイルラベル（上） */}
      <div className="flex ml-6">
        {fileLabels.map((label) => (
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
          {rankLabels.map((label) => (
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
          {rowIndices.map((rowIdx) =>
            colIndices.map((colIdx) => {
              const piece = board[rowIdx][colIdx];
              const pos = { row: rowIdx, col: colIdx };
              const isSelected =
                selectedSquare?.row === rowIdx &&
                selectedSquare?.col === colIdx;
              const isLegalTarget = legalMoveSet.has(`${rowIdx}-${colIdx}`);
              const isLastMoveSq = isLastMoveSquare(rowIdx, colIdx);
              const isKingInCheck =
                inCheck &&
                piece?.type === "king" &&
                piece.owner === currentPlayer;

              return (
                <div
                  key={`${rowIdx}-${colIdx}`}
                  onClick={(e) => { e.stopPropagation(); onSquareClick(pos); }}
                  className={cn(
                    "w-10 h-10 border border-amber-700/60 relative flex items-center justify-center",
                    "cursor-pointer transition-colors duration-100",
                    // 通常背景
                    "bg-amber-50",
                    // 直前の手（移動前・移動後）
                    isLastMoveSq && !isSelected && "bg-emerald-200",
                    // 王手中の王
                    isKingInCheck && "bg-red-300",
                    // 選択マス
                    isSelected && "bg-blue-200",
                    // 合法手ハイライト
                    isLegalTarget && !piece && "bg-blue-200/70",
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
                      <div className="w-3 h-3 rounded-full bg-blue-500/50" />
                    </div>
                  )}

                  {/* 駒 */}
                  {piece && (
                    <div className="absolute inset-0">
                      <ShogiPiece
                        piece={piece}
                        isSelected={isSelected}
                        isInCheck={isKingInCheck}
                      />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* 右側スペーサー（段ラベルと同幅で盤面を中央に揃える） */}
        <div className="w-6" />
      </div>

    </div>
  );
}
