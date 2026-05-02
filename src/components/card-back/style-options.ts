// Issue #110: ユーザーが選べるカード裏面スタイルの定義。
// 新スタイル追加時はここに 1 行足し、CardBack ラッパーから自動的に使えるようになる。
import type { ComponentType } from "react";

import { CardBackEmblem } from "./back-emblem";
import { CardBackSeigaiha } from "./back-seigaiha";
import { CardBackMinimal } from "./back-minimal";
import type { MockSize } from "./sizes";

export type CardBackStyle = "emblem" | "seigaiha" | "minimal";

// デフォルト = 青海波 (Issue #110 で採用)
export const DEFAULT_CARD_BACK_STYLE: CardBackStyle = "seigaiha";

export interface CardBackComponentProps {
  size?: MockSize;
  fullWidth?: boolean;
  className?: string;
}

interface CardBackStyleEntry {
  label: string;
  description: string;
  Component: ComponentType<CardBackComponentProps>;
}

export const CARD_BACK_STYLES: Record<CardBackStyle, CardBackStyleEntry> = {
  emblem: {
    label: "玉将エンブレム",
    description: "深紺グラデ + 45° の金色斜線。閃光が左→右に通過する。",
    Component: CardBackEmblem,
  },
  seigaiha: {
    label: "青海波",
    description: "藍ベースに青海波の和柄。薄ゴールドの sheen が通過する。",
    Component: CardBackSeigaiha,
  },
  minimal: {
    label: "黒漆ミニマル",
    description: "黒ベース + 左上の金ラジアル。控えめで上質な印象。",
    Component: CardBackMinimal,
  },
};

export const CARD_BACK_STYLE_LIST: CardBackStyle[] = ["emblem", "seigaiha", "minimal"];

export function isValidCardBackStyle(value: unknown): value is CardBackStyle {
  return value === "emblem" || value === "seigaiha" || value === "minimal";
}
