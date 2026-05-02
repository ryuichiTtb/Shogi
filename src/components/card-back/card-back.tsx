// カード裏面の共通エントリーポイント。
//   - style 未指定なら CardBackProvider から現在のユーザー設定を取得
//   - style 指定時は明示的にそのスタイルを描画 (設定画面のプレビュー等)
//   - dimmed は山札の相手番非活性表示用 (brightness を落として opacity も少し下げる)
"use client";

import { cn } from "@/lib/utils";

import { useCardBackStyle } from "./card-back-provider";
import { CARD_BACK_STYLES, type CardBackStyle } from "./style-options";
import type { MockSize } from "./sizes";

interface CardBackProps {
  size?: MockSize;
  fullWidth?: boolean;
  // 明示指定が無ければ Context (= ユーザー設定) を参照
  style?: CardBackStyle;
  // 山札非活性 (相手番中など)
  dimmed?: boolean;
  className?: string;
}

export function CardBack({
  size = "md",
  fullWidth = false,
  style,
  dimmed = false,
  className,
}: CardBackProps) {
  const { style: ctxStyle } = useCardBackStyle();
  const resolved = style ?? ctxStyle;
  const Component = CARD_BACK_STYLES[resolved].Component;
  return (
    <Component
      size={size}
      fullWidth={fullWidth}
      className={cn(dimmed && "brightness-60 opacity-85", className)}
    />
  );
}
