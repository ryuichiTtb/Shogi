// 案 E-3: 苔 (Koke) variant C - 五葉松 starburst
//   - 深緑グラデベースに金の五葉松 (5 本の針葉が一点から扇状に広がる房) を散らす。
//     2 ペアの V 字よりも針葉数を増やし、本物の松葉の房のような房感を出す。
//     深い杉林で松葉が積もった趣。
//   - sheen は 5s で左→右 — 3 つの koke variant で共有。
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

export function CardBackKokeC({ size = "md", fullWidth = false, className }: Props) {
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
      {/* 五葉松パターン (SVG タイル repeat) */}
      <div className="absolute inset-0 card-back-mock-koke-c-pattern" aria-hidden />
      {/* 内側の二重枠 */}
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
      {/* sheen */}
      <div className="absolute inset-0 card-back-mock-koke-sheen pointer-events-none" aria-hidden />
    </div>
  );
}
