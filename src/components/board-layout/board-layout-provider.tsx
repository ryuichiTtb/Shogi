// Issue #177: 将棋盤レイアウト (盤面マス背景) のユーザー設定を localStorage で
// 永続化し、Context で全体に提供する。CardBackProvider と異なり DB 同期は行わず、
// ブラウザ単位の保存に留める (将来必要なら useBoardLayoutControls の setLayoutId
// から server action 呼び出しを足せば拡張可能)。
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
}

const BoardLayoutContext = createContext<BoardLayoutContextValue>({
  layout: findBoardLayout(DEFAULT_BOARD_LAYOUT_ID),
  setLayoutId: () => {},
});

export function useBoardLayout(): BoardLayout {
  return useContext(BoardLayoutContext).layout;
}

export function useBoardLayoutControls(): BoardLayoutContextValue {
  return useContext(BoardLayoutContext);
}

export function BoardLayoutProvider({ children }: { children: ReactNode }) {
  const [layoutId, setLayoutIdState] = useState<BoardLayoutId>(
    DEFAULT_BOARD_LAYOUT_ID,
  );

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

  const setLayoutId = useCallback((id: BoardLayoutId) => {
    setLayoutIdState(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // ignore
    }
  }, []);

  const layout = BOARD_LAYOUTS.find((l) => l.id === layoutId) ?? BOARD_LAYOUTS[0];
  return (
    <BoardLayoutContext.Provider value={{ layout, setLayoutId }}>
      {children}
    </BoardLayoutContext.Provider>
  );
}
