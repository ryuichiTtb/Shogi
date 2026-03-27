"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PIECE_DEF_MAP } from "@/lib/shogi/variants/standard";
import type { Move } from "@/lib/shogi/types";

interface PromotionDialogProps {
  move: Move | null;
  onConfirm: (promote: boolean) => void;
}

export function PromotionDialog({ move, onConfirm }: PromotionDialogProps) {
  if (!move) return null;

  const def = PIECE_DEF_MAP.get(move.piece);
  const promotedType = def?.promotesTo;
  const promotedDef = promotedType ? PIECE_DEF_MAP.get(promotedType) : null;

  return (
    <Dialog open={!!move} onOpenChange={() => {}}>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle>成りますか？</DialogTitle>
        </DialogHeader>

        <div className="flex gap-4 justify-center py-4">
          {/* 成る */}
          <button
            onClick={() => onConfirm(true)}
            className="flex flex-col items-center gap-2 p-4 rounded-lg border border-amber-400 bg-amber-50 hover:bg-amber-100 transition-colors cursor-pointer"
          >
            <div className="w-14 h-14 flex items-center justify-center rounded bg-amber-100 border border-amber-400">
              <span className="text-2xl font-bold text-red-700">
                {promotedDef?.kanji ?? "成"}
              </span>
            </div>
            <span className="text-sm font-medium">成る</span>
          </button>

          {/* 成らない */}
          <button
            onClick={() => onConfirm(false)}
            className="flex flex-col items-center gap-2 p-4 rounded-lg border border-amber-400 bg-amber-50 hover:bg-amber-100 transition-colors cursor-pointer"
          >
            <div className="w-14 h-14 flex items-center justify-center rounded bg-amber-100 border border-amber-400">
              <span className="text-2xl font-bold text-gray-900">
                {def?.kanji ?? move.piece}
              </span>
            </div>
            <span className="text-sm font-medium">成らない</span>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
