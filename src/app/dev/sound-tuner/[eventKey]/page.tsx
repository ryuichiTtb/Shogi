"use client";

// Issue #79: 音源調整ツール 詳細ページ。
// 2 カラム構成 (左: 音源プール選択、右: 摸擬 UI)。
// 摸擬 UI はイベントごとに異なる (registry から動的取得)。第 1 弾は駒系
// 6 種のみ実装、それ以外の event は摸擬 UI なしで動作 (左カラムのみ)。
//
// 固定ヘッダ: back link / event 情報 / 「現在の割り当て」+ ▶ + 波形 + リセット。
// スクロール部: 左カラム (音源プール フォルダグルーピング) + 右カラム (摸擬 UI)。
//
// プレビュー player は usePreviewPlayer 共有 hook (一覧と同じインスタンス
// ではなく、ページ内で 1 つ持つ。本番ゲーム useSound には触れない)。

import { useCallback, useMemo, useRef, useState } from "react";
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
import { usePreviewPlayer } from "@/hooks/dev/use-preview-player";
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
import { MOCK_REGISTRY } from "@/components/dev/sound-tuner-mocks/registry";

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

  // 摸擬 UI: 該当 event の Mock コンポーネント (未登録なら null)
  const Mock = MOCK_REGISTRY[eventKey];
  // 摸擬 UI のリセット用 key (++ で子の state を強制リセット)
  const [mockResetKey, setMockResetKey] = useState(0);
  // 自動リセット: 摸擬 UI 起点の再生が自然終了したら盤面リセット (デフォルト ON)
  const [autoResetEnabled, setAutoResetEnabled] = useState(true);
  // mock 起点の再生かを追跡 (path 値で保持。null = 直近は mock 起点ではない)
  const mockTriggeredPathRef = useRef<string | null>(null);

  const { playFrom, stop, activePath, progress, ready } = usePreviewPlayer({
    onNaturalEnd: useCallback(
      (endedPath: string) => {
        if (
          autoResetEnabled &&
          mockTriggeredPathRef.current === endedPath
        ) {
          setMockResetKey((k) => k + 1);
        }
        // 自然終了したらフラグもクリア
        mockTriggeredPathRef.current = null;
      },
      [autoResetEnabled],
    ),
  });
  const unlockedRef = useRef(false);

  const handlePlay = useCallback(
    (path: string, fromRatio: number = 0) => {
      if (!path) return;
      if (!unlockedRef.current) {
        unlockedRef.current = true;
        void prepareAudio();
      }
      // 通常のプレビュー再生は mock 起点ではないのでフラグクリア
      mockTriggeredPathRef.current = null;
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

  // path 別の onSeek を useMemo で安定化
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

  const groups = useMemo(
    () => groupSoundsByDir(AUDIO_MANIFEST.poolUrls),
    [],
  );

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

  const handleMockReset = useCallback(() => {
    setMockResetKey((k) => k + 1);
  }, []);
  // 摸擬 UI 操作で SFX を再生。
  // 自動リセット判定のため、handlePlay (フラグクリア) ではなく playFrom 直接呼出
  // + ref に effectivePath を記録する。
  const handleMockTrigger = useCallback(() => {
    if (!effectivePath) return;
    if (!unlockedRef.current) {
      unlockedRef.current = true;
      void prepareAudio();
    }
    mockTriggeredPathRef.current = effectivePath;
    playFrom(effectivePath, 0);
  }, [effectivePath, playFrom]);

  return (
    <main className="h-dvh flex flex-col bg-background">
      {/* ===== 固定ヘッダ ===== */}
      <header className="shrink-0 bg-background/95 backdrop-blur-sm border-b border-border/50 z-10">
        <div className="max-w-6xl mx-auto px-4 py-2.5 sm:py-3 flex flex-col gap-2">
          <div className="flex items-start gap-3">
            <Link
              href="/dev/sound-tuner"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mt-0.5 shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
              一覧に戻る
            </Link>
            <div className="flex-1 min-w-0">
              <h1 className="text-base sm:text-lg font-bold leading-tight flex items-center gap-1.5 flex-wrap">
                {label}
                <Badge variant="outline" className="text-[10px] px-1 h-4 leading-none">
                  {isSfx ? "SFX" : "BGM"}
                </Badge>
                {isOverridden && (
                  <Badge variant="default" className="text-[10px] px-1 h-4 leading-none">
                    カスタム
                  </Badge>
                )}
              </h1>
              <p className="text-[10px] text-muted-foreground font-mono leading-tight">
                {eventKey}
              </p>
            </div>
          </div>

          {/* 現在の割り当て (1 行コンパクト) */}
          <div className="flex items-center gap-2 bg-muted/30 rounded-md px-2 py-1.5">
            <span className="text-[10px] text-muted-foreground shrink-0">現在:</span>
            <div className="flex-1 min-w-0">
              <div
                className="font-mono text-xs truncate"
                title={effectivePath || "(未割当)"}
              >
                {effectivePath ? basename(effectivePath) : "(未割当)"}
              </div>
            </div>
            {effectivePath && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleToggle(effectivePath)}
                  disabled={!ready}
                  className="h-7 w-7 min-h-0 min-w-0 p-0 shrink-0"
                  aria-label={activePath === effectivePath ? "停止" : "再生"}
                >
                  {activePath === effectivePath ? (
                    <Pause className="w-3.5 h-3.5" />
                  ) : (
                    <Play className="w-3.5 h-3.5" />
                  )}
                </Button>
                <div className="hidden sm:flex items-center gap-1.5 w-[200px] shrink-0">
                  <SoundWaveform
                    peaks={WAVEFORM_PEAKS[effectivePath] ?? []}
                    isActive={activePath === effectivePath}
                    progress={activePath === effectivePath ? progress : 0}
                    onSeek={seekHandlers[effectivePath]}
                    height={18}
                    touchMinHeight={0}
                    ariaLabel={`${basename(effectivePath)} の波形 (クリックでシーク)`}
                  />
                  <SoundTime
                    duration={WAVEFORM_DURATIONS[effectivePath] ?? 0}
                    progress={activePath === effectivePath ? progress : 0}
                    className="text-[10px]"
                  />
                </div>
              </>
            )}
            {/* 既定に戻す: 常時表示。override されていない時は非活性。 */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleReset}
              disabled={!isOverridden}
              className="h-7 text-[11px] px-2 shrink-0"
              title={isOverridden ? "デフォルトに戻す" : "既にデフォルトを使用中"}
            >
              <RotateCcw className="w-3 h-3 sm:mr-1" />
              <span className="hidden sm:inline">既定に戻す</span>
            </Button>
          </div>
        </div>
      </header>

      {/* ===== 2 カラムレイアウト (lg+ 横並び、それ以下は縦) =====
          ・外側はスクロールなし。摸擬 UI とサブヘッダは固定配置。
          ・スクロールは「音源を選ぶ」配下の groups 一覧のみで発生。 */}
      <div className="flex-1 min-h-0 max-w-6xl w-full mx-auto px-4 py-3 flex flex-col lg:flex-row gap-4">
        {/* 左カラム: 音源プール (サブヘッダ固定 + 一覧のみ縦スクロール) */}
        <section className="flex flex-col gap-2 min-w-0 min-h-0 flex-1 order-2 lg:order-1">
          <div className="shrink-0 flex items-center justify-between gap-2 pb-2 px-1 border-b border-border/40">
            <h2 className="text-sm font-bold text-muted-foreground truncate">
              音源を選ぶ ({AUDIO_MANIFEST.poolUrls.length} 件 / {groups.length} フォルダ)
            </h2>
            <div className="flex gap-1 shrink-0">
              <Button variant="outline" size="sm" onClick={expandAll} className="h-7 text-[11px] px-2">
                全展開
              </Button>
              <Button variant="outline" size="sm" onClick={collapseAll} className="h-7 text-[11px] px-2">
                全折りたたみ
              </Button>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 pb-2">
            {groups.map((group) => {
              const isExpanded = expandedDirs.has(group.dir);
              const groupContainsAssigned = group.paths.includes(effectivePath);
              return (
                // flex 子要素の自動 shrink で Card の中身が潰れるため shrink-0 必須
                <Card key={group.dir} className="shrink-0 overflow-hidden">
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
          </div>
        </section>

        {/* 右カラム: 摸擬 UI (固定配置、スクロールしない) */}
        <aside className="shrink-0 lg:w-80 order-1 lg:order-2 min-w-0">
          <Card className="p-4 flex flex-col items-center gap-3">
            <div className="flex items-center justify-between w-full gap-2">
              <h2 className="text-sm font-bold text-muted-foreground shrink-0">摸擬操作</h2>
              {Mock && (
                <div className="flex items-center gap-2 shrink-0">
                  <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={autoResetEnabled}
                      onChange={(e) => setAutoResetEnabled(e.target.checked)}
                      className="w-3.5 h-3.5 rounded accent-primary cursor-pointer"
                    />
                    自動リセット
                  </label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleMockReset}
                    className="h-7 text-[11px] px-2"
                    title="盤面をリセット"
                  >
                    <RotateCcw className="w-3 h-3 mr-1" />
                    リセット
                  </Button>
                </div>
              )}
            </div>
            {Mock ? (
              <Mock key={mockResetKey} onTrigger={handleMockTrigger} />
            ) : (
              <div className="text-[11px] text-muted-foreground text-center py-6 max-w-[240px]">
                このイベントの摸擬操作 UI は未実装です。
                <br />
                左の音源リストから ▶ プレビューで試聴できます。
              </div>
            )}
            {!effectivePath && Mock && (
              <div className="text-[11px] text-amber-700 dark:text-amber-400 text-center max-w-[240px]">
                音源未割当のため操作しても無音です。先に左から割り当ててください。
              </div>
            )}
          </Card>
        </aside>
      </div>
    </main>
  );
}
