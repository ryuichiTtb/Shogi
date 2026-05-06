// カード裏面スタイルの選択状態を DB と userId scoped localStorage に保存し、Context で全体に提供。
"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";

import {
  getCurrentUserPreferences,
  saveCardBackStylePreference,
} from "@/app/actions/preferences";
import {
  type CardBackStyle,
} from "./style-options";
import { DEFAULT_CARD_BACK_STYLE } from "@/lib/user-preferences";

const CLERK_CONFIGURED = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

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

// Issue #160: ThemeProvider と同様、SSR で Clerk session 解決が間に合わずゲスト経路に
// 落ちた場合の救済策。Clerk client が hydrate 完了したタイミングで preferences を再取得し、
// SSR で得た値と異なれば onSync で state を更新する。
function ClerkPreferenceSync({
  ssrUserId,
  onSync,
}: {
  ssrUserId: string;
  onSync: (style: CardBackStyle) => void;
}) {
  const { isLoaded, isSignedIn } = useAuth();
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let cancelled = false;
    getCurrentUserPreferences()
      .then((p) => {
        if (cancelled) return;
        if (p.userId !== ssrUserId) {
          onSync(p.cardBackStyle);
        }
      })
      .catch((error) => {
        console.error("Failed to rehydrate card back preference", error);
      });
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, ssrUserId, onSync]);
  return null;
}

export function CardBackProvider({
  children,
  userId,
  userKind,
  initialStyle,
}: {
  children: React.ReactNode;
  userId: string;
  userKind: "guest" | "account";
  initialStyle: CardBackStyle;
}) {
  const [style, setStyleState] = useState<CardBackStyle>(initialStyle);
  // Issue #160: userId / initialStyle の props 変化に state を追従させる。
  // ThemeProvider の `key={userId}` 撤去に伴い、CardBackProvider も親の暗黙的な
  // 再マウントには依存できなくなるため、render 中 conditional setState で同期する。
  const [lastSync, setLastSync] = useState({ userId, initialStyle });
  if (lastSync.userId !== userId || lastSync.initialStyle !== initialStyle) {
    setLastSync({ userId, initialStyle });
    setStyleState(initialStyle);
  }

  const storageKey = `shogi-card-back-style:${userId}`;

  const setStyle = useCallback((s: CardBackStyle) => {
    setStyleState(s);
    localStorage.setItem(storageKey, s);
    saveCardBackStylePreference(s).catch((error) => {
      console.error("Failed to save card back preference", error);
    });
  }, [storageKey]);

  const handleClerkSync = useCallback((newStyle: CardBackStyle) => {
    setStyleState((prev) => (prev === newStyle ? prev : newStyle));
  }, []);

  useEffect(() => {
    localStorage.setItem(storageKey, initialStyle);
  }, [initialStyle, storageKey]);

  return (
    <CardBackContext value={{ style: style ?? DEFAULT_CARD_BACK_STYLE, setStyle }}>
      {CLERK_CONFIGURED && userKind === "guest" && (
        <ClerkPreferenceSync ssrUserId={userId} onSync={handleClerkSync} />
      )}
      {children}
    </CardBackContext>
  );
}
