// 案 A: 玉将エンブレム (改訂版)
//   - 深紺グラデ + ゴールドアクセント
//   - 中央: 駒シルエット (末広がり、文字なし、ゴールド線)
//   - 装飾: 金色の斜線(複数本)+ 斜線を流れる閃光 (sheen)
//   - アニメ: エンブレムが 6s で脈動 + 閃光は 3.5s で左→右に流れる
import { cn } from "@/lib/utils";
import { KomaShape } from "./koma-shape";
import {
  MOCK_SIZE_CLASS,
  MOCK_FULLWIDTH_HEIGHT,
  MOCK_CENTER_SHAPE_CLASS,
  type MockSize,
} from "./sizes";

interface Props {
  size?: MockSize;
  fullWidth?: boolean;
  className?: string;
}

export function CardBackEmblem({ size = "md", fullWidth = false, className }: Props) {
  const sizeCls = fullWidth
    ? cn("w-full", MOCK_FULLWIDTH_HEIGHT[size])
    : MOCK_SIZE_CLASS[size];
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md border-2 border-amber-400/80 shrink-0",
        "bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-950",
        sizeCls,
        className,
      )}
      aria-label="伏せられたカード"
    >
      {/* 静止の金色斜線 */}
      <div className="absolute inset-0 card-back-mock-emblem-stripes" aria-hidden />
      {/* 斜線を流れる閃光 */}
      <div
        className="absolute inset-0 card-back-mock-emblem-shine pointer-events-none"
        aria-hidden
      />
      {/* 中央エンブレム (脈動) */}
      <div
        className={cn(
          "absolute inset-0 flex items-center justify-center",
          "card-back-mock-emblem-pulse",
        )}
      >
        <KomaShape
          className={MOCK_CENTER_SHAPE_CLASS[size]}
          fillClassName="fill-amber-400/10"
          strokeClassName="stroke-amber-300"
          strokeWidth={3}
        />
      </div>
    </div>
  );
}
