"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface LoadingOverlayProps {
  show: boolean;
  message?: string;
  // fullScreen=true → 画面全体を覆う (fixed)。
  // false → 直近の position:relative 親を覆う (absolute)。
  fullScreen?: boolean;
  className?: string;
}

// 共通ローディングマスク。中央に lucide Loader2 のスピナー + メッセージ。
// 半透明背景 + backdrop-blur で背面の視認性を残しつつ、pointer-events:auto
// (デフォルト) によりクリックを吸収して操作不可状態にする。
export function LoadingOverlay({
  show,
  message = "読み込み中...",
  fullScreen = false,
  className,
}: LoadingOverlayProps) {
  if (!show) return null;
  return (
    <div
      className={cn(
        fullScreen ? "fixed" : "absolute",
        "inset-0 z-50 flex flex-col items-center justify-center gap-2",
        "bg-background/40 backdrop-blur-sm",
        className,
      )}
      aria-busy
      role="status"
      aria-live="polite"
    >
      <div className="rounded-full bg-background/85 shadow-lg p-3">
        <Loader2 className="w-7 h-7 text-primary animate-spin" />
      </div>
      <span className="text-xs text-muted-foreground bg-background/85 px-2 py-0.5 rounded-md shadow-sm">
        {message}
      </span>
    </div>
  );
}
