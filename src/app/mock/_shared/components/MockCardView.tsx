"use client";

import { cn } from "@/lib/utils";
import type { CardInstance } from "../types";
import { MOCK_CARD_DEFS } from "../dummy-data";

interface MockCardViewProps {
  card: CardInstance;
  faceDown?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
  selected?: boolean;
}

const SIZE_CLASS = {
  sm: "w-12 h-16 text-[9px]",
  md: "w-20 h-28 text-xs",
  lg: "w-24 h-32 text-sm",
};

export function MockCardView({
  card,
  faceDown = false,
  onClick,
  disabled = false,
  size = "md",
  selected = false,
}: MockCardViewProps) {
  const def = MOCK_CARD_DEFS[card.defId];

  if (faceDown) {
    return (
      <div
        className={cn(
          "rounded-md border-2 border-indigo-700 bg-gradient-to-br from-indigo-700 to-indigo-900",
          "flex items-center justify-center text-white/80 font-bold shrink-0",
          SIZE_CLASS[size],
        )}
        aria-label="伏せられたカード"
      >
        ♠
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-md border-2 bg-card text-card-foreground shadow-sm shrink-0",
        "flex flex-col items-stretch p-1.5 text-left transition-all",
        SIZE_CLASS[size],
        disabled
          ? "opacity-50 cursor-not-allowed border-border"
          : "cursor-pointer hover:border-primary hover:shadow-md",
        selected && "border-primary ring-2 ring-primary",
        def.kind === "trap" ? "border-purple-500" : "border-amber-500",
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <span
          className={cn(
            "rounded-full px-1.5 leading-tight font-bold",
            def.kind === "trap"
              ? "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200"
              : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
          )}
        >
          {def.cost}
        </span>
        {def.kind === "trap" && <span className="text-[8px] opacity-70">TRAP</span>}
      </div>
      <div className="flex-1 flex items-center justify-center font-bold text-center leading-tight">
        {def.name}
      </div>
      {size !== "sm" && (
        <div className="text-[9px] text-muted-foreground leading-tight line-clamp-2">
          {def.description}
        </div>
      )}
    </button>
  );
}
