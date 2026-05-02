// 将棋駒の五角形シルエット (SVG)。複数のモック案で共有する。
//   - 上が尖り、下が長方形の伝統的な駒形
//   - viewBox 100×120 (= 駒の縦長比 5:6)

import { cn } from "@/lib/utils";

interface KomaShapeProps {
  className?: string;
  fillClassName?: string;
  strokeClassName?: string;
  strokeWidth?: number;
  // 中に描く文字 ("玉" "将" "歩" 等)
  glyph?: string;
  glyphClassName?: string;
}

export function KomaShape({
  className,
  fillClassName,
  strokeClassName,
  strokeWidth = 2,
  glyph,
  glyphClassName,
}: KomaShapeProps) {
  return (
    <svg
      viewBox="0 0 100 120"
      className={cn("block", className)}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      <path
        d="M50 4 L84 30 L84 116 L16 116 L16 30 Z"
        className={cn(fillClassName, strokeClassName)}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
      {glyph && (
        <text
          x="50"
          y="78"
          textAnchor="middle"
          className={cn(
            "select-none",
            glyphClassName,
          )}
          style={{
            fontFamily: "'Yuji Boku', 'Noto Sans JP', serif",
            fontSize: 56,
            fontWeight: 700,
          }}
        >
          {glyph}
        </text>
      )}
    </svg>
  );
}
