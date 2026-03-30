"use client";

import { useEffect, useRef, useMemo } from "react";
import { moveToNotation } from "@/lib/shogi/notation";
import type { Move } from "@/lib/shogi/types";
import { cn } from "@/lib/utils";

interface MoveHistoryProps {
  moves: Move[];
}

export function MoveHistory({ moves }: MoveHistoryProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // 棋譜文字列をメモ化（moves が変わらない限り再計算しない）
  const notations = useMemo(
    () => moves.map((move, i) => moveToNotation(move, i > 0 ? moves[i - 1].to : undefined)),
    [moves]
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [moves.length]);

  return (
    <div className="flex flex-col h-full">
      <div className="text-sm font-medium text-muted-foreground mb-1">棋譜</div>
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto border rounded-md bg-muted/30"
      >
        <div className="p-2 space-y-0.5">
          {moves.length === 0 ? (
            <p className="text-xs text-muted-foreground p-2">棋譜はまだありません</p>
          ) : (
            moves.map((move, index) => {
              const isSente = move.player === "sente";

              return (
                <div
                  key={index}
                  className={cn(
                    "flex items-center gap-2 px-2 py-0.5 rounded text-xs",
                    "hover:bg-muted transition-colors"
                  )}
                >
                  <span className="text-muted-foreground w-6 text-right shrink-0">
                    {index + 1}.
                  </span>
                  <span className={cn("font-medium", isSente ? "text-gray-700" : "text-gray-500")}>
                    {isSente ? "▲" : "△"}
                  </span>
                  <span>{notations[index]}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
