"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
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

// 山札→中央: 500ms / 中央ホールド: 1500ms / 中央→手札: 300ms
const FADE_IN_MS = 500;
const HOLD_MS = 1500;
const FADE_OUT_MS = 300;
const TOTAL_MS = FADE_IN_MS + HOLD_MS + FADE_OUT_MS;
// Issue #82: 中央→手札の最終 100ms で一気にフェードアウト
// (途中までは不透明のまま、終端で急速に消える)
const FADE_OUT_TAIL_MS = 100;

// 中央到着直後にカード上を斜めに走るシマー (光) と、周辺を一瞬光らせる黄金グロウ
const FLASH_DELAY_S = FADE_IN_MS / 1000;
const SHIMMER_DURATION_S = 0.7;
const GLOW_DURATION_S = 0.8;

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
  // タブ非アクティブ時に Framer Motion の onAnimationComplete が throttling で
  // 遅延すると finalizeDraw が呼ばれず AI が永久に動かないリスクがある。
  // 想定時間 + 500ms 経過しても発火しない場合は強制的に完了通知する保険。
  // onAnimationComplete でも通知されるので completedRef で重複呼出しを防ぐ。
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
    const deckRect = deckRectGetter();
    const handRect = handRectGetter();

    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const centerX = (winW - CARD_W) / 2;
    const centerY = (winH - CARD_H) / 2;

    // モバイル等で 576x352 がそのまま入らない場合、ビューポートにフィットする倍率まで縮小。
    // transform: scale なので 高解像度フォントを保ったまま縮小描画される (ボケなし)。
    const centerScale = Math.min(1, (winW * 0.92) / CARD_W, (winH * 0.85) / CARD_H);

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

    return { startX, startY, centerX, centerY, endX, endY, startScale, centerScale, endScale };
  });

  if (!coords) return null;

  const { startX, startY, centerX, centerY, endX, endY, startScale, centerScale, endScale } = coords;

  const t1 = FADE_IN_MS / TOTAL_MS;
  const t2 = (FADE_IN_MS + HOLD_MS) / TOTAL_MS;
  // フェード開始タイミング (TOTAL の終端 FADE_OUT_TAIL_MS 手前)
  const tFadeStart = (TOTAL_MS - FADE_OUT_TAIL_MS) / TOTAL_MS;

  // 回転 (Issue #89 ユーザー指示で更新):
  //   rotateY:
  //     deck→中央 の最後 25% に集中して 1 回転 (0→360°)。前半 75% は 0° で待機し、
  //     中央到着直前に「クルッ」と 1 回転する演出。中央以降は 360° のまま維持。
  //   rotateZ:
  //     0 → 中央 で 2周 (=720°)
  //     中央 → 手札 で +3周 (=+1080°、累積 1800°)
  // 表/裏切替は子要素の backface-visibility hidden で自動。
  // 注意: filter 系プロパティ(drop-shadow 等)は preserve-3d を flatten させるため
  //       外側 motion.div には付けず、内側面に box-shadow ベースの shadow-2xl を当てる。
  // rotateY の回転開始点 (deck→中央 の 75% 地点)
  const tSpinStart = t1 * 0.75;
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
        scale: [startScale, centerScale, centerScale, endScale],
        // Issue #82: 中央→手札の途中までは不透明のまま、終端 (最後 FADE_OUT_TAIL_MS)
        //           で一気にフェードアウト。
        opacity: [0, 1, 1, 1, 0],
      }}
      transition={{
        duration: TOTAL_MS / 1000,
        times: [0, t1, t2, 1],
        ease: ["easeOut", "linear", "linear"],
        opacity: {
          duration: TOTAL_MS / 1000,
          times: [0, t1, t2, tFadeStart, 1],
          ease: ["easeOut", "linear", "linear", "linear"],
        },
      }}
      onAnimationComplete={handleComplete}
      style={{
        position: "fixed",
        width: CARD_W,
        height: CARD_H,
        transformStyle: "preserve-3d",
        willChange: "transform, opacity, left, top",
      }}
    >
      <motion.div
        animate={{
          // rotateY: deck→中央 の最後 25% で 1 回転 (0→360°)、中央以降は維持。
          // 前半は 0° のまま静止し、中央到着直前にクルッと 1 周する。
          rotateY: [0, 0, 360, 360, 360],
          // rotateZ: 山札→中央 で 2周 (0→720°)、中央→手札 で +3周 (720°→1800°)
          rotateZ: [0, 720, 720, 1800],
        }}
        transition={{
          duration: TOTAL_MS / 1000,
          // rotateZ 用の既定 times/ease (4 キーフレームに対応)
          times: [0, t1, t2, 1],
          ease: ["easeOut", "linear", "linear"],
          // rotateY は別 times: [0, tSpinStart, t1, t2, 1] (5 キーフレーム)
          // 0→tSpinStart は 0° で静止、tSpinStart→t1 で 0→360° (easeIn でスナップ感)
          rotateY: {
            duration: TOTAL_MS / 1000,
            times: [0, tSpinStart, t1, t2, 1],
            ease: ["linear", "easeIn", "linear", "linear"],
          },
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
          className="absolute inset-0"
          style={{
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
          }}
        >
          {/* 黄金グロウ: 中央到着の瞬間カード周辺がふわっと光る (はみ出し可) */}
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
              boxShadow: "0 0 90px 14px rgba(251, 191, 36, 0.9)",
              pointerEvents: "none",
            }}
          />
          {/* カード本体 + シマー (シマーはカード矩形内に収める) */}
          <div className="absolute inset-0 rounded-md shadow-2xl overflow-hidden">
            <CardView card={cardInstance} size="xl" fullWidth />
            <motion.div
              initial={{ x: "-110%", opacity: 0 }}
              animate={{
                x: ["-110%", "-110%", "210%"],
                opacity: [0, 1, 0],
              }}
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
        </div>
      </motion.div>
    </motion.div>
  );
}
