// Issue #79: 個別音源調整画面の摸擬 UI 共通型 + props。
// resetKey は使わない (親で <Mock key={resetKey} /> で remount する設計)。

export interface MockProps {
  /** 操作トリガー時に親が呼ぶ player.playFrom(effectivePath) のラッパ */
  onTrigger: () => void;
}

export type MockComponent = React.ComponentType<MockProps>;
