"use client";

import { useRef } from "react";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { CardView } from "@/components/game/card-shogi/card-view";
import { cn } from "@/lib/utils";
import type { CardId } from "@/lib/shogi/cards/types";

export type DeckArea = "deck" | "owned";

interface DeckCardTileProps {
  // 同一 cardId が複数並ぶときに React key を一意にするための補助。
  instanceKey?: string | number;
  cardId: CardId;
  // フライト元/先を判別するため、領域種別を data 属性として埋める。
  area: DeckArea;
  // タイル右上に重ねるバッジ。例: ×N
  topBadge?: React.ReactNode;
  // 物理的に使用不可 (所持枚数を全部編成済み等)。CardView の disabled と同じ
  // 見た目 (saturate-40% + opacity-55 + cursor-not-allowed) になる。
  disabled?: boolean;
  // クリック時に発火。フライト演出の起点として、タイルの画面座標を渡す。
  onClick?: (sourceRect: DOMRect) => void;
  title?: string;
  // フライト中は元タイルを視覚的に隠す (DeckCardTile を render し続けたまま
  // 透明にすることで grid レイアウトの揺れを避ける)。
  ghosted?: boolean;
}

// 現在のデッキ・所持カード両方で使う共通タイル。
// CardView をそのまま実物カードとして表示し、上にバッジを重ねるだけ。
export function DeckCardTile({
  cardId,
  instanceKey,
  area,
  topBadge,
  disabled = false,
  onClick,
  title,
  ghosted = false,
}: DeckCardTileProps) {
  const ref = useRef<HTMLDivElement>(null);

  function handleClick() {
    if (!onClick || disabled) return;
    const rect = ref.current?.getBoundingClientRect();
    if (rect) onClick(rect);
  }

  return (
    <motion.div
      ref={ref}
      // layout="position" により、リスト前後関係の変化に追従してタイルが
      // スムーズに移動する。サイズ変化はしないので "position" 限定で十分。
      layout="position"
      transition={{ duration: 0.24, ease: "easeOut" }}
      className={cn(
        "relative transition-opacity",
        ghosted && "opacity-0",
      )}
      data-deck-area={area}
      data-card-id={cardId}
      data-instance-key={instanceKey ?? "single"}
      title={title}
    >
      <CardView
        card={{
          instanceId: `tile-${area}-${cardId}-${instanceKey ?? "single"}`,
          defId: cardId,
        }}
        size="md"
        fullWidth
        disabled={disabled}
        onClick={onClick ? handleClick : undefined}
      />
      {topBadge && (
        <div className="absolute -top-2 -right-1 pointer-events-none z-10">
          {topBadge}
        </div>
      )}
    </motion.div>
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
