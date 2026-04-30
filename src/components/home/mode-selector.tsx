"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type GameMode = "standard" | "card-shogi";

interface ModeSelectorProps {
  mode: GameMode;
  onChange: (mode: GameMode) => void;
  className?: string;
}

const MODES: { value: GameMode; label: string; description: string; beta?: boolean }[] = [
  {
    value: "standard",
    label: "従来将棋",
    description: "正統派ルール",
  },
  {
    value: "card-shogi",
    label: "カード将棋",
    description: "マナとカードで戦う",
    beta: true,
  },
];

export function ModeSelector({ mode, onChange, className }: ModeSelectorProps) {
  return (
    <div
      className={cn("grid grid-cols-2 gap-2", className)}
      role="tablist"
      aria-label="モード選択"
    >
      {MODES.map((m) => {
        const active = mode === m.value;
        return (
          <button
            key={m.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(m.value)}
            className={cn(
              "relative py-3 px-3 rounded-lg border-2 transition-all",
              "flex flex-col items-center justify-center gap-0.5 text-center",
              "cursor-pointer",
              active
                ? "border-primary bg-primary/10 shadow-sm"
                : "border-border bg-card hover:border-primary/40",
            )}
          >
            <div className="flex items-center gap-1.5">
              <span className={cn("font-bold text-sm", active ? "text-primary" : "text-foreground")}>
                {m.label}
              </span>
              {m.beta && (
                <Badge
                  variant="secondary"
                  className="text-[9px] px-1 py-0 leading-tight bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200"
                >
                  BETA
                </Badge>
              )}
            </div>
            <span className="text-[11px] text-muted-foreground leading-tight">
              {m.description}
            </span>
          </button>
        );
      })}
    </div>
  );
}
