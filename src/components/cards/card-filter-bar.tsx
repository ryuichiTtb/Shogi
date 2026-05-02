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
  status: ReadonlySet<CardStatus>;
  kind: ReadonlySet<CardKind>;
  rarity: ReadonlySet<CardRarity>;
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
        options={STATUS_OPTIONS.map((s) => ({
          id: s,
          label: STATUS_INFO[s].label,
          className: STATUS_INFO[s].className,
        }))}
        selected={value.status}
        allOptions={STATUS_OPTIONS}
        onToggle={(id) => onChange({ ...value, status: toggle(value.status, id) })}
        onToggleAll={() =>
          onChange({ ...value, status: toggleAll(value.status, STATUS_OPTIONS) })
        }
      />
      <FilterRow
        label="種別"
        options={KIND_OPTIONS.map((k) => ({
          id: k,
          label: KIND_INFO[k].label,
          className: KIND_INFO[k].className,
        }))}
        selected={value.kind}
        allOptions={KIND_OPTIONS}
        onToggle={(id) => onChange({ ...value, kind: toggle(value.kind, id) })}
        onToggleAll={() =>
          onChange({ ...value, kind: toggleAll(value.kind, KIND_OPTIONS) })
        }
      />
      <FilterRow
        label="レア度"
        options={RARITY_OPTIONS.map((r) => ({
          id: r,
          label: RARITY_INFO[r].label,
          className: RARITY_INFO[r].className,
        }))}
        selected={value.rarity}
        allOptions={RARITY_OPTIONS}
        onToggle={(id) => onChange({ ...value, rarity: toggle(value.rarity, id) })}
        onToggleAll={() =>
          onChange({ ...value, rarity: toggleAll(value.rarity, RARITY_OPTIONS) })
        }
      />
    </div>
  );
}

function toggle<T>(set: ReadonlySet<T>, id: T): Set<T> {
  const next = new Set(set);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

// 全 ON のときは全 OFF へ、それ以外は全 ON へ切り替える。
function toggleAll<T>(set: ReadonlySet<T>, all: readonly T[]): Set<T> {
  const allActive = all.every((id) => set.has(id));
  return allActive ? new Set<T>() : new Set(all);
}

interface FilterRowProps<T extends string> {
  label: string;
  options: { id: T; label: string; className: string }[];
  selected: ReadonlySet<T>;
  allOptions: readonly T[];
  onToggle: (id: T) => void;
  onToggleAll: () => void;
}

function FilterRow<T extends string>({
  label,
  options,
  selected,
  allOptions,
  onToggle,
  onToggleAll,
}: FilterRowProps<T>) {
  const allActive = allOptions.every((id) => selected.has(id));
  return (
    <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
      <span className="text-[10px] sm:text-xs font-medium text-muted-foreground w-11 sm:w-16 shrink-0">{label}</span>
      <div className="flex flex-wrap gap-1 sm:gap-1.5">
        <button
          type="button"
          onClick={onToggleAll}
          className={cn(
            "cursor-pointer transition-all",
            allActive ? "" : "opacity-40 hover:opacity-100",
          )}
          aria-pressed={allActive}
        >
          <Badge
            variant="outline"
            className={cn("text-[10px] sm:text-xs px-1.5 sm:px-2 py-0 sm:py-0.5 bg-card")}
          >
            すべて
          </Badge>
        </button>
        {options.map((opt) => {
          const active = selected.has(opt.id);
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onToggle(opt.id)}
              className={cn(
                "cursor-pointer transition-all",
                active ? "" : "opacity-40 hover:opacity-100",
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
