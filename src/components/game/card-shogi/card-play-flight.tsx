"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";

import type { CardInstance } from "@/lib/shogi/cards/types";
import { CardView } from "./card-view";

interface CardPlayFlightProps {
  cardInstance: CardInstance | null;
  flightKey: number | null;
  startRectGetter: () => DOMRect | null;
  isTrap: boolean;
  onComplete: () => void;
}

// CardView size="xl" の素サイズ (DrawFlightCard と揃える)
const CARD_W = 576;
const CARD_H = 352;

// Issue #106: ドロー演出 (~2.65s) より短め。手番継続中に挟むため間延びを避ける。
const FADE_IN_MS = 320;
const HOLD_MS = 700;
const FADE_OUT_MS = 350;
const TOTAL_MS = FADE_IN_MS + HOLD_MS + FADE_OUT_MS;

const FLASH_DELAY_S = FADE_IN_MS / 1000;
const SHIMMER_DURATION_S = 0.6;
const GLOW_DURATION_S = 0.75;

const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export function CardPlayFlight({
  cardInstance,
  flightKey,
  startRectGetter,
  isTrap,
  onComplete,
}: CardPlayFlightProps) {
  const isClient = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
  if (!isClient) return null;

  return createPortal(
    <div className="fixed inset-0 pointer-events-none z-[60]">
      <AnimatePresence>
        {cardInstance && flightKey !== null && (
          <CardPlayFlightInner
            key={flightKey}
            cardInstance={cardInstance}
            startRectGetter={startRectGetter}
            isTrap={isTrap}
            onComplete={onComplete}
          />
        )}
      </AnimatePresence>
    </div>,
    document.body,
  );
}

function CardPlayFlightInner({
  cardInstance,
  startRectGetter,
  isTrap,
  onComplete,
}: {
  cardInstance: CardInstance;
  startRectGetter: () => DOMRect | null;
  isTrap: boolean;
  onComplete: () => void;
}) {
  // Issue #78 と同じ理由: タブ非アクティブ時に onAnimationComplete が遅延する
  // 場合の保険タイマー。completedRef で onAnimationComplete との重複呼出しを防ぐ。
  const completedRef = useRef(false);
  const handleComplete = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    onComplete();
  }, [onComplete]);

  useEffect(() => {
    const id = window.setTimeout(handleComplete, TOTAL_MS + 500);
    return () => window.clearTimeout(id);
  }, [handleComplete]);

  const [coords] = useState(() => {
    if (typeof window === "undefined") return null;
    const startRect = startRectGetter();

    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const centerX = (winW - CARD_W) / 2;
    const centerY = (winH - CARD_H) / 2;

    // モバイル等で 576x352 がそのまま入らない場合、ビューポートにフィットする倍率まで縮小。
    const centerScale = Math.min(1, (winW * 0.92) / CARD_W, (winH * 0.85) / CARD_H);

    const startX = startRect ? startRect.x + startRect.width / 2 - CARD_W / 2 : centerX;
    const startY = startRect ? startRect.y + startRect.height / 2 - CARD_H / 2 : centerY;
    const startScale = startRect ? Math.max(0.15, startRect.width / CARD_W) : 0.3;

    return { startX, startY, centerX, centerY, startScale, centerScale };
  });

  if (!coords) return null;
  const { startX, startY, centerX, centerY, startScale, centerScale } = coords;

  const t1 = FADE_IN_MS / TOTAL_MS;
  const t2 = (FADE_IN_MS + HOLD_MS) / TOTAL_MS;

  // グロウ色: トラップは紫 (BoardOverlay の trap_trigger と揃える)、通常は黄金 (ドロー演出と揃える)
  const glowShadow = isTrap
    ? "0 0 90px 14px rgba(168, 85, 247, 0.85)"
    : "0 0 90px 14px rgba(251, 191, 36, 0.9)";

  return (
    <motion.div
      initial={{ left: startX, top: startY, scale: startScale, opacity: 0 }}
      animate={{
        left: [startX, centerX, centerX, centerX],
        top: [startY, centerY, centerY, centerY],
        scale: [startScale, centerScale, centerScale, centerScale * 1.04],
        opacity: [0, 1, 1, 0],
      }}
      transition={{
        duration: TOTAL_MS / 1000,
        times: [0, t1, t2, 1],
        ease: ["easeOut", "linear", "easeIn"],
      }}
      onAnimationComplete={handleComplete}
      style={{
        position: "fixed",
        width: CARD_W,
        height: CARD_H,
        willChange: "transform, opacity, left, top",
      }}
    >
      <div className="relative w-full h-full">
        {/* グロウ: 中央到着の瞬間カード周辺がふわっと光る */}
        <motion.div
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: [0, 0.95, 0], scale: [0.92, 1.08, 1] }}
          transition={{
            duration: GLOW_DURATION_S,
            delay: FLASH_DELAY_S,
            times: [0, 0.45, 1],
            ease: "easeOut",
          }}
          style={{
            position: "absolute",
            inset: -12,
            borderRadius: "0.6rem",
            boxShadow: glowShadow,
            pointerEvents: "none",
          }}
        />
        {/* カード本体 + シマー */}
        <div className="absolute inset-0 rounded-md shadow-2xl overflow-hidden">
          <CardView card={cardInstance} size="xl" fullWidth />
          <motion.div
            initial={{ x: "-110%", opacity: 0 }}
            animate={{ x: ["-110%", "-110%", "210%"], opacity: [0, 1, 0] }}
            transition={{
              duration: SHIMMER_DURATION_S,
              delay: FLASH_DELAY_S,
              times: [0, 0.05, 1],
              ease: "easeOut",
            }}
            style={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(115deg, transparent 35%, rgba(255,255,255,0.9) 50%, transparent 65%)",
              pointerEvents: "none",
              mixBlendMode: "overlay",
            }}
          />
        </div>
        {/* 「発動！」/「セット！」バッジ: カード上端に被せて配置 */}
        <motion.div
          initial={{ opacity: 0, scale: 0.6, y: -16 }}
          animate={{
            opacity: [0, 0, 1, 1, 0],
            scale: [0.6, 0.6, 1.1, 1, 0.95],
            y: [-16, -16, 0, 0, 0],
          }}
          transition={{
            duration: TOTAL_MS / 1000,
            times: [0, t1 * 0.85, t1, t2, 1],
            ease: "easeOut",
          }}
          style={{
            position: "absolute",
            left: "50%",
            top: -32,
            transform: "translateX(-50%)",
            pointerEvents: "none",
          }}
        >
          <div
            className={
              isTrap
                ? "px-5 py-1.5 rounded-full bg-purple-700 text-white text-xl font-bold tracking-wider shadow-lg border-2 border-purple-300"
                : "px-5 py-1.5 rounded-full bg-amber-500 text-amber-950 text-xl font-bold tracking-wider shadow-lg border-2 border-amber-200"
            }
          >
            {isTrap ? "セット！" : "発動！"}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
