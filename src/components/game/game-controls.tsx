"use client";

import { Button } from "@/components/ui/button";
import { Flag, RotateCcw, Volume2, VolumeX, ScrollText } from "lucide-react";
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
  onShowHistory?: () => void;
}

export function GameControls({
  onResign,
  onUndo,
  isMuted,
  onToggleMute,
  canUndo,
  gameActive,
  onShowHistory,
}: GameControlsProps) {
  const [showResignDialog, setShowResignDialog] = useState(false);

  return (
    <>
      <div className="flex gap-1 lg:gap-2 flex-wrap shrink-0">
        <Button
          variant="outline"
          size="sm"
          onClick={onToggleMute}
          className="gap-1 lg:gap-1.5 text-xs lg:text-sm"
        >
          {isMuted ? <VolumeX className="w-3.5 h-3.5 lg:w-4 lg:h-4" /> : <Volume2 className="w-3.5 h-3.5 lg:w-4 lg:h-4" />}
          <span className="hidden sm:inline">{isMuted ? "ミュート中" : "音あり"}</span>
        </Button>

        {gameActive && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={onUndo}
              disabled={!canUndo}
              className="gap-1 lg:gap-1.5 text-xs lg:text-sm"
            >
              <RotateCcw className="w-3.5 h-3.5 lg:w-4 lg:h-4" />
              待った
            </Button>

            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowResignDialog(true)}
              className="gap-1 lg:gap-1.5 text-xs lg:text-sm"
            >
              <Flag className="w-3.5 h-3.5 lg:w-4 lg:h-4" />
              投了
            </Button>
          </>
        )}

        {/* モバイル専用: 棋譜/キャラクターボタン */}
        {onShowHistory && (
          <Button
            variant="outline"
            size="sm"
            className="lg:hidden gap-1 text-xs ml-auto"
            onClick={onShowHistory}
          >
            <ScrollText className="w-3.5 h-3.5" />
            棋譜
          </Button>
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
