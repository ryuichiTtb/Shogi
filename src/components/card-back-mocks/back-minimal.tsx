// 案 D: 黒漆「将」ミニマル
//   - 漆黒グラデ + シルバー線画
//   - 中央: 大きな「将」字 (筆文字)
//   - 装飾: 二重細枠 + 四隅の菱形
//   - アニメ: 縁が 8s で薄シマー
import { cn } from "@/lib/utils";
import {
  MOCK_SIZE_CLASS,
  MOCK_FULLWIDTH_HEIGHT,
  MOCK_CENTER_TEXT_CLASS,
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
        "relative overflow-hidden rounded-md border-2 border-slate-300/70 shrink-0",
        "bg-gradient-to-br from-zinc-900 via-zinc-950 to-black",
        sizeCls,
        className,
      )}
      aria-label="伏せられたカード"
    >
      {/* 内側の細枠 (ゴールド) */}
      <div className="absolute inset-[3px] rounded-sm border border-amber-300/35 pointer-events-none" aria-hidden />
      {/* 四隅の菱形 */}
      <span className="absolute top-1 left-1 w-1.5 h-1.5 rotate-45 bg-amber-300/60" aria-hidden />
      <span className="absolute top-1 right-1 w-1.5 h-1.5 rotate-45 bg-amber-300/60" aria-hidden />
      <span className="absolute bottom-1 left-1 w-1.5 h-1.5 rotate-45 bg-amber-300/60" aria-hidden />
      <span className="absolute bottom-1 right-1 w-1.5 h-1.5 rotate-45 bg-amber-300/60" aria-hidden />
      {/* 中央「将」 */}
      <div
        className={cn(
          "absolute inset-0 flex items-center justify-center select-none",
          MOCK_CENTER_TEXT_CLASS[size],
          "text-slate-200 font-bold",
        )}
        style={{ fontFamily: "'Yuji Boku', 'Noto Sans JP', serif" }}
        aria-hidden
      >
        将
      </div>
      {/* シマー (縁が薄く流れる光沢) */}
      <div className="absolute inset-0 card-back-mock-minimal-shimmer pointer-events-none" aria-hidden />
    </div>
  );
}
