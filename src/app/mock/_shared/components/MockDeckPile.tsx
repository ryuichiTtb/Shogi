"use client";

import { cn } from "@/lib/utils";

interface MockDeckPileProps {
  count: number;
  canDraw?: boolean;
  onDraw?: () => void;
  size?: "sm" | "md";
}

export function MockDeckPile({ count, canDraw = false, onDraw, size = "md" }: MockDeckPileProps) {
  const sizeClass = size === "sm" ? "w-9 h-12 text-[9px]" : "w-12 h-16 text-xs";

  return (
    <button
      type="button"
      onClick={onDraw}
      disabled={!canDraw}
      className={cn(
        "rounded-md border-2 bg-gradient-to-br from-slate-700 to-slate-900",
        "flex flex-col items-center justify-center text-white shrink-0 transition-all",
        sizeClass,
        canDraw
          ? "border-amber-400 cursor-pointer hover:scale-105 shadow-amber-400/50 shadow-md"
          : "border-slate-700 cursor-not-allowed opacity-70",
      )}
      aria-label={canDraw ? `山札からドロー (残${count}枚)` : `山札 (残${count}枚、マナ不足)`}
    >
      <div className="font-bold tabular-nums leading-none">{count}</div>
      <div className="text-[8px] opacity-70 leading-none mt-0.5">DECK</div>
      {canDraw && <div className="text-[7px] mt-0.5 text-amber-300 leading-none">DRAW!</div>}
    </button>
  );
}
