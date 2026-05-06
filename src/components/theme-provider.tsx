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
