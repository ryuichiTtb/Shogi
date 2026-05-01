"use client";

import { cn } from "@/lib/utils";
import type { CardInstance } from "@/lib/shogi/cards/types";
import { CARD_DEFS } from "@/lib/shogi/cards/definitions";

export type CardViewSize = "sm" | "md" | "lg" | "xl";

interface CardViewProps {
  card: CardInstance;
  faceDown?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  size?: CardViewSize;
  selected?: boolean;
  fullWidth?: boolean;
}

// "sm" はサムネイル(裏向きの相手手札用、縦長)
// "md" / "lg" は表向きの手札(横長、コスト+アイコン+名前+説明)
// "xl" はドロー演出用の中央拡大表示(Issue #78、576x352px)
const SIZE_CLASS: Record<CardViewSize, string> = {
  sm: "w-12 h-16 text-[10px]",
  md: "w-32 h-[80px] text-[13px]",
  lg: "w-40 h-24 text-sm",
  xl: "w-[36rem] h-[22rem] text-2xl",
};

const FULL_WIDTH_HEIGHT: Record<CardViewSize, string> = {
  sm: "h-16",
  md: "h-[80px]",
  lg: "h-24",
  xl: "h-[22rem]",
};

const FULL_WIDTH_TEXT: Record<CardViewSize, string> = {
  sm: "text-[10px]",
  md: "text-[13px]",
  lg: "text-sm",
  xl: "text-2xl",
};

const ICON_SIZE_CLASS: Record<CardViewSize, string> = {
  sm: "text-base",
  md: "text-3xl",
  lg: "text-4xl",
  xl: "text-9xl",
};

const LEFT_W_CLASS: Record<CardViewSize, string> = {
  sm: "w-10",
  md: "w-10",
  lg: "w-10",
  xl: "w-40",
};

const COST_TEXT_CLASS: Record<CardViewSize, string> = {
  sm: "text-xs",
  md: "text-xs",
  lg: "text-xs",
  xl: "text-4xl",
};

const NAME_TEXT_CLASS: Record<CardViewSize, string> = {
  sm: "",
  md: "",
  lg: "",
  xl: "text-4xl",
};

const DESC_TEXT_CLASS: Record<CardViewSize, string> = {
  sm: "text-[10px]",
  md: "text-[11px]",
  lg: "text-[11px]",
  xl: "text-2xl",
};

const TRAP_BADGE_TEXT_CLASS: Record<CardViewSize, string> = {
  sm: "text-[8px]",
  md: "text-[8px]",
  lg: "text-[8px]",
  xl: "text-base",
};

const PADDING_CLASS: Record<CardViewSize, string> = {
  sm: "p-1",
  md: "p-2",
  lg: "p-2",
  xl: "p-6",
};

const GAP_CLASS: Record<CardViewSize, string> = {
  sm: "gap-1",
  md: "gap-2",
  lg: "gap-2",
  xl: "gap-5",
};

const FACEDOWN_SYMBOL_CLASS: Record<CardViewSize, string> = {
  sm: "text-2xl",
  md: "text-2xl",
  lg: "text-2xl",
  xl: "text-9xl",
};

export function CardView({
  card,
  faceDown = false,
  onClick,
  disabled = false,
  size = "md",
  selected = false,
  fullWidth = false,
}: CardViewProps) {
  const def = CARD_DEFS[card.defId];

  if (faceDown) {
    return (
      <div
        className={cn(
          "rounded-md border-2 border-indigo-700 bg-gradient-to-br from-indigo-700 to-indigo-900",
          "flex items-center justify-center text-white/80 font-bold shrink-0",
          fullWidth ? cn("w-full", FULL_WIDTH_HEIGHT[size]) : SIZE_CLASS[size],
          fullWidth && FACEDOWN_SYMBOL_CLASS[size],
        )}
        aria-label="伏せられたカード"
      >
        ♠
      </div>
    );
  }

  const sizeClass = fullWidth
    ? cn("w-full", FULL_WIDTH_HEIGHT[size], FULL_WIDTH_TEXT[size])
    : SIZE_CLASS[size];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-md border-2 bg-card text-card-foreground shadow-sm shrink-0",
        "flex flex-row items-stretch text-left transition-all",
        PADDING_CLASS[size],
        GAP_CLASS[size],
        sizeClass,
        disabled
          ? "opacity-50 cursor-not-allowed border-border"
          : "cursor-pointer hover:border-primary hover:shadow-md",
        selected && "border-primary ring-2 ring-primary",
        def.kind === "trap" ? "border-purple-500" : "border-amber-500",
      )}
      aria-label={`${def.name} (コスト${def.cost})`}
    >
      {/* 左: コストとアイコン */}
      <div className={cn("flex flex-col items-center justify-center gap-0.5 shrink-0", LEFT_W_CLASS[size])}>
        <span
          className={cn(
            "rounded-full px-2 leading-tight font-bold tabular-nums",
            COST_TEXT_CLASS[size],
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
          <span className={cn("font-bold leading-tight truncate", NAME_TEXT_CLASS[size])}>{def.name}</span>
          {def.kind === "trap" && (
            <span
              className={cn(
                "bg-purple-200 dark:bg-purple-900/60 text-purple-900 dark:text-purple-100 px-1 rounded font-bold leading-tight shrink-0",
                TRAP_BADGE_TEXT_CLASS[size],
              )}
            >
              TRAP
            </span>
          )}
        </div>
        <div className={cn("text-muted-foreground leading-tight line-clamp-2", DESC_TEXT_CLASS[size])}>
          {def.description}
        </div>
      </div>
    </button>
  );
}
