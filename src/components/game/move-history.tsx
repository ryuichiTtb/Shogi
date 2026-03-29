"use client";

import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { moveToNotation } from "@/lib/shogi/notation";
import type { Move } from "@/lib/shogi/types";
import { cn } from "@/lib/utils";

interface MoveHistoryProps {
  moves: Move[];
}

export function MoveHistory({ moves }: MoveHistoryProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // 手が追加されるたびに最新手へ自動スクロール
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [moves.length]);

  return (
    <div className="flex flex-col h-full">
      <div className="text-sm font-medium text-muted-foreground mb-1">棋譜</div>
      <ScrollArea className="flex-1 border rounded-md bg-muted/30">
        <div className="p-2 space-y-0.5">
          {moves.length === 0 ? (
            <p className="text-xs text-muted-foreground p-2">棋譜はまだありません</p>
          ) : (
            moves.map((move, index) => {
              const prevTo = index > 0 ? moves[index - 1].to : undefined;
              const notation = moveToNotation(move, prevTo);
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
                  <span>{notation}</span>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
    </div>
  );
}
