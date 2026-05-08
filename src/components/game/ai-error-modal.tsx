// Issue #176 Phase 1 Stage B: AI 思考リクエストの連続失敗時に表示するモーダル。
//
// card-shogi は AI が止まると進行不能 (詰みでもないのに自分の手番が来ない)
// になるため、自動リトライ尽きた場合に「もう一度試す / 投了する」を提示して
// UI を進行可能状態に復旧させる。
//
// Issue #176 timeout-fix F1: AiRequestError の kind に応じて文言を分岐し、
// 504 timeout 時 / HTTP エラー時 / network エラー時を切り分けて伝える。

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
import type { AiRequestError } from "@/hooks/ai/use-ai-request";

export interface AiErrorModalProps {
  open: boolean;
  // 表示文言の出し分けに使う。null 時は default 文言。
  error?: AiRequestError | null;
  onRetry: () => void;
  onResign: () => void;
}

function getDescription(error: AiRequestError | null | undefined): string {
  switch (error?.kind) {
    case "timeout":
      return "AI が時間内に手を返せませんでした。もう一度試すか、投了するかを選んでください。";
    case "http":
      return `サーバ側でエラーが発生しました (${error.status ?? "?"})。もう一度試すか、投了するかを選んでください。`;
    case "network":
      return "通信エラーで AI 思考が中断されました。もう一度試すか、投了するかを選んでください。";
    default:
      return "通信や一時的なエラーで AI 思考が完了しませんでした。もう一度試すか、投了するかを選んでください。";
  }
}

export function AiErrorModal({ open, error, onRetry, onResign }: AiErrorModalProps) {
  return (
    // onOpenChange を no-op にすることで Esc / 外クリックでの dismiss を無視し、
    // 必ず Retry / Resign のいずれかを選ばせる (進行不能状態の救済)。
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>AI が応答しませんでした</DialogTitle>
          <DialogDescription>{getDescription(error)}</DialogDescription>
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
