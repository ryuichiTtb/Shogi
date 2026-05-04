// Issue #82: 二手指し (double_move) カード使用中の上端バナー。
// CardTargetingNotice (card-play-dialog.tsx:164) と同じパターン。
//
// movesLeft=2 のとき: 「あと2手」表示 + 「キャンセル」ボタン
// movesLeft=1 のとき: 「あと1手」表示 + 「1手目を戻す」ボタン + 「キャンセル」ボタン
//
// 「キャンセル」(新仕様 / Issue #82): カード使用自体を取り消し、カードを手札に戻す。
// 1手目を選択済みでも全部巻き戻して元の状態に戻る。マナも消費前に戻る。
// → 「カード使用 → カード使用演出」の確定タイミングを 2手目完了時に遅延しているため可能。
//
// 表示条件:
// - state.doubleMove !== null
// - 演出中 (isPlayingCard / isCheckBreakAnimating) は親側で非表示にする想定だが
//   ここでもボタンの disabled 制御で防御的にロック。

import { Button } from "@/components/ui/button";

interface DoubleMoveNoticeProps {
  movesLeft: 1 | 2;
  canUndoFirst: boolean; // movesLeft=1 + game active + 演出なし のとき true
  canCancel: boolean;    // movesLeft 不問 + game active + 演出なし のとき true
  onUndoFirst: () => void;
  onCancel: () => void;
}

export function DoubleMoveNotice({
  movesLeft,
  canUndoFirst,
  canCancel,
  onUndoFirst,
  onCancel,
}: DoubleMoveNoticeProps) {
  const message = movesLeft === 2 ? "あと2手 指せます" : "あと1手";

  return (
    <div
      className="fixed inset-x-0 top-0 z-40 bg-violet-500 text-violet-50 px-3 py-2 shadow-md flex items-center gap-2"
      style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
      role="status"
    >
      <span className="text-xl shrink-0">⚡</span>
      <div className="flex-1 min-w-0">
        <div className="font-bold text-sm">二手指し</div>
        <div className="text-xs">{message}</div>
      </div>
      {movesLeft === 1 && (
        <Button
          size="sm"
          variant="secondary"
          onClick={onUndoFirst}
          disabled={!canUndoFirst}
        >
          1手目を戻す
        </Button>
      )}
      <Button
        size="sm"
        variant="outline"
        onClick={onCancel}
        disabled={!canCancel}
      >
        キャンセル
      </Button>
    </div>
  );
}
