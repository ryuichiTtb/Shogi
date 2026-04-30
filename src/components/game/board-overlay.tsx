"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export type OverlayEvent = "game_start" | "check" | "resign" | "checkmate" | "trap_trigger";

interface BoardOverlayProps {
  event: OverlayEvent | null;
  // trap_trigger イベント時に表示するトラップ名(任意、未指定時は「トラップ発動！」のみ)
  trapName?: string;
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
    className: "text-white",
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
    className: "text-white",
  },
  trap_trigger: {
    text: "トラップ発動！",
    fadeIn: 200,
    hold: 1500,
    fadeOut: 600,
    className: "text-purple-100",
  },
};

export function BoardOverlay({ event, trapName }: BoardOverlayProps) {
  const [opacity, setOpacity] = useState(0);
  const [transitionDuration, setTransitionDuration] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!event) return;

    const config = OVERLAY_CONFIG[event];
    setOpacity(0);
    setTransitionDuration(0);
    setVisible(true);

    // フェードイン（transitionをfadeIn時間にセットしてから opacity 1 へ）
    const t1 = setTimeout(() => {
      setTransitionDuration(config.fadeIn);
      setOpacity(1);
    }, 10);

    if (config.fadeOut > 0) {
      // ホールド後にフェードアウト
      const t2 = setTimeout(() => {
        setTransitionDuration(config.fadeOut);
        setOpacity(0);
      }, config.fadeIn + config.hold);
      const t3 = setTimeout(() => setVisible(false), config.fadeIn + config.hold + config.fadeOut);
      return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
    }

    return () => { clearTimeout(t1); };
  }, [event]);

  if (!visible || !event) return null;

  const config = OVERLAY_CONFIG[event];

  // トラップ発動はトラップ専用の演出(紫グラデ + シェイク的なスケールアニメ + ⚠アイコン + トラップ名)
  if (event === "trap_trigger") {
    return (
      <div
        className="absolute inset-0 flex items-center justify-center pointer-events-none z-10"
        style={{ transition: `opacity ${transitionDuration}ms ease`, opacity }}
      >
        <div
          className={cn(
            "rounded-xl px-8 py-4 flex flex-col items-center gap-1",
            "bg-gradient-to-br from-purple-700 to-purple-900",
            "border-2 border-purple-300 shadow-2xl shadow-purple-500/50",
            "font-[family-name:var(--font-yuji-boku)]",
            "animate-trap-trigger",
            config.className,
          )}
        >
          <div className="flex items-center gap-3 text-3xl tracking-wider font-bold">
            <span className="text-4xl" aria-hidden>⚠</span>
            <span>{config.text}</span>
            <span className="text-4xl" aria-hidden>⚠</span>
          </div>
          {trapName && (
            <div className="text-xl text-purple-200 tracking-wide">
              {trapName}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="absolute inset-0 flex items-center justify-center pointer-events-none z-10"
      style={{ transition: `opacity ${transitionDuration}ms ease`, opacity }}
    >
      <div className={cn(
        "bg-black/60 rounded-xl px-8 py-4",
        "text-5xl tracking-widest",
        "font-[family-name:var(--font-yuji-boku)]",
        config.className
      )}>
        {config.text}
      </div>
    </div>
  );
}
