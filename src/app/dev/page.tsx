"use client";

// Issue #79: 開発者ツール一覧ページ。
// /dev/* 配下の各 dev ツールへの導線を集約する。今後 dev ツールが
// 増えた場合はこの一覧に 1 件追記するだけで discoverable になる。

import Link from "next/link";
import { ArrowLeft, ChevronRight, Music, Plane, LayoutGrid } from "lucide-react";

import { Card } from "@/components/ui/card";
import { useBgm } from "@/hooks/use-bgm";

interface DevTool {
  href: string;
  title: string;
  description: string;
  Icon: React.ComponentType<{ className?: string }>;
}

const DEV_TOOLS: readonly DevTool[] = [
  {
    href: "/dev/piece-flight",
    title: "駒フライト調整",
    description:
      "歩戻し / 駒戻し / 二歩指し / 王手崩し で使われている駒移動アニメのチューニング",
    Icon: Plane,
  },
  {
    href: "/dev/card-shogi-layout",
    title: "カード将棋レイアウト検証",
    description:
      "カード将棋画面の精密配置 (盤・カード・トラップ枠) のフィクスチャ検証",
    Icon: LayoutGrid,
  },
  {
    href: "/dev/sound-tuner",
    title: "音源調整ツール",
    description:
      "各 SFX イベントに割り当てる mp3 を選択 / プレビュー / 永続化",
    Icon: Music,
  },
];

export default function DevIndexPage() {
  // Issue #79 (PR 1.7): dev pages では BGM を停止
  useBgm(null);
  return (
    <main className="min-h-dvh bg-background p-4 sm:p-6">
      <div className="max-w-3xl mx-auto flex flex-col gap-4">
        <header className="flex items-start gap-3 mb-1">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mt-1"
          >
            <ArrowLeft className="w-4 h-4" />
            ホーム
          </Link>
          <div className="flex-1">
            <h1 className="text-xl sm:text-2xl font-bold">開発者ツール</h1>
            <p className="text-xs text-muted-foreground">
              アニメーション・レイアウト・サウンド等の試行錯誤に使う dev 専用ページ群
            </p>
          </div>
        </header>

        <section className="grid gap-2 lg:grid-cols-2">
          {DEV_TOOLS.map(({ href, title, description, Icon }) => (
            <Link
              key={href}
              href={href}
              className="group"
              aria-label={title}
            >
              <Card className="p-4 h-full flex items-start gap-3 hover:border-primary/40 transition-colors min-h-[80px]">
                <Icon className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm flex items-center gap-1">
                    {title}
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 leading-snug">
                    {description}
                  </p>
                </div>
              </Card>
            </Link>
          ))}
        </section>
      </div>
    </main>
  );
}
