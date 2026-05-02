// 将棋駒の五角形シルエット (SVG)。複数のモック案で共有する。
//   - 上が尖り、左右側面が下に向けてやや外向きに広がる伝統的な末広がり駒形
//     (肩の幅 < 底辺の幅)
//   - viewBox 100×120 (= 駒の縦長比 5:6)
//
// 将来 (Issue #110 以降) ユーザー設定でアイコンを差し替えられるようにするため、
// シルエット内にカスタムシンボルを描画できる children スロットを公開している。
// 現状のモックは内部に何も入れず駒形シルエットのみで判別される前提。
//
// variant="metallic" (default): 金 → 黒の対角グラデで塗りつぶし、
//   駒形にクリップした白い斜め光帯が 4.5s 周期で左→右に流れて「キラッ」と光る。
// variant="plain": 単色 fill のみ (採用案決定後の比較用に残す)。
"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

interface KomaShapeProps {
  className?: string;
  variant?: "metallic" | "plain";
  fillClassName?: string;
  strokeClassName?: string;
  strokeWidth?: number;
  // 駒シルエット内部に重ねる SVG 要素 (将来のアイコン差し替え用スロット)。
  children?: React.ReactNode;
}

// 末広がりの将棋駒形 (浅め・横広)。
//   上頂点 (50,6) → 右肩 (80,28) → 右下 (88,114) → 左下 (12,114) → 左肩 (20,28)
//   肩幅 60 / 底辺 76 → 下に向けて約 1.27 倍の浅い末広がり。
//   側面の傾斜は片側 8px / 86px ≒ 5.3° (角度は維持し横方向に拡張)。
const KOMA_PATH = "M50 6 L80 28 L88 114 L12 114 L20 28 Z";

export function KomaShape({
  className,
  variant = "metallic",
  fillClassName,
  strokeClassName = "stroke-amber-400",
  strokeWidth = 2,
  children,
}: KomaShapeProps) {
  // 同一ページで KomaShape を多数描画するため、defs の id 衝突を避けるよう
  // useId で SSR-safe なユニーク ID を生成。
  const uid = useId();
  const gradientId = `koma-grad-${uid}`;
  const clipId = `koma-clip-${uid}`;
  const isMetallic = variant === "metallic";

  return (
    <svg
      viewBox="0 0 100 120"
      className={cn("block", className)}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      {isMetallic && (
        <defs>
          {/* 左上の明るい金 → 右下の黒、4 ストップで金属感。明部は維持し
              暗部を amber-900→黒で深く落として透過感を消す。 */}
          <linearGradient id={gradientId} x1="0.15" y1="0" x2="0.85" y2="1">
            <stop offset="0%" stopColor="#fef3c7" />
            <stop offset="22%" stopColor="#fcd34d" />
            <stop offset="60%" stopColor="#78350f" />
            <stop offset="100%" stopColor="#000000" />
          </linearGradient>
          {/* 駒形でクリップ (sheen が外にはみ出さないように) */}
          <clipPath id={clipId}>
            <path d={KOMA_PATH} />
          </clipPath>
        </defs>
      )}
      <path
        d={KOMA_PATH}
        className={cn(!isMetallic && fillClassName, strokeClassName)}
        fill={isMetallic ? `url(#${gradientId})` : undefined}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
      {isMetallic && (
        // 駒形にクリップした白い斜め光帯。SMIL animate で x と opacity を動かし、
        // 4.5s 周期のうち最初の半分で左→右へ通過、残り半分は休む (キラッ感)。
        <g clipPath={`url(#${clipId})`}>
          <rect
            x="-40"
            y="-10"
            width="22"
            height="140"
            fill="#ffffff"
            opacity="0"
            transform="skewX(-20)"
          >
            <animate
              attributeName="x"
              values="-40; 120; 120"
              keyTimes="0; 0.5; 1"
              dur="4.5s"
              repeatCount="indefinite"
            />
            <animate
              attributeName="opacity"
              values="0; 0; 0.4; 0; 0"
              keyTimes="0; 0.05; 0.25; 0.5; 1"
              dur="4.5s"
              repeatCount="indefinite"
            />
          </rect>
        </g>
      )}
      {children}
    </svg>
  );
}
