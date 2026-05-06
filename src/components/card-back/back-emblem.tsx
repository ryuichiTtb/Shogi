// 案 A: 煌 (Kira) - 深紺地 + 金斜線 + 閃光
//   - 深紺ベース (slate-900 → indigo-950 → slate-950) に 45° の金色斜線 (静止、左下→右上)。
//     斜線を貫く広い光帯 sheen が 3.5s で左→右に流れ、金線が閃光のように煌めく。
//   - 中央: 駒シルエット (末広がり、文字なし、ゴールド線)
//   - 装飾(枠): 内側ゴールド細枠 + 四隅菱形 (他案と統一感)
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
      {/* 内側の細枠 (ゴールド) */}
      <div className="absolute inset-[3px] rounded-sm border border-amber-300/35 pointer-events-none" aria-hidden />
      {/* 四隅の菱形 */}
      <span className="absolute top-1 left-1 w-1.5 h-1.5 rotate-45 bg-amber-300/70" aria-hidden />
      <span className="absolute top-1 right-1 w-1.5 h-1.5 rotate-45 bg-amber-300/70" aria-hidden />
      <span className="absolute bottom-1 left-1 w-1.5 h-1.5 rotate-45 bg-amber-300/70" aria-hidden />
      <span className="absolute bottom-1 right-1 w-1.5 h-1.5 rotate-45 bg-amber-300/70" aria-hidden />
      {/* 中央エンブレム */}
      <div className="absolute inset-0 flex items-center justify-center">
        <KomaShape
          className={MOCK_CENTER_SHAPE_CLASS[size]}
          strokeWidth={3}
        />
      </div>
    </div>
  );
}
