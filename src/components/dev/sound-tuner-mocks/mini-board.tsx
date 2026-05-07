"use client";

// Issue #79: 個別音源調整画面の摸擬 UI 用ミニ将棋盤。
// 任意 rows × cols のグリッドを描画し、各マスに駒/ハイライト/クリック判定を持つ。
// 既存 ShogiPiece を流用 (見た目を本番と統一)。
//
// 摸擬 UI 専用のため board モード (盤駒の選択 + 移動先表示 + クリック) を
// 1 コンポーネントで完結させる。完全な ShogiBoard ほどリッチではない。

import { memo } from "react";

import { ShogiPiece } from "@/components/game/shogi-piece";
import type { Piece, Player } from "@/lib/shogi/variants/types";
import { cn } from "@/lib/utils";

export interface MiniSquare {
  row: number;
  col: number;
  piece?: Piece | null;
  /** 選択中マスとしてハイライト */
  selected?: boolean;
  /** 移動先候補としてハイライト */
  targetable?: boolean;
  /** 着地マスとしてハイライト (アニメ後等) */
  landed?: boolean;
  /** 敵陣マーキング (薄色) */
  promotionZone?: boolean;
}

interface MiniBoardProps {
  rows: number;
  cols: number;
  squareSize?: number; // px
  squares: MiniSquare[];
  /** プレイヤー視点。sente: 下から見上げる、gote: 上から見下ろす */
  playerColor?: Player;
  onSquareClick?: (row: number, col: number) => void;
}

function MiniBoardImpl({
  rows,
  cols,
  squareSize = 56,
  squares,
  playerColor = "sente",
  onSquareClick,
}: MiniBoardProps) {
  // 検索高速化: row,col → MiniSquare
  const lookup = new Map<string, MiniSquare>();
  for (const sq of squares) {
    lookup.set(`${sq.row},${sq.col}`, sq);
  }

  // sente 視点: row 0 = 上 (相手側)、row max = 下 (自分側) — 既存盤と同じ
  // 描画順序は row 0 → row max を上から下へ
  const rowIndices = Array.from({ length: rows }, (_, i) => i);
  const colIndices = Array.from({ length: cols }, (_, i) => i);

  return (
    <div
      role="grid"
      aria-label="ミニ将棋盤"
      className="inline-block bg-amber-100/80 dark:bg-amber-950/30 border-2 border-amber-700/70 rounded-md p-0.5"
      style={{ touchAction: "manipulation" }}
    >
      {rowIndices.map((row) => (
        <div key={row} role="row" className="flex">
          {colIndices.map((col) => {
            const sq = lookup.get(`${row},${col}`);
            const piece = sq?.piece ?? null;
            const isClickable = !!onSquareClick;
            return (
              <button
                key={col}
                role="gridcell"
                type="button"
                onClick={isClickable ? () => onSquareClick?.(row, col) : undefined}
                disabled={!isClickable}
                aria-label={`${row + 1}行${col + 1}列${piece ? ` (${piece.type})` : ""}`}
                className={cn(
                  "relative flex items-center justify-center border border-amber-700/50 transition-colors",
                  isClickable && "cursor-pointer hover:bg-amber-200/60 dark:hover:bg-amber-900/40",
                  !isClickable && "cursor-default",
                  sq?.promotionZone && "bg-red-100/40 dark:bg-red-950/20",
                  sq?.targetable && "bg-emerald-200/60 dark:bg-emerald-800/40",
                  sq?.selected && "bg-blue-200/70 dark:bg-blue-800/50 ring-2 ring-blue-500 z-10",
                  sq?.landed && "bg-yellow-200/70 dark:bg-yellow-800/50 animate-pulse",
                )}
                style={{ width: squareSize, height: squareSize }}
              >
                {piece && (
                  <ShogiPiece
                    piece={piece}
                    isSmall
                    playerColor={playerColor}
                    squareSize={squareSize}
                  />
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export const MiniBoard = memo(MiniBoardImpl);
