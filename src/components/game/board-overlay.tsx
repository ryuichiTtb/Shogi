"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  PLAY_POP_IN_MS,
  PLAY_HOLD_MS,
  PLAY_FADE_OUT_MS,
  CHECK_OVERLAY_FADE_IN_MS,
  CHECK_OVERLAY_HOLD_MS,
  CHECK_OVERLAY_FADE_OUT_MS,
  TRAP_TRIGGER_OVERLAY_FADE_IN_MS,
  TRAP_TRIGGER_OVERLAY_HOLD_MS,
  TRAP_TRIGGER_OVERLAY_FADE_OUT_MS,
} from "./card-shogi/animation-constants";

// trap_set: 相手 (AI) がトラップを設置したときの汎用通知。トラップは隠し情報
// なのでカード種別は出さず、設置された事実のみを伝える (Issue #193 / card-apply)。
export type OverlayEvent =
  | "game_start"
  | "check"
  | "resign"
  | "checkmate"
  | "trap_trigger"
  | "trap_set";

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
    fadeIn: CHECK_OVERLAY_FADE_IN_MS,
    hold: CHECK_OVERLAY_HOLD_MS,
    fadeOut: CHECK_OVERLAY_FADE_OUT_MS,
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
    fadeIn: TRAP_TRIGGER_OVERLAY_FADE_IN_MS,
    hold: TRAP_TRIGGER_OVERLAY_HOLD_MS,
    fadeOut: TRAP_TRIGGER_OVERLAY_FADE_OUT_MS,
    className: "text-purple-100",
  },
  // 相手トラップ設置の汎用通知。種別を伏せた控えめな表示で、長さは通常カード
  // 演出 (PLAY_*) と同じ尺に揃え、AI 手番のテンポを乱さない。
  trap_set: {
    text: "トラップ設置",
    fadeIn: PLAY_POP_IN_MS,
    hold: PLAY_HOLD_MS,
    fadeOut: PLAY_FADE_OUT_MS,
    className: "text-purple-200",
  },
};

export function BoardOverlay({ event, trapName }: BoardOverlayProps) {
  const [opacity, setOpacity] = useState(0);
  const [transitionDuration, setTransitionDuration] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!event) return;

    const config = OVERLAY_CONFIG[event];
    // event 変化時の初期化フェーズ。続く setTimeout 連鎖でフェードイン → ホールド
    // → フェードアウトを進めるため、initial state を effect 内で確定する必要がある。
    // 同一 event で再描画されるたびに毎回 0 → 1 → 0 とサイクルするので cascading
    // にはならない。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpacity(0);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTransitionDuration(0);
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
