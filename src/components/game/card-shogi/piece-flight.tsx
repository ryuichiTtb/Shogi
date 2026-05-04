"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";

import type { Player } from "@/lib/shogi/types";
import { ShogiPiece } from "../shogi-piece";
import {
  PIECE_SIZE,
  PIECE_SPEED_PX_PER_SEC as SPEED_PX_PER_SEC,
  PIECE_ROTATION_SEC_PER_TURN as ROTATION_SEC_PER_TURN,
  PIECE_MIN_DURATION_MS as MIN_DURATION_MS,
  PIECE_FALLBACK_PADDING_MS as FALLBACK_PADDING_MS,
} from "./animation-constants";

// Issue #82: カード使用後の駒移動演出。
// 中央フライト演出 (CardPlayFlight) 完了後に発火し、対象駒が回転しながら
// from → to へ移動する。完了で onComplete を呼び、reducer の COMMIT_PLAY_CARD で
// AI の手番解禁・isPlayingCard クリアにつなげる。

export interface PieceFlightSpec {
  pieceType: string;
  owner: Player;
  // 画面座標 (DOMRect.left + width/2 などの中心点)
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

interface PieceFlightProps {
  spec: PieceFlightSpec | null;
  flightKey: number | null;
  // プレイヤー視点(駒の向き)
  playerColor: Player;
  onComplete: () => void;
  // 検証用 (dev /piece-flight 等) のオプション上書き。本番経路では未指定で
  // animation-constants の値が使われる。
  speedPxPerSec?: number;
  rotationSecPerTurn?: number;
  minDurationMs?: number;
  pieceSize?: number;
  ease?: "linear" | "easeIn" | "easeOut" | "easeInOut" | "circIn" | "circOut" | "anticipate";
}

const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export function PieceFlight({
  spec,
  flightKey,
  playerColor,
  onComplete,
  speedPxPerSec,
  rotationSecPerTurn,
  minDurationMs,
  pieceSize,
  ease,
}: PieceFlightProps) {
  const isClient = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
  if (!isClient) return null;

  return createPortal(
    <div className="fixed inset-0 pointer-events-none z-[55]">
      <AnimatePresence>
        {spec && flightKey !== null && (
          <PieceFlightInner
            key={flightKey}
            spec={spec}
            playerColor={playerColor}
            onComplete={onComplete}
            speedPxPerSec={speedPxPerSec}
            rotationSecPerTurn={rotationSecPerTurn}
            minDurationMs={minDurationMs}
            pieceSize={pieceSize}
            ease={ease}
          />
        )}
      </AnimatePresence>
    </div>,
    document.body,
  );
}

function PieceFlightInner({
  spec,
  playerColor,
  onComplete,
  speedPxPerSec,
  rotationSecPerTurn,
  minDurationMs,
  pieceSize,
  ease,
}: {
  spec: PieceFlightSpec;
  playerColor: Player;
  onComplete: () => void;
  speedPxPerSec?: number;
  rotationSecPerTurn?: number;
  minDurationMs?: number;
  pieceSize?: number;
  ease?: PieceFlightProps["ease"];
}) {
  const speed = speedPxPerSec ?? SPEED_PX_PER_SEC;
  const rotPeriod = rotationSecPerTurn ?? ROTATION_SEC_PER_TURN;
  const minDur = minDurationMs ?? MIN_DURATION_MS;
  const size = pieceSize ?? PIECE_SIZE;
  // 既定 easing は dev 検証で採用された easeInOut (2026-05-04)。
  // 旧実装は linear を採用していたが、最小再生時間を 600ms に伸ばしたため
  // 始終点で減速がかかる easeInOut の方が違和感が少なくなった。
  const easing = ease ?? "easeInOut";

  // 距離に応じた duration を算出 (移動速度 speed 一定)
  const dx = spec.toX - spec.fromX;
  const dy = spec.toY - spec.fromY;
  const distance = Math.hypot(dx, dy);
  const durationMs = Math.max(minDur, (distance / speed) * 1000);
  // 回転総量は duration から逆算 (回転速度 rotPeriod sec/回転 一定)
  const rotateDeg = (durationMs / 1000 / rotPeriod) * 360;

  // タブ非アクティブ時の onAnimationComplete 遅延に備えた保険タイマー
  const completedRef = useRef(false);
  const handleComplete = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    onComplete();
  }, [onComplete]);

  useEffect(() => {
    const id = window.setTimeout(handleComplete, durationMs + FALLBACK_PADDING_MS);
    return () => window.clearTimeout(id);
  }, [handleComplete, durationMs]);

  return (
    <motion.div
      initial={{
        x: spec.fromX - size / 2,
        y: spec.fromY - size / 2,
        rotate: 0,
      }}
      animate={{
        x: spec.toX - size / 2,
        y: spec.toY - size / 2,
        rotate: rotateDeg,
      }}
      transition={{
        duration: durationMs / 1000,
        ease: easing,
      }}
      onAnimationComplete={handleComplete}
      style={{
        position: "fixed",
        left: 0,
        top: 0,
        width: size,
        height: size,
        willChange: "transform",
        zIndex: 55,
      }}
    >
      <ShogiPiece
        piece={{ type: spec.pieceType, owner: spec.owner }}
        playerColor={playerColor}
        squareSize={size}
      />
    </motion.div>
  );
}
