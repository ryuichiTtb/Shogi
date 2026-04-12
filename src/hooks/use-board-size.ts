"use client";

import { useState, useEffect, useCallback } from "react";

const MOBILE_BREAKPOINT = 768;

interface BoardSize {
  squareSize: number;
  isMobile: boolean;
  viewportHeight: number;
  isReady: boolean;
}

// 各エリアの固定高さ（px） — コンポーネントと同期させること
const STATUS_BAR_HEIGHT = 28;
const CAPTURED_PIECES_HEIGHT = 72; // captured-pieces.tsx の CAPTURED_PIECES_HEIGHT と同値
const GAME_CONTROLS_HEIGHT = 36;  // game-controls.tsx の GAME_CONTROLS_HEIGHT と同値
const MOBILE_DRAWER_TAB_HEIGHT = 40; // mobile-drawer.tsx のタブバー高さ
const BOARD_LABEL_HEIGHT = 16; // ファイルラベル（上）
const GAPS = 20; // マージン・パディング合計

const VERTICAL_RESERVED =
  STATUS_BAR_HEIGHT +
  CAPTURED_PIECES_HEIGHT * 2 +
  GAME_CONTROLS_HEIGHT +
  MOBILE_DRAWER_TAB_HEIGHT +
  BOARD_LABEL_HEIGHT +
  GAPS;

const MIN_SQUARE_SIZE = 36;
const MAX_SQUARE_SIZE = 64;
const HORIZONTAL_PADDING = 40;
const HORIZONTAL_PADDING_MOBILE = 24;
const BOARD_CELLS = 9;

function calculate(): { squareSize: number; isMobile: boolean; viewportHeight: number } {
  if (typeof window === "undefined") return { squareSize: 40, isMobile: false, viewportHeight: 800 };

  const vw = window.innerWidth;
  // window.innerHeight は iOS Safari でもアドレスバー込みの実際の表示領域を返す
  const vh = window.innerHeight;
  const isMobile = vw < MOBILE_BREAKPOINT;

  const padding = isMobile ? HORIZONTAL_PADDING_MOBILE : HORIZONTAL_PADDING;
  const availableWidth = vw - padding;
  const availableHeight = vh - VERTICAL_RESERVED;

  const fromWidth = Math.floor(availableWidth / BOARD_CELLS);
  const fromHeight = Math.floor(availableHeight / BOARD_CELLS);

  const squareSize = Math.max(MIN_SQUARE_SIZE, Math.min(MAX_SQUARE_SIZE, fromWidth, fromHeight));
  return { squareSize, isMobile, viewportHeight: vh };
}

export function useBoardSize(): BoardSize {
  const [squareSize, setSquareSize] = useState(40);
  const [isMobile, setIsMobile] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(800);
  const [isReady, setIsReady] = useState(false);

  const recalculate = useCallback(() => {
    const result = calculate();
    setSquareSize(result.squareSize);
    setIsMobile(result.isMobile);
    setViewportHeight(result.viewportHeight);
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

  return { squareSize, isMobile, viewportHeight, isReady };
}
