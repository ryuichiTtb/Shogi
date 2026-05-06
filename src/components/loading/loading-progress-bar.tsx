// Issue #155: 進捗バー。0 → 約 95% へ時間で減速接近する擬似進捗。
//
// 真の進捗値 (例: 何バイト中の何バイト) は Server Action / SSR 復元から取得
// できないため、UX 標準パターンの「指数関数で減速接近 + 完了前に上限手前で待機」
// で「進んでいる感 + そろそろ完了しそう感」を演出する。完了 (show=false) 時に
// LoadingOverlay ごとアンマウントされるので 100% は画面に出さない (中途半端
// に表示せず一気に消える方が体感的に違和感が少ない)。
//
// チューニング:
//   - PROGRESS_TARGET_PERCENT (95): 上限。これに近づいた時点で「あと一歩」感。
//   - PROGRESS_TIME_CONSTANT_MS (3000): 指数の時定数。τ 経過で残量 36.8%。
//     0 → 60% に約 3 秒、60 → 90% にさらに約 4 秒、90 → 95% にもう約 6 秒、
//     という減速カーブで「初動は速い」「後半は粘る」体感になる。
//   - PROGRESS_TICK_MS (80): 描画更新間隔。CSS transition と組み合わせて
//     滑らかに見せる。
"use client";

import { memo, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const PROGRESS_TARGET_PERCENT = 95;
const PROGRESS_TIME_CONSTANT_MS = 3000;
const PROGRESS_TICK_MS = 80;

interface LoadingProgressBarProps {
  className?: string;
}

export const LoadingProgressBar = memo(function LoadingProgressBar({
  className,
}: LoadingProgressBarProps) {
  const [percent, setPercent] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    startRef.current = performance.now();
    const timer = setInterval(() => {
      if (startRef.current === null) return;
      const elapsed = performance.now() - startRef.current;
      // p(t) = TARGET * (1 - exp(-t / τ)) で 0 → TARGET に減速接近。
      const next =
        PROGRESS_TARGET_PERCENT *
        (1 - Math.exp(-elapsed / PROGRESS_TIME_CONSTANT_MS));
      setPercent(next);
    }, PROGRESS_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const rounded = Math.round(percent);
  return (
    <div
      role="progressbar"
      aria-busy="true"
      aria-valuenow={rounded}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={`${rounded}%`}
      className={cn(
        "relative w-full max-w-[240px] h-1 rounded-full bg-muted overflow-hidden",
        className,
      )}
    >
      {/* width を style で指定し、transition で滑らかに伸ばす。setInterval の
          tick (80ms) ごとに新しい width が当たり、CSS transition (120ms) で
          補間されることで階段的にならない。 */}
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-[120ms] ease-out"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
});
