// カード裏面スタイルの選択状態を localStorage に保存し、Context で全体に提供。
// theme-provider.tsx と同じパターン。
"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

import {
  DEFAULT_CARD_BACK_STYLE,
  isValidCardBackStyle,
  type CardBackStyle,
} from "./style-options";

const STORAGE_KEY = "shogi-card-back-style";

interface CardBackContextValue {
  style: CardBackStyle;
  setStyle: (style: CardBackStyle) => void;
}

const CardBackContext = createContext<CardBackContextValue>({
  style: DEFAULT_CARD_BACK_STYLE,
  setStyle: () => {},
});

export function useCardBackStyle() {
  return useContext(CardBackContext);
}

export function CardBackProvider({ children }: { children: React.ReactNode }) {
  const [style, setStyleState] = useState<CardBackStyle>(DEFAULT_CARD_BACK_STYLE);

  const setStyle = useCallback((s: CardBackStyle) => {
    setStyleState(s);
    localStorage.setItem(STORAGE_KEY, s);
  }, []);

  useEffect(() => {
    // SSR では localStorage が無いため初期 render は DEFAULT、
    // ハイドレーション後にここで端末の保存値で上書きする (theme-provider と同じパターン)。
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isValidCardBackStyle(stored)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStyleState(stored);
    }
  }, []);

  return (
    <CardBackContext value={{ style, setStyle }}>{children}</CardBackContext>
  );
}
