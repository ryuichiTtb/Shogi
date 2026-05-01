"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";

import { cn } from "@/lib/utils";

export interface ManaFlightItem {
  id: number;
  delta: number;
  rect: DOMRect;
}

interface ManaFlightLayerProps {
  items: ManaFlightItem[];
  onComplete: (id: number) => void;
}

const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

const DURATION_S = 1.1;
const FLOAT_DISTANCE_PX = 60;
const BOX_W = 200;
const BOX_H = 56;

export function ManaFlightLayer({ items, onComplete }: ManaFlightLayerProps) {
  const isClient = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
  if (!isClient) return null;

  return createPortal(
    <div className="fixed inset-0 pointer-events-none z-[55]">
      <AnimatePresence>
        {items.map((item) => (
          <ManaFlightSingle
            key={item.id}
            item={item}
            onComplete={() => onComplete(item.id)}
          />
        ))}
      </AnimatePresence>
    </div>,
    document.body,
  );
}

function ManaFlightSingle({
  item,
  onComplete,
}: {
  item: ManaFlightItem;
  onComplete: () => void;
}) {
  const { rect, delta } = item;
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const startLeft = cx - BOX_W / 2;
  const startTop = cy - BOX_H / 2;
  const endTop = startTop - FLOAT_DISTANCE_PX;

  const text = delta > 0 ? `💎+${delta}` : `💎${delta}`;
  const colorClass = delta > 0 ? "text-emerald-400" : "text-rose-400";

  return (
    <motion.div
      initial={{ left: startLeft, top: startTop, opacity: 0, scale: 0.6 }}
      animate={{
        left: startLeft,
        top: endTop,
        opacity: [0, 1, 1, 0],
        scale: 1,
      }}
      transition={{
        duration: DURATION_S,
        times: [0, 0.15, 0.7, 1],
        ease: "easeOut",
      }}
      onAnimationComplete={onComplete}
      style={{
        position: "fixed",
        width: BOX_W,
        height: BOX_H,
        willChange: "transform, opacity, top, left",
      }}
      className="flex items-center justify-center"
    >
      <span
        className={cn(
          "select-none tabular-nums font-extrabold text-3xl",
          "drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)]",
          colorClass,
        )}
        style={{
          textShadow: "0 0 6px rgba(0,0,0,0.5)",
        }}
      >
        {text}
      </span>
    </motion.div>
  );
}
