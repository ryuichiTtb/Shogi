"use client";

import { useState, useMemo } from "react";
import { CardCatalogTile } from "./card-catalog-tile";
import { CardFilterBar, type CardFilterValue } from "./card-filter-bar";
import type { CardDefinition } from "@/lib/shogi/cards/types";

interface CardCatalogGridProps {
  cards: CardDefinition[];
}

const INITIAL_FILTER: CardFilterValue = {
  status: "all",
  kind: "all",
  rarity: "all",
};

export function CardCatalogGrid({ cards }: CardCatalogGridProps) {
  const [filter, setFilter] = useState<CardFilterValue>(INITIAL_FILTER);

  const filtered = useMemo(() => {
    return cards.filter((c) => {
      if (filter.status !== "all" && c.status !== filter.status) return false;
      if (filter.kind !== "all" && c.kind !== filter.kind) return false;
      if (filter.rarity !== "all" && c.rarity !== filter.rarity) return false;
      return true;
    });
  }, [cards, filter]);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border bg-card p-3">
        <CardFilterBar value={filter} onChange={setFilter} />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          条件に合致するカードがありません
        </div>
      ) : (
        <>
          <div className="text-xs text-muted-foreground">
            {filtered.length} 件表示中 (全 {cards.length} 件)
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((def) => (
              <CardCatalogTile key={def.id} def={def} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
