// Issue #110: ユーザーが選べるカード裏面スタイルの定義。
// 新スタイル追加時はここに 1 行足し、CardBack ラッパーから自動的に使えるようになる。
import type { ComponentType } from "react";

import { CardBackEmblem } from "./back-emblem";
import { CardBackSeigaiha } from "./back-seigaiha";
import { CardBackMinimal } from "./back-minimal";
import { CardBackKoke } from "./back-koke";
import { CardBackKurenai } from "./back-kurenai";
import type { MockSize } from "./sizes";

export type CardBackStyle =
  | "seigaiha"
  | "koke"
  | "emblem"
  | "minimal"
  | "kurenai";

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
  seigaiha: {
    label: "波",
    description: "深紺の海原に金箔の波柄が広がる、悠久の大海を思わせる和の意匠。",
    Component: CardBackSeigaiha,
  },
  koke: {
    label: "苔",
    description: "深緑の苔地に金の五葉松の房がほろりと落ちる、静謐な杉林の趣。",
    Component: CardBackKoke,
  },
  emblem: {
    label: "煌",
    description: "深紺地に金の斜光が閃いてきらめく、華やぎを宿した玉将の意匠。",
    Component: CardBackEmblem,
  },
  minimal: {
    label: "漆",
    description: "漆黒に金の溜まり光がにじむ、上品でシックな佇まい。",
    Component: CardBackMinimal,
  },
  kurenai: {
    label: "紅",
    description: "深紅の漆地に金の葉文が舞い散る、雅やかな宴を思わせる華やぎの意匠。",
    Component: CardBackKurenai,
  },
};

// 設定画面はこの順序で並べる。
export const CARD_BACK_STYLE_LIST: CardBackStyle[] = [
  "seigaiha",
  "koke",
  "emblem",
  "minimal",
  "kurenai",
];

const VALID_STYLES: ReadonlySet<string> = new Set<CardBackStyle>([
  "seigaiha",
  "koke",
  "emblem",
  "minimal",
  "kurenai",
]);

export function isValidCardBackStyle(value: unknown): value is CardBackStyle {
  return typeof value === "string" && VALID_STYLES.has(value);
}
