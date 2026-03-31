"use client";

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    // Service Worker登録
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // SW登録失敗は無視（開発環境など）
      });
    }

    // iOS Safari向け: ピンチズームを完全に無効化
    // gesturestart/gesturechange はiOS Safari固有のイベントで、
    // CSS touch-action だけでは防げないピンチ操作を抑制する
    const preventGesture = (e: Event) => {
      e.preventDefault();
    };
    document.addEventListener("gesturestart", preventGesture, { passive: false });
    document.addEventListener("gesturechange", preventGesture, { passive: false });

    return () => {
      document.removeEventListener("gesturestart", preventGesture);
      document.removeEventListener("gesturechange", preventGesture);
    };
  }, []);

  return null;
}
