// Issue #155: indeterminate プログレスバー。
// Server Action 等の真の進捗値が取得できない処理向けに、走査アニメで
// 「待ちが進んでいる」感覚を視覚的に提供する。
// CSS keyframes (loading-progress-indeterminate) で実装、JS タイマー不使用。
"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";

interface LoadingProgressBarProps {
  className?: string;
}

export const LoadingProgressBar = memo(function LoadingProgressBar({
  className,
}: LoadingProgressBarProps) {
  return (
    <div
      role="progressbar"
      aria-busy="true"
      aria-valuetext="読み込み中"
      className={cn(
        "relative w-full max-w-[240px] h-1 rounded-full bg-muted overflow-hidden",
        className,
      )}
    >
      <div className="absolute top-0 left-0 h-full w-[40%] rounded-full bg-primary animate-loading-progress-indeterminate" />
    </div>
  );
});
