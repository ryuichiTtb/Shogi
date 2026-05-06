"use client";

// Issue #79: 音源調整ツール (一覧/詳細) で共有するプレビュー再生 hook。
// ・パス指定で再生 (useSound は event key 指定なので別系統)
// ・直前再生中の Howl を stop してから新規 play (連打 OK)
// ・rAF で seek() を読み progress (0-1) を更新 → 波形カーソル連動
// ・onend / onloaderror / onplayerror で activePath/progress を確実にリセット
// ・ページ unmount cleanup で再生停止 + Howl unload + rAF cancel

import { useCallback, useEffect, useRef, useState } from "react";

import { WAVEFORM_DURATIONS } from "@/lib/dev/waveform-peaks-data";

type HowlInstance = {
  play: () => number | undefined;
  stop: () => void;
  unload: () => void;
  duration: () => number;
  seek: (pos?: number) => number | HowlInstance;
};

type HowlConstructor = new (options: {
  src: string[];
  volume?: number;
  preload?: boolean;
  onload?: () => void;
  onend?: () => void;
  onloaderror?: () => void;
  onplayerror?: () => void;
}) => HowlInstance;

export interface PreviewPlayer {
  /** 指定 path を再生開始。fromRatio (0-1) を指定するとその位置から。 */
  playFrom: (path: string, fromRatio?: number) => void;
  /** 現在の再生を停止。 */
  stop: () => void;
  /** 同じ path 再生中なら stop、それ以外なら playFrom(path, 0)。 */
  toggle: (path: string) => void;
  /** 現在再生中の path (なければ null)。 */
  activePath: string | null;
  /** 再生位置 (0-1)。activePath に対応する曲のみ更新される。 */
  progress: number;
  /** Howler ロード完了したか。false の間は disabled UI 推奨。 */
  ready: boolean;
}

export function usePreviewPlayer(): PreviewPlayer {
  const HowlRef = useRef<HowlConstructor | null>(null);
  const cacheRef = useRef<Map<string, HowlInstance>>(new Map());
  const currentRef = useRef<HowlInstance | null>(null);
  const rafRef = useRef<number | null>(null);
  const [ready, setReady] = useState(false);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const cache = cacheRef.current;
    const current = currentRef;
    const raf = rafRef;
    import("howler").then(({ Howl }) => {
      if (cancelled) return;
      HowlRef.current = Howl as unknown as HowlConstructor;
      setReady(true);
    });
    return () => {
      cancelled = true;
      if (raf.current !== null) {
        cancelAnimationFrame(raf.current);
        raf.current = null;
      }
      current.current?.stop();
      cache.forEach((h) => h.unload());
      cache.clear();
      current.current = null;
    };
  }, []);

  const stopRaf = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const startTracking = useCallback(
    (howl: HowlInstance, duration: number) => {
      stopRaf();
      const tick = () => {
        const seekVal = howl.seek();
        const seekSec = typeof seekVal === "number" ? seekVal : 0;
        if (!Number.isFinite(seekSec)) {
          rafRef.current = requestAnimationFrame(tick);
          return;
        }
        const p = duration > 0 ? Math.min(1, seekSec / duration) : 0;
        setProgress(p);
        if (p < 1) {
          rafRef.current = requestAnimationFrame(tick);
        }
      };
      rafRef.current = requestAnimationFrame(tick);
    },
    [stopRaf],
  );

  const stop = useCallback(() => {
    currentRef.current?.stop();
    stopRaf();
    setActivePath(null);
    setProgress(0);
  }, [stopRaf]);

  const playFrom = useCallback(
    (path: string, fromRatio: number = 0) => {
      if (!HowlRef.current || !path) return;
      currentRef.current?.stop();
      stopRaf();

      let howl = cacheRef.current.get(path);
      if (!howl) {
        const onClear = () => {
          setActivePath((cur) => (cur === path ? null : cur));
          setProgress((p) => (p > 0 ? 0 : p));
          stopRaf();
        };
        howl = new HowlRef.current({
          src: [path],
          volume: 0.7,
          preload: true,
          onend: onClear,
          onloaderror: onClear,
          onplayerror: onClear,
        });
        cacheRef.current.set(path, howl);
      }
      currentRef.current = howl;

      const duration = WAVEFORM_DURATIONS[path] ?? howl.duration() ?? 0;
      const clamped = Math.max(0, Math.min(1, fromRatio));
      if (clamped > 0 && duration > 0) {
        howl.seek(clamped * duration);
      }
      setActivePath(path);
      setProgress(clamped);
      howl.play();
      if (duration > 0) startTracking(howl, duration);
    },
    [startTracking, stopRaf],
  );

  const toggle = useCallback(
    (path: string) => {
      if (!path) return;
      if (activePath === path) {
        stop();
      } else {
        playFrom(path, 0);
      }
    },
    [activePath, playFrom, stop],
  );

  return { playFrom, stop, toggle, activePath, progress, ready };
}
