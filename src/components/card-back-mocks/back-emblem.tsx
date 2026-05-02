// 案 A: 玉将エンブレム
//   - 深紺グラデ + ゴールドアクセント
//   - 中央: 駒シルエット内に「玉」
//   - 装飾: 放射状の薄ゴールド光線 (conic-gradient、ゆっくり回転)
//   - アニメ: エンブレムが 6s で脈動
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
      <div className="absolute inset-0 card-back-mock-emblem-rays" aria-hidden />
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
          glyph="玉"
          glyphClassName="fill-amber-200"
        />
      </div>
    </div>
  );
}
