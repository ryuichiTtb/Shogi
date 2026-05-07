// Issue #177: 将棋盤レイアウト (盤面マス背景) のユーザー設定を localStorage で
// 永続化し、Context で全体に提供する。CardBackProvider と異なり DB 同期は行わず、
// ブラウザ単位の保存に留める (将来必要なら useBoardLayoutControls の setLayoutId
// から server action 呼び出しを足せば拡張可能)。
//
// 派生 (Issue #177): 木目テクスチャ画像を mount 時に一括先読みし、URL 単位で
// 「ロード完了済」状態を追跡する。対局画面 / 盤デザイン画面はテクスチャが
// 未ロードの間は描画を保留 (LoadingOverlay) し、初回表示時の単色フラッシュを防ぐ。
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import {
  BOARD_LAYOUTS,
  DEFAULT_BOARD_LAYOUT_ID,
  findBoardLayout,
  isBoardLayoutId,
  type BoardLayout,
  type BoardLayoutId,
} from "./options";

const STORAGE_KEY = "shogi-board-layout";

interface BoardLayoutContextValue {
  layout: BoardLayout;
  setLayoutId: (id: BoardLayoutId) => void;
  // 指定 URL のテクスチャ画像が読み込み完了済みか
  isTextureReady: (url: string) => boolean;
  // 採用 4 種すべてが読み込み完了済みか (盤デザイン画面のサムネイル一覧用)
  allTexturesReady: boolean;
}

const BoardLayoutContext = createContext<BoardLayoutContextValue>({
  layout: findBoardLayout(DEFAULT_BOARD_LAYOUT_ID),
  setLayoutId: () => {},
  isTextureReady: () => false,
  allTexturesReady: false,
});

export function useBoardLayout(): BoardLayout {
  return useContext(BoardLayoutContext).layout;
}

export function useBoardLayoutControls(): BoardLayoutContextValue {
  return useContext(BoardLayoutContext);
}

// 現在選択中の盤レイアウトテクスチャがロード完了済か。
// 対局画面 (GameLayout) で初回マウント時のフラッシュを抑止するために使う。
export function useIsBoardLayoutReady(): boolean {
  const ctx = useContext(BoardLayoutContext);
  return ctx.isTextureReady(ctx.layout.url);
}

// 採用 4 種のテクスチャがすべてロード完了済か。
// 盤デザイン画面で 4 つのサムネイル全て出揃ってから表示するために使う。
export function useAllBoardLayoutsReady(): boolean {
  return useContext(BoardLayoutContext).allTexturesReady;
}

export function BoardLayoutProvider({ children }: { children: ReactNode }) {
  const [layoutId, setLayoutIdState] = useState<BoardLayoutId>(
    DEFAULT_BOARD_LAYOUT_ID,
  );
  const [readyUrls, setReadyUrls] = useState<Set<string>>(() => new Set());

  // mount 時に localStorage から復元する。SSR とのハイドレーション差異を避ける
  // ため、初期 render は DEFAULT_BOARD_LAYOUT_ID で固定し、mount 後にユーザー
  // 選択値で上書きする (短時間のフラッシュは許容)。
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && isBoardLayoutId(saved) && saved !== DEFAULT_BOARD_LAYOUT_ID) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setLayoutIdState(saved);
      }
    } catch {
      // localStorage 利用不可 (Safari Private Mode 等) — 黙ってデフォルトを使う
    }
  }, []);

  // 木目テクスチャを 4 種一括先読み。完了 URL を Set に蓄積して isTextureReady で
  // 参照する。エラー時もマークを進める (画像取得失敗で UI を永久に止めない)。
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    const markReady = (url: string) => {
      if (cancelled) return;
      setReadyUrls((prev) => {
        if (prev.has(url)) return prev;
        const next = new Set(prev);
        next.add(url);
        return next;
      });
    };
    for (const lay of BOARD_LAYOUTS) {
      const img = new window.Image();
      img.onload = () => markReady(lay.url);
      img.onerror = () => markReady(lay.url);
      img.src = lay.url;
      // 既にブラウザキャッシュ済みなら onload が発火しない (or 既に発火済) ことが
      // あるため complete を即時チェックする (load を待たずに ready マーク)。
      if (img.complete && img.naturalWidth > 0) {
        markReady(lay.url);
      }
    }
    return () => {
      cancelled = true;
    };
  }, []);

  const setLayoutId = useCallback((id: BoardLayoutId) => {
    setLayoutIdState(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // ignore
    }
  }, []);

  const isTextureReady = useCallback(
    (url: string) => readyUrls.has(url),
    [readyUrls],
  );
  const allTexturesReady = readyUrls.size === BOARD_LAYOUTS.length;

  const layout = BOARD_LAYOUTS.find((l) => l.id === layoutId) ?? BOARD_LAYOUTS[0];
  return (
    <BoardLayoutContext.Provider
      value={{ layout, setLayoutId, isTextureReady, allTexturesReady }}
    >
      {children}
    </BoardLayoutContext.Provider>
  );
}
