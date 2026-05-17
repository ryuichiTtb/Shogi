"use client";

import { memo, useCallback } from "react";
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
  // Issue #130: 自動ドロー直後のカードを emerald 系で光らせる (manual と区別、0.7s)。
  autoFlashCardId?: string | null;
  // Issue #106: モバイル手札等の幅が狭いコンテキストで効果説明を非表示にする
  hideCardDescription?: boolean;
  // 二歩指し等、マナ以外の使用条件を満たさないカードIDを非活性化する。
  // マナ不足と同じ disabled 表示にする(条件詳細はカード説明を参照)。
  unusableCardIds?: Set<string>;
  // stack レイアウト時に重ね表示するカード枚数の上限 (Issue #105 モバイル省幅化)。
  // 超過分は「×N (合計枚数)」ラベルで補う。デフォルト 5。
  stackMaxVisible?: number;
}

interface HandCardProps {
  card: CardInstance;
  size: "sm" | "md" | "lg";
  cardDisabled: boolean;
  cardInactive: boolean;
  fullWidth: boolean;
  hideCardDescription: boolean;
  isFresh: boolean;
  // Issue #130: 自動ドロー由来のカードを emerald で光らせる (isFresh=manual amber と排他)
  isAutoFresh: boolean;
  onCardClick?: (instanceId: string) => void;
}

// 手札の 1 枚分。React.memo + 内部 useCallback で onClick を安定化し、
// 親の他フィールド変化 (マナ・eventLog 等) で他カードが再描画されないようにする。
const HandCard = memo(function HandCard({
  card,
  size,
  cardDisabled,
  cardInactive,
  fullWidth,
  hideCardDescription,
  isFresh,
  isAutoFresh,
  onCardClick,
}: HandCardProps) {
  const handleClick = useCallback(() => {
    onCardClick?.(card.instanceId);
  }, [card.instanceId, onCardClick]);

  return (
    <div
      className={cn(
        "rounded-md",
        isFresh && "animate-hand-card-flash",
        isAutoFresh && "animate-hand-card-flash-emerald",
      )}
    >
      <CardView
        card={card}
        size={size}
        disabled={cardDisabled}
        inactive={cardInactive}
        fullWidth={fullWidth}
        hideDescription={hideCardDescription}
        onClick={handleClick}
      />
    </div>
  );
});

export const HandArea = memo(function HandArea({
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
  autoFlashCardId = null,
  hideCardDescription = false,
  unusableCardIds,
  stackMaxVisible = 5,
}: HandAreaProps) {
  if (hand.length === 0) {
    return <div className="text-xs text-muted-foreground py-2 px-3">{emptyLabel}</div>;
  }

  // 重ね表示(stack): 隣接カードを重ねる。Phase 0 では相手手札の裏向き表示で使用。
  // 表示は最大 stackMaxVisible 枚までに制限し、超過分は「×N」ラベルで補う
  // (Issue #105: モバイルで手札が増えると相手バーが見切れるため)。
  if (layout === "stack") {
    const overlapClass = size === "sm" ? "-ml-9" : size === "md" ? "-ml-14" : "-ml-16";
    const total = hand.length;
    const visible = hand.slice(0, stackMaxVisible);
    return (
      <div data-hand-area className="flex flex-row items-center" aria-label={`カード ${total}枚`}>
        {visible.map((c, i) => (
          <div key={c.instanceId} className={cn(i > 0 && overlapClass)}>
            <CardView card={c} faceDown={faceDown} size={size} />
          </div>
        ))}
        {total > stackMaxVisible && (
          <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-muted text-foreground text-[10px] font-bold leading-none shrink-0 self-center">
            ×{total}
          </span>
        )}
      </div>
    );
  }

  if (faceDown) {
    return (
      <div
        data-hand-area
        className={cn("flex gap-1", layout === "vertical" ? "flex-col" : "flex-row")}
      >
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
        const isAutoFresh = c.instanceId === autoFlashCardId;
        return (
          <HandCard
            key={c.instanceId}
            card={c}
            size={size}
            cardDisabled={cardDisabled}
            cardInactive={cardInactive}
            fullWidth={fullWidth}
            hideCardDescription={hideCardDescription}
            isFresh={isFresh}
            isAutoFresh={isAutoFresh}
            onCardClick={onCardClick}
          />
        );
      })}
    </div>
  );
});
