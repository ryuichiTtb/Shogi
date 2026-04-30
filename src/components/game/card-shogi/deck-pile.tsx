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
  // 相手手番中など、より暗くした非活性表示にしたい場合に true
  dimmed?: boolean;
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
  dimmed = false,
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
        "relative rounded-md border-2 transition-all",
        "flex flex-col items-center justify-center text-white shrink-0 px-1",
        sizeClass,
        // 通常時(マナ不足など): 中間色グラデーション、非活性
        !interactable && !dimmed && "bg-gradient-to-br from-slate-600 to-slate-800 border-slate-600 cursor-not-allowed",
        // 相手手番中など: より暗くした非活性表示 (R14)
        !interactable && dimmed && "bg-gradient-to-br from-slate-800 to-slate-950 border-slate-800 cursor-not-allowed opacity-65",
        // ドロー可能時: 明るいアンバー寄りグラデーション + 独自グロー演出 (R13/R14)
        interactable && "bg-gradient-to-br from-amber-500 to-amber-700 border-amber-300 cursor-pointer hover:scale-[1.03] animate-deck-draw",
      )}
      aria-label={
        interactable ? `山札からドロー (残${count}枚、コスト${PHASE0_DRAW_COST})` : `山札 (残${count}枚)`
      }
    >
      {/* R12: ドローコストを左上に「💎 × N」形式で表示 (showDrawCost のとき) */}
      {showDrawCost && (
        <span
          className={cn(
            "absolute top-0.5 left-0.5 flex items-center gap-0.5 rounded-full px-1.5 leading-tight font-bold tabular-nums",
            "bg-cyan-100 text-cyan-900 dark:bg-cyan-900/60 dark:text-cyan-100",
            size === "sm" ? "text-[8px]" : "text-[10px]",
          )}
          title={`ドローコスト: マナ ${PHASE0_DRAW_COST}`}
        >
          <span aria-hidden>💎</span>
          <span>× {PHASE0_DRAW_COST}</span>
        </span>
      )}

      <div className="opacity-90 leading-none font-medium mt-2">山札</div>
      <div className="font-bold tabular-nums leading-none mt-1 text-base">
        × {count}
      </div>
      {interactable && (
        <div className="mt-1 leading-none text-amber-300 text-[10px] font-bold animate-bounce">
          DRAW!
        </div>
      )}
    </button>
  );
}
