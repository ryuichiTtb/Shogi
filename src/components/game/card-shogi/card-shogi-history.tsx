"use client";

import { useEffect, useRef } from "react";
import { moveToNotation } from "@/lib/shogi/notation";
import type { Player, Position } from "@/lib/shogi/types";
import type { GameEvent } from "@/lib/shogi/cards/types";
import { CARD_DEFS } from "@/lib/shogi/cards/definitions";
import { cn } from "@/lib/utils";

interface CardShogiHistoryProps {
  eventLog: GameEvent[];
}

interface DisplayEntry {
  index: number;
  player: Player;
  text: string;
  kind: "move" | "card";
}

// eventLog を表示用エントリに変換。manaChargeEvent はターンごとに大量発生するため非表示。
function buildEntries(eventLog: GameEvent[]): DisplayEntry[] {
  const entries: DisplayEntry[] = [];
  let prevMoveTo: Position | undefined;
  for (const ev of eventLog) {
    let entry: DisplayEntry | null = null;
    switch (ev.kind) {
      case "moveEvent":
        entry = {
          index: 0,
          player: ev.move.player,
          text: moveToNotation(ev.move, prevMoveTo),
          kind: "move",
        };
        prevMoveTo = ev.move.to;
        break;
      case "drawEvent":
        entry = { index: 0, player: ev.player, text: "山札ドロー", kind: "card" };
        break;
      case "cardPlayEvent":
        entry = {
          index: 0,
          player: ev.player,
          text: `${CARD_DEFS[ev.instance.defId].name}使用`,
          kind: "card",
        };
        break;
      case "trapSetEvent":
        entry = {
          index: 0,
          player: ev.player,
          text: `${CARD_DEFS[ev.instance.defId].name}セット`,
          kind: "card",
        };
        break;
      case "trapTriggerEvent":
        entry = {
          index: 0,
          player: ev.player,
          text: `トラップ発動: ${CARD_DEFS[ev.instance.defId].name}`,
          kind: "card",
        };
        break;
      case "manaChargeEvent":
        // ターン由来の自動チャージは大量発生のため非表示。カード由来のみ表示することも可能だが
        // Phase 0 ではノイズを抑えるため一律非表示。
        break;
    }
    if (entry) {
      entries.push({ ...entry, index: entries.length + 1 });
    }
  }
  return entries;
}

export function CardShogiHistory({ eventLog }: CardShogiHistoryProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const entries = buildEntries(eventLog);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  return (
    <div className="flex flex-col h-full">
      <div className="text-sm font-medium text-muted-foreground mb-1">棋譜</div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto border rounded-md bg-muted/30">
        <div className="p-2 space-y-0.5">
          {entries.length === 0 ? (
            <p className="text-xs text-muted-foreground p-2">棋譜はまだありません</p>
          ) : (
            entries.map((entry) => {
              const isSente = entry.player === "sente";
              return (
                <div
                  key={entry.index}
                  className={cn(
                    "flex items-center gap-2 px-2 py-0.5 rounded text-xs",
                    "hover:bg-muted transition-colors",
                    entry.kind === "card" && "text-purple-700 dark:text-purple-300",
                  )}
                >
                  <span className="text-muted-foreground w-6 text-right shrink-0">
                    {entry.index}.
                  </span>
                  <span
                    className={cn(
                      "font-medium",
                      isSente ? "text-gray-700 dark:text-gray-300" : "text-gray-500 dark:text-gray-400",
                    )}
                  >
                    {isSente ? "▲" : "△"}
                  </span>
                  <span>{entry.text}</span>
                  {entry.kind === "card" && (
                    <span className="ml-auto text-[9px] bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-200 px-1 rounded shrink-0">
                      CARD
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
