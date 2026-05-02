"use client";

import { useState, useMemo } from "react";
import { CardCatalogTile } from "./card-catalog-tile";
import { CardFilterBar, type CardFilterValue } from "./card-filter-bar";
import {
  KIND_OPTIONS,
  RARITY_OPTIONS,
  STATUS_OPTIONS,
} from "@/lib/shogi/cards/labels";
import type { CardDefinition } from "@/lib/shogi/cards/types";

interface CardCatalogGridProps {
  cards: CardDefinition[];
}

const INITIAL_FILTER: CardFilterValue = {
  status: new Set(STATUS_OPTIONS),
  kind: new Set(KIND_OPTIONS),
  rarity: new Set(RARITY_OPTIONS),
};

// フィルタ欄は親 flex の shrink-0 で上部固定、
// グリッド領域は flex-1 + overflow-y-auto で内部スクロール。
export function CardCatalogGrid({ cards }: CardCatalogGridProps) {
  const [filter, setFilter] = useState<CardFilterValue>(INITIAL_FILTER);

  const filtered = useMemo(() => {
    return cards.filter((c) => {
      if (!filter.status.has(c.status)) return false;
      if (!filter.kind.has(c.kind)) return false;
      if (!filter.rarity.has(c.rarity)) return false;
      return true;
    });
  }, [cards, filter]);

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      <div className="rounded-lg border bg-card p-3 shrink-0">
        <CardFilterBar value={filter} onChange={setFilter} />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          条件に合致するカードがありません
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1">
          <div className="text-xs text-muted-foreground mb-2 sticky top-0 bg-background/80 backdrop-blur py-1 z-10">
            {filtered.length} 件表示中 (全 {cards.length} 件)
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pb-3">
            {filtered.map((def) => (
              <CardCatalogTile key={def.id} def={def} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
