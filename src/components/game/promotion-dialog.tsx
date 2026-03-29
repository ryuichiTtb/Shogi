"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PIECE_DEF_MAP } from "@/lib/shogi/variants/standard";
import { ShogiPiece } from "./shogi-piece";
import type { Move, Player } from "@/lib/shogi/types";

interface PromotionDialogProps {
  move: Move | null;
  playerColor: Player;
  onConfirm: (promote: boolean) => void;
  onCancel: () => void;
}

export function PromotionDialog({ move, playerColor, onConfirm, onCancel }: PromotionDialogProps) {
  if (!move) return null;

  const def = PIECE_DEF_MAP.get(move.piece);
  const promotedType = def?.promotesTo;

  return (
    <Dialog open={!!move} onOpenChange={(open) => { if (!open) onCancel(); }}>
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
            <div className="w-20 h-20">
              {promotedType ? (
                <ShogiPiece piece={{ type: promotedType, owner: move.player }} isLarge playerColor={playerColor} />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-2xl font-bold text-red-700">成</div>
              )}
            </div>
            <span className="text-sm font-medium">成る</span>
          </button>

          {/* 成らない */}
          <button
            onClick={() => onConfirm(false)}
            className="flex flex-col items-center gap-2 p-4 rounded-lg border border-amber-400 bg-amber-50 hover:bg-amber-100 transition-colors cursor-pointer"
          >
            <div className="w-20 h-20">
              <ShogiPiece piece={{ type: move.piece, owner: move.player }} isLarge playerColor={playerColor} />
            </div>
            <span className="text-sm font-medium">成らない</span>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
