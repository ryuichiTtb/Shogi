// Issue #110: ユーザーが選べるカード裏面スタイルの定義。
// 新スタイル追加時はここに 1 行足し、CardBack ラッパーから自動的に使えるようになる。
import type { ComponentType } from "react";

import { CardBackEmblem } from "./back-emblem";
import { CardBackSeigaiha } from "./back-seigaiha";
import { CardBackMinimal } from "./back-minimal";
import { CardBackKokeA } from "./back-koke-a";
import { CardBackKokeB } from "./back-koke-b";
import { CardBackKokeC } from "./back-koke-c";
import { CardBackSasa } from "./back-sasa";
import type { MockSize } from "./sizes";

export type CardBackStyle =
  | "emblem"
  | "seigaiha"
  | "minimal"
  | "kokeA"
  | "kokeB"
  | "kokeC"
  | "sasa";

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
  // --- 緑系候補 (検討中: 苔は 3 variant から 1 案を採用後、未採用 2 案を削除) ---
  kokeA: {
    label: "苔 (細密散らし)",
    description: "深緑地に金の松葉を細やかに散らす、苔庭を思わせる風雅な意匠。",
    Component: CardBackKokeA,
  },
  kokeB: {
    label: "苔 (松葉菱)",
    description: "深緑地に金の松葉菱を据えた、家紋のように端整な佇まい。",
    Component: CardBackKokeB,
  },
  kokeC: {
    label: "苔 (五葉松)",
    description: "深緑地に金の五葉松の房を散らす、深い杉林の趣。",
    Component: CardBackKokeC,
  },
  sasa: {
    label: "翠",
    description: "深緑地に金の笹葉が舞う、涼やかで爽やかなデザイン。",
    Component: CardBackSasa,
  },
};

// 設定画面はこの順序で並べる (デフォルトを先頭に)。
export const CARD_BACK_STYLE_LIST: CardBackStyle[] = [
  "seigaiha",
  "emblem",
  "minimal",
  "kokeA",
  "kokeB",
  "kokeC",
  "sasa",
];

const VALID_STYLES: ReadonlySet<string> = new Set<CardBackStyle>([
  "emblem",
  "seigaiha",
  "minimal",
  "kokeA",
  "kokeB",
  "kokeC",
  "sasa",
]);

export function isValidCardBackStyle(value: unknown): value is CardBackStyle {
  return typeof value === "string" && VALID_STYLES.has(value);
}
