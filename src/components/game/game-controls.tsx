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
}

export function GameControls({
  onResign,
  onUndo,
  isMuted,
  onToggleMute,
  canUndo,
  gameActive,
}: GameControlsProps) {
  const [showResignDialog, setShowResignDialog] = useState(false);

  return (
    <>
      <div className="flex gap-2 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          onClick={onToggleMute}
          className="gap-1.5"
        >
          {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          {isMuted ? "ミュート中" : "音あり"}
        </Button>

        {gameActive && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={onUndo}
              disabled={!canUndo}
              className="gap-1.5"
            >
              <RotateCcw className="w-4 h-4" />
              待った
            </Button>

            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowResignDialog(true)}
              className="gap-1.5"
            >
              <Flag className="w-4 h-4" />
              投了
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
