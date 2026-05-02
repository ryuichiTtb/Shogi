// Issue #110: カード裏面モック検討用の共通サイズ定義。
// card-view.tsx の SIZE_CLASS と同一サイズに揃える (採用案決定後に共通化予定)。
import type { CardViewSize } from "@/components/game/card-shogi/card-view";

export type MockSize = CardViewSize;

export const MOCK_SIZE_CLASS: Record<MockSize, string> = {
  sm: "w-12 h-16",
  md: "w-32 h-[80px]",
  lg: "w-40 h-24",
  xl: "w-[36rem] h-[22rem]",
};

export const MOCK_FULLWIDTH_HEIGHT: Record<MockSize, string> = {
  sm: "h-16",
  md: "h-[80px]",
  lg: "h-24",
  xl: "h-[22rem]",
};

// 中央モチーフ(駒シルエット)の代表サイズ。
// xl はドロー演出用 576×352 なのでぐっと拡大する。
export const MOCK_CENTER_SHAPE_CLASS: Record<MockSize, string> = {
  sm: "w-7 h-9",
  md: "w-10 h-12",
  lg: "w-12 h-14",
  xl: "w-56 h-64",
};
