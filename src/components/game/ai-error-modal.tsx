// Issue #176 Phase 1 Stage B: AI 思考リクエストの連続失敗時に表示するモーダル。
//
// card-shogi は AI が止まると進行不能 (詰みでもないのに自分の手番が来ない)
// になるため、自動リトライ尽きた場合に「もう一度試す / 投了する」を提示して
// UI を進行可能状態に復旧させる。

"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface AiErrorModalProps {
  open: boolean;
  onRetry: () => void;
  onResign: () => void;
}

export function AiErrorModal({ open, onRetry, onResign }: AiErrorModalProps) {
  return (
    // onOpenChange を no-op にすることで Esc / 外クリックでの dismiss を無視し、
    // 必ず Retry / Resign のいずれかを選ばせる (進行不能状態の救済)。
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>AI が応答しませんでした</DialogTitle>
          <DialogDescription>
            通信や一時的なエラーで AI 思考が完了しませんでした。もう一度試すか、投了するかを選んでください。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onResign}>
            投了する
          </Button>
          <Button onClick={onRetry}>もう一度試す</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
