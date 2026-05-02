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

// 駒のサイズ。盤面マス・持ち駒アイコンと比して見栄えするよう中間サイズ
const PIECE_SIZE = 56;
// 移動全体の所要時間 (Issue #82: 0.5s)
const TOTAL_MS = 500;
// 回転数 (Issue #82 ユーザー指示: 4 周)
const ROTATIONS = 4;
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
  // タブ非アクティブ時の onAnimationComplete 遅延に備えた保険タイマー
  const completedRef = useRef(false);
  const handleComplete = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    onComplete();
  }, [onComplete]);

  useEffect(() => {
    const id = window.setTimeout(handleComplete, TOTAL_MS + FALLBACK_PADDING_MS);
    return () => window.clearTimeout(id);
  }, [handleComplete]);

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
        rotate: 360 * ROTATIONS,
      }}
      transition={{
        duration: TOTAL_MS / 1000,
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
      />
    </motion.div>
  );
}
