// 案 E-1: 苔 (Koke) variant A - 細密散らし松葉
//   - 深緑グラデベースに金の松葉ペア (V 字) を細密に散らした版。
//     現行の matsuba (28×28・2 ペア) より密度を上げ、ストロークを細く、
//     位置を揺らして手仕事のような有機的な雰囲気に。
//   - sheen は 5s で左→右 (波と同テンポ) — 3 つの koke variant で共有。
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

export function CardBackKokeA({ size = "md", fullWidth = false, className }: Props) {
  const sizeCls = fullWidth
    ? cn("w-full", MOCK_FULLWIDTH_HEIGHT[size])
    : MOCK_SIZE_CLASS[size];
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md border-2 border-amber-400/70 shrink-0",
        "bg-gradient-to-br from-emerald-950 via-green-950 to-stone-950",
        sizeCls,
        className,
      )}
      aria-label="伏せられたカード"
    >
      {/* 細密散らし松葉パターン (SVG タイル repeat) */}
      <div className="absolute inset-0 card-back-mock-koke-a-pattern" aria-hidden />
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
      <div className="absolute inset-0 card-back-mock-koke-sheen pointer-events-none" aria-hidden />
    </div>
  );
}
