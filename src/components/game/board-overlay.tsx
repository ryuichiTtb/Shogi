"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export type OverlayEvent = "game_start" | "check" | "resign" | "checkmate";

interface BoardOverlayProps {
  event: OverlayEvent | null;
}

type OverlayConfig = {
  text: string;
  fadeIn: number;   // ms
  hold: number;     // ms（0 = フェードアウトなし）
  fadeOut: number;  // ms（0 = フェードアウトなし）
  className: string;
};

const OVERLAY_CONFIG: Record<OverlayEvent, OverlayConfig> = {
  game_start: {
    text: "対局開始",
    fadeIn: 1000,
    hold: 1000,
    fadeOut: 1000,
    className: "text-white",
  },
  check: {
    text: "王手",
    fadeIn: 100,
    hold: 1000,
    fadeOut: 500,
    className: "text-red-300",
  },
  resign: {
    text: "投了",
    fadeIn: 1000,
    hold: 0,
    fadeOut: 0,
    className: "text-white",
  },
  checkmate: {
    text: "詰み",
    fadeIn: 1000,
    hold: 0,
    fadeOut: 0,
    className: "text-red-300",
  },
};

export function BoardOverlay({ event }: BoardOverlayProps) {
  const [opacity, setOpacity] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!event) return;

    const config = OVERLAY_CONFIG[event];
    setOpacity(0);
    setVisible(true);

    // フェードイン
    const t1 = setTimeout(() => setOpacity(1), 10);

    if (config.fadeOut > 0) {
      // フェードアウトあり: ホールド後にフェードアウト
      const t2 = setTimeout(() => setOpacity(0), config.fadeIn + config.hold);
      const t3 = setTimeout(() => setVisible(false), config.fadeIn + config.hold + config.fadeOut);
      return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
    } else {
      // フェードアウトなし: そのまま表示
      return () => { clearTimeout(t1); };
    }
  }, [event]);

  if (!visible || !event) return null;

  const config = OVERLAY_CONFIG[event];

  return (
    <div
      className="absolute inset-0 flex items-center justify-center pointer-events-none z-10"
      style={{ transition: `opacity ${event && opacity === 0 ? OVERLAY_CONFIG[event].fadeIn : OVERLAY_CONFIG[event].fadeOut}ms ease`, opacity }}
    >
      <div className={cn(
        "bg-black/60 rounded-xl px-8 py-4",
        "text-4xl font-bold tracking-widest",
        config.className
      )}>
        {config.text}
      </div>
    </div>
  );
}
