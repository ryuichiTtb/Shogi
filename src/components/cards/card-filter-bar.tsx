"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  KIND_INFO,
  KIND_OPTIONS,
  RARITY_INFO,
  RARITY_OPTIONS,
  STATUS_INFO,
  STATUS_OPTIONS,
} from "@/lib/shogi/cards/labels";
import type {
  CardKind,
  CardRarity,
  CardStatus,
} from "@/lib/shogi/cards/types";

export interface CardFilterValue {
  status: CardStatus | "all";
  kind: CardKind | "all";
  rarity: CardRarity | "all";
}

interface CardFilterBarProps {
  value: CardFilterValue;
  onChange: (next: CardFilterValue) => void;
}

export function CardFilterBar({ value, onChange }: CardFilterBarProps) {
  return (
    <div className="flex flex-col gap-3">
      <FilterRow
        label="ステータス"
        options={[
          { id: "all", label: "すべて", className: "" },
          ...STATUS_OPTIONS.map((s) => ({ id: s, label: STATUS_INFO[s].label, className: STATUS_INFO[s].className })),
        ]}
        selected={value.status}
        onSelect={(id) => onChange({ ...value, status: id as CardFilterValue["status"] })}
      />
      <FilterRow
        label="種別"
        options={[
          { id: "all", label: "すべて", className: "" },
          ...KIND_OPTIONS.map((k) => ({ id: k, label: KIND_INFO[k].label, className: KIND_INFO[k].className })),
        ]}
        selected={value.kind}
        onSelect={(id) => onChange({ ...value, kind: id as CardFilterValue["kind"] })}
      />
      <FilterRow
        label="レア度"
        options={[
          { id: "all", label: "すべて", className: "" },
          ...RARITY_OPTIONS.map((r) => ({ id: r, label: RARITY_INFO[r].label, className: RARITY_INFO[r].className })),
        ]}
        selected={value.rarity}
        onSelect={(id) => onChange({ ...value, rarity: id as CardFilterValue["rarity"] })}
      />
    </div>
  );
}

interface FilterRowProps {
  label: string;
  options: { id: string; label: string; className: string }[];
  selected: string;
  onSelect: (id: string) => void;
}

function FilterRow({ label, options, selected, onSelect }: FilterRowProps) {
  return (
    <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
      <span className="text-[10px] sm:text-xs font-medium text-muted-foreground w-11 sm:w-16 shrink-0">{label}</span>
      <div className="flex flex-wrap gap-1 sm:gap-1.5">
        {options.map((opt) => {
          const active = selected === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onSelect(opt.id)}
              className={cn(
                "cursor-pointer transition-all",
                active ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : "opacity-60 hover:opacity-100",
              )}
              aria-pressed={active}
            >
              <Badge
                variant="outline"
                className={cn("text-[10px] sm:text-xs px-1.5 sm:px-2 py-0 sm:py-0.5", opt.className || "bg-card")}
              >
                {opt.label}
              </Badge>
            </button>
          );
        })}
      </div>
    </div>
  );
}
