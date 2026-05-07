"use client";

// Issue #177: 対局画面 (画面全体) 背景の素材確認用 Context。
// 将棋盤の背景は別途 BoardLayoutProvider (= 永続化された設定) で管理されるため
// ここでは扱わない。本 Context はあくまでプレビュー (永続化なし) 用。
import { createContext, useContext, useState, type ReactNode } from "react";

export interface ScreenTexture {
  id: string;
  name: string;
  // null = テクスチャなし (従来の AppBackground を表示)
  url: string | null;
}

// public/img/wood 配下の素材候補 + デフォルト (AppBackground)。
export const SCREEN_TEXTURES: readonly ScreenTexture[] = [
  { id: "default", name: "デフォルト (青海波)", url: null },
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

interface ScreenTextureContextValue {
  texture: ScreenTexture;
  setTextureById: (id: string) => void;
}

const ScreenTextureContext = createContext<ScreenTextureContextValue | null>(null);

function findById(id: string): ScreenTexture {
  return SCREEN_TEXTURES.find((t) => t.id === id) ?? SCREEN_TEXTURES[0];
}

export function ScreenTextureProvider({ children }: { children: ReactNode }) {
  const [textureId, setTextureId] = useState<string>("default");
  return (
    <ScreenTextureContext.Provider
      value={{
        texture: findById(textureId),
        setTextureById: setTextureId,
      }}
    >
      {children}
    </ScreenTextureContext.Provider>
  );
}

// Provider が無い文脈でもクラッシュしないよう null 許容で扱う。
export function useScreenTexture(): ScreenTexture {
  const ctx = useContext(ScreenTextureContext);
  return ctx?.texture ?? SCREEN_TEXTURES[0];
}

export function useScreenTextureControls(): ScreenTextureContextValue | null {
  return useContext(ScreenTextureContext);
}
