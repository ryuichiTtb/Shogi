// 案 G: 笹 (Sasa) - 笹葉 + 斜光
//   - 深緑グラデ (emerald-950 → green-900 → emerald-950) ベース
//   - 全面に笹葉 (細長いランス形) の SVG タイルを斜めに repeat
//   - 装飾(枠): 内側ゴールド細枠 + 四隅菱形 (既存 3 案と統一感)
//   - アニメ: 斜め (100°) の閃光 sheen が 3.5s で流れる (煌と同テンポ)
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

export function CardBackSasa({ size = "md", fullWidth = false, className }: Props) {
  const sizeCls = fullWidth
    ? cn("w-full", MOCK_FULLWIDTH_HEIGHT[size])
    : MOCK_SIZE_CLASS[size];
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md border-2 border-amber-400/80 shrink-0",
        "bg-gradient-to-br from-emerald-950 via-green-900 to-emerald-950",
        sizeCls,
        className,
      )}
      aria-label="伏せられたカード"
    >
      {/* 笹葉パターン (SVG タイル repeat) */}
      <div className="absolute inset-0 card-back-mock-sasa-pattern" aria-hidden />
      {/* 斜め閃光 sheen */}
      <div
        className="absolute inset-0 card-back-mock-sasa-shine pointer-events-none"
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
