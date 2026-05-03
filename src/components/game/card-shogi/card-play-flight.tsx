"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";

import type { CardInstance } from "@/lib/shogi/cards/types";
import { CardView } from "./card-view";
import {
  PLAY_CARD_W as CARD_W,
  PLAY_CARD_H as CARD_H,
  PLAY_POP_IN_MS as POP_IN_MS,
  PLAY_HOLD_MS as HOLD_MS,
  PLAY_TOTAL_MS as TOTAL_MS,
  PLAY_FLASH_DELAY_S as FLASH_DELAY_S,
  PLAY_SHIMMER_DURATION_S as SHIMMER_DURATION_S,
  PLAY_GLOW_DURATION_S as GLOW_DURATION_S,
} from "./animation-constants";

interface CardPlayFlightProps {
  cardInstance: CardInstance | null;
  flightKey: number | null;
  isTrap: boolean;
  onComplete: () => void;
}

const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export function CardPlayFlight({
  cardInstance,
  flightKey,
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
  isTrap,
  onComplete,
}: {
  cardInstance: CardInstance;
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

  // ビューポートにフィットする倍率まで縮小 (モバイル対応)
  const centerScale =
    typeof window === "undefined"
      ? 1
      : Math.min(1, (window.innerWidth * 0.92) / CARD_W, (window.innerHeight * 0.85) / CARD_H);

  const t1 = POP_IN_MS / TOTAL_MS;
  const t2 = (POP_IN_MS + HOLD_MS) / TOTAL_MS;

  // グロウ色: トラップは紫 (BoardOverlay の trap_trigger と揃える)、通常は黄金
  const glowShadow = isTrap
    ? "0 0 100px 18px rgba(168, 85, 247, 0.9)"
    : "0 0 100px 18px rgba(251, 191, 36, 0.95)";

  return (
    <motion.div
      initial={{ scale: centerScale * 0.4, opacity: 0 }}
      animate={{
        // パッと出現 (オーバーシュート気味) → ホールド → わずかにスケールアップしながらフェードアウト
        scale: [centerScale * 0.4, centerScale * 1.08, centerScale, centerScale * 1.04],
        opacity: [0, 1, 1, 0],
      }}
      transition={{
        duration: TOTAL_MS / 1000,
        times: [0, t1, t2, 1],
        ease: ["backOut", "linear", "easeIn"],
      }}
      onAnimationComplete={handleComplete}
      style={{
        position: "fixed",
        left: "50%",
        top: "50%",
        marginLeft: -CARD_W / 2,
        marginTop: -CARD_H / 2,
        width: CARD_W,
        height: CARD_H,
        willChange: "transform, opacity",
      }}
    >
      <div className="relative w-full h-full">
        {/* グロウ: 出現の瞬間カード周辺がふわっと光る */}
        <motion.div
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: [0, 1, 0], scale: [0.92, 1.12, 1] }}
          transition={{
            duration: GLOW_DURATION_S,
            delay: FLASH_DELAY_S,
            times: [0, 0.4, 1],
            ease: "easeOut",
          }}
          style={{
            position: "absolute",
            inset: -16,
            borderRadius: "0.6rem",
            boxShadow: glowShadow,
            pointerEvents: "none",
          }}
        />
        {/* カード本体 + シマー (キラッと斜めに走る光) */}
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
                "linear-gradient(115deg, transparent 35%, rgba(255,255,255,0.95) 50%, transparent 65%)",
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
            scale: [0.6, 0.6, 1.15, 1, 0.95],
            y: [-16, -16, 0, 0, 0],
          }}
          transition={{
            duration: TOTAL_MS / 1000,
            times: [0, t1 * 0.6, t1, t2, 1],
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
                ? "px-5 py-1.5 rounded-full bg-purple-700 text-white text-xl font-bold tracking-wider shadow-lg border-2 border-purple-300 whitespace-nowrap"
                : "px-5 py-1.5 rounded-full bg-amber-500 text-amber-950 text-xl font-bold tracking-wider shadow-lg border-2 border-amber-200 whitespace-nowrap"
            }
          >
            {isTrap ? "セット！" : "発動！"}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
