"use client";

// Issue #79: 音源調整ツール 詳細ページ。
// SFX / BGM event のどちらにも対応。SOUND_POOL 全件 (73 ファイル) を
// フォルダ別グルーピング + 折りたたみで表示し、各音源で
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
import { ArrowLeft, ChevronDown, ChevronRight, Check, Pause, Play, RotateCcw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { AUDIO_MANIFEST, BGM_FILES, SFX_FILES } from "@/lib/audio/manifest";
import { prepareAudio } from "@/hooks/use-sound";
import { useBgm } from "@/hooks/use-bgm";
import {
  BGM_EVENT_KEYS,
  BGM_EVENT_LABELS,
  resetBgmOverride,
  resetSoundOverride,
  saveBgmOverride,
  saveSoundOverride,
  SFX_EVENT_KEYS,
  SFX_EVENT_LABELS,
  useBgmOverrides,
  useSoundOverrides,
  type BgmEventKey,
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
  if (!path) return "";
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(0, i) : "";
}

function isSfxEventKey(s: string): s is SfxEventKey {
  return (SFX_EVENT_KEYS as readonly string[]).includes(s);
}

function isBgmEventKey(s: string): s is BgmEventKey {
  return (BGM_EVENT_KEYS as readonly string[]).includes(s);
}

// 詳細ページ専用の Howler ラッパ + 再生位置トラッキング。
function usePreviewPlayer() {
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

  return { playFrom, stop, activePath, progress, ready };
}

// SOUND_POOL を dirname でグループ化。各グループは {dir, paths} の配列。
// グループ順は元の poolUrls 順 (= scan の sort 順)。
interface SoundGroup {
  dir: string;
  paths: string[];
}

function groupSoundsByDir(paths: readonly string[]): SoundGroup[] {
  const map = new Map<string, string[]>();
  for (const p of paths) {
    const d = dirname(p);
    const list = map.get(d) ?? [];
    list.push(p);
    if (list.length === 1) map.set(d, list);
  }
  return Array.from(map.entries()).map(([dir, paths]) => ({ dir, paths }));
}

export default function SoundTunerDetailPage() {
  // dev page では BGM 停止
  useBgm(null);
  const params = useParams<{ eventKey: string }>();
  const eventKey = params?.eventKey ?? "";

  const isSfx = isSfxEventKey(eventKey);
  const isBgm = !isSfx && isBgmEventKey(eventKey);
  if (!isSfx && !isBgm) {
    notFound();
  }

  const sfxOverrides = useSoundOverrides();
  const bgmOverrides = useBgmOverrides();

  const overridePath = isSfx
    ? sfxOverrides[eventKey as SfxEventKey]
    : bgmOverrides[eventKey as BgmEventKey];
  const defaultPath = isSfx
    ? SFX_FILES[eventKey as SfxEventKey] ?? ""
    : BGM_FILES[eventKey as BgmEventKey] ?? "";
  const effectivePath = overridePath ?? defaultPath;
  const isOverridden = overridePath !== undefined;
  const label = isSfx
    ? SFX_EVENT_LABELS[eventKey as SfxEventKey]
    : BGM_EVENT_LABELS[eventKey as BgmEventKey];

  const { playFrom, stop, activePath, progress, ready } = usePreviewPlayer();
  const unlockedRef = useRef(false);

  // 初回 ▶ クリック時に Safari の AudioContext を unlock
  const handlePlay = useCallback(
    (path: string, fromRatio: number = 0) => {
      if (!path) return;
      if (!unlockedRef.current) {
        unlockedRef.current = true;
        void prepareAudio();
      }
      playFrom(path, fromRatio);
    },
    [playFrom],
  );

  const handleToggle = useCallback(
    (path: string) => {
      if (!path) return;
      if (activePath === path) {
        stop();
      } else {
        handlePlay(path, 0);
      }
    },
    [activePath, handlePlay, stop],
  );

  // path 別の onSeek を useMemo で安定化 (SoundWaveform の memo 効く)
  const seekHandlers = useMemo(() => {
    const map: Record<string, (ratio: number) => void> = {};
    for (const path of AUDIO_MANIFEST.poolUrls) {
      map[path] = (ratio: number) => handlePlay(path, ratio);
    }
    return map;
  }, [handlePlay]);

  const handleAssign = useCallback(
    (path: string) => {
      if (isSfx) {
        saveSoundOverride(eventKey as SfxEventKey, path);
      } else {
        saveBgmOverride(eventKey as BgmEventKey, path);
      }
    },
    [eventKey, isSfx],
  );

  const handleReset = useCallback(() => {
    if (isSfx) {
      resetSoundOverride(eventKey as SfxEventKey);
    } else {
      resetBgmOverride(eventKey as BgmEventKey);
    }
  }, [eventKey, isSfx]);

  // SOUND_POOL をフォルダ別グルーピング (memo 化、変化なし前提)
  const groups = useMemo(
    () => groupSoundsByDir(AUDIO_MANIFEST.poolUrls),
    [],
  );

  // 折りたたみ state: dir → expanded?
  // 初期: 「現在割当 path を含むグループ」だけ展開、他は折りたたみ
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => {
    const init = new Set<string>();
    if (effectivePath) init.add(dirname(effectivePath));
    return init;
  });

  const toggleDir = useCallback((dir: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setExpandedDirs(new Set(groups.map((g) => g.dir)));
  }, [groups]);

  const collapseAll = useCallback(() => {
    setExpandedDirs(new Set());
  }, []);

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
            <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2 flex-wrap">
              {label}
              <Badge variant="outline" className="text-[10px]">
                {isSfx ? "SFX" : "BGM"}
              </Badge>
              {isOverridden && <Badge variant="default" className="text-[10px]">カスタム</Badge>}
            </h1>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">{eventKey}</p>
          </div>
        </header>

        {/* 現在の割り当て */}
        <Card className="p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-[11px] text-muted-foreground">現在の割り当て</div>
              <div className="font-mono text-sm truncate" title={effectivePath || "(未割当)"}>
                {effectivePath ? basename(effectivePath) : "(未割当)"}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {effectivePath && (
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
              )}
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
          {effectivePath && (
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
          )}
        </Card>

        {/* 音源リスト (フォルダ別 + 折りたたみ) */}
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-sm font-bold text-muted-foreground">
              音源を選ぶ ({AUDIO_MANIFEST.poolUrls.length} 件 / {groups.length} フォルダ)
            </h2>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" onClick={expandAll} className="min-h-[36px] text-[11px]">
                全展開
              </Button>
              <Button variant="outline" size="sm" onClick={collapseAll} className="min-h-[36px] text-[11px]">
                全折りたたみ
              </Button>
            </div>
          </div>
          {groups.map((group) => {
            const isExpanded = expandedDirs.has(group.dir);
            const groupContainsAssigned = group.paths.includes(effectivePath);
            return (
              <Card key={group.dir} className="overflow-hidden">
                {/* グループ見出し */}
                <button
                  type="button"
                  onClick={() => toggleDir(group.dir)}
                  className="w-full flex items-center gap-2 p-3 hover:bg-muted/40 transition-colors min-h-[44px] text-left"
                  aria-expanded={isExpanded}
                >
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-xs truncate" title={group.dir}>
                      {group.dir}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {group.paths.length} ファイル
                    </div>
                  </div>
                  {groupContainsAssigned && (
                    <Badge variant="outline" className="text-[10px] shrink-0">割当済を含む</Badge>
                  )}
                </button>
                {/* グループ内行 (展開時のみ描画) */}
                {isExpanded && (
                  <div className="flex flex-col gap-2 p-3 pt-0">
                    {group.paths.map((path) => {
                      const isSelected = effectivePath === path;
                      const isDefault = defaultPath === path;
                      const isPlaying = activePath === path;
                      const fname = basename(path);
                      return (
                        <Card
                          key={path}
                          className={cn(
                            "p-3 flex flex-col gap-2",
                            isSelected && "bg-primary/5 border-primary/40",
                          )}
                        >
                          <div className="flex items-center gap-3">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleToggle(path)}
                              disabled={!ready}
                              className="min-h-[44px] min-w-[44px] shrink-0"
                              aria-label={isPlaying ? `${fname} を停止` : `${fname} を再生`}
                            >
                              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                            </Button>
                            <div className="flex-1 min-w-0">
                              <div className="font-mono text-xs sm:text-sm truncate" title={fname}>
                                {fname}
                              </div>
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
                                className="min-h-[44px] shrink-0 text-xs"
                              >
                                割り当て
                              </Button>
                            )}
                          </div>
                          <div className="flex items-center gap-2 pl-[52px]">
                            <SoundWaveform
                              peaks={WAVEFORM_PEAKS[path] ?? []}
                              isActive={isPlaying}
                              progress={isPlaying ? progress : 0}
                              onSeek={seekHandlers[path]}
                              ariaLabel={`${fname} の波形 (クリックでシーク)`}
                            />
                            <SoundTime
                              duration={WAVEFORM_DURATIONS[path] ?? 0}
                              progress={isPlaying ? progress : 0}
                            />
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </Card>
            );
          })}
        </section>
      </div>
    </main>
  );
}

