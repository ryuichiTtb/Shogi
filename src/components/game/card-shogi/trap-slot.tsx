"use client";

import { cn } from "@/lib/utils";
import type { TrapInstance } from "@/lib/shogi/cards/types";
import { CARD_DEFS } from "@/lib/shogi/cards/definitions";

interface TrapSlotProps {
  trap: TrapInstance | null;
  faceDown?: boolean;
  size?: "sm" | "md";
}

export function TrapSlot({ trap, faceDown = false, size = "md" }: TrapSlotProps) {
  const sizeClass = size === "sm" ? "w-9 h-12" : "w-12 h-16";

  if (!trap) {
    return (
      <div
        className={cn(
          "rounded-md border-2 border-dashed border-muted-foreground/40 bg-muted/30",
          "flex items-center justify-center shrink-0",
          sizeClass,
        )}
        aria-label="トラップ未セット"
      >
        <span className="text-[8px] text-muted-foreground font-bold">TRAP</span>
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
        ⚠
      </div>
    );
  }

  const def = CARD_DEFS[trap.defId];
  return (
    <div
      className={cn(
        "rounded-md border-2 border-purple-500 bg-purple-50 dark:bg-purple-950/40",
        "flex flex-col items-center justify-center text-[9px] text-center p-0.5 shrink-0",
        sizeClass,
      )}
      aria-label={`トラップ: ${def.name}`}
    >
      <div className="font-bold leading-tight">{def.name}</div>
      <div className="text-[7px] opacity-70">⚠ TRAP</div>
    </div>
  );
}
