"use client";

// Issue #79: 音源調整ツール 詳細ページ。
// 1 つの SFX イベントに対して、利用可能な全 mp3 を行リスト化し、各行で
// プレビュー再生 + 波形表示 + シーク + 「このイベントに割り当て」を可能にする。
//
// プレビューは詳細ページ専用の Howler ラッパ (usePreviewPlayer) を使い、
// useSound 本体には触れない。連打時は直前再生を stop してから新規 play、
// ページ遷移 cleanup でも stop する。
//
// 波形は scripts/build-waveform-peaks.ts でビルドタイムに事前計算された
// WAVEFORM_PEAKS を静的 import。実行時 decode コストはゼロ。
//
// 不正な eventKey は notFound() で 404。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Check, Pause, Play, RotateCcw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AUDIO_MANIFEST, SFX_FILES } from "@/lib/audio/manifest";
import { prepareAudio } from "@/hooks/use-sound";
import {
  resetSoundOverride,
  saveSoundOverride,
  SFX_EVENT_KEYS,
  SFX_EVENT_LABELS,
  useSoundOverrides,
  type SfxEventKey,
} from "@/lib/dev/sound-overrides";
import {
  WAVEFORM_DURATIONS,
  WAVEFORM_PEAKS,
} from "@/lib/dev/waveform-peaks-data";
import { SoundWaveform } from "@/components/dev/sound-waveform";
import { SoundTime } from "@/components/dev/sound-time";

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

function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

function isSfxEventKey(s: string): s is SfxEventKey {
  return (SFX_EVENT_KEYS as readonly string[]).includes(s);
}

// 詳細ページ専用の Howler ラッパ + 再生位置トラッキング。
// ・パス指定で再生 (useSound は event key 指定なので別系統)
// ・直前再生中の Howl を stop してから新規 play (連打 OK)
// ・rAF で seek() を読み progress (0-1) を更新 → 波形カーソル連動
// ・onend / onloaderror / onplayerror で activePath/progress を確実にリセット
// ・ページ unmount cleanup で再生停止 + Howl unload + rAF cancel
function usePreviewPlayer() {
  const HowlRef = useRef<HowlConstructor | null>(null);
  const cacheRef = useRef<Map<string, HowlInstance>>(new Map());
  const currentRef = useRef<HowlInstance | null>(null);
  const rafRef = useRef<number | null>(null);
  const [ready, setReady] = useState(false);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  // Howler 動的 import (mount 時 1 回)
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
      if (!HowlRef.current) return;
      currentRef.current?.stop();
      stopRaf();

      let howl = cacheRef.current.get(path);
      if (!howl) {
        const onClear = () => {
          // 終了 / 失敗時は state クリア (現在 path が同じならば)
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

      // duration は manifest から取得 (Howler.duration() は load 完了前 0)
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

  return { playFrom, stop, activePath, progress, ready };
}

export default function SoundTunerDetailPage() {
  const params = useParams<{ eventKey: string }>();
  const eventKey = params?.eventKey ?? "";
  if (!isSfxEventKey(eventKey)) {
    notFound();
  }
  const key = eventKey as SfxEventKey;

  const overrides = useSoundOverrides();
  const overridePath = overrides[key];
  const defaultPath = SFX_FILES[key];
  const effectivePath = overridePath ?? defaultPath;
  const isOverridden = overridePath !== undefined;

  const { playFrom, stop, activePath, progress, ready } = usePreviewPlayer();
  const unlockedRef = useRef(false);

  // 初回 ▶ クリック時に Safari の AudioContext を unlock。
  const handlePlay = useCallback(
    (path: string, fromRatio: number = 0) => {
      if (!unlockedRef.current) {
        unlockedRef.current = true;
        void prepareAudio();
      }
      playFrom(path, fromRatio);
    },
    [playFrom],
  );

  // 同じ path 再生中の ▶ クリックは toggle (停止)、それ以外は再生開始。
  const handleToggle = useCallback(
    (path: string) => {
      if (activePath === path) {
        stop();
      } else {
        handlePlay(path, 0);
      }
    },
    [activePath, handlePlay, stop],
  );

  // path 別の onSeek ハンドラを useMemo で安定化 → SoundWaveform の memo 効く
  const seekHandlers = useMemo(() => {
    const map: Record<string, (ratio: number) => void> = {};
    for (const path of AUDIO_MANIFEST.sfxUrls) {
      map[path] = (ratio: number) => handlePlay(path, ratio);
    }
    return map;
  }, [handlePlay]);

  const handleAssign = useCallback(
    (path: string) => {
      saveSoundOverride(key, path);
    },
    [key],
  );

  const handleReset = useCallback(() => {
    resetSoundOverride(key);
  }, [key]);

  return (
    <main className="min-h-dvh bg-background p-4 sm:p-6">
      <div className="max-w-3xl mx-auto flex flex-col gap-4">
        <header className="flex items-start gap-3 mb-1">
          <Link
            href="/dev/sound-tuner"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mt-1"
          >
            <ArrowLeft className="w-4 h-4" />
            一覧に戻る
          </Link>
          <div className="flex-1">
            <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
              {SFX_EVENT_LABELS[key]}
              {isOverridden && <Badge variant="default" className="text-[10px]">カスタム</Badge>}
            </h1>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">{key}</p>
          </div>
        </header>

        {/* 現在の割り当て */}
        <Card className="p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-[11px] text-muted-foreground">現在の割り当て</div>
              <div className="font-mono text-sm truncate">{basename(effectivePath)}</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleToggle(effectivePath)}
                disabled={!ready}
                className="min-h-[44px] min-w-[44px]"
                aria-label={activePath === effectivePath ? "停止" : "現在の音源を再生"}
              >
                {activePath === effectivePath ? (
                  <Pause className="w-3.5 h-3.5" />
                ) : (
                  <Play className="w-3.5 h-3.5" />
                )}
              </Button>
              {isOverridden && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReset}
                  className="min-h-[44px]"
                >
                  <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                  デフォルトに戻す
                </Button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <SoundWaveform
              peaks={WAVEFORM_PEAKS[effectivePath] ?? []}
              isActive={activePath === effectivePath}
              progress={activePath === effectivePath ? progress : 0}
              onSeek={seekHandlers[effectivePath]}
              ariaLabel={`${basename(effectivePath)} の波形 (クリックでシーク)`}
            />
            <SoundTime
              duration={WAVEFORM_DURATIONS[effectivePath] ?? 0}
              progress={activePath === effectivePath ? progress : 0}
            />
          </div>
        </Card>

        {/* 音源リスト */}
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-bold text-muted-foreground px-1">音源を選ぶ</h2>
          {AUDIO_MANIFEST.sfxUrls.map((path) => {
            const isSelected = effectivePath === path;
            const isDefault = defaultPath === path;
            const isPlaying = activePath === path;
            return (
              <Card
                key={path}
                className={`p-3 flex flex-col gap-2 ${isSelected ? "bg-primary/5 border-primary/40" : ""}`}
              >
                <div className="flex items-center gap-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleToggle(path)}
                    disabled={!ready}
                    className="min-h-[44px] min-w-[44px] shrink-0"
                    aria-label={isPlaying ? `${basename(path)} を停止` : `${basename(path)} を再生`}
                  >
                    {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </Button>
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-sm truncate">{basename(path)}</div>
                    {isDefault && (
                      <div className="text-[10px] text-muted-foreground mt-0.5">既定</div>
                    )}
                  </div>
                  {isSelected ? (
                    <Badge variant="default" className="shrink-0 min-h-[44px] px-3 flex items-center">
                      <Check className="w-3.5 h-3.5 mr-1" />
                      選択中
                    </Badge>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleAssign(path)}
                      className="min-h-[44px] shrink-0"
                    >
                      このイベントに割り当て
                    </Button>
                  )}
                </div>
                <div className="flex items-center gap-2 pl-[52px]">
                  <SoundWaveform
                    peaks={WAVEFORM_PEAKS[path] ?? []}
                    isActive={isPlaying}
                    progress={isPlaying ? progress : 0}
                    onSeek={seekHandlers[path]}
                    ariaLabel={`${basename(path)} の波形 (クリックでシーク)`}
                  />
                  <SoundTime
                    duration={WAVEFORM_DURATIONS[path] ?? 0}
                    progress={isPlaying ? progress : 0}
                  />
                </div>
              </Card>
            );
          })}
        </section>
      </div>
    </main>
  );
}
