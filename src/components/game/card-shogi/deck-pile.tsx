"use client";

import { cn } from "@/lib/utils";

interface DeckPileProps {
  count: number;
  canDraw?: boolean;
  onDraw?: () => void;
  size?: "sm" | "md";
}

export function DeckPile({ count, canDraw = false, onDraw, size = "md" }: DeckPileProps) {
  const sizeClass = size === "sm" ? "w-9 h-12 text-[9px]" : "w-12 h-16 text-xs";

  return (
    <button
      type="button"
      onClick={onDraw}
      disabled={!canDraw || count === 0}
      className={cn(
        "rounded-md border-2 bg-gradient-to-br from-slate-700 to-slate-900",
        "flex flex-col items-center justify-center text-white shrink-0 transition-all",
        sizeClass,
        canDraw && count > 0
          ? "border-amber-400 cursor-pointer hover:scale-105 shadow-amber-400/50 shadow-md"
          : "border-slate-700 cursor-not-allowed opacity-70",
      )}
      aria-label={
        canDraw && count > 0 ? `山札からドロー (残${count}枚)` : `山札 (残${count}枚)`
      }
    >
      <div className="font-bold tabular-nums leading-none">{count}</div>
      <div className="text-[8px] opacity-70 leading-none mt-0.5">DECK</div>
      {canDraw && count > 0 && <div className="text-[7px] mt-0.5 text-amber-300 leading-none">DRAW!</div>}
    </button>
  );
}
