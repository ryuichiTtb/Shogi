"use client";

// Issue #79: 音源調整ツール 操作一覧ページ。
// SFX (18 event) と BGM (4 event) をタブで切替表示し、各イベントの
// 現在割り当てファイル名 + 「変更」ボタンから詳細ページに遷移する。
// オーバーライド適用状況とリセット導線をヘッダにまとめる。

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronRight, Music, RotateCcw, Volume2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { BGM_FILES, SFX_FILES } from "@/lib/audio/manifest";
import { useBgm } from "@/hooks/use-bgm";
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
  type SfxEventKey,
} from "@/lib/dev/sound-overrides";

type Tab = "sfx" | "bgm";

function basename(path: string): string {
  if (!path) return "";
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

export default function SoundTunerPage() {
  // dev page では BGM 停止
  useBgm(null);
  const [tab, setTab] = useState<Tab>("sfx");
  const sfxOverrides = useSoundOverrides();
  const bgmOverrides = useBgmOverrides();
  const sfxOverrideCount = Object.keys(sfxOverrides).length;
  const bgmOverrideCount = Object.keys(bgmOverrides).length;

  // SFX 用: 各 URL に対して「どのイベントが現在その URL を使っているか」のマップ。
  // オーバーライドを反映した実効 URL でグループ化。
  const sfxUsageByPath = new Map<string, SfxEventKey[]>();
  for (const key of SFX_EVENT_KEYS) {
    const url = sfxOverrides[key] ?? SFX_FILES[key] ?? "";
    if (!url) continue;
    const list = sfxUsageByPath.get(url) ?? [];
    list.push(key);
    sfxUsageByPath.set(url, list);
  }

  return (
    <main className="min-h-dvh bg-background p-4 sm:p-6">
      <div className="max-w-3xl mx-auto flex flex-col gap-4">
        <header className="flex items-start gap-3 mb-1">
          <Link
            href="/dev"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mt-1"
          >
            <ArrowLeft className="w-4 h-4" />
            開発者ツール
          </Link>
          <div className="flex-1">
            <h1 className="text-xl sm:text-2xl font-bold">音源調整ツール</h1>
            <p className="text-xs text-muted-foreground">
              各操作 (SFX イベント) / 各画面 (BGM イベント) に割り当てる音源を選択する。
              設定はブラウザの localStorage に保存される。
            </p>
          </div>
        </header>

        {/* タブ */}
        <div role="tablist" aria-label="音源カテゴリ" className="flex gap-1 border-b">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "sfx"}
            onClick={() => setTab("sfx")}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors min-h-[44px]",
              tab === "sfx"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Volume2 className="w-3.5 h-3.5" />
            SFX
            <Badge variant="outline" className="text-[10px] ml-1">
              {SFX_EVENT_KEYS.length}
            </Badge>
            {sfxOverrideCount > 0 && (
              <Badge variant="default" className="text-[10px]">
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
              "inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors min-h-[44px]",
              tab === "bgm"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Music className="w-3.5 h-3.5" />
            BGM
            <Badge variant="outline" className="text-[10px] ml-1">
              {BGM_EVENT_KEYS.length}
            </Badge>
            {bgmOverrideCount > 0 && (
              <Badge variant="default" className="text-[10px]">
                {bgmOverrideCount}
              </Badge>
            )}
          </button>
        </div>

        {/* オーバーライド状況サマリ + リセット (タブごと) */}
        <Card className="p-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm">オーバーライド</span>
            <Badge variant={(tab === "sfx" ? sfxOverrideCount : bgmOverrideCount) > 0 ? "default" : "outline"}>
              {tab === "sfx" ? sfxOverrideCount : bgmOverrideCount} 件
            </Badge>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => (tab === "sfx" ? resetAllSoundOverrides() : resetAllBgmOverrides())}
            disabled={(tab === "sfx" ? sfxOverrideCount : bgmOverrideCount) === 0}
            className="min-h-[36px]"
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
            このカテゴリをリセット
          </Button>
        </Card>

        {/* SFX 一覧 */}
        {tab === "sfx" && (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-bold text-muted-foreground px-1">SFX イベント一覧</h2>
            {SFX_EVENT_KEYS.map((key) => {
              const defaultPath = SFX_FILES[key] ?? "";
              const overridePath = sfxOverrides[key];
              const effectivePath = overridePath ?? defaultPath;
              const isOverridden = overridePath !== undefined;
              const isUnassigned = !effectivePath;
              const sharedWith = effectivePath
                ? (sfxUsageByPath.get(effectivePath) ?? []).filter((k) => k !== key)
                : [];

              return (
                <Card key={key} className="p-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm">{SFX_EVENT_LABELS[key]}</span>
                      <code className="text-[10px] text-muted-foreground font-mono">{key}</code>
                      {isOverridden && (
                        <Badge variant="default" className="text-[10px]">カスタム</Badge>
                      )}
                      {isUnassigned && (
                        <Badge variant="outline" className="text-[10px]">未割当</Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 truncate" title={effectivePath || "(未割当)"}>
                      <span className="font-mono">{isUnassigned ? "(未割当)" : basename(effectivePath)}</span>
                      {sharedWith.length > 0 && (
                        <span className="ml-2">
                          ← 共有: {sharedWith.map((k) => SFX_EVENT_LABELS[k]).join(", ")}
                        </span>
                      )}
                    </div>
                  </div>
                  <Link
                    href={`/dev/sound-tuner/${key}`}
                    aria-label={`${SFX_EVENT_LABELS[key]} の音源を変更`}
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-[44px] shrink-0")}
                  >
                    変更
                    <ChevronRight className="w-3.5 h-3.5 ml-1" />
                  </Link>
                </Card>
              );
            })}
          </section>
        )}

        {/* BGM 一覧 */}
        {tab === "bgm" && (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-bold text-muted-foreground px-1">BGM イベント一覧</h2>
            {BGM_EVENT_KEYS.map((key: BgmEventKey) => {
              const defaultPath = BGM_FILES[key] ?? "";
              const overridePath = bgmOverrides[key];
              const effectivePath = overridePath ?? defaultPath;
              const isOverridden = overridePath !== undefined;
              const isUnassigned = !effectivePath;

              return (
                <Card key={key} className="p-3 flex items-center gap-3">
                  <Music className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm">{BGM_EVENT_LABELS[key]}</span>
                      <code className="text-[10px] text-muted-foreground font-mono">{key}</code>
                      {isOverridden && (
                        <Badge variant="default" className="text-[10px]">カスタム</Badge>
                      )}
                      {isUnassigned && (
                        <Badge variant="outline" className="text-[10px]">未割当</Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 truncate" title={effectivePath || "(未割当)"}>
                      <span className="font-mono">{isUnassigned ? "(未割当)" : basename(effectivePath)}</span>
                    </div>
                  </div>
                  <Link
                    href={`/dev/sound-tuner/${key}`}
                    aria-label={`${BGM_EVENT_LABELS[key]} の音源を変更`}
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-[44px] shrink-0")}
                  >
                    変更
                    <ChevronRight className="w-3.5 h-3.5 ml-1" />
                  </Link>
                </Card>
              );
            })}
          </section>
        )}

        <p className="text-[11px] text-muted-foreground text-center mt-2">
          リセットすると localStorage の該当キー (
          <code className="font-mono">dev:sound-overrides:v1</code> /
          <code className="font-mono">dev:bgm-overrides:v1</code>) が削除され、manifest.ts の既定値に戻ります。
        </p>
      </div>
    </main>
  );
}
