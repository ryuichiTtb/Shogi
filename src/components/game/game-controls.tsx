"use client";

import { Button } from "@/components/ui/button";
import { Flag, RotateCcw, Volume2, VolumeX } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useState } from "react";

interface GameControlsProps {
  onResign: () => void;
  onUndo: () => void;
  isMuted: boolean;
  onToggleMute: () => void;
  canUndo: boolean;
  gameActive: boolean;
  // 狭い領域用にアイコンのみ表示する。card-shogi の 4列レイアウト Col1 等で使用。
  compact?: boolean;
}

// 固定高さ: 36px
export const GAME_CONTROLS_HEIGHT = 36;

export function GameControls({
  onResign,
  onUndo,
  isMuted,
  onToggleMute,
  canUndo,
  gameActive,
  compact = false,
}: GameControlsProps) {
  const [showResignDialog, setShowResignDialog] = useState(false);

  return (
    <>
      <div
        className="flex gap-2 flex-wrap items-center"
        style={{ height: GAME_CONTROLS_HEIGHT }}
      >
        <Button
          variant="outline"
          size={compact ? "icon" : "sm"}
          onClick={onToggleMute}
          className={compact ? "h-9 w-9" : "gap-1.5"}
          aria-label={isMuted ? "ミュート中" : "音あり"}
          title={isMuted ? "ミュート中" : "音あり"}
        >
          {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          {!compact && (isMuted ? "ミュート中" : "音あり")}
        </Button>

        {gameActive && (
          <>
            <Button
              variant="outline"
              size={compact ? "icon" : "sm"}
              onClick={onUndo}
              disabled={!canUndo}
              className={compact ? "h-9 w-9" : "gap-1.5"}
              aria-label="待った"
              title="待った"
            >
              <RotateCcw className="w-4 h-4" />
              {!compact && "待った"}
            </Button>

            <Button
              variant="destructive"
              size={compact ? "icon" : "sm"}
              onClick={() => setShowResignDialog(true)}
              className={compact ? "h-9 w-9" : "gap-1.5"}
              aria-label="投了"
              title="投了"
            >
              <Flag className="w-4 h-4" />
              {!compact && "投了"}
            </Button>
          </>
        )}
      </div>

      <Dialog open={showResignDialog} onOpenChange={setShowResignDialog}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>投了しますか？</DialogTitle>
            <DialogDescription>
              投了すると負けになります。本当によろしいですか？
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 justify-end mt-2">
            <Button variant="outline" onClick={() => setShowResignDialog(false)}>
              キャンセル
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setShowResignDialog(false);
                onResign();
              }}
            >
              投了する
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
