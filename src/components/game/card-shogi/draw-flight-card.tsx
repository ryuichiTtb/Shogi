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

// CardView size="xl" の素サイズ (w-[36rem] = 576, h-[22rem] = 352)
const CARD_W = 576;
const CARD_H = 352;

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
      style={{ perspective: 1600 }}
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
    const startScale = deckRect ? Math.max(0.15, deckRect.width / CARD_W) : 0.2;

    let endX: number;
    let endY: number;
    let endScale: number;
    if (handRect) {
      endX = handRect.x + handRect.width / 2 - CARD_W / 2;
      endY = handRect.y + handRect.height / 2 - CARD_H / 2;
      endScale = Math.max(0.15, handRect.width / CARD_W);
    } else {
      endX = centerX;
      endY = centerY + 240;
      endScale = 0.2;
    }

    return { startX, startY, centerX, centerY, endX, endY, startScale, endScale };
  });

  if (!coords) return null;

  const { startX, startY, centerX, centerY, endX, endY, startScale, endScale } = coords;

  const t1 = FADE_IN_MS / TOTAL_MS;
  const t2 = (FADE_IN_MS + HOLD_MS) / TOTAL_MS;

  // 回転は累積で 0 → 540 → 540 → 1080:
  //   0deg     裏面手前 (山札位置スタート)
  //   540deg   = 180deg 相当 → 表面手前 (中央到着・ホールド)
  //   1080deg  = 0deg 相当 → 裏面手前 (手札到着)
  // 山札→中央 で 1.5周、中央→手札 で 1.5周、合計 3周。
  // 表/裏切替は子要素の backface-visibility hidden で自動。
  // 注意: filter 系プロパティ(drop-shadow 等)は preserve-3d を flatten させるため
  //       外側 motion.div には付けず、内側面に box-shadow ベースの shadow-2xl を当てる。
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
        scale: [startScale, 1, 1, endScale],
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
        transformStyle: "preserve-3d",
        willChange: "transform, opacity, left, top",
      }}
    >
      <motion.div
        animate={{ rotateY: [0, 540, 540, 1080] }}
        transition={{
          duration: TOTAL_MS / 1000,
          times: [0, t1, t2, 1],
          ease: ["easeOut", "linear", "easeIn"],
        }}
        style={{
          width: "100%",
          height: "100%",
          transformStyle: "preserve-3d",
          transformOrigin: "center center",
        }}
      >
        {/* 裏面 (rotateY 0 のとき手前) */}
        <div
          className="absolute inset-0 rounded-md shadow-2xl"
          style={{
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
          }}
        >
          <CardView card={cardInstance} faceDown size="xl" fullWidth />
        </div>
        {/* 表面 (rotateY 180 のとき手前) */}
        <div
          className="absolute inset-0 rounded-md shadow-2xl"
          style={{
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
          }}
        >
          <CardView card={cardInstance} size="xl" fullWidth />
        </div>
      </motion.div>
    </motion.div>
  );
}
