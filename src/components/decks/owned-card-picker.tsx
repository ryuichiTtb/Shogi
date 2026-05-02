"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Plus } from "lucide-react";
import { CARD_DEFS } from "@/lib/shogi/cards/definitions";
import { RARITY_INFO, RARITY_OPTIONS } from "@/lib/shogi/cards/labels";
import {
  DECK_TOTAL_MAX,
  RARITY_MAX_PER_DECK,
} from "@/lib/shogi/cards/deck-rules";
import type { CardId, CardRarity } from "@/lib/shogi/cards/types";
import type { OwnedCardSummary } from "@/app/actions/deck";

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
          <ul className="space-y-1">
            {filtered.map((c) => {
              const def = CARD_DEFS[c.cardId];
              const current = currentCountByCard.get(c.cardId) ?? 0;
              const cap = RARITY_MAX_PER_DECK[c.rarity];
              const limit = cap === null ? c.owned : Math.min(c.owned, cap);
              const atCardLimit = current >= limit;
              const cantAdd = disabled || totalAtMax || atCardLimit;

              const reason = totalAtMax
                ? `デッキ合計 ${DECK_TOTAL_MAX} 枚に達しています`
                : atCardLimit
                  ? cap !== null && c.owned >= cap
                    ? `${RARITY_INFO[c.rarity].label}は ${cap} 枚まで`
                    : `所持枚数 ${c.owned} 枚に達しています`
                  : undefined;

              return (
                <li
                  key={c.cardId}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md border bg-background"
                >
                  <span className="text-base shrink-0" aria-hidden>
                    {def.icon}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium truncate">
                        {def.name}
                      </span>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[9px] px-1 py-0 leading-tight",
                          RARITY_INFO[c.rarity].className,
                        )}
                      >
                        {RARITY_INFO[c.rarity].label}
                      </Badge>
                    </div>
                    <div className="text-[10px] text-muted-foreground tabular-nums">
                      所持 {c.owned} / 編成中 {current}
                      {cap !== null && ` (上限 ${cap})`}
                    </div>
                  </div>
                  <Button
                    size="icon-xs"
                    variant="outline"
                    onClick={() => onAdd(c.cardId)}
                    disabled={cantAdd}
                    title={reason}
                    aria-label={`${def.name} を追加`}
                  >
                    <Plus />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
