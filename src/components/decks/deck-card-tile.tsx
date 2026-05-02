"use client";

import { Badge } from "@/components/ui/badge";
import { CardView } from "@/components/game/card-shogi/card-view";
import { cn } from "@/lib/utils";
import type { CardId } from "@/lib/shogi/cards/types";

interface DeckCardTileProps {
  // 同一 cardId が複数並ぶときに React key を一意にするための補助。
  instanceKey?: string | number;
  cardId: CardId;
  // タイル右上に重ねるバッジ。例: ×N
  topBadge?: React.ReactNode;
  // 物理的に使用不可 (所持枚数を全部編成済み等)。CardView の disabled と同じ
  // 見た目 (saturate-40% + opacity-55 + cursor-not-allowed) になる。
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
}

// 現在のデッキ・所持カード両方で使う共通タイル。CardView をそのまま実物カード
// として表示し、上にバッジを重ねるだけのシンプルな構造。
export function DeckCardTile({
  cardId,
  instanceKey,
  topBadge,
  disabled = false,
  onClick,
  title,
}: DeckCardTileProps) {
  return (
    <div className="relative" title={title}>
      <CardView
        card={{
          instanceId: `deck-${cardId}-${instanceKey ?? "single"}`,
          defId: cardId,
        }}
        size="md"
        fullWidth
        disabled={disabled}
        onClick={disabled ? undefined : onClick}
      />
      {topBadge && (
        <div className={cn("absolute -top-2 -right-1 pointer-events-none z-10")}>
          {topBadge}
        </div>
      )}
    </div>
  );
}

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
        "text-[10px] px-1.5 py-0 leading-tight border-2 shadow-sm tabular-nums",
        className,
      )}
    >
      {children}
    </Badge>
  );
}
