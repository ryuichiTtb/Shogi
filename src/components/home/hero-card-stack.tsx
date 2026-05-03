// Issue #117: 新ホームの Hero ビジュアル。
// 選択中の card-back スタイルで「3 枚扇状に重ねた山札」を表示し、
// クリックで /card-design へ遷移してカード裏面を変更できる。
//
// SSR/CSR 整合のため、ハイドレーション完了 (mounted) までは固定スタイル
// (DEFAULT_CARD_BACK_STYLE) で描画し、その後ユーザー設定値に切り替える。
// CardBackProvider が同パターンで動くため、視覚切り替えは滑らか。
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";

import { useCardBackStyle } from "@/components/card-back/card-back-provider";
import {
  CARD_BACK_STYLES,
  DEFAULT_CARD_BACK_STYLE,
  type CardBackStyle,
} from "@/components/card-back/style-options";
import { cn } from "@/lib/utils";

interface HeroCardStackProps {
  className?: string;
}

export function HeroCardStack({ className }: HeroCardStackProps) {
  const { style: liveStyle } = useCardBackStyle();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  // ハイドレーション前は default 描画 (SSR と一致させる)
  const style: CardBackStyle = mounted ? liveStyle : DEFAULT_CARD_BACK_STYLE;
  const Component = CARD_BACK_STYLES[style].Component;
  const styleLabel = CARD_BACK_STYLES[style].label;

  const reduce = useReducedMotion();

  return (
    <Link
      href="/card-design"
      aria-label="カードデザインを変更する"
      className={cn(
        "group relative inline-flex items-center justify-center select-none",
        "transition-transform active:scale-[0.98]",
        className,
      )}
    >
      {/* 3 枚スタック: 中央が前、左右が斜めに重なる */}
      <div className="relative w-40 h-24 sm:w-48 sm:h-28">
        {/* 左 (奥) */}
        <div
          className="absolute top-0 left-0 origin-bottom-right"
          style={{ transform: "translate(-22%, 4%) rotate(-9deg)" }}
        >
          <Component size="md" className="opacity-90 shadow-md" />
        </div>
        {/* 右 (奥) */}
        <div
          className="absolute top-0 right-0 origin-bottom-left"
          style={{ transform: "translate(22%, 4%) rotate(9deg)" }}
        >
          <Component size="md" className="opacity-90 shadow-md" />
        </div>
        {/* 中央 (手前、フロート) */}
        <div
          className={cn(
            "absolute top-0 left-1/2 -translate-x-1/2",
            !reduce && "animate-hero-card-float",
          )}
        >
          <Component size="md" className="shadow-xl" />
        </div>
      </div>

      {/* スタイル名 (ハイドレーション後にだけ表示して FOUC 回避) */}
      <span className="sr-only">現在の裏面スタイル: {mounted ? styleLabel : ""}</span>
    </Link>
  );
}
