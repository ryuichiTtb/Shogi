"use client";

// Issue #79: 音源調整ツール 操作一覧ページ。
// SFX (18 event) と BGM (4 event) をタブで切替表示し、各イベントの
// 現在割り当てを 1 行コンパクトに表示。各行でインラインプレビュー
// (▶ + 波形 + 時間) と「変更」ボタンを提供。
//
// 一覧ヘッダ (back link / title / tabs / override summary) は sticky 固定。
// 一覧本体は flex-1 + overflow-y-auto で独立スクロール。

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronRight, Music, Pause, Play, RotateCcw, Volume2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { BGM_FILES, SFX_FILES } from "@/lib/audio/manifest";
import { useBgm } from "@/hooks/use-bgm";
import { prepareAudio } from "@/hooks/use-sound";
import { usePreviewPlayer } from "@/hooks/dev/use-preview-player";
import {
  BGM_EVENT_KEYS,
  BGM_EVENT_LABELS,
  resetAllBgmOverrides,
  resetAllSoundOverrides,
  SFX_EVENT_KEYS,
  SFX_EVENT_LABELS,
  useBgmOverrides,
  useSoundOverrides,
  type BgmEventKey,
} from "@/lib/dev/sound-overrides";
import {
  WAVEFORM_DURATIONS,
  WAVEFORM_PEAKS,
} from "@/lib/dev/waveform-peaks-data";
import { SoundWaveform } from "@/components/dev/sound-waveform";
import { SoundTime } from "@/components/dev/sound-time";

type Tab = "sfx" | "bgm";

function basename(path: string): string {
  if (!path) return "";
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

interface RowProps {
  eventKey: string;
  label: string;
  effectivePath: string;
  isOverridden: boolean;
  isUnassigned: boolean;
  activePath: string | null;
  progress: number;
  ready: boolean;
  onToggle: (path: string) => void;
  onSeek: (path: string, ratio: number) => void;
  href: string;
  Icon?: React.ComponentType<{ className?: string }>;
}

// 1 行表示の event 行。
// すべての要素 (イベント名+key / 割当て音源名 / ▶+波形+時間 / 変更ボタン) を
// 単一の横方向 row に並べる。Card 既定が flex-col のため flex-row を明示。
function EventRow({
  eventKey,
  label,
  effectivePath,
  isOverridden,
  isUnassigned,
  activePath,
  progress,
  ready,
  onToggle,
  onSeek,
  href,
  Icon,
}: RowProps) {
  const isPlaying = activePath === effectivePath;
  const fname = basename(effectivePath);
  const seekHandler = useCallback(
    (ratio: number) => onSeek(effectivePath, ratio),
    [effectivePath, onSeek],
  );

  return (
    <Card className="flex-row items-center gap-2 px-2.5 py-1.5 min-h-[44px]">
      {/* 左: イベント名 + key (2 段、コンパクト) */}
      <div className="shrink-0 min-w-0 w-[42%] sm:w-[26%] flex items-center gap-1">
        {Icon && <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
        <div className="min-w-0">
          <div className="font-bold text-xs sm:text-sm leading-tight truncate flex items-center gap-1">
            <span className="truncate">{label}</span>
            {isOverridden && (
              <Badge variant="default" className="text-[9px] px-1 h-3.5 leading-none shrink-0">
                custom
              </Badge>
            )}
            {isUnassigned && (
              <Badge variant="outline" className="text-[9px] px-1 h-3.5 leading-none shrink-0">
                未割当
              </Badge>
            )}
          </div>
          <code className="text-[9px] text-muted-foreground font-mono truncate block leading-tight">
            {eventKey}
          </code>
        </div>
      </div>

      {/* 中央 1: 割当て音源名 (mobile では非表示で行幅確保) */}
      <div className="hidden sm:block shrink min-w-0 w-[20%]">
        <span
          className="font-mono text-[11px] text-muted-foreground truncate block"
          title={effectivePath || "(未割当)"}
        >
          {isUnassigned ? "(未割当)" : fname}
        </span>
      </div>

      {/* 中央 2: ▶ + 波形 + 時間 (1 行) */}
      <div className="flex-1 min-w-0 flex items-center gap-1.5">
        {!isUnassigned ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onToggle(effectivePath)}
              disabled={!ready}
              className="h-6 w-6 min-h-0 min-w-0 p-0 shrink-0"
              aria-label={isPlaying ? "停止" : "再生"}
            >
              {isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            </Button>
            <SoundWaveform
              peaks={WAVEFORM_PEAKS[effectivePath] ?? []}
              isActive={isPlaying}
              progress={isPlaying ? progress : 0}
              onSeek={seekHandler}
              height={18}
              touchMinHeight={0}
              ariaLabel={`${fname} の波形 (クリックでシーク)`}
            />
            <SoundTime
              duration={WAVEFORM_DURATIONS[effectivePath] ?? 0}
              progress={isPlaying ? progress : 0}
              className="text-[10px]"
            />
          </>
        ) : (
          <span className="text-[10px] text-muted-foreground italic">音源なし</span>
        )}
      </div>

      {/* 右: 変更リンク */}
      <Link
        href={href}
        aria-label={`${label} の音源を変更`}
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "shrink-0 h-7 text-xs px-2",
        )}
      >
        変更
        <ChevronRight className="w-3 h-3 ml-0.5" />
      </Link>
    </Card>
  );
}

export default function SoundTunerPage() {
  // dev page では BGM 停止
  useBgm(null);
  const [tab, setTab] = useState<Tab>("sfx");
  const sfxOverrides = useSoundOverrides();
  const bgmOverrides = useBgmOverrides();
  const sfxOverrideCount = Object.keys(sfxOverrides).length;
  const bgmOverrideCount = Object.keys(bgmOverrides).length;

  // インラインプレビュー (1 ページ全体で共有)
  const player = usePreviewPlayer();
  const unlockedRef = useRef(false);

  const onToggle = useCallback(
    (path: string) => {
      if (!unlockedRef.current) {
        unlockedRef.current = true;
        void prepareAudio();
      }
      player.toggle(path);
    },
    [player],
  );

  const onSeek = useCallback(
    (path: string, ratio: number) => {
      if (!unlockedRef.current) {
        unlockedRef.current = true;
        void prepareAudio();
      }
      player.playFrom(path, ratio);
    },
    [player],
  );

  const isSfxTab = tab === "sfx";
  const overrideCount = isSfxTab ? sfxOverrideCount : bgmOverrideCount;

  return (
    <main className="h-dvh flex flex-col bg-background">
      {/* ===== 固定ヘッダ ===== */}
      <header className="shrink-0 bg-background/95 backdrop-blur-sm border-b border-border/50 z-10">
        <div className="max-w-3xl mx-auto px-4 py-2.5 sm:py-3 flex flex-col gap-2">
          <div className="flex items-start gap-3">
            <Link
              href="/dev"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mt-0.5 shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
              開発者ツール
            </Link>
            <div className="flex-1 min-w-0">
              <h1 className="text-base sm:text-lg font-bold leading-tight">音源調整ツール</h1>
              <p className="text-[10px] sm:text-xs text-muted-foreground leading-tight">
                各操作 (SFX) / 各画面 (BGM) に割り当てる音源を選択
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => (isSfxTab ? resetAllSoundOverrides() : resetAllBgmOverrides())}
              disabled={overrideCount === 0}
              className="h-7 text-xs px-2 shrink-0"
              title={`${isSfxTab ? "SFX" : "BGM"} のオーバーライドを全リセット`}
            >
              <RotateCcw className="w-3 h-3 mr-1" />
              リセット
            </Button>
          </div>

          {/* タブ */}
          <div role="tablist" aria-label="音源カテゴリ" className="flex gap-0.5 border-b -mb-2.5 sm:-mb-3">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "sfx"}
              onClick={() => setTab("sfx")}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border-b-2 transition-colors",
                tab === "sfx"
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Volume2 className="w-3.5 h-3.5" />
              SFX
              <Badge variant="outline" className="text-[10px] ml-0.5 h-4 px-1 leading-none">
                {SFX_EVENT_KEYS.length}
              </Badge>
              {sfxOverrideCount > 0 && (
                <Badge variant="default" className="text-[10px] h-4 px-1 leading-none">
                  {sfxOverrideCount}
                </Badge>
              )}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "bgm"}
              onClick={() => setTab("bgm")}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border-b-2 transition-colors",
                tab === "bgm"
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Music className="w-3.5 h-3.5" />
              BGM
              <Badge variant="outline" className="text-[10px] ml-0.5 h-4 px-1 leading-none">
                {BGM_EVENT_KEYS.length}
              </Badge>
              {bgmOverrideCount > 0 && (
                <Badge variant="default" className="text-[10px] h-4 px-1 leading-none">
                  {bgmOverrideCount}
                </Badge>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* ===== スクロール領域 ===== */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-3 flex flex-col gap-1.5">
          {isSfxTab
            ? SFX_EVENT_KEYS.map((key) => {
                const defaultPath = SFX_FILES[key] ?? "";
                const overridePath = sfxOverrides[key];
                const effectivePath = overridePath ?? defaultPath;
                const isOverridden = overridePath !== undefined;
                const isUnassigned = !effectivePath;
                return (
                  <EventRow
                    key={key}
                    eventKey={key}
                    label={SFX_EVENT_LABELS[key]}
                    effectivePath={effectivePath}
                    isOverridden={isOverridden}
                    isUnassigned={isUnassigned}
                    activePath={player.activePath}
                    progress={player.progress}
                    ready={player.ready}
                    onToggle={onToggle}
                    onSeek={onSeek}
                    href={`/dev/sound-tuner/${key}`}
                  />
                );
              })
            : BGM_EVENT_KEYS.map((key: BgmEventKey) => {
                const defaultPath = BGM_FILES[key] ?? "";
                const overridePath = bgmOverrides[key];
                const effectivePath = overridePath ?? defaultPath;
                const isOverridden = overridePath !== undefined;
                const isUnassigned = !effectivePath;
                return (
                  <EventRow
                    key={key}
                    eventKey={key}
                    label={BGM_EVENT_LABELS[key]}
                    effectivePath={effectivePath}
                    isOverridden={isOverridden}
                    isUnassigned={isUnassigned}
                    activePath={player.activePath}
                    progress={player.progress}
                    ready={player.ready}
                    onToggle={onToggle}
                    onSeek={onSeek}
                    href={`/dev/sound-tuner/${key}`}
                    Icon={Music}
                  />
                );
              })}
          <p className="text-[10px] text-muted-foreground text-center mt-2 mb-1">
            設定はブラウザの localStorage (
            <code className="font-mono">dev:sound-overrides:v1</code> /
            <code className="font-mono">dev:bgm-overrides:v1</code>) に保存される。
            未割当 (空文字 src) のイベントは playSfx 内で skip され無音になります。
          </p>
        </div>
      </div>

    </main>
  );
}
