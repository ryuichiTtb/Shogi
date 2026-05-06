"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useSyncExternalStore,
} from "react";
import { saveThemePreference } from "@/app/actions/preferences";
import type { ThemePreference } from "@/lib/user-preferences";

type Theme = ThemePreference;

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolvedTheme: "light" | "dark";
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "system",
  setTheme: () => {},
  resolvedTheme: "light",
});

export function useTheme() {
  return useContext(ThemeContext);
}

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function subscribeSystemTheme(onChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

export function ThemeProvider({
  children,
  userId,
  initialTheme,
}: {
  children: React.ReactNode;
  userId: string;
  initialTheme: Theme;
}) {
  const [theme, setThemeState] = useState<Theme>(initialTheme);
  // Issue #160: userId / initialTheme の props 変化に state を追従させる。以前は layout 側
  // `key={userId}` による強制再マウントで対応していたが、Provider 配下 (対局画面など) ごと
  // unmount → mount されて対局開始演出の二重再生・useSound (Howler) 再ロードを誘発していた。
  // key を撤去し、React 19 推奨の render 中 conditional setState で同期する。
  const [lastSync, setLastSync] = useState({ userId, initialTheme });
  if (lastSync.userId !== userId || lastSync.initialTheme !== initialTheme) {
    setLastSync({ userId, initialTheme });
    setThemeState(initialTheme);
  }

  const storageKey = `shogi-theme:${userId}`;
  const systemTheme = useSyncExternalStore<"light" | "dark">(
    subscribeSystemTheme,
    getSystemTheme,
    () => "light",
  );
  const resolvedTheme: "light" | "dark" = theme === "system" ? systemTheme : theme;

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    localStorage.setItem(storageKey, t);
    saveThemePreference(t).catch((error) => {
      console.error("Failed to save theme preference", error);
    });
  }, [storageKey]);

  // 初期化: DB の現在値を反映し、端末キャッシュは userId ごとに名前空間を分ける。
  useEffect(() => {
    localStorage.setItem(storageKey, theme);
    document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
  }, [resolvedTheme, storageKey, theme]);

  return (
    <ThemeContext value={{ theme, setTheme, resolvedTheme }}>
      {children}
    </ThemeContext>
  );
}
