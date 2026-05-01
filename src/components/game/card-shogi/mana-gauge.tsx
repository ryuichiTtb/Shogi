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

interface FloatingDelta {
  id: number;
  delta: number;
}

const FLASH_DURATION_MS = 1000;

export function ManaGauge({ current, cap, compact = false, label }: ManaGaugeProps) {
  const ratio = Math.min(1, current / cap);
  const canDraw = current >= PHASE0_DRAW_COST;

  const previousRef = useRef<number>(current);
  const floatIdRef = useRef<number>(0);
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [floats, setFloats] = useState<FloatingDelta[]>([]);
  const [flash, setFlash] = useState<"plus" | "minus" | null>(null);

  useEffect(() => {
    const previous = previousRef.current;
    if (current === previous) return;

    const delta = current - previous;
    previousRef.current = current;

    floatIdRef.current += 1;
    const id = floatIdRef.current;
    setFloats((prev) => [...prev, { id, delta }]);
    setFlash(delta > 0 ? "plus" : "minus");

    if (flashTimeoutRef.current) {
      clearTimeout(flashTimeoutRef.current);
    }
    flashTimeoutRef.current = setTimeout(() => {
      setFlash(null);
      flashTimeoutRef.current = null;
    }, FLASH_DURATION_MS);
  }, [current]);

  useEffect(() => {
    return () => {
      if (flashTimeoutRef.current) {
        clearTimeout(flashTimeoutRef.current);
      }
    };
  }, []);

  const removeFloat = (id: number) => {
    setFloats((prev) => prev.filter((f) => f.id !== id));
  };

  const gaugeGradientClass =
    flash === "plus"
      ? "from-emerald-400 to-green-500"
      : flash === "minus"
        ? "from-rose-400 to-red-500"
        : "from-cyan-400 to-blue-500";

  return (
    <div
      className={cn(
        "relative flex items-center gap-2 rounded-md border bg-card px-2 py-1",
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
          "flex-1 h-1.5 rounded-full bg-muted overflow-hidden min-w-[60px]",
          compact && "min-w-[40px]",
        )}
      >
        <div
          className={cn(
            "h-full bg-gradient-to-r transition-all duration-300",
            gaugeGradientClass,
          )}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col items-center"
      >
        <AnimatePresence>
          {floats.map((f) => (
            <motion.span
              key={f.id}
              initial={{ y: 0, opacity: 0, scale: 0.6 }}
              animate={{
                y: compact ? -22 : -28,
                opacity: [0, 1, 1, 0],
                scale: 1,
              }}
              transition={{ duration: 0.9, times: [0, 0.15, 0.7, 1] }}
              onAnimationComplete={() => removeFloat(f.id)}
              className={cn(
                "inline-block font-bold tabular-nums select-none drop-shadow-sm",
                compact ? "text-xs" : "text-sm",
                f.delta > 0 ? "text-emerald-500" : "text-rose-500",
              )}
            >
              {f.delta > 0 ? `+${f.delta}` : f.delta}
            </motion.span>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
