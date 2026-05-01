"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

import { cn } from "@/lib/utils";
import { PHASE0_DRAW_COST } from "@/lib/shogi/cards/definitions";

interface ManaGaugeProps {
  current: number;
  cap: number;
  compact?: boolean;
  label?: string;
}

interface DeltaSegment {
  id: number;
  left: number;
  width: number;
  kind: "plus" | "minus";
}

const SEGMENT_DURATION_S = 2.4;

export function ManaGauge({ current, cap, compact = false, label }: ManaGaugeProps) {
  const ratio = Math.min(1, current / cap);
  const canDraw = current >= PHASE0_DRAW_COST;

  const previousRef = useRef<number>(current);
  const segIdRef = useRef<number>(0);
  const [segments, setSegments] = useState<DeltaSegment[]>([]);

  useEffect(() => {
    const previous = previousRef.current;
    if (current === previous) return;

    const delta = current - previous;
    const prevRatio = Math.min(1, Math.max(0, previous / cap));
    const newRatio = Math.min(1, Math.max(0, current / cap));
    previousRef.current = current;

    const left = delta > 0 ? prevRatio : newRatio;
    const right = delta > 0 ? newRatio : prevRatio;
    const width = Math.max(0, right - left);
    if (width <= 0) return;

    segIdRef.current += 1;
    const id = segIdRef.current;
    setSegments((prev) => [
      ...prev,
      { id, left, width, kind: delta > 0 ? "plus" : "minus" },
    ]);
  }, [current, cap]);

  const removeSegment = (id: number) => {
    setSegments((prev) => prev.filter((s) => s.id !== id));
  };

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border bg-card px-2 py-1",
        canDraw && "border-amber-400 shadow-sm",
        compact ? "text-[10px]" : "text-xs",
      )}
      role="meter"
      aria-label={`マナ ${current} / ${cap}`}
      aria-valuenow={current}
      aria-valuemin={0}
      aria-valuemax={cap}
    >
      {label && <span className="font-medium text-muted-foreground shrink-0">{label}</span>}
      <span className="shrink-0">💎</span>
      <span className="font-bold tabular-nums shrink-0">
        {current}
        <span className="text-muted-foreground"> / {cap}</span>
      </span>
      <div
        className={cn(
          "relative flex-1 h-1.5 rounded-full bg-muted overflow-hidden min-w-[60px]",
          compact && "min-w-[40px]",
        )}
      >
        <div
          className="h-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-all duration-300"
          style={{ width: `${ratio * 100}%` }}
        />
        <AnimatePresence>
          {segments.map((s) => {
            const isPlus = s.kind === "plus";
            const initialWidth = `${s.width * 100}%`;
            return (
              <motion.div
                key={s.id}
                // プラス: width 維持で opacity 1→0 にフェードアウト
                // マイナス: opacity 維持で width を右端から 0% に縮める (右から徐々に消える)
                initial={{ opacity: 1, width: initialWidth }}
                animate={
                  isPlus
                    ? { opacity: 0, width: initialWidth }
                    : { opacity: 1, width: "0%" }
                }
                transition={{ duration: SEGMENT_DURATION_S, ease: "easeOut" }}
                onAnimationComplete={() => removeSegment(s.id)}
                className={cn(
                  "absolute top-0 bottom-0",
                  isPlus ? "bg-emerald-500" : "bg-rose-500",
                )}
                style={{
                  left: `${s.left * 100}%`,
                }}
              />
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
