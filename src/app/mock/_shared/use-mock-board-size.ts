"use client";

import { useState, useEffect, useCallback } from "react";

const MOBILE_BREAKPOINT = 768;
const MIN_SQUARE_SIZE = 32;
const MAX_SQUARE_SIZE = 64;
const HORIZONTAL_PADDING = 40;
const HORIZONTAL_PADDING_MOBILE = 24;
const BOARD_CELLS = 9;

interface MockBoardSize {
  squareSize: number;
  isMobile: boolean;
  viewportHeight: number;
  isReady: boolean;
}

interface MockBoardSizeOptions {
  // カード要素(マナ・手札・トラップ等)が確保する縦領域(px)。案ごとに渡す。
  extraReservedVertical: number;
  // 駒台 + ラベル + パディングの最低限予約値
  baseReservedVertical?: number;
}

export function useMockBoardSize({
  extraReservedVertical,
  baseReservedVertical = 200,
}: MockBoardSizeOptions): MockBoardSize {
  const [squareSize, setSquareSize] = useState(40);
  const [isMobile, setIsMobile] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(800);
  const [isReady, setIsReady] = useState(false);

  const recalc = useCallback(() => {
    if (typeof window === "undefined") return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const mobile = vw < MOBILE_BREAKPOINT;
    const padding = mobile ? HORIZONTAL_PADDING_MOBILE : HORIZONTAL_PADDING;
    const availableWidth = vw - padding;
    const availableHeight = vh - baseReservedVertical - extraReservedVertical;
    const fromWidth = Math.floor(availableWidth / BOARD_CELLS);
    const fromHeight = Math.floor(availableHeight / BOARD_CELLS);
    const size = Math.max(MIN_SQUARE_SIZE, Math.min(MAX_SQUARE_SIZE, fromWidth, fromHeight));
    setSquareSize(size);
    setIsMobile(mobile);
    setViewportHeight(vh);
  }, [extraReservedVertical, baseReservedVertical]);

  useEffect(() => {
    // 既存の useBoardSize と同じ初期化パターン。SSR-safe にするため
    // useState の lazy initializer は使えず、effect 内で window を参照している。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    recalc();
    setIsReady(true);
    let timeoutId: ReturnType<typeof setTimeout>;
    const handleResize = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(recalc, 100);
    };
    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleResize);
    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
    };
  }, [recalc]);

  return { squareSize, isMobile, viewportHeight, isReady };
}
