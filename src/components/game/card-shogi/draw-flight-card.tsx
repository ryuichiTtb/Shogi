"use client";

import { useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";

import type { CardInstance } from "@/lib/shogi/cards/types";
import { CardView } from "./card-view";

interface DrawFlightCardProps {
  cardInstance: CardInstance | null;
  flightKey: number | null;
  deckRectGetter: () => DOMRect | null;
  handRectGetter: () => DOMRect | null;
  onComplete: () => void;
}

// CardView size="xl" の素サイズ (w-72 = 288px, h-44 = 176px)
const CARD_W = 288;
const CARD_H = 176;

// タイミング (合計 1250ms。速度 UP 後)
const FADE_IN_MS = 350;
const HOLD_MS = 600;
const FADE_OUT_MS = 300;
const TOTAL_MS = FADE_IN_MS + HOLD_MS + FADE_OUT_MS;

const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export function DrawFlightCard({
  cardInstance,
  flightKey,
  deckRectGetter,
  handRectGetter,
  onComplete,
}: DrawFlightCardProps) {
  const isClient = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);

  if (!isClient) return null;

  return createPortal(
    <div
      className="fixed inset-0 pointer-events-none z-[60]"
      style={{ perspective: 1400 }}
    >
      <AnimatePresence>
        {cardInstance && flightKey !== null && (
          <DrawFlightInner
            key={flightKey}
            cardInstance={cardInstance}
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
  deckRectGetter,
  handRectGetter,
  onComplete,
}: {
  cardInstance: CardInstance;
  deckRectGetter: () => DOMRect | null;
  handRectGetter: () => DOMRect | null;
  onComplete: () => void;
}) {
  const [coords] = useState(() => {
    if (typeof window === "undefined") return null;
    const deckRect = deckRectGetter();
    const handRect = handRectGetter();

    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const centerX = (winW - CARD_W) / 2;
    const centerY = (winH - CARD_H) / 2;

    const startX = deckRect ? deckRect.x + deckRect.width / 2 - CARD_W / 2 : centerX;
    const startY = deckRect ? deckRect.y + deckRect.height / 2 - CARD_H / 2 : centerY;
    const startScale = deckRect ? Math.max(0.25, deckRect.width / CARD_W) : 0.4;

    let endX: number;
    let endY: number;
    let endScale: number;
    if (handRect) {
      endX = handRect.x + handRect.width / 2 - CARD_W / 2;
      endY = handRect.y + handRect.height / 2 - CARD_H / 2;
      endScale = Math.max(0.25, handRect.width / CARD_W);
    } else {
      endX = centerX;
      endY = centerY + 240;
      endScale = 0.4;
    }

    return { startX, startY, centerX, centerY, endX, endY, startScale, endScale };
  });

  if (!coords) return null;

  const { startX, startY, centerX, centerY, endX, endY, startScale, endScale } = coords;

  const t1 = FADE_IN_MS / TOTAL_MS;
  const t2 = (FADE_IN_MS + HOLD_MS) / TOTAL_MS;

  // 回転は累積で表現:
  // - 0deg → 180deg (山札→中央): 裏向き開始 → 中央到着で表向き
  // - 180deg ホールド: 表向き
  // - 180deg → 360deg (中央→手札): 表向き → 裏向きに戻る
  // 表/裏の切替は子要素の backface-visibility で自動
  return (
    <motion.div
      initial={{
        left: startX,
        top: startY,
        scale: startScale,
        opacity: 0,
        rotateY: 0,
      }}
      animate={{
        left: [startX, centerX, centerX, endX],
        top: [startY, centerY, centerY, endY],
        scale: [startScale, 1, 1, endScale],
        opacity: [0, 1, 1, 0],
        rotateY: [0, 180, 180, 360],
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
        transformStyle: "preserve-3d",
        willChange: "transform, opacity, left, top",
      }}
      className="drop-shadow-2xl"
    >
      {/* 裏面 (rotateY 0 のとき手前) */}
      <div
        className="absolute inset-0"
        style={{
          backfaceVisibility: "hidden",
          WebkitBackfaceVisibility: "hidden",
        }}
      >
        <CardView card={cardInstance} faceDown size="xl" fullWidth />
      </div>
      {/* 表面 (rotateY 180 のとき手前) */}
      <div
        className="absolute inset-0"
        style={{
          backfaceVisibility: "hidden",
          WebkitBackfaceVisibility: "hidden",
          transform: "rotateY(180deg)",
        }}
      >
        <CardView card={cardInstance} size="xl" fullWidth />
      </div>
    </motion.div>
  );
}
