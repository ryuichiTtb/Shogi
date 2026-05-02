// 案 D: 黒漆ミニマル
//   - 黒ベースに、左上から黄色→金茶のラジアルグラデ + 中央寄りに白ハイライト
//   - 中央: 大きな駒シルエット (金属グラデ + キラッと sheen)
//   - 装飾: 二重細枠 + 四隅の菱形
//   - アニメ: 7s で横に流れる薄ゴールド帯 + 8s で薄シマー
import { cn } from "@/lib/utils";
import { KomaShape } from "./koma-shape";
import {
  MOCK_SIZE_CLASS,
  MOCK_FULLWIDTH_HEIGHT,
  type MockSize,
} from "./sizes";

interface Props {
  size?: MockSize;
  fullWidth?: boolean;
  className?: string;
}

// D 案は中央駒シルエットが主役のため、共通の MOCK_CENTER_SHAPE_CLASS より
// やや大きめの駒サイズを使う。
const D_SHAPE_CLASS: Record<MockSize, string> = {
  sm: "w-8 h-10",
  md: "w-14 h-16",
  lg: "w-16 h-20",
  xl: "w-72 h-80",
};

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
      {/* 横に流れる薄ゴールド帯 (背景の動きを足す) */}
      <div className="absolute inset-0 card-back-mock-minimal-flow pointer-events-none" aria-hidden />
      {/* 内側の細枠 (ゴールド) */}
      <div className="absolute inset-[3px] rounded-sm border border-amber-300/35 pointer-events-none" aria-hidden />
      {/* 四隅の菱形 */}
      <span className="absolute top-1 left-1 w-1.5 h-1.5 rotate-45 bg-amber-300/70" aria-hidden />
      <span className="absolute top-1 right-1 w-1.5 h-1.5 rotate-45 bg-amber-300/70" aria-hidden />
      <span className="absolute bottom-1 left-1 w-1.5 h-1.5 rotate-45 bg-amber-300/70" aria-hidden />
      <span className="absolute bottom-1 right-1 w-1.5 h-1.5 rotate-45 bg-amber-300/70" aria-hidden />
      {/* 中央: 大きな駒シルエット (金属グラデ + キラッと sheen) */}
      <div className="absolute inset-0 flex items-center justify-center">
        <KomaShape className={D_SHAPE_CLASS[size]} strokeWidth={2} />
      </div>
      {/* シマー (縁が薄く流れる光沢) */}
      <div className="absolute inset-0 card-back-mock-minimal-shimmer pointer-events-none" aria-hidden />
    </div>
  );
}
