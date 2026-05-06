// Issue #110: ユーザーが選べるカード裏面スタイルの定義。
// 新スタイル追加時はここに 1 行足し、CardBack ラッパーから自動的に使えるようになる。
import type { ComponentType } from "react";

import {
  DEFAULT_CARD_BACK_STYLE,
  isValidCardBackStyle,
  type CardBackStyle,
} from "@/lib/user-preferences";
import { CardBackEmblem } from "./back-emblem";
import { CardBackSeigaiha } from "./back-seigaiha";
import { CardBackMinimal } from "./back-minimal";
import type { MockSize } from "./sizes";

export { DEFAULT_CARD_BACK_STYLE, isValidCardBackStyle };
export type { CardBackStyle };

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
  seigaiha: {
    label: "波",
    description: "金箔の波柄が広がる、和の落ち着きある一品。",
    Component: CardBackSeigaiha,
  },
  emblem: {
    label: "煌",
    description: "金色の斜線に閃光がきらめく、華やかなデザイン。",
    Component: CardBackEmblem,
  },
  minimal: {
    label: "漆",
    description: "黒地に金の輝きをあしらった、上品でシックな佇まい。",
    Component: CardBackMinimal,
  },
};

// 設定画面はこの順序で並べる (デフォルトを先頭に)。
export const CARD_BACK_STYLE_LIST: CardBackStyle[] = ["seigaiha", "emblem", "minimal"];
