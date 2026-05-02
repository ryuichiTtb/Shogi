// 将棋駒の五角形シルエット (SVG)。複数のモック案で共有する。
//   - 上が尖り、左右側面が下に向けてやや外向きに広がる伝統的な末広がり駒形
//     (肩の幅 < 底辺の幅)
//   - viewBox 100×120 (= 駒の縦長比 5:6)
//
// 将来 (Issue #110 以降) ユーザー設定でアイコンを差し替えられるようにするため、
// シルエット内にカスタムシンボルを描画できる children スロットを公開している。
// 現状のモックは内部に何も入れず駒形シルエットのみで判別される前提。

import { cn } from "@/lib/utils";

interface KomaShapeProps {
  className?: string;
  fillClassName?: string;
  strokeClassName?: string;
  strokeWidth?: number;
  // 駒シルエット内部に重ねる SVG 要素 (将来のアイコン差し替え用スロット)。
  children?: React.ReactNode;
}

// 末広がりの将棋駒形 (浅め)。
//   上頂点 (50,6) → 右肩 (76,28) → 右下 (84,114) → 左下 (16,114) → 左肩 (24,28)
//   肩幅 52 / 底辺 68 → 下に向けて約 1.31 倍の浅い末広がり。
//   側面の傾斜は片側 8px / 86px ≒ 5.3°。
const KOMA_PATH = "M50 6 L76 28 L84 114 L16 114 L24 28 Z";

export function KomaShape({
  className,
  fillClassName,
  strokeClassName,
  strokeWidth = 2,
  children,
}: KomaShapeProps) {
  return (
    <svg
      viewBox="0 0 100 120"
      className={cn("block", className)}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      <path
        d={KOMA_PATH}
        className={cn(fillClassName, strokeClassName)}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
      {children}
    </svg>
  );
}
