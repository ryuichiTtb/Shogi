"use client";

// Issue #217: 「もう一局」失敗時のエラー通知 + 再試行 UI。
// 旧実装は createGame 失敗を握り潰し、ボタンが「準備中...」固着の無言ハングに
// なっていた。本バナーで失敗を明示し再試行導線を提供する。標準/カード両
// variant で共有 (DRY)。トースト基盤が無いため画面下部固定の軽量 alert。

import { Button } from "@/components/ui/button";

interface RematchErrorBannerProps {
  // null のとき非表示。
  message: string | null;
  onRetry: () => void;
  onDismiss: () => void;
}

export function RematchErrorBanner({
  message,
  onRetry,
  onDismiss,
}: RematchErrorBannerProps) {
  if (!message) return null;
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed inset-x-0 bottom-4 z-[80] flex justify-center px-4 pointer-events-none"
    >
      <div className="pointer-events-auto flex max-w-md items-center gap-3 rounded-lg border border-red-400/60 bg-red-950/95 px-4 py-3 text-sm text-red-50 shadow-xl backdrop-blur">
        <span className="flex-1 leading-snug">{message}</span>
        <Button
          size="sm"
          onClick={onRetry}
          className="shrink-0"
        >
          再試行
        </Button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="閉じる"
          className="shrink-0 rounded px-1 text-red-200 hover:text-white"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
