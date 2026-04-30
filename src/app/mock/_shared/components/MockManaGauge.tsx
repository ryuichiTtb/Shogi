"use client";

import { cn } from "@/lib/utils";

interface MockManaGaugeProps {
  current: number;
  cap: number;
  compact?: boolean;
  label?: string;
}

export function MockManaGauge({ current, cap, compact = false, label }: MockManaGaugeProps) {
  const ratio = Math.min(1, current / cap);
  const canDraw = current >= 5;

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border bg-card px-2 py-1",
        canDraw && "border-amber-400 shadow-sm",
        compact ? "text-[10px]" : "text-xs",
      )}
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
          className="h-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-all"
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  );
}
