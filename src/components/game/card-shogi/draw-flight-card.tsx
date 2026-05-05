"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";

import type { CardInstance } from "@/lib/shogi/cards/types";
import { CardView } from "./card-view";
import {
  AUTO_DRAW_PHASE_OFFSETS,
  DRAW_CARD_W as CARD_W,
  DRAW_CARD_H as CARD_H,
  DRAW_FADE_IN_MS as FADE_IN_MS,
  DRAW_HOLD_MS as HOLD_MS,
  DRAW_TOTAL_MS as TOTAL_MS,
  DRAW_FADE_OUT_TAIL_MS as FADE_OUT_TAIL_MS,
  DRAW_FLASH_DELAY_S as FLASH_DELAY_S,
  DRAW_SHIMMER_DURATION_S as SHIMMER_DURATION_S,
  DRAW_GLOW_DURATION_S as GLOW_DURATION_S,
} from "./animation-constants";

// Issue #130: auto variant 時の前段 (Burst+Trail) 分の遅延 (ms)。
// Phase 4 (cardFlight) 開始 - Phase 1 (ringCollapse) 開始 = 350ms。
// この遅延を transition.delay に乗せることで Burst 完了直後に card flight が始まる。
const AUTO_VARIANT_START_DELAY_MS =
  AUTO_DRAW_PHASE_OFFSETS.cardFlight - AUTO_DRAW_PHASE_OFFSETS.ringCollapse;

// Issue #130: 演出バリアント。manual = 既存 (amber 系)、auto = 自動ドロー (emerald 系)。
// 既定 "manual" で旧呼び出し互換 (variant 未指定 = 手動)。
export type DrawFlightVariant = "manual" | "auto";

interface DrawFlightCardProps {
  cardInstance: CardInstance | null;
  flightKey: number | null;
  deckRectGetter: () => DOMRect | null;
  handRectGetter: () => DOMRect | null;
  onComplete: () => void;
  variant?: DrawFlightVariant;
}

const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export function DrawFlightCard({
  cardInstance,
  flightKey,
  deckRectGetter,
  handRectGetter,
  onComplete,
  variant = "manual",
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
            variant={variant}
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
  variant,
}: {
  cardInstance: CardInstance;
  deckRectGetter: () => DOMRect | null;
  handRectGetter: () => DOMRect | null;
  onComplete: () => void;
  variant: DrawFlightVariant;
}) {
  // Issue #130: variant ごとの色トークン (グロー / シマー / 中央保持ラベル)。
  // 内部 const にまとめ、props で個別色を渡さない (将来の variant 追加に備える)。
  const isAuto = variant === "auto";
  const glowBoxShadow = isAuto
    // emerald 主層 + amber ウォームスパーク 2 層 (色温度を保ちつつ「自動」を強調)
    ? "0 0 90px 14px rgba(52, 211, 153, 0.55), 0 0 60px 8px rgba(254, 243, 199, 0.25)"
    : "0 0 90px 14px rgba(251, 191, 36, 0.9)";
  const shimmerBackground = isAuto
    // emerald シマーをメインに amber を 0.4 倍重ね (色味の温感を残す)
    ? "linear-gradient(115deg, transparent 35%, hsla(160, 70%, 65%, 0.85) 50%, transparent 65%), linear-gradient(115deg, transparent 35%, hsla(50, 100%, 75%, 0.4) 50%, transparent 65%)"
    : "linear-gradient(115deg, transparent 35%, rgba(255,255,255,0.9) 50%, transparent 65%)";
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

  // Issue #130: auto variant は Burst 完了を待ってから card flight を開始するため
  // 全体の所要時間に startDelay を加算する (= 安全タイマも合わせて伸ばす)。
  const startDelayMs = isAuto ? AUTO_VARIANT_START_DELAY_MS : 0;
  const startDelayS = startDelayMs / 1000;

  useEffect(() => {
    const id = window.setTimeout(handleComplete, startDelayMs + TOTAL_MS + 500);
    return () => window.clearTimeout(id);
  }, [handleComplete, startDelayMs]);

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
  //     deck→中央 の中間地点 (50%) から 0.5 回転 (0→180°)。前半 50% は 0° で
  //     待機し、終端=中央到着で 180°。中央以降は 180° のまま維持。
  //   rotateZ:
  //     0 → 中央 で 2周 (=720°)
  //     中央 → 手札 で +3周 (=+1080°、累積 1800°)
  // 表/裏切替は子要素の backface-visibility hidden で自動。
  // 注意: filter 系プロパティ(drop-shadow 等)は preserve-3d を flatten させるため
  //       外側 motion.div には付けず、内側面に box-shadow ベースの shadow-2xl を当てる。
  // rotateY の回転開始点 (deck→中央 の 50% 地点)
  const tSpinStart = t1 * 0.5;
  return (
    <motion.div
      initial={{
        left: startX,
        top: startY,
        scale: startScale,
        opacity: 1,
      }}
      animate={{
        left: [startX, centerX, centerX, endX],
        top: [startY, centerY, centerY, endY],
        scale: [startScale, centerScale, centerScale, endScale],
        // 山札→中央のフライト中は不透明のまま (透過なし)。終端 FADE_OUT_TAIL_MS で
        // 一気にフェードアウトのみ行う。
        opacity: [1, 1, 1, 1, 0],
      }}
      transition={{
        duration: TOTAL_MS / 1000,
        delay: startDelayS,
        times: [0, t1, t2, 1],
        ease: ["easeOut", "linear", "linear"],
        opacity: {
          duration: TOTAL_MS / 1000,
          delay: startDelayS,
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
          // rotateY: deck→中央 の最後 25% で 0.5 回転 (0→180°)、中央以降は維持。
          // 前半は 0° のまま裏向きで静止し、中央到着直前に半回転して表面が手前に来る。
          rotateY: [0, 0, 180, 180, 180],
          // rotateZ: 山札→中央 で 2周 (0→720°)、中央→手札 で +3周 (720°→1800°)
          rotateZ: [0, 720, 720, 1800],
        }}
        transition={{
          duration: TOTAL_MS / 1000,
          delay: startDelayS,
          // rotateZ 用の既定 times/ease (4 キーフレームに対応)
          times: [0, t1, t2, 1],
          ease: ["easeOut", "linear", "linear"],
          // rotateY は別 times: [0, tSpinStart, t1, t2, 1] (5 キーフレーム)
          // 0→tSpinStart は 0° で静止、tSpinStart→t1 で 0→360° (easeIn でスナップ感)
          rotateY: {
            duration: TOTAL_MS / 1000,
            delay: startDelayS,
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
          {/* グロウ: 中央到着の瞬間カード周辺がふわっと光る (はみ出し可)。
              variant ごとに色味を切替 (manual=amber, auto=emerald + amber 2 層) */}
          <motion.div
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: [0, 0.95, 0], scale: [0.92, 1.08, 1] }}
            transition={{
              duration: GLOW_DURATION_S,
              delay: startDelayS + FLASH_DELAY_S,
              times: [0, 0.45, 1],
              ease: "easeOut",
            }}
            style={{
              position: "absolute",
              inset: -12,
              borderRadius: "0.6rem",
              boxShadow: glowBoxShadow,
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
                delay: startDelayS + FLASH_DELAY_S,
                times: [0, 0.05, 1],
                ease: "easeOut",
              }}
              style={{
                position: "absolute",
                inset: 0,
                background: shimmerBackground,
                pointerEvents: "none",
                mixBlendMode: "overlay",
              }}
            />
            {/* Issue #130: 自動ドロー時のみ「自動ドロー」ラベルを中央保持中に表示。
                Phase 5 (cardHold) の前半 1000ms に薄く出現させる。fade-in 後に
                hold が始まるので CSS animation の delay はカード fade-in と
                合わせる (= FLASH_DELAY_S と同タイミング)。 */}
            {isAuto && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: [0, 0.85, 0.85, 0], y: [6, 0, 0, 0] }}
                transition={{
                  duration: 1.0,
                  delay: startDelayS + FLASH_DELAY_S,
                  times: [0, 0.2, 0.8, 1],
                  ease: "easeOut",
                }}
                style={{
                  position: "absolute",
                  bottom: 16,
                  left: 0,
                  right: 0,
                  textAlign: "center",
                  fontSize: 14,
                  letterSpacing: "0.18em",
                  color: "rgb(236 253 245)", // emerald-50
                  textShadow: "0 1px 4px rgba(0, 0, 0, 0.7)",
                  pointerEvents: "none",
                  fontWeight: 600,
                }}
              >
                自動ドロー
              </motion.div>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
