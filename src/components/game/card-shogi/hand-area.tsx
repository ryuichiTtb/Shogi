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
  // "horizontal": 横スクロール / "vertical": 縦スクロール / "stack": 重ね表示(クリック非インタラクティブ向け)
  layout?: "horizontal" | "vertical" | "stack";
  emptyLabel?: string;
  // true のとき手札全体のクリックを無効化(相手の手番中・ゲーム終了時など)
  disabled?: boolean;
  // true のとき各カードを横幅一杯に展開(vertical layout で使用)
  fullWidth?: boolean;
}

export function HandArea({
  hand,
  currentMana,
  faceDown = false,
  onCardClick,
  size = "md",
  layout = "horizontal",
  emptyLabel = "手札なし",
  disabled = false,
  fullWidth = false,
}: HandAreaProps) {
  if (hand.length === 0) {
    return <div className="text-xs text-muted-foreground py-2 px-3">{emptyLabel}</div>;
  }

  // 重ね表示(stack): 隣接カードを重ねる。Phase 0 では相手手札の裏向き表示で使用。
  if (layout === "stack") {
    const overlapClass = size === "sm" ? "-ml-9" : size === "md" ? "-ml-14" : "-ml-16";
    return (
      <div className="flex flex-row items-center" aria-label={`カード ${hand.length}枚`}>
        {hand.map((c, i) => (
          <div key={c.instanceId} className={cn(i > 0 && overlapClass)}>
            <CardView card={c} faceDown={faceDown} size={size} />
          </div>
        ))}
      </div>
    );
  }

  if (faceDown) {
    return (
      <div className={cn("flex gap-1", layout === "vertical" ? "flex-col" : "flex-row")}>
        {hand.map((c) => (
          <CardView key={c.instanceId} card={c} faceDown size={size} fullWidth={fullWidth} />
        ))}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex gap-2",
        layout === "horizontal" && "flex-row overflow-x-auto pb-1",
        layout === "vertical" && "flex-col overflow-y-auto pr-1",
      )}
      style={{ touchAction: layout === "vertical" ? "pan-y" : "pan-x" }}
    >
      {hand.map((c) => {
        const def = CARD_DEFS[c.defId];
        const cardDisabled = disabled || currentMana < def.cost;
        return (
          <CardView
            key={c.instanceId}
            card={c}
            size={size}
            disabled={cardDisabled}
            fullWidth={fullWidth}
            onClick={() => onCardClick?.(c.instanceId)}
          />
        );
      })}
    </div>
  );
}
