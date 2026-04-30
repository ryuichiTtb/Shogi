"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { PendingCard } from "@/lib/shogi/cards/types";
import { CARD_DEFS } from "@/lib/shogi/cards/definitions";

interface CardPlayDialogProps {
  pendingCard: PendingCard | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function CardPlayDialog({ pendingCard, onConfirm, onCancel }: CardPlayDialogProps) {
  // selectTarget フェーズではダイアログを閉じる(盤面でターゲットを選ぶため)
  if (!pendingCard || pendingCard.phase === "selectTarget") return null;
  const def = CARD_DEFS[pendingCard.instance.defId];

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {def.kind === "trap" ? "トラップをセット" : "カードを使用"} —{" "}
            <span className="text-primary">{def.name}</span>
          </DialogTitle>
          <DialogDescription className="text-sm whitespace-pre-line">
            {`消費マナ: ${def.cost}\n${def.description}`}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="flex-row gap-2 justify-end">
          <Button variant="outline" onClick={onCancel}>
            キャンセル
          </Button>
          <Button onClick={onConfirm}>
            {def.kind === "trap" ? "セットする" : "使用する"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface CardTargetingNoticeProps {
  pendingCard: PendingCard | null;
  onCancel: () => void;
}

// selectTarget フェーズの時に画面上端に出すバナー
export function CardTargetingNotice({ pendingCard, onCancel }: CardTargetingNoticeProps) {
  if (!pendingCard || pendingCard.phase !== "selectTarget") return null;
  const def = CARD_DEFS[pendingCard.instance.defId];
  const targetText =
    def.targeting === "ownPiece"
      ? "盤面の自分の駒を選んでください"
      : def.targeting === "enemyPiece"
        ? "盤面の相手の駒を選んでください"
        : "盤面のマスを選んでください";

  return (
    <div
      className="fixed inset-x-0 top-0 z-40 bg-amber-500 text-amber-950 px-3 py-2 shadow-md flex items-center gap-2"
      style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
      role="status"
    >
      <span className="text-xl shrink-0">🎯</span>
      <div className="flex-1 min-w-0">
        <div className="font-bold text-sm">{def.name}</div>
        <div className="text-xs">{targetText}</div>
      </div>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        中止
      </Button>
    </div>
  );
}
