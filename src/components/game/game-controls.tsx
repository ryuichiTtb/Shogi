"use client";

import { Button } from "@/components/ui/button";
import { Flag, Home, Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
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
  // 音量トグルを非表示にする。card-shogi の 4列レイアウトでは音はヘッダーに分離するため。
  hideSound?: boolean;
  // Issue #193 / PR1a: CPU vs CPU 観戦モード。true のとき投了 / 待ったボタンを
  // 描画しない (= ユーザー操作不可、両 CPU 駆動のみで進行)。音量トグルは引き続き表示。
  spectatorMode?: boolean;
  // Issue #193 / PR1a: 観戦モード専用の一時停止 / 再開 / ホーム戻り。
  // spectatorMode=true && gameActive=true のときに描画。
  isPaused?: boolean;
  onPauseSpectator?: () => void;
  onResumeSpectator?: () => void;
  onExitSpectator?: () => void;
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
  hideSound = false,
  spectatorMode = false,
  isPaused = false,
  onPauseSpectator,
  onResumeSpectator,
  onExitSpectator,
}: GameControlsProps) {
  const [showResignDialog, setShowResignDialog] = useState(false);

  return (
    <>
      <div
        className="flex gap-2 flex-wrap items-center"
        style={{ height: GAME_CONTROLS_HEIGHT }}
      >
        {!hideSound && (
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
        )}

        {/* Issue #193 / PR1a: 観戦モードでは投了 / 待ったボタンを描画しない (両 CPU 駆動のみ) */}
        {gameActive && !spectatorMode && (
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

        {/* Issue #193 / PR1a: 観戦モード専用の一時停止 / 再開 / ホーム戻りボタン */}
        {gameActive && spectatorMode && (
          <>
            <Button
              variant="outline"
              size={compact ? "icon" : "sm"}
              onClick={isPaused ? onResumeSpectator : onPauseSpectator}
              className={compact ? "h-9 w-9" : "gap-1.5"}
              aria-label={isPaused ? "再開" : "一時停止"}
              title={isPaused ? "再開" : "一時停止"}
            >
              {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
              {!compact && (isPaused ? "再開" : "一時停止")}
            </Button>

            <Button
              variant="outline"
              size={compact ? "icon" : "sm"}
              onClick={onExitSpectator}
              className={compact ? "h-9 w-9" : "gap-1.5"}
              aria-label="ホームへ戻る"
              title="ホームへ戻る"
            >
              <Home className="w-4 h-4" />
              {!compact && "ホーム"}
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
