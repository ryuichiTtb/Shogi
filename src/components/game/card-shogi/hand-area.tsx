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
  // Issue #78: 直前にドローしたカードを一瞬光らせる (instanceId 一致のカードに animate-hand-card-flash を付与)
  flashCardId?: string | null;
  // Issue #106: モバイル手札等の幅が狭いコンテキストで効果説明を非表示にする
  hideCardDescription?: boolean;
  // 二歩指し等、マナ以外の使用条件を満たさないカードIDを非活性化する。
  // マナ不足と同じ disabled 表示にする(条件詳細はカード説明を参照)。
  unusableCardIds?: Set<string>;
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
  flashCardId = null,
  hideCardDescription = false,
  unusableCardIds,
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
      data-hand-scroll={layout}
      className={cn(
        "flex gap-2",
        // 上余白(pt-2): hover で各カードが translateY(-2px) で浮くため、
        // 上余白がないと一番上(または一番手前)のカードが見切れる。
        layout === "horizontal" && "flex-row overflow-x-auto pt-2 pb-1",
        layout === "vertical" && "flex-col overflow-y-auto pt-2 pr-1",
      )}
      style={{ touchAction: layout === "vertical" ? "pan-y" : "pan-x" }}
    >
      {hand.map((c) => {
        const def = CARD_DEFS[c.defId];
        // マナ不足: 常にグレーアウト (操作不可かどうかに関わらず)
        // 条件未達 (二歩指し等): 同様にグレーアウト
        // マナ十分・条件達成かつ全体 disabled (相手番など): 通常表示のまま操作だけ無効化 (= inactive)
        const unaffordable = currentMana < def.cost;
        const conditionUnmet = unusableCardIds?.has(c.defId) ?? false;
        const cardDisabled = unaffordable || conditionUnmet;
        const cardInactive = !cardDisabled && disabled;
        const isFresh = c.instanceId === flashCardId;
        return (
          <div
            key={c.instanceId}
            className={cn("rounded-md", isFresh && "animate-hand-card-flash")}
          >
            <CardView
              card={c}
              size={size}
              disabled={cardDisabled}
              inactive={cardInactive}
              fullWidth={fullWidth}
              hideDescription={hideCardDescription}
              onClick={() => onCardClick?.(c.instanceId)}
            />
          </div>
        );
      })}
    </div>
  );
}
