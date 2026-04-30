"use client";

import { useState, useEffect, useCallback } from "react";

// カード将棋画面用の盤面サイズ計算フック。
// 既存の useBoardSize はカード要素を考慮していないため、ハイブリッドUI のレイアウト
// (モバイル / タブレット / PC大) ごとに reserved 値を切り替える。
// 既存の useBoardSize は改変しない(影響を切る方針)。

const MOBILE_BREAKPOINT = 768; // md
const PC_LARGE_BREAKPOINT = 1280; // xl - 4列レイアウト発動
const MIN_SQUARE_SIZE = 32;
const MAX_SQUARE_SIZE = 64;
const HORIZONTAL_PADDING = 40;
const HORIZONTAL_PADDING_MOBILE = 24;
const BOARD_CELLS = 9;

// 既存 useBoardSize の VERTICAL_RESERVED と同等の基本予約値
const BASE_RESERVED = 200;

// PC タブレット相当 (md..xl-1): 上下分割の上ゾーン+下ゾーン
const PC_CARD_RESERVED = 240;

// モバイル (<md): 上端細バー+下端コンパクトバー
const MOBILE_CARD_RESERVED = 100;

// PC 大 (>=xl): 4列構成 = 上下ゾーンなし、ヘッダ・パディング分のみ
const PC_LARGE_CARD_RESERVED = 40;

// PC 大 (>=xl): 横方向に「自分カード + 相手カード + キャラ・棋譜」の3列が並ぶため、
// 中央盤面に使える横幅は (vw - これら3列の合計幅 - gap)
const PC_LARGE_HORIZONTAL_RESERVED = 680; // 220 + 240 + 220 = 680

interface CardBoardSize {
  squareSize: number;
  isMobile: boolean;
  isLargeDesktop: boolean;
  viewportHeight: number;
  isReady: boolean;
}

export function useCardBoardSize(): CardBoardSize {
  const [squareSize, setSquareSize] = useState(40);
  const [isMobile, setIsMobile] = useState(false);
  const [isLargeDesktop, setIsLargeDesktop] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(800);
  const [isReady, setIsReady] = useState(false);

  const recalc = useCallback(() => {
    if (typeof window === "undefined") return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const mobile = vw < MOBILE_BREAKPOINT;
    const largeDesktop = vw >= PC_LARGE_BREAKPOINT;

    const padding = mobile ? HORIZONTAL_PADDING_MOBILE : HORIZONTAL_PADDING;
    const cardReserved = mobile
      ? MOBILE_CARD_RESERVED
      : largeDesktop
        ? PC_LARGE_CARD_RESERVED
        : PC_CARD_RESERVED;
    const horizontalReserved = largeDesktop
      ? PC_LARGE_HORIZONTAL_RESERVED + padding
      : padding;
    const availableWidth = vw - horizontalReserved;
    const availableHeight = vh - BASE_RESERVED - cardReserved;
    const fromWidth = Math.floor(availableWidth / BOARD_CELLS);
    const fromHeight = Math.floor(availableHeight / BOARD_CELLS);
    const size = Math.max(MIN_SQUARE_SIZE, Math.min(MAX_SQUARE_SIZE, fromWidth, fromHeight));
    setSquareSize(size);
    setIsMobile(mobile);
    setIsLargeDesktop(largeDesktop);
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

  return { squareSize, isMobile, isLargeDesktop, viewportHeight, isReady };
}
