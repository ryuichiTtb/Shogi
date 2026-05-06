// Issue #110: ユーザーが選べるカード裏面スタイルの定義。
// 新スタイル追加時はここに 1 行足し、CardBack ラッパーから自動的に使えるようになる。
import type { ComponentType } from "react";

import { CardBackEmblem } from "./back-emblem";
import { CardBackSeigaiha } from "./back-seigaiha";
import { CardBackMinimal } from "./back-minimal";
import { CardBackMatsuba } from "./back-matsuba";
import { CardBackMori } from "./back-mori";
import { CardBackSasa } from "./back-sasa";
import type { MockSize } from "./sizes";

export type CardBackStyle =
  | "emblem"
  | "seigaiha"
  | "minimal"
  | "matsuba"
  | "mori"
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
  // --- 緑系候補 (検討中: 採用 1 案決定後、未採用案は削除) ---
  matsuba: {
    label: "松葉",
    description: "深緑地に金の松葉文を散らした、新春の松飾りを思わせる一品。",
    Component: CardBackMatsuba,
  },
  mori: {
    label: "杜",
    description: "深い森の暗がりに翡翠の木洩れ日が差す、静謐なミニマル。",
    Component: CardBackMori,
  },
  sasa: {
    label: "笹",
    description: "深緑地に翠の笹葉が舞う、涼やかで爽やかなデザイン。",
    Component: CardBackSasa,
  },
};

// 設定画面はこの順序で並べる (デフォルトを先頭に)。
export const CARD_BACK_STYLE_LIST: CardBackStyle[] = [
  "seigaiha",
  "emblem",
  "minimal",
  "matsuba",
  "mori",
  "sasa",
];

const VALID_STYLES: ReadonlySet<string> = new Set<CardBackStyle>([
  "emblem",
  "seigaiha",
  "minimal",
  "matsuba",
  "mori",
  "sasa",
]);

export function isValidCardBackStyle(value: unknown): value is CardBackStyle {
  return typeof value === "string" && VALID_STYLES.has(value);
}
