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
  // true のとき横幅を親に合わせる(縦並び・中央揃えで使用)
  fullWidth?: boolean;
}

const SIZE_CLASS = {
  sm: "w-9 h-12 text-[10px]",
  md: "w-16 h-20 text-[13px]",
  lg: "w-20 h-24 text-sm",
};

export function DeckPile({
  count,
  canDraw = false,
  onDraw,
  size = "md",
  showDrawCost = false,
  fullWidth = false,
}: DeckPileProps) {
  const interactable = canDraw && count > 0 && !!onDraw;
  const sizeClass = fullWidth
    ? cn(
        "w-full",
        size === "sm" ? "h-12 text-[10px]" : size === "md" ? "h-20 text-[13px]" : "h-24 text-sm",
      )
    : SIZE_CLASS[size];
  return (
    <button
      type="button"
      onClick={onDraw}
      disabled={!interactable}
      className={cn(
        "rounded-md border-2 bg-gradient-to-br from-slate-700 to-slate-900",
        "flex flex-col items-center justify-center text-white shrink-0 transition-all px-1",
        sizeClass,
        interactable
          ? "border-amber-400 cursor-pointer hover:scale-[1.03] shadow-amber-400/50 shadow-md"
          : "border-slate-700 cursor-not-allowed opacity-80",
      )}
      aria-label={
        interactable ? `山札からドロー (残${count}枚、コスト${PHASE0_DRAW_COST})` : `山札 (残${count}枚)`
      }
    >
      <div className="opacity-90 leading-none font-medium">山札</div>
      <div className="font-bold tabular-nums leading-none mt-1 text-base">
        × {count}
      </div>
      {showDrawCost && (
        <div className="mt-1 leading-none flex items-center gap-1 text-[10px]">
          <span className="opacity-70">ドロー</span>
          <span className="font-bold text-cyan-200">-{PHASE0_DRAW_COST}</span>
        </div>
      )}
      {interactable && !showDrawCost && (
        <div className="mt-1 text-amber-300 leading-none text-[10px] font-bold">DRAW!</div>
      )}
    </button>
  );
}
