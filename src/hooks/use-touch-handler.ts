"use client";

import { useRef, useCallback } from "react";
import type { Move, Position } from "@/lib/shogi/types";

interface UseTouchHandlerOptions {
  squareSize: number;
  legalMoves: Move[];
  selectedSquare: Position | null;
  isGote: boolean;
  onSquareClick: (pos: Position) => void;
}

// タップ位置から合法手マスへのスナップ補正閾値（マスサイズの40%）
const SNAP_THRESHOLD_RATIO = 0.4;

export function useTouchHandler({
  squareSize,
  legalMoves,
  selectedSquare,
  isGote,
  onSquareClick,
}: UseTouchHandlerOptions) {
  const gridRef = useRef<HTMLDivElement>(null);
  // pointerdown時の座標を記録（スクロールとタップを区別するため）
  const pointerDownPos = useRef<{ x: number; y: number } | null>(null);

  const getGridPosition = useCallback(
    (clientX: number, clientY: number): Position | null => {
      const grid = gridRef.current;
      if (!grid) return null;

      const rect = grid.getBoundingClientRect();
      const relX = clientX - rect.left;
      const relY = clientY - rect.top;

      // グリッド外ならnull
      if (relX < 0 || relY < 0 || relX >= rect.width || relY >= rect.height) {
        return null;
      }

      const rawCol = Math.floor(relX / squareSize);
      const rawRow = Math.floor(relY / squareSize);

      // 後手時は行・列を反転（isGoteの場合rowIndices/colIndicesが逆順）
      const col = isGote ? 8 - rawCol : rawCol;
      const row = isGote ? 8 - rawRow : rawRow;

      if (row < 0 || row > 8 || col < 0 || col > 8) return null;

      return { row, col };
    },
    [squareSize, isGote]
  );

  const snapToLegalMove = useCallback(
    (clientX: number, clientY: number, rawPos: Position): Position => {
      // 駒が選択されていない場合はスナップ不要
      if (!selectedSquare) return rawPos;

      const legalTargets = legalMoves.filter((m) => m.type === "move" || m.type === "drop");
      if (legalTargets.length === 0) return rawPos;

      // タップした座標が既に合法手マスなら補正不要
      const isAlreadyLegal = legalTargets.some(
        (m) => m.to.row === rawPos.row && m.to.col === rawPos.col
      );
      if (isAlreadyLegal) return rawPos;

      const grid = gridRef.current;
      if (!grid) return rawPos;

      const rect = grid.getBoundingClientRect();
      const relX = clientX - rect.left;
      const relY = clientY - rect.top;

      const threshold = squareSize * SNAP_THRESHOLD_RATIO;

      let nearestTarget: Position | null = null;
      let minDistance = Infinity;

      for (const move of legalTargets) {
        const { row: targetRow, col: targetCol } = move.to;

        // 後手時は表示上の行・列を変換
        const displayRow = isGote ? 8 - targetRow : targetRow;
        const displayCol = isGote ? 8 - targetCol : targetCol;

        // マスの中心座標（グリッド相対）
        const centerX = (displayCol + 0.5) * squareSize;
        const centerY = (displayRow + 0.5) * squareSize;

        const dist = Math.hypot(relX - centerX, relY - centerY);
        if (dist < minDistance) {
          minDistance = dist;
          nearestTarget = move.to;
        }
      }

      // 閾値以内の合法手マスがあればスナップ
      if (nearestTarget && minDistance < threshold) {
        return nearestTarget;
      }

      return rawPos;
    },
    [selectedSquare, legalMoves, squareSize, isGote]
  );

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    pointerDownPos.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // pointerdownがなければ無視
      if (!pointerDownPos.current) return;

      const downPos = pointerDownPos.current;
      pointerDownPos.current = null;

      // pointerdown→pointerup間の移動量が大きければスクロール扱いでスキップ
      const dx = Math.abs(e.clientX - downPos.x);
      const dy = Math.abs(e.clientY - downPos.y);
      if (dx > 8 || dy > 8) return;

      const rawPos = getGridPosition(e.clientX, e.clientY);
      if (!rawPos) return;

      const finalPos = snapToLegalMove(e.clientX, e.clientY, rawPos);

      // ハプティックフィードバック（Android対応、iOS非対応だが害はない）
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate(8);
      }

      // clickイベントの二重発火を防ぐ（preventDefault でブラウザのclick合成を抑制）
      e.preventDefault();
      e.stopPropagation();
      onSquareClick(finalPos);
    },
    [getGridPosition, snapToLegalMove, onSquareClick]
  );

  const handlePointerCancel = useCallback(() => {
    pointerDownPos.current = null;
  }, []);

  return {
    gridRef,
    pointerHandlers: {
      onPointerDown: handlePointerDown,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerCancel,
    },
  };
}
