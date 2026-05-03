"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { PIECE_DEF_MAP } from "@/lib/shogi/variants/standard";
import { ShogiPiece } from "./shogi-piece";
import type { Move, Player } from "@/lib/shogi/types";

interface PromotionDialogProps {
  move: Move | null;
  playerColor: Player;
  onConfirm: (promote: boolean) => void;
  onCancel: () => void;
}

// Step S6 (Issue #107): 駒を指した直後に成り/不成りダイアログが開いたとき、
// 同じタップが (touchend → 合成 click や、ダイアログが finger 位置に重なる
// などで) 即時にダイアログのボタンへ伝わって意図しない選択がされる事故を
// 防ぐためのクールダウン (ms)。300ms あれば手を離して再タップできる。
const TAP_COOLDOWN_MS = 300;

export function PromotionDialog({ move, playerColor, onConfirm, onCancel }: PromotionDialogProps) {
  // ダイアログが開いた直後はクリックを受け付けない期間を設ける。
  // 同期 setState を effect 内で呼ばないために「クールダウンを通過した move」を
  // 保持する派生 state パターンにし、現在の move 参照と一致するときのみ
  // 入力受付可とする。move が変わると一致しなくなり自動的に false に戻る。
  const [enabledForMove, setEnabledForMove] = useState<Move | null>(null);
  useEffect(() => {
    if (!move) return;
    const target = move;
    const t = setTimeout(() => setEnabledForMove(target), TAP_COOLDOWN_MS);
    return () => clearTimeout(t);
  }, [move]);
  const inputReady = move !== null && enabledForMove === move;

  if (!move) return null;

  const def = PIECE_DEF_MAP.get(move.piece);
  const promotedType = def?.promotesTo;

  // クールダウン中は pointer-events: none と aria-disabled で全クリック/タップを
  // 無視。disabled は「成る/成らない」自体を無効化するためあえて使わない (ボタン
  // としての見た目は通常のままにし、押せたかのような誤認を避ける)。
  // 注: pointer-events なしのため :active も発火せずタップ感は出ないが、これは
  // 意図的 (誤発火防止が最優先)。
  const buttonGuard = !inputReady ? "pointer-events-none" : "";

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
            aria-disabled={!inputReady}
            className={cn(
              "flex flex-col items-center gap-2 p-4 rounded-lg border border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/30 hover:bg-amber-100 dark:hover:bg-amber-800/40 transition-colors cursor-pointer",
              buttonGuard,
            )}
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
            aria-disabled={!inputReady}
            className={cn(
              "flex flex-col items-center gap-2 p-4 rounded-lg border border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/30 hover:bg-amber-100 dark:hover:bg-amber-800/40 transition-colors cursor-pointer",
              buttonGuard,
            )}
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
