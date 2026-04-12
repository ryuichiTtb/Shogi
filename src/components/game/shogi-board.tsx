"use client";

import { cn } from "@/lib/utils";
import { ShogiPiece } from "./shogi-piece";
import { useTouchHandler } from "@/hooks/use-touch-handler";
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
  squareSize: number;
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
  squareSize,
}: ShogiBoardProps) {
  const legalMoveSet = new Set(
    legalMoves.map((m) => `${m.to.row}-${m.to.col}`)
  );

  const isGote = playerColor === "gote";
  const { gridRef, pointerHandlers } = useTouchHandler({
    squareSize,
    legalMoves,
    selectedSquare,
    isGote,
    onSquareClick,
  });

  const isLastMoveSquare = (row: number, col: number) => {
    if (!lastMove) return false;
    const matchTo = lastMove.to.row === row && lastMove.to.col === col;
    const matchFrom = lastMove.from && lastMove.from.row === row && lastMove.from.col === col;
    return matchTo || matchFrom;
  };

  const isPlayerTurn = currentPlayer === playerColor;

  // 後手番時は行・列を逆順にして後手目線の盤面にする
  const rowIndices = isGote ? [8, 7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const colIndices = isGote ? [8, 7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const fileLabels = isGote ? FILE_LABELS_GOTE : FILE_LABELS_SENTE;
  const rankLabels = isGote ? RANK_LABELS_GOTE : RANK_LABELS_SENTE;

  const labelSize = Math.max(16, squareSize * 0.45);
  const dotSize = Math.max(8, squareSize * 0.22);

  return (
    <div className="flex flex-col items-center gap-0.5">
      {/* ファイルラベル（上） */}
      <div className="flex" style={{ marginLeft: labelSize + 4 }}>
        {fileLabels.map((label) => (
          <div
            key={label}
            className="flex items-center justify-center text-muted-foreground"
            style={{ width: squareSize, height: labelSize, fontSize: labelSize * 0.75 }}
          >
            {label}
          </div>
        ))}
      </div>

      <div className="flex">
        {/* ランクラベル（左） */}
        <div className="flex flex-col" style={{ marginRight: 2 }}>
          {rankLabels.map((label) => (
            <div
              key={label}
              className="flex items-center justify-center text-muted-foreground"
              style={{ height: squareSize, width: labelSize, fontSize: labelSize * 0.75 }}
            >
              {label}
            </div>
          ))}
        </div>

        {/* 盤面グリッド */}
        <div
          ref={gridRef}
          role="grid"
          aria-label="将棋盤"
          className="grid border border-amber-800 dark:border-amber-600 bg-amber-800/60 dark:bg-amber-600/40 relative"
          style={{
            gridTemplateColumns: `repeat(9, ${squareSize}px)`,
            gridTemplateRows: `repeat(9, ${squareSize}px)`,
            gap: "0.5px",
            touchAction: "none",
          }}
          onClick={(e) => e.stopPropagation()}
          {...pointerHandlers}
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
                  data-legal={isLegalTarget}
                  className={cn(
                    "shogi-square relative flex items-center justify-center",
                    "cursor-pointer",
                    // 通常背景
                    "bg-amber-50 dark:bg-amber-900/40",
                    // 直前の手（移動前・移動後）
                    isLastMoveSq && !isSelected && "bg-emerald-200 dark:bg-emerald-800/60",
                    // 王手中の王
                    isKingInCheck && "bg-red-300 dark:bg-red-800/70",
                    // 選択マス
                    isSelected && "bg-blue-200 dark:bg-blue-800/60",
                    // 合法手ハイライト
                    isLegalTarget && !piece && "bg-blue-200/70 dark:bg-blue-700/40",
                    isLegalTarget && piece && "bg-red-200/70 dark:bg-red-700/40",
                    // プレイヤーのターンでない・AI思考中は操作不可
                    (!isPlayerTurn || isAiThinking) && "cursor-not-allowed",
                    // ホバー
                    isPlayerTurn && !isAiThinking && "hover:bg-amber-100 dark:hover:bg-amber-800/50"
                  )}
                  style={{ width: squareSize, height: squareSize }}
                >
                  {/* 合法手ドット（空きマス） */}
                  {isLegalTarget && !piece && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div
                        className="rounded-full bg-blue-500/50"
                        style={{ width: dotSize, height: dotSize }}
                      />
                    </div>
                  )}

                  {/* 駒 */}
                  {piece && (
                    <div className="absolute inset-0">
                      <ShogiPiece
                        piece={piece}
                        isSelected={isSelected}
                        isInCheck={isKingInCheck}
                        playerColor={playerColor}
                        squareSize={squareSize}
                      />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* 右側スペーサー（段ラベルと同幅で盤面を中央に揃える） */}
        <div style={{ width: labelSize + 6 }} />
      </div>
    </div>
  );
}
