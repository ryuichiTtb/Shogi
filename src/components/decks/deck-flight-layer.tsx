"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";

import { CardView } from "@/components/game/card-shogi/card-view";
import type { CardId } from "@/lib/shogi/cards/types";

export interface DeckFlightItem {
  id: number;
  cardId: CardId;
  fromRect: DOMRect;
  toRect: DOMRect;
}

interface DeckFlightLayerProps {
  flights: DeckFlightItem[];
  onComplete: (id: number) => void;
}

const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

const FLIGHT_DURATION_MS = 480;

// 編成エリア ↔ 所持エリア のフライト演出。
// 起点タイルと終点タイルの bounding rect を受け取り、
// 回転しながら座標補間で移動する。完了時に onComplete を発火し、
// 上位はそれを受けてフライトを state から取り除く。
export function DeckFlightLayer({ flights, onComplete }: DeckFlightLayerProps) {
  const isClient = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
  if (!isClient) return null;

  return createPortal(
    <div
      className="fixed inset-0 pointer-events-none z-[60]"
      style={{ perspective: 1200 }}
    >
      <AnimatePresence>
        {flights.map((flight) => (
          <DeckFlightSingle
            key={flight.id}
            flight={flight}
            onComplete={() => onComplete(flight.id)}
          />
        ))}
      </AnimatePresence>
    </div>,
    document.body,
  );
}

function DeckFlightSingle({
  flight,
  onComplete,
}: {
  flight: DeckFlightItem;
  onComplete: () => void;
}) {
  const { fromRect, toRect, cardId, id } = flight;

  // タブ非アクティブ時の onAnimationComplete 遅延に備えた保険タイマー。
  const completedRef = useRef(false);
  const handleComplete = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    onComplete();
  }, [onComplete]);

  useEffect(() => {
    const t = window.setTimeout(handleComplete, FLIGHT_DURATION_MS + 300);
    return () => window.clearTimeout(t);
  }, [handleComplete]);

  // 軌道のピーク (中点) で少しだけ持ち上げて弧を描く。
  const peakX = (fromRect.left + toRect.left) / 2;
  const peakY = Math.min(fromRect.top, toRect.top) - 24;

  return (
    <motion.div
      initial={{
        left: fromRect.left,
        top: fromRect.top,
        width: fromRect.width,
        height: fromRect.height,
        opacity: 1,
      }}
      animate={{
        left: [fromRect.left, peakX, toRect.left],
        top: [fromRect.top, peakY, toRect.top],
        width: [fromRect.width, fromRect.width, toRect.width],
        height: [fromRect.height, fromRect.height, toRect.height],
        opacity: [1, 1, 1],
      }}
      transition={{
        duration: FLIGHT_DURATION_MS / 1000,
        times: [0, 0.5, 1],
        ease: "easeInOut",
      }}
      onAnimationComplete={handleComplete}
      style={{
        position: "fixed",
        transformStyle: "preserve-3d",
        willChange: "left, top, width, height, transform",
      }}
    >
      <motion.div
        // rotateY: 1 回転 (表→裏→表)
        // rotateZ: 4 回転 (画面平面のスピン)
        animate={{ rotateY: [0, 180, 360], rotateZ: [0, 720, 1440] }}
        transition={{
          duration: FLIGHT_DURATION_MS / 1000,
          times: [0, 0.5, 1],
          ease: "linear",
        }}
        style={{
          width: "100%",
          height: "100%",
          transformStyle: "preserve-3d",
          transformOrigin: "center center",
        }}
      >
        {/* 表面 (rotateY 0 / 360 のとき手前) */}
        <div
          className="absolute inset-0 rounded-md shadow-xl"
          style={{
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
          }}
        >
          <CardView
            card={{ instanceId: `flight-${id}`, defId: cardId }}
            size="md"
            fullWidth
            inactive
          />
        </div>
        {/* 裏面 (rotateY 180 のとき手前) */}
        <div
          className="absolute inset-0 rounded-md shadow-xl"
          style={{
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
          }}
        >
          <CardView
            card={{ instanceId: `flight-${id}-back`, defId: cardId }}
            size="md"
            fullWidth
            faceDown
          />
        </div>
      </motion.div>
    </motion.div>
  );
}
