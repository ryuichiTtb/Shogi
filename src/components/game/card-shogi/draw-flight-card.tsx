"use client";

import { useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";

import type { CardInstance } from "@/lib/shogi/cards/types";
import { CardView } from "./card-view";

// SSR 中は false、クライアントマウント後 true。hydration mismatch を起こさず Portal を遅延マウントする。
const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export type DrawFlightMode = "directional" | "tracking";

interface DrawFlightCardProps {
  cardInstance: CardInstance | null;
  flightKey: number | null;
  mode: DrawFlightMode;
  deckRectGetter: () => DOMRect | null;
  handRectGetter?: () => DOMRect | null;
  onComplete: () => void;
}

// CardView size="lg" の素サイズ (w-40 h-24)
const CARD_W = 160;
const CARD_H = 96;

// 中央表示時の拡大率
const CENTER_SCALE = 1.6;

// タイミング (合計 2100ms)
const FADE_IN_MS = 300;
const HOLD_MS = 1200;
const FADE_OUT_MS = 600;
const TOTAL_MS = FADE_IN_MS + HOLD_MS + FADE_OUT_MS;

export function DrawFlightCard({
  cardInstance,
  flightKey,
  mode,
  deckRectGetter,
  handRectGetter,
  onComplete,
}: DrawFlightCardProps) {
  const isClient = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);

  if (!isClient) return null;

  return createPortal(
    <div className="fixed inset-0 pointer-events-none z-[60]">
      <AnimatePresence>
        {cardInstance && flightKey !== null && (
          <DrawFlightInner
            key={flightKey}
            cardInstance={cardInstance}
            mode={mode}
            deckRectGetter={deckRectGetter}
            handRectGetter={handRectGetter}
            onComplete={onComplete}
          />
        )}
      </AnimatePresence>
    </div>,
    document.body,
  );
}

function DrawFlightInner({
  cardInstance,
  mode,
  deckRectGetter,
  handRectGetter,
  onComplete,
}: {
  cardInstance: CardInstance;
  mode: DrawFlightMode;
  deckRectGetter: () => DOMRect | null;
  handRectGetter?: () => DOMRect | null;
  onComplete: () => void;
}) {
  const [coords] = useState(() => {
    if (typeof window === "undefined") return null;
    const deckRect = deckRectGetter();
    const handRect = mode === "tracking" ? handRectGetter?.() ?? null : null;

    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const centerX = (winW - CARD_W) / 2;
    const centerY = (winH - CARD_H) / 2;

    const startX = deckRect ? deckRect.x + deckRect.width / 2 - CARD_W / 2 : centerX;
    const startY = deckRect ? deckRect.y + deckRect.height / 2 - CARD_H / 2 : centerY;
    // 山札の見かけサイズに開始スケールを合わせる (山札 md/lg のいずれでも近似)
    const startScale = deckRect ? Math.max(0.45, deckRect.width / CARD_W) : 0.6;

    let endX: number;
    let endY: number;
    let endScale: number;
    if (mode === "tracking" && handRect) {
      endX = handRect.x + handRect.width / 2 - CARD_W / 2;
      endY = handRect.y + handRect.height / 2 - CARD_H / 2;
      // 手札サイズ (md = w-32 h-[80px] = 128x80) に近い縮小
      endScale = Math.max(0.4, handRect.width / CARD_W);
    } else {
      // directional: 中央からやや下方向 (手札方向) に縮小しつつフェード
      endX = centerX;
      endY = centerY + 120;
      endScale = 0.9;
    }

    return { startX, startY, centerX, centerY, endX, endY, startScale, endScale };
  });

  if (!coords) return null;

  const { startX, startY, centerX, centerY, endX, endY, startScale, endScale } = coords;

  const t1 = FADE_IN_MS / TOTAL_MS;
  const t2 = (FADE_IN_MS + HOLD_MS) / TOTAL_MS;

  return (
    <motion.div
      initial={{
        left: startX,
        top: startY,
        scale: startScale,
        opacity: 0,
      }}
      animate={{
        left: [startX, centerX, centerX, endX],
        top: [startY, centerY, centerY, endY],
        scale: [startScale, CENTER_SCALE, CENTER_SCALE, endScale],
        opacity: [0, 1, 1, 0],
      }}
      transition={{
        duration: TOTAL_MS / 1000,
        times: [0, t1, t2, 1],
        ease: ["easeOut", "linear", "easeIn"],
      }}
      onAnimationComplete={onComplete}
      style={{
        position: "fixed",
        width: CARD_W,
        height: CARD_H,
        transformOrigin: "center center",
        willChange: "transform, opacity, left, top",
      }}
      className="drop-shadow-2xl"
    >
      <CardView card={cardInstance} size="lg" />
    </motion.div>
  );
}
