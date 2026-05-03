"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface MarqueeTextProps {
  text: string;
  className?: string;
  // 1 サイクルの所要時間 (停止時間込み)。デフォルト 8s。
  durationSec?: number;
}

// container 幅より長いテキストは、最初の数秒静止後に左へスクロールして
// 後半を表示し、最後にまた静止する (ping-pong)。
// container 幅に収まる場合はアニメーションを発生させず単に表示する。
//
// 計測は container.scrollWidth - container.clientWidth で実施。
// span 側の scrollWidth は inline 要素だと不安定なため container を使う。
// span は inline-block 必須 (overflow させるため)。
export function MarqueeText({
  text,
  className,
  durationSec = 8,
}: MarqueeTextProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);

  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const recompute = () => {
      const diff = c.scrollWidth - c.clientWidth;
      setShift(Math.max(0, Math.ceil(diff)));
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(c);
    return () => ro.disconnect();
  }, [text]);

  const overflowing = shift > 0;
  return (
    <div
      ref={containerRef}
      className={cn("overflow-hidden whitespace-nowrap", className)}
    >
      <span
        // 常に inline-block にして、長文は container 外にあふれて scrollWidth
        // が正しく測定されるようにする。
        className={cn(
          "inline-block",
          overflowing && "animate-deck-marquee",
        )}
        style={
          overflowing
            ? ({
                "--marquee-shift": `${-shift}px`,
                animationDuration: `${durationSec}s`,
              } as React.CSSProperties)
            : undefined
        }
      >
        {text}
      </span>
    </div>
  );
}
