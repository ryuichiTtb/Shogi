// Issue #155: ローディングマスクのリッチ化。
//   - 中央に回転カードビジュアル (LoadingCardVisual)
//   - 下部に indeterminate プログレスバー (LoadingProgressBar)
//   - テキストとしてステージ文言フェード (LoadingStages)
// 各サブコンポーネントは独立して export しており、必要に応じて単体利用も可能。
//
// 後方互換: card / stages / progress を渡さない既存呼び出しは従来どおり
// spinner + message のみを表示する。
"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { LoadingCardVisual } from "./loading/loading-card-visual";
import { LoadingProgressBar } from "./loading/loading-progress-bar";
import { LoadingStages } from "./loading/loading-stages";

const DEFAULT_STAGE_INTERVAL_MS = 1200;

interface LoadingOverlayProps {
  show: boolean;
  message?: string;
  // fullScreen=true → 画面全体を覆う (fixed)。
  // false → 直近の position:relative 親を覆う (absolute)。
  fullScreen?: boolean;
  className?: string;
  // true で中央に「裏面 ↔ ランダム駒」の回転カードを表示する。
  // 省略・false なら従来の spinner のみ (後方互換)。
  card?: boolean;
  // ステージ文言を順送りで表示。省略時は message を 1 行表示。
  stages?: readonly string[];
  stageIntervalMs?: number;
  // indeterminate プログレスバーを下部に表示。省略時は非表示。
  progress?: { kind: "indeterminate" };
}

// 共通ローディングマスク。半透明背景 + backdrop-blur で背面の視認性を残しつつ、
// pointer-events:auto (デフォルト) によりクリックを吸収して操作不可状態にする。
export function LoadingOverlay({
  show,
  message = "読み込み中...",
  fullScreen = false,
  className,
  card,
  stages,
  stageIntervalMs = DEFAULT_STAGE_INTERVAL_MS,
  progress,
}: LoadingOverlayProps) {
  if (!show) return null;

  const showCard = card === true;
  const showProgress = progress !== undefined;
  const showStages = stages !== undefined && stages.length > 0;

  return (
    <div
      className={cn(
        fullScreen ? "fixed" : "absolute",
        "inset-0 z-50 flex flex-col items-center justify-center gap-3",
        "bg-background/40 backdrop-blur-sm",
        className,
      )}
      aria-busy
      role="status"
      aria-live="polite"
    >
      {showCard ? (
        <LoadingCardVisual />
      ) : (
        <div className="rounded-full bg-background/85 shadow-lg p-3">
          <Loader2 className="w-7 h-7 text-primary animate-spin" />
        </div>
      )}
      {showProgress && <LoadingProgressBar />}
      {showStages ? (
        <LoadingStages stages={stages} intervalMs={stageIntervalMs} />
      ) : (
        <span className="text-xs text-muted-foreground bg-background/85 px-2 py-0.5 rounded-md shadow-sm">
          {message}
        </span>
      )}
    </div>
  );
}
