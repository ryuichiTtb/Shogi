// 案 B: 青海波 + 金箔
//   - 水色ベース (sky-400 → sky-700 → sky-950) + 薄ゴールド線の青海波パターン全面リピート (静止)
//   - 中央: 駒シルエット (末広がり、文字なし)
//   - 装飾(枠): 内側ゴールド細枠 + 四隅菱形 (A/D 案と統一感)
//   - アニメ: 左→右の sheen (光沢)
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

export function CardBackSeigaiha({ size = "md", fullWidth = false, className }: Props) {
  const sizeCls = fullWidth
    ? cn("w-full", MOCK_FULLWIDTH_HEIGHT[size])
    : MOCK_SIZE_CLASS[size];
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md border-2 border-amber-400/70 shrink-0",
        "bg-gradient-to-br from-sky-400 via-sky-700 to-sky-950",
        sizeCls,
        className,
      )}
      aria-label="伏せられたカード"
    >
      {/* 青海波パターン (SVG タイル repeat) */}
      <div className="absolute inset-0 card-back-mock-seigaiha-pattern" aria-hidden />
      {/* 内側の二重枠 (内側 1px 細枠) */}
      <div className="absolute inset-[3px] rounded-sm border border-amber-300/40 pointer-events-none" aria-hidden />
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
      {/* sheen (左→右の金色光沢) */}
      <div className="absolute inset-0 card-back-mock-seigaiha-sheen pointer-events-none" aria-hidden />
    </div>
  );
}
