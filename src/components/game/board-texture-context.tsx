"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

export interface BoardTexture {
  id: string;
  name: string;
  // null = テクスチャなし (従来の amber カラー)
  url: string | null;
}

// public/img/wood 配下の素材候補。Issue #177 動作確認用。
// 本実装でカード背景同様に永続化する場合はここを基にカタログ化する想定。
export const BOARD_TEXTURES: readonly BoardTexture[] = [
  { id: "default", name: "デフォルト (無地)", url: null },
  { id: "natural-1", name: "ナチュラル 01", url: "/img/wood/mokume_natural01.png" },
  { id: "natural-2", name: "ナチュラル 02", url: "/img/wood/mokume_natural02.png" },
  { id: "natural-3", name: "ナチュラル 03", url: "/img/wood/mokume_natural03.png" },
  { id: "natural-4", name: "ナチュラル 04", url: "/img/wood/mokume_natural04.png" },
  { id: "light-1", name: "ライト 01", url: "/img/wood/mokume_light01.png" },
  { id: "light-2", name: "ライト 02", url: "/img/wood/mokume_light02.png" },
  { id: "light-3", name: "ライト 03", url: "/img/wood/mokume_light03.png" },
  { id: "light-4", name: "ライト 04", url: "/img/wood/mokume_light04.png" },
  { id: "dark-1", name: "ダーク 01", url: "/img/wood/mokume_dark01.png" },
  { id: "dark-2", name: "ダーク 02", url: "/img/wood/mokume_dark02.png" },
  { id: "dark-3", name: "ダーク 03", url: "/img/wood/mokume_dark03.png" },
  { id: "dark-4", name: "ダーク 04", url: "/img/wood/mokume_dark04.png" },
];

interface BoardTextureContextValue {
  // 将棋盤マス背景
  boardTexture: BoardTexture;
  setBoardTextureById: (id: string) => void;
  // 対局画面全体背景 (AppBackground の代替)
  screenTexture: BoardTexture;
  setScreenTextureById: (id: string) => void;
}

const BoardTextureContext = createContext<BoardTextureContextValue | null>(null);

function findById(id: string): BoardTexture {
  return BOARD_TEXTURES.find((t) => t.id === id) ?? BOARD_TEXTURES[0];
}

export function BoardTextureProvider({ children }: { children: ReactNode }) {
  const [boardId, setBoardId] = useState<string>("default");
  const [screenId, setScreenId] = useState<string>("default");
  const value: BoardTextureContextValue = {
    boardTexture: findById(boardId),
    setBoardTextureById: setBoardId,
    screenTexture: findById(screenId),
    setScreenTextureById: setScreenId,
  };
  return (
    <BoardTextureContext.Provider value={value}>
      {children}
    </BoardTextureContext.Provider>
  );
}

// Provider が無い文脈 (テスト・Storybook 等) でもクラッシュさせないため null 許容で扱う。
export function useBoardTexture(): BoardTexture {
  const ctx = useContext(BoardTextureContext);
  return ctx?.boardTexture ?? BOARD_TEXTURES[0];
}

export function useScreenTexture(): BoardTexture {
  const ctx = useContext(BoardTextureContext);
  return ctx?.screenTexture ?? BOARD_TEXTURES[0];
}

export function useBoardTextureControls(): BoardTextureContextValue | null {
  return useContext(BoardTextureContext);
}
