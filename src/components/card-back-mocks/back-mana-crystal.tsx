// 案 C: マナクリスタル
//   - 深紫グラデ + 💎 菱形格子パターン
//   - 中央: 大きな 💎、背後に光の渦
//   - アニメ: 中央 💎 呼吸 + 背景渦のゆっくり回転
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

export function CardBackManaCrystal({ size = "md", fullWidth = false, className }: Props) {
  const sizeCls = fullWidth
    ? cn("w-full", MOCK_FULLWIDTH_HEIGHT[size])
    : MOCK_SIZE_CLASS[size];
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md border-2 border-violet-500/80 shrink-0",
        "bg-gradient-to-br from-violet-950 via-indigo-950 to-slate-950",
        sizeCls,
        className,
      )}
      aria-label="伏せられたカード"
    >
      {/* 背景の光の渦 (回転) */}
      <div className="absolute inset-0 card-back-mock-mana-vortex" aria-hidden />
      {/* 💎 格子パターン */}
      <div className="absolute inset-0 card-back-mock-mana-grid pointer-events-none" aria-hidden />
      {/* 中央 💎 (呼吸) */}
      <div
        className={cn(
          "absolute inset-0 flex items-center justify-center",
          "card-back-mock-mana-breathe",
          MOCK_CENTER_TEXT_CLASS[size],
        )}
        aria-hidden
      >
        <span className="drop-shadow-[0_0_6px_rgba(167,139,250,0.7)]">💎</span>
      </div>
    </div>
  );
}
