"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type GameMode = "standard" | "card-shogi";

interface ModeSelectorProps {
  mode: GameMode;
  onChange: (mode: GameMode) => void;
  className?: string;
}

export function ModeSelector({ mode, onChange, className }: ModeSelectorProps) {
  return (
    <Tabs
      value={mode}
      onValueChange={(v) => onChange(v as GameMode)}
      className={cn("w-full", className)}
    >
      <TabsList className="w-full grid grid-cols-2 h-auto">
        <TabsTrigger value="standard" className="py-2">
          <span className="font-bold text-sm">従来将棋</span>
        </TabsTrigger>
        <TabsTrigger value="card-shogi" className="py-2 gap-1.5">
          <span className="font-bold text-sm">カード将棋</span>
          <Badge
            variant="secondary"
            className="text-[9px] px-1 py-0 leading-tight bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200"
          >
            BETA
          </Badge>
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
