"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CardView } from "@/components/game/card-shogi/card-view";
import { cn } from "@/lib/utils";
import { Minus, Plus, X } from "lucide-react";
import type { CardId } from "@/lib/shogi/cards/types";

interface DeckCardTileProps {
  cardId: CardId;
  // タイル右上に重ねるバッジ。所持枚数や編成中バッジ等を表示。
  topBadge?: React.ReactNode;
  // 下部コントロール (+/- など)。レイアウトはこのコンポーネント側で flex する。
  controls: React.ReactNode;
  // タイル全体のグレーアウト (現在のデッキで count が 0 になることはないので主に
  // owned 側で「全く編成不可」状態のときに使う想定)
  faded?: boolean;
}

// 現在のデッキ・所持カード両方で使う共通タイル。
// CardView (md, fullWidth) を使い、マスターカタログのタイルと同じ見た目にする。
export function DeckCardTile({
  cardId,
  topBadge,
  controls,
  faded = false,
}: DeckCardTileProps) {
  return (
    <div className={cn("flex flex-col gap-1", faded && "opacity-50")}>
      <div className="relative">
        <CardView
          card={{ instanceId: `deck-${cardId}`, defId: cardId }}
          size="md"
          fullWidth
          inactive
        />
        {topBadge && (
          <div className="absolute -top-2 -right-1 pointer-events-none">
            {topBadge}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-1 px-0.5">
        {controls}
      </div>
    </div>
  );
}

// 「現在のデッキ」用コントロール: − / 枚数 / + / ×
interface DeckTileControlsProps {
  count: number;
  canIncrement: boolean;
  disabled?: boolean;
  onIncrement: () => void;
  onDecrement: () => void;
  onRemove: () => void;
}

export function DeckTileControls({
  count,
  canIncrement,
  disabled = false,
  onIncrement,
  onDecrement,
  onRemove,
}: DeckTileControlsProps) {
  return (
    <>
      <div className="flex items-center gap-0.5">
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={onDecrement}
          disabled={disabled}
          aria-label="1枚減らす"
        >
          <Minus />
        </Button>
        <span className="w-6 text-center text-sm font-semibold tabular-nums">
          ×{count}
        </span>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={onIncrement}
          disabled={disabled || !canIncrement}
          aria-label="1枚増やす"
        >
          <Plus />
        </Button>
      </div>
      <Button
        size="icon-xs"
        variant="ghost"
        onClick={onRemove}
        disabled={disabled}
        aria-label="削除"
      >
        <X />
      </Button>
    </>
  );
}

// 「所持カード」用コントロール: 所持/編成中の数値 + + ボタン
interface OwnedTileControlsProps {
  owned: number;
  current: number;
  cap: number | null;
  canAdd: boolean;
  disabled?: boolean;
  reason?: string;
  onAdd: () => void;
}

export function OwnedTileControls({
  owned,
  current,
  cap,
  canAdd,
  disabled = false,
  reason,
  onAdd,
}: OwnedTileControlsProps) {
  return (
    <>
      <span className="text-[10px] text-muted-foreground tabular-nums leading-tight">
        所持 {owned} / 編成 {current}
        {cap !== null && ` (上限 ${cap})`}
      </span>
      <Button
        size="icon-xs"
        variant="outline"
        onClick={onAdd}
        disabled={disabled || !canAdd}
        title={reason}
        aria-label="デッキに追加"
      >
        <Plus />
      </Button>
    </>
  );
}

// 共通バッジ (タイル右上)
export function TileBadge({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px] px-1.5 py-0 leading-tight border-2 shadow-sm",
        className,
      )}
    >
      {children}
    </Badge>
  );
}
