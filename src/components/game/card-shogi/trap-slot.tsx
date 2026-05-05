"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import type { CardInstance, TrapInstance } from "@/lib/shogi/cards/types";
import { CardView } from "./card-view";

interface TrapSlotProps {
  trap: TrapInstance | null;
  faceDown?: boolean;
  size?: "sm" | "md" | "lg";
  // true のとき横幅を親に合わせる(縦並び・中央揃えで使用)
  fullWidth?: boolean;
  // true のとき横長表示(相手細バー等で縦幅圧縮)
  horizontal?: boolean;
}

const SIZE_CLASS = {
  // sm は CardView の sm (w-12 h-16) と寸法を揃え、相手手札 stack や山札と
  // 同じカードサイズで並べられるようにする (Issue #105 モバイル相手バー)。
  sm: "w-12 h-16 text-[10px]",
  md: "w-16 h-20 text-[13px]",
  lg: "w-20 h-24 text-sm",
};

export const TrapSlot = memo(function TrapSlot({
  trap,
  faceDown = false,
  size = "md",
  fullWidth = false,
  horizontal = false,
}: TrapSlotProps) {
  // 設置済みかつ表向き: 該当トラップカードのデザインそのもので表示する (Issue #105)。
  // CardView を inactive で描画し、効果説明は hideDescription、ラベルは hideTrapBadge、
  // レイアウトは compactIconLayout (アイコン左上+カード名複数行) で省スペース化する。
  // 非 fullWidth + 非 horizontal のときは元 TrapSlot 同等の枠サイズ (SIZE_CLASS) に
  // 固定し、内部 CardView は fullWidth=true で wrapper 幅に追従させる。
  // CardView 自然サイズ (md=128px) のままだとモバイル下端の 3 カラムレイアウトで
  // 隣接要素 (マナゲージ等) を圧迫してしまうため。
  if (trap && !faceDown) {
    const cardInstance: CardInstance = { instanceId: trap.instanceId, defId: trap.defId };
    if (!fullWidth && !horizontal) {
      return (
        <div data-card-shogi-trap className={cn("shrink-0", SIZE_CLASS[size])}>
          <CardView
            card={cardInstance}
            size={size}
            fullWidth
            hideDescription
            hideTrapBadge
            compactIconLayout
            inactive
          />
        </div>
      );
    }
    return (
      <div data-card-shogi-trap className={cn((fullWidth || horizontal) && "w-full", horizontal && "h-full")}>
        <CardView
          card={cardInstance}
          size={size}
          fullWidth={fullWidth || horizontal}
          hideDescription
          hideTrapBadge
          compactIconLayout
          inactive
        />
      </div>
    );
  }

  // 横長モード: 2行構成 (⚠ / TRAP) で横幅を圧縮、h-full で親に追従
  if (horizontal) {
    const wrapperBase = cn("rounded-md border-2 px-1.5 py-0.5 h-full flex flex-col items-center justify-center shrink-0 leading-tight", fullWidth ? "w-full" : "w-auto");
    if (!trap) {
      return (
        <div
          data-card-shogi-trap
          className={cn(wrapperBase, "border-dashed border-muted-foreground/40 bg-muted/30")}
          aria-label="トラップ未セット"
        >
          <span className="text-sm opacity-50 leading-none" aria-hidden>⚠</span>
          <span className="text-[10px] text-muted-foreground font-bold leading-none mt-0.5">TRAP</span>
        </div>
      );
    }
    return (
      <div
        data-card-shogi-trap
        className={cn(wrapperBase, "border-purple-700 bg-gradient-to-br from-purple-700 to-purple-900 text-white/80 font-bold")}
        aria-label="トラップセット済(裏向き)"
      >
        <span className="text-sm leading-none">⚠</span>
        <span className="text-[10px] leading-none mt-0.5">TRAP</span>
      </div>
    );
  }

  const sizeClass = fullWidth
    ? cn(
        "w-full",
        size === "sm" ? "h-16 text-[10px]" : size === "md" ? "h-20 text-[13px]" : "h-24 text-sm",
      )
    : SIZE_CLASS[size];

  if (!trap) {
    return (
      <div
        data-card-shogi-trap
        className={cn(
          "rounded-md border-2 border-dashed border-muted-foreground/40 bg-muted/30",
          "flex flex-col items-center justify-center shrink-0",
          sizeClass,
        )}
        aria-label="トラップ未セット"
      >
        <span className="text-xl opacity-50 leading-none">⚠</span>
        <span className="text-[10px] text-muted-foreground font-bold mt-1 leading-none">TRAP</span>
      </div>
    );
  }

  // ここに来るのは faceDown=true のケース (相手側のセット済みトラップ表示)
  return (
    <div
      data-card-shogi-trap
      className={cn(
        "rounded-md border-2 border-purple-700 bg-gradient-to-br from-purple-700 to-purple-900",
        "flex items-center justify-center text-white/80 font-bold shrink-0",
        sizeClass,
      )}
      aria-label="トラップセット済(裏向き)"
    >
      <span className="text-3xl">⚠</span>
    </div>
  );
});
