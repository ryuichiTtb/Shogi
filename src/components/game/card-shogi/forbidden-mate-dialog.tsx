// Issue #82 (二手指し): 2手目で「禁止された詰み手」を選択した時に表示する案内ダイアログ。
//
// 用途: mateInOneAvailable=false 時、2手目で相手玉を詰ませる手を選択 → このダイアログが出て
// 禁止理由を説明する。マスは赤×表示で視覚的にも禁止が分かるようになっているが、
// 「なぜダメなのか」を文章で伝えることで UX を向上させる。

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface ForbiddenMateDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ForbiddenMateDialog({ open, onClose }: ForbiddenMateDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-red-600 dark:text-red-400 text-2xl leading-none">×</span>
            禁止された手
          </DialogTitle>
          <DialogDescription className="pt-2 leading-relaxed">
            二手指しでは、カード使用時点で「1手詰め」が成立していない場合、
            2手目で相手玉を詰ませることはできません。
            <br />
            <br />
            別の手を選んで 2手目を完了してください。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="sm:justify-end">
          <Button onClick={onClose} variant="default">
            OK
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
