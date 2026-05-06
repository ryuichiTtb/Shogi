"use client";

// Issue #79: 音源調整ツール 操作一覧ページ。
// 12 SFX イベントを縦リストで表示し、各イベントの現在割り当てファイル名 +
// 「変更」ボタンから詳細ページ (/dev/sound-tuner/[eventKey]) に遷移する。
// オーバーライド適用状況とリセット導線をヘッダにまとめる。
//
// シミュレータ Section B は PR 2 で追加予定。本 PR はストア + 一覧/詳細の
// UI 構築までで止め、本番ゲームへの影響をゼロに保つ (useSound 未連携)。

import Link from "next/link";
import { ArrowLeft, ChevronRight, RotateCcw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { SFX_FILES } from "@/lib/audio/manifest";
import { useBgm } from "@/hooks/use-bgm";
import {
  resetAllSoundOverrides,
  SFX_EVENT_KEYS,
  SFX_EVENT_LABELS,
  useSoundOverrides,
  type SfxEventKey,
} from "@/lib/dev/sound-overrides";

// ファイルパスから表示用のファイル名 (basename) を取り出す。
function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

export default function SoundTunerPage() {
  // Issue #79 (PR 1.7): dev page では BGM 停止
  useBgm(null);
  const overrides = useSoundOverrides();
  const overrideCount = Object.keys(overrides).length;

  // 各 SFX URL に対して「どのイベントが現在その URL を使っているか」のマップ。
  // 一覧の「他で使用」表示に使う。オーバーライドを反映した実効 URL でグループ化。
  const usageByPath = new Map<string, SfxEventKey[]>();
  for (const key of SFX_EVENT_KEYS) {
    const url = overrides[key] ?? SFX_FILES[key];
    const list = usageByPath.get(url) ?? [];
    list.push(key);
    usageByPath.set(url, list);
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
              各操作 (SFX イベント) に割り当てる mp3 を選択する。設定はブラウザの localStorage (
              <code className="font-mono">dev:sound-overrides:v1</code>) に保存される。
            </p>
          </div>
        </header>

        {/* オーバーライド状況サマリ + 全リセット */}
        <Card className="p-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm">オーバーライド</span>
            <Badge variant={overrideCount > 0 ? "default" : "outline"}>
              {overrideCount} 件
            </Badge>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => resetAllSoundOverrides()}
            disabled={overrideCount === 0}
            className="min-h-[36px]"
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
            全リセット
          </Button>
        </Card>

        {/* Section A: 操作一覧 */}
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-bold text-muted-foreground px-1">操作一覧</h2>
          {SFX_EVENT_KEYS.map((key) => {
            const defaultPath = SFX_FILES[key];
            const overridePath = overrides[key];
            const effectivePath = overridePath ?? defaultPath;
            const isOverridden = overridePath !== undefined;
            // 同じファイルを共有する他のイベント (自分以外)
            const sharedWith = (usageByPath.get(effectivePath) ?? []).filter((k) => k !== key);

            return (
              <Card key={key} className="p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-sm">{SFX_EVENT_LABELS[key]}</span>
                    <code className="text-[10px] text-muted-foreground font-mono">{key}</code>
                    {isOverridden && (
                      <Badge variant="default" className="text-[10px]">カスタム</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 truncate">
                    <span className="font-mono">{basename(effectivePath)}</span>
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

        <p className="text-[11px] text-muted-foreground text-center mt-2">
          全リセットすると localStorage の <code className="font-mono">dev:sound-overrides:v1</code> が削除され、manifest.ts の既定値に戻ります。
        </p>
      </div>
    </main>
  );
}
