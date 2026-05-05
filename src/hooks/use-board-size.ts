"use client";

import { useState, useEffect, useCallback } from "react";

import {
  SHOGI_BOARD_CELLS,
  getShogiBoardGridSize,
  getShogiBoardLabelSize,
} from "@/lib/shogi/board-layout";

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
const BOARD_LABEL_GAP = 2; // shogi-board.tsx の flex gap-0.5 相当
const GAPS = 20; // マージン・パディング合計

const VERTICAL_RESERVED =
  STATUS_BAR_HEIGHT +
  CAPTURED_PIECES_HEIGHT * 2 +
  GAME_CONTROLS_HEIGHT +
  MOBILE_DRAWER_TAB_HEIGHT +
  GAPS;

const MIN_SQUARE_SIZE = 36;
const MAX_SQUARE_SIZE = 64;
const HORIZONTAL_PADDING = 40;
const HORIZONTAL_PADDING_MOBILE = 24;

function boardFits(baseSize: number, isMobile: boolean, availableWidth: number, availableHeight: number): boolean {
  const grid = getShogiBoardGridSize(baseSize);
  const labelSize = getShogiBoardLabelSize(baseSize, isMobile);
  const boardWidth = grid.width + 2 + labelSize + (isMobile ? 0 : labelSize + 6);
  const boardHeight = labelSize + BOARD_LABEL_GAP + grid.height;
  return boardWidth <= availableWidth && boardHeight <= availableHeight;
}

function calculate(): { squareSize: number; isMobile: boolean; viewportHeight: number } {
  if (typeof window === "undefined") return { squareSize: 40, isMobile: false, viewportHeight: 800 };

  const vw = window.innerWidth;
  // window.innerHeight は iOS Safari でもアドレスバー込みの実際の表示領域を返す
  const vh = window.innerHeight;
  const isMobile = vw < MOBILE_BREAKPOINT;

  const padding = isMobile ? HORIZONTAL_PADDING_MOBILE : HORIZONTAL_PADDING;
  const availableWidth = vw - padding;
  const availableHeight = vh - VERTICAL_RESERVED;

  let squareSize = MIN_SQUARE_SIZE;
  for (let candidate = MAX_SQUARE_SIZE; candidate >= MIN_SQUARE_SIZE; candidate--) {
    if (boardFits(candidate, isMobile, availableWidth, availableHeight)) {
      squareSize = candidate;
      break;
    }
  }
  squareSize = Math.min(squareSize, Math.floor(availableWidth / SHOGI_BOARD_CELLS));
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
    const initialFrame = window.requestAnimationFrame(() => {
      recalculate();
      setIsReady(true);
    });

    let timeoutId: ReturnType<typeof setTimeout>;
    const handleResize = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(recalculate, 100);
    };

    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleResize);

    return () => {
      window.cancelAnimationFrame(initialFrame);
      clearTimeout(timeoutId);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
    };
  }, [recalculate]);

  return { squareSize, isMobile, viewportHeight, isReady };
}
