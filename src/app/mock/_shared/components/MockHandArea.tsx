"use client";

import { cn } from "@/lib/utils";
import type { CardInstance } from "../types";
import { MOCK_CARD_DEFS } from "../dummy-data";
import { MockCardView } from "./MockCardView";

interface MockHandAreaProps {
  hand: CardInstance[];
  currentMana: number;
  faceDown?: boolean;
  onCardClick?: (instanceId: string) => void;
  size?: "sm" | "md" | "lg";
  layout?: "horizontal" | "vertical" | "stack";
  emptyLabel?: string;
}

export function MockHandArea({
  hand,
  currentMana,
  faceDown = false,
  onCardClick,
  size = "md",
  layout = "horizontal",
  emptyLabel = "手札なし",
}: MockHandAreaProps) {
  if (hand.length === 0) {
    return (
      <div className="text-xs text-muted-foreground py-2 px-3">{emptyLabel}</div>
    );
  }

  if (faceDown) {
    return (
      <div
        className={cn(
          "flex gap-1",
          layout === "vertical" ? "flex-col" : "flex-row",
        )}
      >
        {hand.map((c) => (
          <MockCardView key={c.instanceId} card={c} faceDown size={size} />
        ))}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex gap-2",
        layout === "horizontal" && "flex-row overflow-x-auto pb-1",
        layout === "vertical" && "flex-col overflow-y-auto",
        layout === "stack" && "flex-row -space-x-6 hover:space-x-1 transition-all",
      )}
      style={{ touchAction: layout === "horizontal" ? "pan-x" : "auto" }}
    >
      {hand.map((c) => {
        const def = MOCK_CARD_DEFS[c.defId];
        const disabled = currentMana < def.cost;
        return (
          <MockCardView
            key={c.instanceId}
            card={c}
            size={size}
            disabled={disabled}
            onClick={() => onCardClick?.(c.instanceId)}
          />
        );
      })}
    </div>
  );
}
