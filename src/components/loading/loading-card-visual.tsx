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

// 檜 (ひのき) の心材を意識した、硬く落ち着いた茶色。標準将棋盤上の駒色 (薄い
// ベージュ系) より明確に濃く、黒背景にも埋もれない明度を保つようチューニング。
//   - inner: #a86d3b (濃い檜茶。中央スポットの白光と相互作用してふんわり浮き上がる)
//   - border: #4a2e15 (こげ茶。標準 king (#5c3a1e) より一段濃く、引き締まった輪郭)
const LOADING_PIECE_COLOR_OVERRIDE = {
  border: "#4a2e15",
  inner: "#a86d3b",
} as const;

// 表面: 裏面と同じ「金フレーム + 中央スポット + 中央駒」の世界観を保ちつつ、
// 背景は loading-card-face-bg (完全な黒地 + 中央楕円の白スポット) で漆 (minimal)
// とは別パターンに差別化する。
//   - 外枠: amber-400/70 の border-2
//   - 内枠: 内側 3px 位置に amber-300/35 の細枠
//   - 四隅: amber-300/70 の菱形 (45° 回転した小正方形)
//   - 背景: loading-card-face-bg (globals.css の専用 class)
//   - 中央: ランダム駒シルエット (ShogiPiece = 五角形 SVG 枠 + yuji-boku 漢字、
//     色は檜木調にオーバーライド)。
function LoadingCardFace({ pieceType }: LoadingCardFaceProps) {
  return (
    <div
      className={cn(
        "relative w-full h-full overflow-hidden rounded-md border-2",
        "border-amber-400/70 loading-card-face-bg",
      )}
    >
      {/* 内側の細枠 (ゴールド) */}
      <div
        className="absolute inset-[3px] rounded-sm border border-amber-300/35 pointer-events-none"
        aria-hidden
      />
      {/* 四隅の菱形 */}
      <span className="absolute top-1 left-1 w-1.5 h-1.5 rotate-45 bg-amber-300/70" aria-hidden />
      <span className="absolute top-1 right-1 w-1.5 h-1.5 rotate-45 bg-amber-300/70" aria-hidden />
      <span className="absolute bottom-1 left-1 w-1.5 h-1.5 rotate-45 bg-amber-300/70" aria-hidden />
      <span className="absolute bottom-1 right-1 w-1.5 h-1.5 rotate-45 bg-amber-300/70" aria-hidden />
      {/* 中央: ランダム駒シルエット (檜木調にオーバーライド) */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="h-[78%] aspect-[5/6]">
          <ShogiPiece
            piece={{ type: pieceType, owner: "sente" }}
            isLarge
            colorOverride={LOADING_PIECE_COLOR_OVERRIDE}
          />
        </div>
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
