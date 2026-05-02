// 案 D: 黒漆ミニマル
//   - 黒ベース大目。左上から黄色→金茶のラジアルグラデ (42% で減衰) +
//     中央寄りに控えめな白ハイライト (20% で減衰)
//   - 中央: 大きな駒シルエット (金属グラデ + キラッと sheen)
//   - 装飾: 二重細枠 + 四隅の菱形
//   - アニメ: 8s で薄シマー
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

export function CardBackMinimal({ size = "md", fullWidth = false, className }: Props) {
  const sizeCls = fullWidth
    ? cn("w-full", MOCK_FULLWIDTH_HEIGHT[size])
    : MOCK_SIZE_CLASS[size];
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md border-2 border-amber-400/70 shrink-0",
        "card-back-mock-minimal-bg",
        sizeCls,
        className,
      )}
      aria-label="伏せられたカード"
    >
      {/* 内側の細枠 (ゴールド) */}
      <div className="absolute inset-[3px] rounded-sm border border-amber-300/35 pointer-events-none" aria-hidden />
      {/* 四隅の菱形 */}
      <span className="absolute top-1 left-1 w-1.5 h-1.5 rotate-45 bg-amber-300/70" aria-hidden />
      <span className="absolute top-1 right-1 w-1.5 h-1.5 rotate-45 bg-amber-300/70" aria-hidden />
      <span className="absolute bottom-1 left-1 w-1.5 h-1.5 rotate-45 bg-amber-300/70" aria-hidden />
      <span className="absolute bottom-1 right-1 w-1.5 h-1.5 rotate-45 bg-amber-300/70" aria-hidden />
      {/* 中央: 駒シルエット (金属グラデ + キラッと sheen) */}
      <div className="absolute inset-0 flex items-center justify-center">
        <KomaShape className={MOCK_CENTER_SHAPE_CLASS[size]} strokeWidth={2} />
      </div>
      {/* シマー (縁が薄く流れる光沢) */}
      <div className="absolute inset-0 card-back-mock-minimal-shimmer pointer-events-none" aria-hidden />
    </div>
  );
}
