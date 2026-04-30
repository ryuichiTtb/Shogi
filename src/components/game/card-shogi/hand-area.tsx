"use client";

import { cn } from "@/lib/utils";
import type { CardInstance } from "@/lib/shogi/cards/types";
import { CARD_DEFS } from "@/lib/shogi/cards/definitions";
import { CardView } from "./card-view";

interface HandAreaProps {
  hand: CardInstance[];
  currentMana: number;
  faceDown?: boolean;
  onCardClick?: (instanceId: string) => void;
  size?: "sm" | "md" | "lg";
  emptyLabel?: string;
}

export function HandArea({
  hand,
  currentMana,
  faceDown = false,
  onCardClick,
  size = "md",
  emptyLabel = "手札なし",
}: HandAreaProps) {
  if (hand.length === 0) {
    return <div className="text-xs text-muted-foreground py-2 px-3">{emptyLabel}</div>;
  }

  if (faceDown) {
    return (
      <div className="flex gap-1">
        {hand.map((c) => (
          <CardView key={c.instanceId} card={c} faceDown size={size} />
        ))}
      </div>
    );
  }

  return (
    <div
      className={cn("flex flex-row gap-2 overflow-x-auto pb-1")}
      style={{ touchAction: "pan-x" }}
    >
      {hand.map((c) => {
        const def = CARD_DEFS[c.defId];
        const disabled = currentMana < def.cost;
        return (
          <CardView
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
