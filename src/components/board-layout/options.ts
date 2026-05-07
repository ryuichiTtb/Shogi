// Issue #177: 将棋盤の見た目 (盤面マス背景) のオプション。
// プレビュー検証 (12 種) の結果、ユーザーが採用したのは以下 4 種。
// 将来追加する場合は public/img/wood/ に素材を置き、ここに追記する。
//
// 型 (BoardLayoutId / DEFAULT_BOARD_LAYOUT_ID / isValidBoardLayoutId) は
// サーバアクション側でも利用するため lib/user-preferences.ts に集約している。

import {
  DEFAULT_BOARD_LAYOUT_ID,
  isValidBoardLayoutId,
  type BoardLayoutId,
} from "@/lib/user-preferences";

export {
  DEFAULT_BOARD_LAYOUT_ID,
  isValidBoardLayoutId,
  type BoardLayoutId,
};

export interface BoardLayout {
  id: BoardLayoutId;
  name: string;
  url: string;
  // 盤線・中央 4 隅の星点に使う色。
  // light-* は明るい木目の上で濃く出るよう濃焦茶、
  // dark-* は暗い木目の上でも識別できるよう一段薄い焦茶を採用する (Issue #177)。
  lineColor: string;
}

export const BOARD_LAYOUTS: readonly BoardLayout[] = [
  {
    id: "light-1",
    name: "ライト 01",
    url: "/img/wood/mokume_light01.png",
    lineColor: "#3a1f0a",
  },
  {
    id: "light-2",
    name: "ライト 02",
    url: "/img/wood/mokume_light02.png",
    lineColor: "#3a1f0a",
  },
  {
    id: "dark-1",
    name: "ダーク 01",
    url: "/img/wood/mokume_dark01.png",
    lineColor: "#8a5e35",
  },
  {
    id: "dark-2",
    name: "ダーク 02",
    url: "/img/wood/mokume_dark02.png",
    lineColor: "#8a5e35",
  },
];

export function findBoardLayout(id: string): BoardLayout {
  return (
    BOARD_LAYOUTS.find((l) => l.id === id) ??
    BOARD_LAYOUTS.find((l) => l.id === DEFAULT_BOARD_LAYOUT_ID)!
  );
}
