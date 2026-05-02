"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Plus } from "lucide-react";
import type { DeckSummary } from "@/app/actions/deck";

interface DeckListPaneProps {
  decks: DeckSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRequestNew: () => void;
}

export function DeckListPane({
  decks,
  selectedId,
  onSelect,
  onRequestNew,
}: DeckListPaneProps) {
  return (
    <div className="rounded-lg border bg-card flex flex-col min-h-0">
      <div className="p-3 border-b flex items-center justify-between shrink-0">
        <h2 className="text-sm font-semibold">デッキ一覧</h2>
        <Button size="sm" variant="outline" onClick={onRequestNew}>
          <Plus className="w-3.5 h-3.5" />
          新規
        </Button>
      </div>
      <ul className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
        {decks.map((deck) => {
          const active = deck.id === selectedId;
          return (
            <li key={deck.id}>
              <button
                type="button"
                onClick={() => onSelect(deck.id)}
                className={cn(
                  "w-full text-left px-3 py-2 rounded-md border-2 transition-all cursor-pointer",
                  active
                    ? "border-primary bg-primary/5"
                    : "border-transparent hover:border-border hover:bg-muted/50",
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm truncate flex-1">
                    {deck.name}
                  </span>
                  {deck.isDefault && (
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0 bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-200 dark:border-emerald-800"
                    >
                      使用中
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {deck.totalCount} 枚
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
