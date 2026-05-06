// Issue #155: 一定間隔でフェード切替するステージ文言。
// 「○○処理中…」「○○初期化中…」など、待ち中にユーザへ進陟感を伝える短文を
// 順送りで表示する。aria-live="polite" によりスクリーンリーダーでも読み上げ可能。
"use client";

import { memo, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface LoadingStagesProps {
  stages: readonly string[];
  intervalMs: number;
  className?: string;
}

export const LoadingStages = memo(function LoadingStages({
  stages,
  intervalMs,
  className,
}: LoadingStagesProps) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (stages.length <= 1) return;
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % stages.length);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [stages.length, intervalMs]);

  if (stages.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className={cn(
        "text-xs text-muted-foreground bg-background/85 px-2 py-0.5 rounded-md shadow-sm",
        className,
      )}
    >
      {/* key を付けてテキスト切替時にフェードイン animation を再トリガー。
          stages.length === 1 のときは index が変わらないため自然と静止する。 */}
      <span key={index} className="inline-block animate-loading-stage-fade">
        {stages[index]}
      </span>
    </div>
  );
});
