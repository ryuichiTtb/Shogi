"use client";

import { cn } from "@/lib/utils";
import { PHASE0_DRAW_COST } from "@/lib/shogi/cards/definitions";

interface DeckPileProps {
  count: number;
  canDraw?: boolean;
  onDraw?: () => void;
  size?: "sm" | "md" | "lg";
  // ドローコストを画面に表示するか(自分側のみ true、相手側は false)
  showDrawCost?: boolean;
}

const SIZE_CLASS = {
  sm: "w-9 h-12 text-[9px]",
  md: "w-14 h-20 text-xs",
  lg: "w-16 h-24 text-sm",
};

export function DeckPile({
  count,
  canDraw = false,
  onDraw,
  size = "md",
  showDrawCost = false,
}: DeckPileProps) {
  const interactable = canDraw && count > 0 && !!onDraw;
  return (
    <button
      type="button"
      onClick={onDraw}
      disabled={!interactable}
      className={cn(
        "rounded-md border-2 bg-gradient-to-br from-slate-700 to-slate-900",
        "flex flex-col items-center justify-center text-white shrink-0 transition-all",
        SIZE_CLASS[size],
        interactable
          ? "border-amber-400 cursor-pointer hover:scale-105 shadow-amber-400/50 shadow-md"
          : "border-slate-700 cursor-not-allowed opacity-80",
      )}
      aria-label={
        interactable ? `山札からドロー (残${count}枚、コスト${PHASE0_DRAW_COST})` : `山札 (残${count}枚)`
      }
    >
      <div className="text-[8px] opacity-80 leading-none">山札</div>
      <div className="font-bold tabular-nums leading-none mt-0.5">
        × {count}
      </div>
      {showDrawCost && (
        <div className="text-[7px] mt-0.5 leading-none flex items-center gap-0.5">
          <span className="opacity-70">ドロー</span>
          <span className="font-bold text-cyan-200">-{PHASE0_DRAW_COST}</span>
        </div>
      )}
      {interactable && !showDrawCost && (
        <div className="text-[7px] mt-0.5 text-amber-300 leading-none">DRAW!</div>
      )}
    </button>
  );
}
