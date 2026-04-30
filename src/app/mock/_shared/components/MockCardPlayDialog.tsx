"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { CardInstance } from "../types";
import { MOCK_CARD_DEFS } from "../dummy-data";

interface MockCardPlayDialogProps {
  pendingCard: { instance: CardInstance; phase: "selectTarget" | "confirm" } | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function MockCardPlayDialog({ pendingCard, onConfirm, onCancel }: MockCardPlayDialogProps) {
  if (!pendingCard) return null;
  const def = MOCK_CARD_DEFS[pendingCard.instance.defId];

  return (
    <Dialog open={!!pendingCard} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {def.kind === "trap" ? "トラップをセット" : "カードを使用"} —{" "}
            <span className="text-primary">{def.name}</span>
          </DialogTitle>
          <DialogDescription className="text-sm">
            消費マナ: <span className="font-bold">{def.cost}</span>
            <br />
            {def.description}
          </DialogDescription>
        </DialogHeader>

        {pendingCard.phase === "selectTarget" && (
          <div className="rounded-md border bg-amber-50 dark:bg-amber-950/30 p-3 text-xs">
            <strong>※モックでは未実装:</strong> 本実装では盤面上の対象を選択する誘導が入ります。
          </div>
        )}

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
