"use client";

import { cn } from "@/lib/utils";
import type { CardInstance } from "@/lib/shogi/cards/types";
import { CARD_DEFS } from "@/lib/shogi/cards/definitions";

interface CardViewProps {
  card: CardInstance;
  faceDown?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
  selected?: boolean;
}

// "sm" はサムネイル(裏向きの相手手札用、縦長)
// "md" / "lg" は表向きの手札(横長、コスト+アイコン+名前+説明)
const SIZE_CLASS = {
  sm: "w-12 h-16 text-[9px]",
  md: "w-32 h-[72px] text-xs",
  lg: "w-40 h-20 text-sm",
};

const ICON_SIZE_CLASS = {
  sm: "text-base",
  md: "text-2xl",
  lg: "text-3xl",
};

export function CardView({
  card,
  faceDown = false,
  onClick,
  disabled = false,
  size = "md",
  selected = false,
}: CardViewProps) {
  const def = CARD_DEFS[card.defId];

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

  // 横長レイアウト: 左にコスト+アイコン、右に名前+説明
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-md border-2 bg-card text-card-foreground shadow-sm shrink-0",
        "flex flex-row items-stretch gap-1.5 p-1.5 text-left transition-all",
        SIZE_CLASS[size],
        disabled
          ? "opacity-50 cursor-not-allowed border-border"
          : "cursor-pointer hover:border-primary hover:shadow-md",
        selected && "border-primary ring-2 ring-primary",
        def.kind === "trap" ? "border-purple-500" : "border-amber-500",
      )}
      aria-label={`${def.name} (コスト${def.cost})`}
    >
      {/* 左: コストとアイコン */}
      <div className="flex flex-col items-center justify-center gap-0.5 shrink-0 w-9">
        <span
          className={cn(
            "rounded-full px-1.5 leading-tight font-bold text-[10px] tabular-nums",
            def.kind === "trap"
              ? "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200"
              : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
          )}
        >
          {def.cost}
        </span>
        <span className={cn(ICON_SIZE_CLASS[size], "leading-none")} aria-hidden>
          {def.icon}
        </span>
      </div>
      {/* 右: 名前 + 説明 + (TRAPバッジ) */}
      <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
        <div className="flex items-center gap-1">
          <span className="font-bold leading-tight truncate">{def.name}</span>
          {def.kind === "trap" && (
            <span className="text-[7px] bg-purple-200 dark:bg-purple-900/60 text-purple-900 dark:text-purple-100 px-1 rounded font-bold leading-tight shrink-0">
              TRAP
            </span>
          )}
        </div>
        <div className="text-[10px] text-muted-foreground leading-tight line-clamp-2">
          {def.description}
        </div>
      </div>
    </button>
  );
}
