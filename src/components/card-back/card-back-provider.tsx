// カード裏面スタイルの選択状態を DB と userId scoped localStorage に保存し、Context で全体に提供。
"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { saveCardBackStylePreference } from "@/app/actions/preferences";
import {
  type CardBackStyle,
} from "./style-options";
import { DEFAULT_CARD_BACK_STYLE } from "@/lib/user-preferences";

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

export function CardBackProvider({
  children,
  userId,
  initialStyle,
}: {
  children: React.ReactNode;
  userId: string;
  initialStyle: CardBackStyle;
}) {
  const [style, setStyleState] = useState<CardBackStyle>(initialStyle);
  const storageKey = `shogi-card-back-style:${userId}`;

  const setStyle = useCallback((s: CardBackStyle) => {
    setStyleState(s);
    localStorage.setItem(storageKey, s);
    saveCardBackStylePreference(s).catch((error) => {
      console.error("Failed to save card back preference", error);
    });
  }, [storageKey]);

  useEffect(() => {
    localStorage.setItem(storageKey, initialStyle);
  }, [initialStyle, storageKey]);

  return (
    <CardBackContext value={{ style: style ?? DEFAULT_CARD_BACK_STYLE, setStyle }}>
      {children}
    </CardBackContext>
  );
}
