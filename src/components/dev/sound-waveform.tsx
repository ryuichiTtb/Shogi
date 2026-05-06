// Issue #79: 音源調整ツールの波形ビジュアライザ。
// SVG <rect> × N 本で波形を描画し、isActive 中は progress に応じて
// 通過済みバーを primary 色に塗り、カーソル線を表示する。
// クリック位置を 0-1 の ratio に変換して onSeek で親に通知。
//
// React.memo + 安定 props (peaks readonly, onSeek useMemo) で非 active 行は
// 再レンダーゼロ。active 1 行のみ rAF で progress が更新される。

"use client";

import React, { useCallback } from "react";

import { cn } from "@/lib/utils";
import { WAVEFORM_BIN_COUNT } from "@/lib/dev/waveform-constants";

interface SoundWaveformProps {
  // 親が WAVEFORM_PEAKS から取得して渡す (内部 import なし、疎結合化)
  peaks: readonly number[];
  isActive: boolean;
  progress: number; // 0-1, 再生位置
  onSeek: (ratio: number) => void;
  height?: number;
  className?: string;
  ariaLabel?: string;
}

const VIEWBOX_HEIGHT = 100;
// バーは中央揃え、最小高さで小音もちょっと見える
const MIN_BAR_HEIGHT = 2;
// 各バーの占有幅 (BIN 単位) のうち、塗る幅 (残りはギャップ)
const BAR_FILL_RATIO = 0.7;

function SoundWaveformImpl({
  peaks,
  isActive,
  progress,
  onSeek,
  height = 32,
  className,
  ariaLabel = "波形プレビュー (クリックでシーク)",
}: SoundWaveformProps) {
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      if (rect.width <= 0) return;
      const x = e.clientX - rect.left;
      const ratio = Math.max(0, Math.min(1, x / rect.width));
      onSeek(ratio);
    },
    [onSeek],
  );

  // ピークデータがない場合 (script 未実行 / decode 失敗) は描画スキップ。
  // 親側で代替表示 (時間表示のみ等) に fallback してもらう想定。
  if (peaks.length === 0) {
    return null;
  }

  const bins = peaks.length;
  // viewBox 幅 = bins (1 unit per bar)、高さ = VIEWBOX_HEIGHT
  // preserveAspectRatio="none" で実描画サイズに合わせて伸縮。
  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={ariaLabel}
      role="slider"
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={Number(progress.toFixed(3))}
      className={cn(
        "block w-full cursor-pointer rounded-sm",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        className,
      )}
      style={{ minHeight: 44, padding: 0, background: "transparent", border: 0 }}
    >
      <svg
        viewBox={`0 0 ${bins} ${VIEWBOX_HEIGHT}`}
        preserveAspectRatio="none"
        className="block w-full"
        style={{ height }}
        aria-hidden="true"
      >
        {peaks.map((peak, i) => {
          const fillH = Math.max(MIN_BAR_HEIGHT, peak * (VIEWBOX_HEIGHT - MIN_BAR_HEIGHT));
          const passed = isActive && i / bins <= progress;
          return (
            <rect
              key={i}
              x={i + (1 - BAR_FILL_RATIO) / 2}
              y={(VIEWBOX_HEIGHT - fillH) / 2}
              width={BAR_FILL_RATIO}
              height={fillH}
              className={passed ? "fill-primary" : "fill-muted-foreground/30"}
            />
          );
        })}
        {isActive && (
          <line
            x1={progress * bins}
            x2={progress * bins}
            y1={0}
            y2={VIEWBOX_HEIGHT}
            className="stroke-primary"
            strokeWidth={0.4}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
    </button>
  );
}

// React.memo で再レンダー抑制。
// 非 active 行は isActive=false 固定 + onSeek 安定参照 (親で useMemo) なら
// progress 更新で再レンダーされない (= バッテリー負荷ゼロ)。
export const SoundWaveform = React.memo(SoundWaveformImpl);

// peaks 未定義時のフォールバック判定を親で簡潔に書けるようヘルパ export。
export const WAVEFORM_BAR_COUNT = WAVEFORM_BIN_COUNT;
