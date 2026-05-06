// 案 G: 紅 (Kurenai) - 葉文 + 金閃光
//   - 深紅ベース (red-950 → red-800 → red-950)。中央に red-800 の鮮やかな緋色を覗かせる
//     「中央輝き」グラデで、漆器の朱塗りのような深みと艶を出す。
//   - 全面に金の葉文 (細長いランス形を 2 枚、対角配置) を 24×24 タイルで repeat。
//   - 中央駒シルエットは tone="orange" を指定し、黄色寄りの橙→黒グラデへ。
//     深紅地に橙の駒を浮かべることで、宴の灯火のような温かい華やぎを宿す。
//   - 装飾(枠): 内側ゴールド細枠 + 四隅菱形 (他案と統一感)
//   - アニメ: 斜め (100°) のゴールド閃光 sheen が 3.5s で流れる (煌と同テンポ)
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

export function CardBackKurenai({ size = "md", fullWidth = false, className }: Props) {
  const sizeCls = fullWidth
    ? cn("w-full", MOCK_FULLWIDTH_HEIGHT[size])
    : MOCK_SIZE_CLASS[size];
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md border-2 border-amber-400/80 shrink-0",
        "bg-gradient-to-br from-red-950 via-red-800 to-red-950",
        sizeCls,
        className,
      )}
      aria-label="伏せられたカード"
    >
      {/* 葉文パターン (SVG タイル repeat) */}
      <div className="absolute inset-0 card-back-mock-kurenai-pattern" aria-hidden />
      {/* 斜め閃光 sheen */}
      <div
        className="absolute inset-0 card-back-mock-kurenai-shine pointer-events-none"
        aria-hidden
      />
      {/* 内側の細枠 (ゴールド) */}
      <div className="absolute inset-[3px] rounded-sm border border-amber-300/35 pointer-events-none" aria-hidden />
      {/* 四隅の菱形 */}
      <span className="absolute top-1 left-1 w-1.5 h-1.5 rotate-45 bg-amber-300/70" aria-hidden />
      <span className="absolute top-1 right-1 w-1.5 h-1.5 rotate-45 bg-amber-300/70" aria-hidden />
      <span className="absolute bottom-1 left-1 w-1.5 h-1.5 rotate-45 bg-amber-300/70" aria-hidden />
      <span className="absolute bottom-1 right-1 w-1.5 h-1.5 rotate-45 bg-amber-300/70" aria-hidden />
      {/* 中央エンブレム (橙→黒グラデで深紅地と調和) */}
      <div className="absolute inset-0 flex items-center justify-center">
        <KomaShape
          className={MOCK_CENTER_SHAPE_CLASS[size]}
          strokeWidth={3}
          tone="orange"
        />
      </div>
    </div>
  );
}
