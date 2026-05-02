"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CARD_DEFS } from "@/lib/shogi/cards/definitions";
import { RARITY_INFO, RARITY_OPTIONS } from "@/lib/shogi/cards/labels";
import {
  DECK_TOTAL_MAX,
  RARITY_MAX_PER_DECK,
} from "@/lib/shogi/cards/deck-rules";
import type { CardId, CardRarity } from "@/lib/shogi/cards/types";
import type { OwnedCardSummary } from "@/app/actions/deck";
import { DeckCardTile, TileBadge } from "./deck-card-tile";

interface OwnedCardPickerProps {
  ownedCards: OwnedCardSummary[];
  currentCountByCard: Map<CardId, number>;
  totalCount: number;
  disabled?: boolean;
  onAdd: (cardId: CardId) => void;
}

export function OwnedCardPicker({
  ownedCards,
  currentCountByCard,
  totalCount,
  disabled = false,
  onAdd,
}: OwnedCardPickerProps) {
  const [rarityFilter, setRarityFilter] = useState<ReadonlySet<CardRarity>>(
    new Set(RARITY_OPTIONS),
  );

  const filtered = useMemo(() => {
    return ownedCards
      .filter((c) => rarityFilter.has(c.rarity))
      .sort((a, b) => {
        const ra = RARITY_OPTIONS.indexOf(a.rarity);
        const rb = RARITY_OPTIONS.indexOf(b.rarity);
        if (ra !== rb) return ra - rb;
        return CARD_DEFS[a.cardId].name.localeCompare(CARD_DEFS[b.cardId].name);
      });
  }, [ownedCards, rarityFilter]);

  const totalAtMax = totalCount >= DECK_TOTAL_MAX;

  return (
    <div className="flex flex-col min-h-0">
      <header className="p-2 border-b shrink-0 flex flex-col gap-2">
        <h3 className="text-xs font-semibold">所持カード ({ownedCards.length} 種)</h3>
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => {
              const all = RARITY_OPTIONS.every((r) => rarityFilter.has(r));
              setRarityFilter(all ? new Set() : new Set(RARITY_OPTIONS));
            }}
            className={cn(
              "rounded-md cursor-pointer transition-all",
              "hover:ring-2 hover:ring-amber-400/70 hover:ring-offset-1 hover:ring-offset-background",
            )}
          >
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] px-1.5 py-0",
                RARITY_OPTIONS.every((r) => rarityFilter.has(r))
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card opacity-40",
              )}
            >
              すべて
            </Badge>
          </button>
          {RARITY_OPTIONS.map((r) => {
            const active = rarityFilter.has(r);
            return (
              <button
                key={r}
                type="button"
                onClick={() => {
                  const next = new Set(rarityFilter);
                  if (next.has(r)) next.delete(r);
                  else next.add(r);
                  setRarityFilter(next);
                }}
                className={cn(
                  "rounded-md cursor-pointer transition-all",
                  "hover:ring-2 hover:ring-amber-400/70 hover:ring-offset-1 hover:ring-offset-background",
                  active ? "" : "opacity-40",
                )}
                aria-pressed={active}
              >
                <Badge
                  variant="outline"
                  className={cn("text-[10px] px-1.5 py-0", RARITY_INFO[r].className)}
                >
                  {RARITY_INFO[r].label}
                </Badge>
              </button>
            );
          })}
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto p-2">
        {filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">
            該当する所持カードがありません
          </p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 pb-2">
            {filtered.map((c) => {
              const current = currentCountByCard.get(c.cardId) ?? 0;
              // 残り = 所持 - 編成中
              const remaining = c.owned - current;
              const cap = RARITY_MAX_PER_DECK[c.rarity];
              const atRarityCap = cap !== null && current >= cap;
              const noStock = remaining <= 0;
              const cantAdd = noStock || atRarityCap || totalAtMax;

              const reason = noStock
                ? "残り 0 枚 (所持枚数すべて編成済み)"
                : atRarityCap
                  ? `${RARITY_INFO[c.rarity].label}は ${cap} 枚まで`
                  : totalAtMax
                    ? `デッキ合計 ${DECK_TOTAL_MAX} 枚に達しています`
                    : "クリックでデッキに追加";

              return (
                <DeckCardTile
                  key={c.cardId}
                  cardId={c.cardId}
                  disabled={disabled || cantAdd}
                  onClick={() => onAdd(c.cardId)}
                  title={reason}
                  topBadge={
                    <TileBadge
                      className={cn(
                        noStock
                          ? "bg-muted text-muted-foreground border-border"
                          : "bg-primary text-primary-foreground border-primary",
                      )}
                    >
                      ×{remaining}
                    </TileBadge>
                  }
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
