// Issue #155: LoadingOverlay 中央に表示する「ふわふわ回転カード」。
//
// 実装方針:
//   - rotateY 360° の連続ループを CSS keyframes (loading-card-flip) で再生し、
//     表面と裏面の 2 枚を [transform-style: preserve-3d] の親に重ねて
//     [backface-visibility: hidden] で半周ごとに表裏を切替える。
//   - 表面は将棋の主要 8 駒 (歩・香車・桂馬・銀将・金将・飛車・角行・王将) から
//     1 枚ランダム選択し、対局時と同じ ShogiPiece (font: yuji-boku、五角形 SVG
//     枠) で描画する。マウントごとにランダムだが、useState 初期化なのでカード
//     表面を見ているあいだは固定される (くるくる入れ替わると目障りなため)。
//   - prefers-reduced-motion: reduce のときは framer-motion の useReducedMotion
//     経由で reduce フラグを取得し、回転を止めて CardBack のみを静止表示する。
//   - サイズはレスポンシブに clamp(140px, 40vw, 240px)、アスペクト比 8:5。
"use client";

import { memo, useState } from "react";
import { useReducedMotion } from "framer-motion";

import { CardBack } from "@/components/card-back/card-back";
import { ShogiPiece } from "@/components/game/shogi-piece";
import type { PieceType } from "@/lib/shogi/types";
import { cn } from "@/lib/utils";

// 表面に出す駒のプール。プロモート駒・成り駒は除外し、初心者にも一目で
// 分かる主要 8 駒に絞る (Issue #155 のユーザー指定)。
const LOADING_FACE_PIECE_TYPES: readonly PieceType[] = [
  "pawn",   // 歩
  "lance",  // 香車
  "knight", // 桂馬
  "silver", // 銀将
  "gold",   // 金将
  "rook",   // 飛車
  "bishop", // 角行
  "king",   // 王将
] as const;

function pickRandomPieceType(): PieceType {
  const idx = Math.floor(Math.random() * LOADING_FACE_PIECE_TYPES.length);
  return LOADING_FACE_PIECE_TYPES[idx];
}

const SIZE_STYLE = {
  width: "clamp(140px, 40vw, 240px)",
  aspectRatio: "8 / 5",
} as const;

interface LoadingCardFaceProps {
  pieceType: PieceType;
}

// 表面: カード枠 (rounded-md + amber 系の縁) の中に駒シルエットを描画。
// ShogiPiece が SVG で五角形枠と漢字を描くため、フォントは対局時と同じ
// (font-yuji-boku) になる。
function LoadingCardFace({ pieceType }: LoadingCardFaceProps) {
  return (
    <div
      className={cn(
        "w-full h-full rounded-md border-2 shadow-sm",
        "border-amber-700/50 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-950/30",
        "flex items-center justify-center p-2",
      )}
    >
      <div className="h-[88%] aspect-[5/6] flex items-center justify-center">
        <ShogiPiece piece={{ type: pieceType, owner: "sente" }} isLarge />
      </div>
    </div>
  );
}

export const LoadingCardVisual = memo(function LoadingCardVisual() {
  const reduce = useReducedMotion() ?? false;
  // 表示中の駒種をマウント時に 1 度だけランダム決定 (memo で再レンダー抑止)。
  const [pieceType] = useState(pickRandomPieceType);

  // reduce 時は静止 (CardBack のみ)。preserve-3d 不要。
  if (reduce) {
    return (
      <div style={SIZE_STYLE} aria-hidden>
        <CardBack className="!w-full !h-full" />
      </div>
    );
  }

  return (
    <div
      className="relative animate-loading-card-bob"
      style={SIZE_STYLE}
      aria-hidden
    >
      <div
        className={cn(
          "relative w-full h-full",
          // Tailwind の任意値で transform-style を確実に適用。globals.css の
          // animation class 側でも同プロパティを指定しているが、Tailwind v4 の
          // ユーティリティ優先度を借りて表裏切替が確実に効くようにする。
          "[transform-style:preserve-3d]",
          "animate-loading-card-flip",
        )}
      >
        {/* 裏面: rotateY(0deg) を起点とし、ループの 0°・360° で正面に来る。
            backface-visibility: hidden により 90°〜270° の範囲は自動で隠れる。 */}
        <div className="absolute inset-0 [backface-visibility:hidden]">
          <CardBack className="!w-full !h-full" />
        </div>
        {/* 表面: rotateY(180deg) を初期姿勢にして裏面と背中合わせに重ねる。
            ループの 180° で正面に来る (= 半周ごとに表裏が切替わる)。 */}
        <div
          className="absolute inset-0 [backface-visibility:hidden]"
          style={{ transform: "rotateY(180deg)" }}
        >
          <LoadingCardFace pieceType={pieceType} />
        </div>
      </div>
    </div>
  );
});
