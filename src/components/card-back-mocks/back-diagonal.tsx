// 案 E: 駒型タイル + 斜め金線
//   - 藍ベース + 斜めの細い金ストライプ (動く)
//   - 中央: 駒シルエット (末広がり、文字なし)
//   - 四隅菱形装飾
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

export function CardBackDiagonal({ size = "md", fullWidth = false, className }: Props) {
  const sizeCls = fullWidth
    ? cn("w-full", MOCK_FULLWIDTH_HEIGHT[size])
    : MOCK_SIZE_CLASS[size];
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md border-2 border-amber-400/70 shrink-0",
        "bg-gradient-to-br from-indigo-900 via-indigo-950 to-slate-950",
        sizeCls,
        className,
      )}
      aria-label="伏せられたカード"
    >
      {/* 斜め金ストライプ (スライド) */}
      <div className="absolute inset-0 card-back-mock-diagonal-stripes" aria-hidden />
      {/* 四隅菱形 */}
      <span className="absolute top-1 left-1 w-1.5 h-1.5 rotate-45 bg-amber-300/70" aria-hidden />
      <span className="absolute top-1 right-1 w-1.5 h-1.5 rotate-45 bg-amber-300/70" aria-hidden />
      <span className="absolute bottom-1 left-1 w-1.5 h-1.5 rotate-45 bg-amber-300/70" aria-hidden />
      <span className="absolute bottom-1 right-1 w-1.5 h-1.5 rotate-45 bg-amber-300/70" aria-hidden />
      {/* 中央エンブレム */}
      <div className="absolute inset-0 flex items-center justify-center">
        <KomaShape
          className={MOCK_CENTER_SHAPE_CLASS[size]}
          fillClassName="fill-indigo-950/70"
          strokeClassName="stroke-amber-300"
          strokeWidth={3}
        />
      </div>
    </div>
  );
}
