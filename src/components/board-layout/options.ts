// Issue #177: 将棋盤の見た目 (盤面マス背景) のオプション。
// プレビュー検証 (12 種) の結果、ユーザーが採用したのは以下 4 種。
// 将来追加する場合は public/img/wood/ に素材を置き、ここに追記する。

export type BoardLayoutId = "light-1" | "light-4" | "dark-1" | "dark-4";

export interface BoardLayout {
  id: BoardLayoutId;
  name: string;
  url: string;
}

export const BOARD_LAYOUTS: readonly BoardLayout[] = [
  { id: "light-1", name: "ライト 01", url: "/img/wood/mokume_light01.png" },
  { id: "light-4", name: "ライト 04", url: "/img/wood/mokume_light04.png" },
  { id: "dark-1", name: "ダーク 01", url: "/img/wood/mokume_dark01.png" },
  { id: "dark-4", name: "ダーク 04", url: "/img/wood/mokume_dark04.png" },
];

export const DEFAULT_BOARD_LAYOUT_ID: BoardLayoutId = "light-4";

export function findBoardLayout(id: string): BoardLayout {
  return (
    BOARD_LAYOUTS.find((l) => l.id === id) ??
    BOARD_LAYOUTS.find((l) => l.id === DEFAULT_BOARD_LAYOUT_ID)!
  );
}

export function isBoardLayoutId(value: unknown): value is BoardLayoutId {
  return typeof value === "string" && BOARD_LAYOUTS.some((l) => l.id === value);
}
