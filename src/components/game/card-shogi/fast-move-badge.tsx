"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";

export interface FastMoveBadgeItem {
  id: number;
  rect: DOMRect;
}

interface FastMoveBadgeLayerProps {
  items: FastMoveBadgeItem[];
  onComplete: (id: number) => void;
}

const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

const DURATION_S = 0.5;
const BOX_W = 160;
const BOX_H = 48;
// 駒下端からの余白(マナ +N の浮遊と被らないよう少し下に配置)
const OFFSET_BELOW_PIECE_PX = 4;

export function FastMoveBadgeLayer({ items, onComplete }: FastMoveBadgeLayerProps) {
  const isClient = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
  if (!isClient) return null;

  return createPortal(
    <div className="fixed inset-0 pointer-events-none z-[55]">
      <AnimatePresence>
        {items.map((item) => (
          <FastMoveBadgeSingle
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

function FastMoveBadgeSingle({
  item,
  onComplete,
}: {
  item: FastMoveBadgeItem;
  onComplete: () => void;
}) {
  const { rect } = item;
  const cx = rect.x + rect.width / 2;
  const top = rect.y + rect.height + OFFSET_BELOW_PIECE_PX;
  const left = cx - BOX_W / 2;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, 1, 1, 0] }}
      transition={{
        duration: DURATION_S,
        times: [0, 0.15, 0.7, 1],
        ease: "easeOut",
      }}
      onAnimationComplete={onComplete}
      style={{
        position: "fixed",
        left,
        top,
        width: BOX_W,
        height: BOX_H,
        willChange: "opacity",
      }}
      className="flex items-center justify-center"
    >
      <span
        className="select-none leading-none font-extrabold text-3xl text-black font-[family-name:var(--font-yuji-boku)]"
      >
        早指し
      </span>
    </motion.div>
  );
}
