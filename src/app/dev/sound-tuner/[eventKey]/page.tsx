"use client";

// Issue #79: 音源調整ツール 詳細ページ。
// 1 つの SFX イベントに対して、利用可能な全 mp3 を行リスト化し、各行で
// プレビュー再生 + 「このイベントに割り当て」を可能にする。
//
// プレビューは詳細ページ専用の Howler ラッパ (usePreviewPlayer) を使い、
// useSound 本体には触れない。連打時は直前再生を stop してから新規 play、
// ページ遷移 cleanup でも stop する。
//
// 不正な eventKey は notFound() で 404。

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Check, Play, RotateCcw } from "lucide-react";

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

type HowlInstance = {
  play: () => number | undefined;
  stop: () => void;
  unload: () => void;
  duration: () => number;
};

type HowlConstructor = new (options: {
  src: string[];
  volume?: number;
  preload?: boolean;
  onload?: () => void;
}) => HowlInstance;

function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

function isSfxEventKey(s: string): s is SfxEventKey {
  return (SFX_EVENT_KEYS as readonly string[]).includes(s);
}

// 詳細ページ専用の小さな Howler ラッパ。
// ・パス指定で再生 (useSound は event key 指定なので別系統)
// ・直前再生中の Howl を stop してから新規 play (連打 OK)
// ・ページ unmount cleanup で再生停止
// ・各 path につき 1 回だけ Howl を生成しキャッシュ
function usePreviewPlayer() {
  const HowlRef = useRef<HowlConstructor | null>(null);
  const cacheRef = useRef<Map<string, HowlInstance>>(new Map());
  const currentRef = useRef<HowlInstance | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // cleanup 時の ref 参照ズレ警告対策で effect 内でキャプチャ
    const cache = cacheRef.current;
    const current = currentRef;
    import("howler").then(({ Howl }) => {
      if (cancelled) return;
      HowlRef.current = Howl as unknown as HowlConstructor;
      setReady(true);
    });
    return () => {
      cancelled = true;
      // ページ遷移時に再生停止 + Howl 解放
      current.current?.stop();
      cache.forEach((h) => h.unload());
      cache.clear();
      current.current = null;
    };
  }, []);

  const preview = useCallback((path: string) => {
    if (!HowlRef.current) return;
    currentRef.current?.stop();
    let howl = cacheRef.current.get(path);
    if (!howl) {
      howl = new HowlRef.current({ src: [path], volume: 0.7, preload: true });
      cacheRef.current.set(path, howl);
    }
    currentRef.current = howl;
    howl.play();
  }, []);

  const getDuration = useCallback((path: string): number | null => {
    const h = cacheRef.current.get(path);
    if (!h) return null;
    const d = h.duration();
    return d > 0 ? d : null;
  }, []);

  return { preview, getDuration, ready };
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

  const { preview, ready } = usePreviewPlayer();
  const unlockedRef = useRef(false);

  // 初回 ▶ クリック時に Safari の AudioContext を unlock。
  const handlePreview = useCallback(
    (path: string) => {
      if (!unlockedRef.current) {
        unlockedRef.current = true;
        void prepareAudio();
      }
      preview(path);
    },
    [preview],
  );

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
        <Card className="p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-[11px] text-muted-foreground">現在の割り当て</div>
              <div className="font-mono text-sm truncate">{basename(effectivePath)}</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePreview(effectivePath)}
                disabled={!ready}
                className="min-h-[44px]"
                aria-label="現在の音源を再生"
              >
                <Play className="w-3.5 h-3.5" />
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
        </Card>

        {/* 音源リスト */}
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-bold text-muted-foreground px-1">音源を選ぶ</h2>
          {AUDIO_MANIFEST.sfxUrls.map((path) => {
            const isSelected = effectivePath === path;
            const isDefault = defaultPath === path;
            return (
              <Card
                key={path}
                className={`p-3 flex items-center gap-3 ${isSelected ? "bg-primary/5 border-primary/40" : ""}`}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handlePreview(path)}
                  disabled={!ready}
                  className="min-h-[44px] min-w-[44px] shrink-0"
                  aria-label={`${basename(path)} を再生`}
                >
                  <Play className="w-4 h-4" />
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
              </Card>
            );
          })}
        </section>
      </div>
    </main>
  );
}
