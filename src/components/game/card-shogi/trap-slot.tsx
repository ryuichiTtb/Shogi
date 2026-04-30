"use client";

import { cn } from "@/lib/utils";
import type { TrapInstance } from "@/lib/shogi/cards/types";
import { CARD_DEFS } from "@/lib/shogi/cards/definitions";

interface TrapSlotProps {
  trap: TrapInstance | null;
  faceDown?: boolean;
  size?: "sm" | "md" | "lg";
  // true のとき横幅を親に合わせる(縦並び・中央揃えで使用)
  fullWidth?: boolean;
  // true のとき横長表示(相手細バー等で縦幅圧縮)
  horizontal?: boolean;
}

const SIZE_CLASS = {
  sm: "w-9 h-12 text-[10px]",
  md: "w-16 h-20 text-[13px]",
  lg: "w-20 h-24 text-sm",
};

export function TrapSlot({
  trap,
  faceDown = false,
  size = "md",
  fullWidth = false,
  horizontal = false,
}: TrapSlotProps) {
  // 横長モード: 2行構成 (⚠ / TRAP) で横幅を圧縮、h-full で親に追従
  if (horizontal) {
    const wrapperBase = cn("rounded-md border-2 px-1.5 py-0.5 h-full flex flex-col items-center justify-center shrink-0 leading-tight", fullWidth ? "w-full" : "w-auto");
    if (!trap) {
      return (
        <div
          className={cn(wrapperBase, "border-dashed border-muted-foreground/40 bg-muted/30")}
          aria-label="トラップ未セット"
        >
          <span className="text-sm opacity-50 leading-none" aria-hidden>⚠</span>
          <span className="text-[10px] text-muted-foreground font-bold leading-none mt-0.5">TRAP</span>
        </div>
      );
    }
    if (faceDown) {
      return (
        <div
          className={cn(wrapperBase, "border-purple-700 bg-gradient-to-br from-purple-700 to-purple-900 text-white/80 font-bold")}
          aria-label="トラップセット済(裏向き)"
        >
          <span className="text-sm leading-none">⚠</span>
          <span className="text-[10px] leading-none mt-0.5">TRAP</span>
        </div>
      );
    }
    const def = CARD_DEFS[trap.defId];
    return (
      <div
        className={cn(wrapperBase, "border-purple-500 bg-purple-50 dark:bg-purple-950/40")}
        aria-label={`トラップ: ${def.name}`}
      >
        <span className="text-sm leading-none" aria-hidden>{def.icon}</span>
        <span className="text-[10px] font-bold leading-none mt-0.5 truncate max-w-[80px]">{def.name}</span>
      </div>
    );
  }

  const sizeClass = fullWidth
    ? cn(
        "w-full",
        size === "sm" ? "h-12 text-[10px]" : size === "md" ? "h-20 text-[13px]" : "h-24 text-sm",
      )
    : SIZE_CLASS[size];

  if (!trap) {
    return (
      <div
        className={cn(
          "rounded-md border-2 border-dashed border-muted-foreground/40 bg-muted/30",
          "flex flex-col items-center justify-center shrink-0",
          sizeClass,
        )}
        aria-label="トラップ未セット"
      >
        <span className="text-xl opacity-50 leading-none">⚠</span>
        <span className="text-[10px] text-muted-foreground font-bold mt-1 leading-none">TRAP</span>
      </div>
    );
  }

  if (faceDown) {
    return (
      <div
        className={cn(
          "rounded-md border-2 border-purple-700 bg-gradient-to-br from-purple-700 to-purple-900",
          "flex items-center justify-center text-white/80 font-bold shrink-0",
          sizeClass,
        )}
        aria-label="トラップセット済(裏向き)"
      >
        <span className="text-3xl">⚠</span>
      </div>
    );
  }

  const def = CARD_DEFS[trap.defId];
  return (
    <div
      className={cn(
        "rounded-md border-2 border-purple-500 bg-purple-50 dark:bg-purple-950/40",
        "flex flex-col items-center justify-center text-center px-1 shrink-0 leading-tight",
        sizeClass,
      )}
      aria-label={`トラップ: ${def.name}`}
    >
      <span className="text-xl leading-none" aria-hidden>{def.icon}</span>
      <div className="font-bold text-[11px] leading-tight mt-0.5">{def.name}</div>
      <div className="text-[9px] opacity-70 leading-none mt-0.5">⚠ TRAP</div>
    </div>
  );
}
