// Issue #79: 音源調整ツールの経過/総再生時間表示。
// 0:01 / 0:03 形式の mono 表示。

"use client";

import React from "react";

import { cn } from "@/lib/utils";

interface SoundTimeProps {
  duration: number; // 秒
  progress: number; // 0-1
  className?: string;
}

function formatMmSs(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function SoundTimeImpl({ duration, progress, className }: SoundTimeProps) {
  const elapsed = Math.max(0, Math.min(duration, duration * progress));
  return (
    <span className={cn("font-mono text-[11px] text-muted-foreground tabular-nums shrink-0", className)}>
      {formatMmSs(elapsed)} / {formatMmSs(duration)}
    </span>
  );
}

export const SoundTime = React.memo(SoundTimeImpl);
