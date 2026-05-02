"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";

import type { Player } from "@/lib/shogi/types";
import { ShogiPiece } from "../shogi-piece";

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
}

// 駒のサイズ (UX 検証中: 持ち駒・盤上駒の約 1.5 倍を試行)
const PIECE_SIZE = 84;
// Issue #82 ユーザー指示: 移動速度・回転速度ともに「速度一定」。
// - 移動速度 1800 px/s
// - 回転速度 0.1s / 1回転 = 10 回転/秒
// duration は距離に応じて可変、回転総量は duration から逆算 (時間に比例)。
const SPEED_PX_PER_SEC = 1800;
// 0.1s で 1 回転
const ROTATION_SEC_PER_TURN = 0.1;
// 距離 0 付近でも瞬時にならないよう最小 duration を確保
const MIN_DURATION_MS = 180;
// 保険タイマーの余裕
const FALLBACK_PADDING_MS = 500;

const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export function PieceFlight({ spec, flightKey, playerColor, onComplete }: PieceFlightProps) {
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
}: {
  spec: PieceFlightSpec;
  playerColor: Player;
  onComplete: () => void;
}) {
  // 距離に応じた duration を算出 (移動速度 SPEED_PX_PER_SEC 一定)
  const dx = spec.toX - spec.fromX;
  const dy = spec.toY - spec.fromY;
  const distance = Math.hypot(dx, dy);
  const durationMs = Math.max(MIN_DURATION_MS, (distance / SPEED_PX_PER_SEC) * 1000);
  // 回転総量は duration から逆算 (回転速度 0.2s/回転 = 5 回転/秒 一定)
  const rotateDeg = (durationMs / 1000 / ROTATION_SEC_PER_TURN) * 360;

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
        x: spec.fromX - PIECE_SIZE / 2,
        y: spec.fromY - PIECE_SIZE / 2,
        rotate: 0,
      }}
      animate={{
        x: spec.toX - PIECE_SIZE / 2,
        y: spec.toY - PIECE_SIZE / 2,
        rotate: rotateDeg,
      }}
      transition={{
        duration: durationMs / 1000,
        // Issue #82 ユーザー指示: 移動・回転とも等速 (linear)
        ease: "linear",
      }}
      onAnimationComplete={handleComplete}
      style={{
        position: "fixed",
        left: 0,
        top: 0,
        width: PIECE_SIZE,
        height: PIECE_SIZE,
        willChange: "transform",
        zIndex: 55,
      }}
    >
      <ShogiPiece
        piece={{ type: spec.pieceType, owner: spec.owner }}
        playerColor={playerColor}
        squareSize={PIECE_SIZE}
      />
    </motion.div>
  );
}
