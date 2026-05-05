"use client";

import { useCallback, useEffect, useRef, useState, type RefCallback } from "react";

import {
  computeCardBoardSize,
  getCardShogiLayoutMode,
  type CardBoardSizeResult,
} from "@/lib/card-shogi/layout-metrics";

interface CardBoardSize {
  squareSize: number;
  isMobile: boolean;
  isLargeDesktop: boolean;
  viewportHeight: number;
  isReady: boolean;
  playAreaRef: RefCallback<HTMLElement>;
  bottomControlsRef: RefCallback<HTMLElement>;
  bottomControlsHeight: number;
  debug: CardBoardSizeResult | null;
}

const DEFAULT_BOTTOM_CONTROLS_HEIGHT = 100;

function getViewportSize(): { width: number; height: number } {
  if (typeof window === "undefined") return { width: 390, height: 844 };
  const visualViewport = window.visualViewport;
  return {
    width: Math.floor(visualViewport?.width ?? window.innerWidth),
    height: Math.floor(visualViewport?.height ?? window.innerHeight),
  };
}

function isVisibleElement(node: HTMLElement): boolean {
  if (!node.isConnected) return false;
  const rect = node.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = window.getComputedStyle(node);
  return style.display !== "none" && style.visibility !== "hidden";
}

function getContentRect(node: HTMLElement): { width: number; height: number } {
  const rect = node.getBoundingClientRect();
  const style = window.getComputedStyle(node);
  const horizontalPadding = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
  const verticalPadding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
  return {
    width: Math.max(0, rect.width - horizontalPadding),
    height: Math.max(0, rect.height - verticalPadding),
  };
}

function getLargestVisibleNode(nodes: Set<HTMLElement>): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestArea = 0;
  for (const node of nodes) {
    if (!isVisibleElement(node)) continue;
    const rect = node.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area > bestArea) {
      best = node;
      bestArea = area;
    }
  }
  return best;
}

export function useCardBoardSize(): CardBoardSize {
  const playAreaNodesRef = useRef<Set<HTMLElement>>(new Set());
  const bottomControlsNodesRef = useRef<Set<HTMLElement>>(new Set());
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const [result, setResult] = useState<CardBoardSizeResult | null>(null);
  const [viewportHeight, setViewportHeight] = useState(844);
  const [bottomControlsHeight, setBottomControlsHeight] = useState(DEFAULT_BOTTOM_CONTROLS_HEIGHT);
  const [isReady, setIsReady] = useState(false);

  const recalc = useCallback(() => {
    if (typeof window === "undefined") return;
    const viewport = getViewportSize();
    const activePlayArea = getLargestVisibleNode(playAreaNodesRef.current);
    const playArea = activePlayArea ? getContentRect(activePlayArea) : null;
    const nextResult = computeCardBoardSize({
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      availableWidth: playArea?.width,
      availableHeight: playArea?.height,
    });

    const activeBottomControls = getLargestVisibleNode(bottomControlsNodesRef.current);
    const nextBottomControlsHeight = activeBottomControls
      ? Math.ceil(activeBottomControls.getBoundingClientRect().height)
      : DEFAULT_BOTTOM_CONTROLS_HEIGHT;

    setViewportHeight(viewport.height);
    setResult((prev) =>
      prev &&
      prev.squareSize === nextResult.squareSize &&
      prev.availableWidth === nextResult.availableWidth &&
      prev.availableHeight === nextResult.availableHeight &&
      prev.mode === nextResult.mode
        ? prev
        : nextResult,
    );
    setBottomControlsHeight((prev) =>
      prev === nextBottomControlsHeight ? prev : nextBottomControlsHeight,
    );
  }, []);

  const observeNode = useCallback((node: HTMLElement | null, bucket: Set<HTMLElement>) => {
    if (!node) return;
    bucket.add(node);
    resizeObserverRef.current?.observe(node);
    recalc();
  }, [recalc]);

  const playAreaRef = useCallback<RefCallback<HTMLElement>>(
    (node) => observeNode(node, playAreaNodesRef.current),
    [observeNode],
  );
  const bottomControlsRef = useCallback<RefCallback<HTMLElement>>(
    (node) => observeNode(node, bottomControlsNodesRef.current),
    [observeNode],
  );

  useEffect(() => {
    const handleResize = () => window.requestAnimationFrame(recalc);
    const ro = new ResizeObserver(handleResize);
    resizeObserverRef.current = ro;
    for (const node of playAreaNodesRef.current) ro.observe(node);
    for (const node of bottomControlsNodesRef.current) ro.observe(node);

    const initialFrame = window.requestAnimationFrame(() => {
      recalc();
      setIsReady(true);
    });

    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleResize);
    window.visualViewport?.addEventListener("resize", handleResize);
    window.visualViewport?.addEventListener("scroll", handleResize);

    return () => {
      ro.disconnect();
      window.cancelAnimationFrame(initialFrame);
      resizeObserverRef.current = null;
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
      window.visualViewport?.removeEventListener("resize", handleResize);
      window.visualViewport?.removeEventListener("scroll", handleResize);
    };
  }, [recalc]);

  const viewport = typeof window === "undefined" ? { width: 390 } : { width: getViewportSize().width };
  const fallbackMode = result?.mode ?? getCardShogiLayoutMode(viewport.width);
  const squareSize = result?.squareSize ?? 40;

  return {
    squareSize,
    isMobile: fallbackMode === "mobile",
    isLargeDesktop: fallbackMode === "largeDesktop",
    viewportHeight,
    isReady,
    playAreaRef,
    bottomControlsRef,
    bottomControlsHeight,
    debug: result,
  };
}
