"use client";

import { useState, useEffect, useCallback } from "react";

interface BoardSize {
  squareSize: number;
  isReady: boolean;
}

// 予約スペース（px）
const VERTICAL_RESERVED = {
  statusBar: 36,
  capturedPiecesX2: 96,
  controls: 44,
  gaps: 32,
  safeArea: 0,
};

const MIN_SQUARE_SIZE = 32;
const MAX_SQUARE_SIZE = 64;
const HORIZONTAL_PADDING = 48; // 左右パディング + ラベル分
const BOARD_CELLS = 9;

function getSafeAreaInset(): number {
  if (typeof window === "undefined") return 0;
  const style = getComputedStyle(document.documentElement);
  const top = parseInt(style.getPropertyValue("env(safe-area-inset-top)") || "0", 10);
  const bottom = parseInt(style.getPropertyValue("env(safe-area-inset-bottom)") || "0", 10);
  return (isNaN(top) ? 0 : top) + (isNaN(bottom) ? 0 : bottom);
}

function calculateSquareSize(): number {
  if (typeof window === "undefined") return 40;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const safeArea = getSafeAreaInset();

  const reservedV =
    VERTICAL_RESERVED.statusBar +
    VERTICAL_RESERVED.capturedPiecesX2 +
    VERTICAL_RESERVED.controls +
    VERTICAL_RESERVED.gaps +
    safeArea;

  const availableWidth = vw - HORIZONTAL_PADDING;
  const availableHeight = vh - reservedV;

  const fromWidth = Math.floor(availableWidth / BOARD_CELLS);
  const fromHeight = Math.floor(availableHeight / BOARD_CELLS);

  return Math.max(MIN_SQUARE_SIZE, Math.min(MAX_SQUARE_SIZE, fromWidth, fromHeight));
}

export function useBoardSize(): BoardSize {
  const [squareSize, setSquareSize] = useState(40);
  const [isReady, setIsReady] = useState(false);

  const recalculate = useCallback(() => {
    setSquareSize(calculateSquareSize());
  }, []);

  useEffect(() => {
    recalculate();
    setIsReady(true);

    let timeoutId: ReturnType<typeof setTimeout>;
    const handleResize = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(recalculate, 100);
    };

    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleResize);

    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
    };
  }, [recalculate]);

  return { squareSize, isReady };
}
