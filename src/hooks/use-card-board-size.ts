"use client";

import { useState, useEffect, useCallback } from "react";

// カード将棋画面用の盤面サイズ計算フック。
// 既存の useBoardSize はカード要素を考慮していないため、PC/モバイル それぞれで
// カード要素が確保する縦領域を `extraReservedVertical` として加算する。
// 既存の useBoardSize は改変しない(影響を切る方針)。

const MOBILE_BREAKPOINT = 768;
const MIN_SQUARE_SIZE = 32;
const MAX_SQUARE_SIZE = 64;
const HORIZONTAL_PADDING = 40;
const HORIZONTAL_PADDING_MOBILE = 24;
const BOARD_CELLS = 9;

// 既存 useBoardSize の VERTICAL_RESERVED と同等の基本予約値
// (statusbar + captured*2 + game-controls + mobile-drawer-tab + board-label + gaps)
const BASE_RESERVED = 200;

// PC (>=md): 上ゾーン(マナ/相手手札裏/山札/トラップ)+下ゾーン(同上+表手札)
// 上下ゾーン約 110-120px ずつ + 余白で 240px 確保
const PC_CARD_RESERVED = 240;

// モバイル (<md): 上端細バー(約 36px)+下端コンパクトバー(約 56px)= 約 100px
const MOBILE_CARD_RESERVED = 100;

interface CardBoardSize {
  squareSize: number;
  isMobile: boolean;
  viewportHeight: number;
  isReady: boolean;
}

export function useCardBoardSize(): CardBoardSize {
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
    const cardReserved = mobile ? MOBILE_CARD_RESERVED : PC_CARD_RESERVED;
    const availableWidth = vw - padding;
    const availableHeight = vh - BASE_RESERVED - cardReserved;
    const fromWidth = Math.floor(availableWidth / BOARD_CELLS);
    const fromHeight = Math.floor(availableHeight / BOARD_CELLS);
    const size = Math.max(MIN_SQUARE_SIZE, Math.min(MAX_SQUARE_SIZE, fromWidth, fromHeight));
    setSquareSize(size);
    setIsMobile(mobile);
    setViewportHeight(vh);
  }, []);

  useEffect(() => {
    // SSR-safe: window が必要なため effect 内で呼ぶ。
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
