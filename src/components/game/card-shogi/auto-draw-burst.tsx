"use client";

// Issue #130: 自動ドロー専用の前段演出 (Burst + Trail + Ring Collapse)。
// DrawFlightCard (auto variant) の前に山札中心から放射状に光粒子を散らし、
// 中央へ向かうトレイルを立ち上げる。Phase 累積 ms 値は animation-constants の
// AUTO_DRAW_PHASE_OFFSETS から参照し、本ファイル内に ms リテラルを書かない。

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import {
  AUTO_DRAW_BURST_DURATION_MS,
  AUTO_DRAW_PHASE_OFFSETS,
  AUTO_DRAW_RING_COLLAPSE_MS,
  AUTO_DRAW_TRAIL_DURATION_MS,
} from "./animation-constants";

const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

// 演出規模の差分 (#130 C-2)。
// - self: 自分側 = 12 粒子・半径 64px・トレイル/中央展開フル尺
// - opponent: 相手側 = 8 粒子・半径 40px・主張弱め (盤面集中のため)
type BurstScale = "self" | "opponent";

export interface AutoDrawBurstProps {
  // null/undefined のとき何も描画しない (起動条件は呼び元で管理)
  origin: { x: number; y: number } | null;
  scale?: BurstScale;
  // フェーズ末尾の cooldown 開始タイミングで通知 (呼び元の演出進行管理用、optional)
  onComplete?: () => void;
  // AnimatePresence 用 key。同一 origin で連続発火した場合に新規 mount を促す。
  burstKey?: number;
}

export function AutoDrawBurst({ origin, scale = "self", onComplete, burstKey }: AutoDrawBurstProps) {
  const isClient = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
  if (!isClient) return null;

  return createPortal(
    // z-[70]: DrawFlightCard (z-[60]) より 1 階層上。盤面 transform 階層と切り離す。
    <div className="fixed inset-0 pointer-events-none z-[70]" aria-hidden>
      <AnimatePresence>
        {origin && burstKey !== undefined && (
          <BurstInner
            key={burstKey}
            origin={origin}
            scale={scale}
            onComplete={onComplete}
          />
        )}
      </AnimatePresence>
    </div>,
    document.body,
  );
}

function BurstInner({
  origin,
  scale,
  onComplete,
}: {
  origin: { x: number; y: number };
  scale: BurstScale;
  onComplete?: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const particleCount = scale === "self" ? 12 : 8;
  const radius = scale === "self" ? 64 : 40;

  // reduced-motion: 単一フラッシュ (300ms) だけで Trail 省略・粒子拡散省略
  if (reducedMotion) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: [0, 0.6, 0], scale: [0.6, 1.2, 1.2] }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        onAnimationComplete={onComplete}
        style={{
          position: "fixed",
          left: origin.x - 32,
          top: origin.y - 32,
          width: 64,
          height: 64,
          borderRadius: 9999,
          background:
            "radial-gradient(circle, rgba(52,211,153,0.65) 0%, rgba(52,211,153,0) 70%)",
          willChange: "opacity, transform",
        }}
      />
    );
  }

  return (
    <>
      {/* Phase 1: Ring Collapse (radial gradient で「リングが中央へ収束」を表現) */}
      <motion.div
        initial={{ opacity: 0, scale: 1 }}
        animate={{ opacity: [0, 0.8, 0], scale: [1, 0.6, 0.4] }}
        transition={{
          duration: AUTO_DRAW_RING_COLLAPSE_MS / 1000,
          delay: AUTO_DRAW_PHASE_OFFSETS.ringCollapse / 1000,
          times: [0, 0.4, 1],
          ease: [0.16, 1, 0.3, 1],
        }}
        style={{
          position: "fixed",
          left: origin.x - radius,
          top: origin.y - radius,
          width: radius * 2,
          height: radius * 2,
          borderRadius: 9999,
          background:
            "radial-gradient(circle, rgba(52,211,153,0.35) 30%, rgba(52,211,153,0) 70%)",
          willChange: "opacity, transform",
        }}
      />

      {/* Phase 2: 12/8 粒子バースト */}
      {Array.from({ length: particleCount }).map((_, i) => {
        const theta = (i / particleCount) * Math.PI * 2;
        const dx = Math.cos(theta) * radius;
        const dy = Math.sin(theta) * radius;
        return (
          <motion.span
            key={`particle-${i}`}
            initial={{ x: 0, y: 0, opacity: 0, scale: 0.4 }}
            animate={{
              x: [0, dx, dx * 1.05],
              y: [0, dy, dy * 1.05],
              opacity: [0, 1, 0],
              scale: [0.4, 1.0, 0.6],
            }}
            transition={{
              duration: AUTO_DRAW_BURST_DURATION_MS / 1000,
              delay: AUTO_DRAW_PHASE_OFFSETS.burst / 1000,
              times: [0, 0.5, 1],
              ease: [0.16, 1, 0.3, 1],
            }}
            style={{
              position: "fixed",
              left: origin.x - 4,
              top: origin.y - 4,
              width: 8,
              height: 8,
              borderRadius: 9999,
              background: "rgb(110 231 183)", // emerald-300
              filter: "blur(2px)",
              mixBlendMode: "screen",
              willChange: "transform, opacity",
            }}
          />
        );
      })}

      {/* Phase 3: Trail (山札→中央へ向かって細い光のストリームが立ち上がる)。
          self のみ描画 (opponent は中央展開しないため省略)。
          通常合成 (mix-blend-mode なし)。Safari iOS で blend mode が縦長要素に
          適用されると promoted layer が解除されるため、粒子と意図的に分離。 */}
      {scale === "self" && (
        <motion.div
          initial={{ scaleY: 0, opacity: 0 }}
          animate={{
            scaleY: [0, 1, 1, 0.4],
            opacity: [0, 0.9, 0.6, 0],
          }}
          transition={{
            duration: AUTO_DRAW_TRAIL_DURATION_MS / 1000,
            delay: AUTO_DRAW_PHASE_OFFSETS.trail / 1000,
            times: [0, 0.25, 0.7, 1],
            ease: "easeInOut",
          }}
          onAnimationComplete={onComplete}
          style={{
            position: "fixed",
            left: origin.x - 3,
            top: origin.y - 80,
            width: 6,
            height: 80,
            borderRadius: 3,
            background:
              "linear-gradient(to top, rgba(110,231,183,0.6) 0%, rgba(110,231,183,0) 100%)",
            transformOrigin: "bottom center",
            willChange: "transform, opacity",
          }}
        />
      )}
      {/* opponent のときは Trail がないので、Burst の終了を onComplete とみなす。
          Burst の duration > Ring Collapse なので、長い方 (= Burst) に紐付ける。 */}
      {scale === "opponent" && (
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 0 }}
          transition={{
            duration: AUTO_DRAW_BURST_DURATION_MS / 1000,
            delay: AUTO_DRAW_PHASE_OFFSETS.burst / 1000,
          }}
          onAnimationComplete={onComplete}
          style={{ position: "fixed", left: 0, top: 0, width: 1, height: 1 }}
        />
      )}
    </>
  );
}
