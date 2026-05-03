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
export function MarqueeText({
  text,
  className,
  durationSec = 8,
}: MarqueeTextProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);

  useEffect(() => {
    const c = containerRef.current;
    const t = textRef.current;
    if (!c || !t) return;
    const recompute = () => {
      const diff = t.scrollWidth - c.clientWidth;
      setShift(Math.max(0, diff));
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(c);
    return () => ro.disconnect();
  }, [text]);

  return (
    <div
      ref={containerRef}
      className={cn("overflow-hidden whitespace-nowrap", className)}
    >
      <span
        ref={textRef}
        className={shift > 0 ? "inline-block animate-deck-marquee" : undefined}
        style={
          shift > 0
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
