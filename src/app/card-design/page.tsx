// Issue #110: カード裏面デザイン設定ページ。
// 各案のプレビューを並べ、クリックで CardBackProvider に保存する。
// 結果は山札 (deck-pile.tsx) と相手手札裏 (card-view.tsx) にリアルタイムで反映される。
"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { useCardBackStyle } from "@/components/card-back/card-back-provider";
import {
  CARD_BACK_STYLES,
  CARD_BACK_STYLE_LIST,
  type CardBackStyle,
} from "@/components/card-back/style-options";
import type { MockSize } from "@/components/card-back/sizes";
import { AppBackground } from "@/components/layout/app-background";
import { cn } from "@/lib/utils";

const NORMAL_SIZES: MockSize[] = ["sm", "md", "lg"];

interface DeckPreviewProps {
  Component: (typeof CARD_BACK_STYLES)[CardBackStyle]["Component"];
  size: "md" | "lg";
  count: number;
}

// 山札の積み重ね表現を再現 (deck-pile.tsx STACK_MAX=4 と整合)。
function DeckStackPreview({ Component, size, count }: DeckPreviewProps) {
  const stackCount = Math.min(count - 1, 4);
  const offsetX = size === "md" ? 0.8 : 1;
  const offsetY = size === "md" ? 1.5 : 2;
  const widthClass = size === "md" ? "w-32" : "w-40";
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={`relative ${widthClass}`}
        style={{
          paddingRight: stackCount * offsetX,
          paddingBottom: stackCount * offsetY,
        }}
      >
        {Array.from({ length: stackCount }).map((_, i) => {
          const ox = (stackCount - i) * offsetX;
          const oy = (stackCount - i) * offsetY;
          return (
            <div
              key={i}
              className="absolute top-0 left-0"
              style={{ transform: `translate(${ox}px, ${oy}px)`, zIndex: i }}
            >
              <Component size={size} className="brightness-75 opacity-95" />
            </div>
          );
        })}
        <div className="relative z-10">
          <Component size={size} />
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white pointer-events-none">
            <div className="text-[11px] font-medium opacity-90 leading-none mt-2 drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">
              山札
            </div>
            <div className="text-base font-bold tabular-nums leading-none mt-1 drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">
              ×{count}
            </div>
          </div>
        </div>
      </div>
      <span className="text-[10px] text-muted-foreground">山札風 ({size})</span>
    </div>
  );
}

function SizeLabeled({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      {children}
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}

export default function CardDesignPage() {
  const { style: currentStyle, setStyle } = useCardBackStyle();

  return (
    <main className="min-h-dvh pb-16">
      <AppBackground variant="page" />
      {/* Step S2 (Issue #107): ホームリンク + 説明書きエリアを sticky 固定。
          スクロール時もヘッダが画面上端に残る。背景は半透明 + backdrop-blur で
          下のリストが透けないようにする。 */}
      <header className="sticky top-0 z-40 bg-background/90 backdrop-blur-sm border-b border-border/50">
        <div className="max-w-5xl mx-auto px-4 py-3 sm:py-4 w-full flex items-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            aria-label="ホームへ戻る"
          >
            <ArrowLeft className="w-4 h-4" />
            ホーム
          </Link>
          <div className="flex-1">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
              カードデザイン
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground">
              山札と相手手札の裏面スタイルを選びます。選択は端末に保存されます。
            </p>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 pt-4 sm:pt-6 w-full">
        <div className="space-y-4">
          {CARD_BACK_STYLE_LIST.map((styleKey) => {
            const entry = CARD_BACK_STYLES[styleKey];
            const Component = entry.Component;
            const isSelected = styleKey === currentStyle;
            return (
              <button
                key={styleKey}
                type="button"
                onClick={() => setStyle(styleKey)}
                aria-pressed={isSelected}
                className={cn(
                  "relative w-full text-left rounded-xl border-2",
                  "bg-white dark:bg-slate-900/60 shadow-sm cursor-pointer",
                  // Step S2 (Issue #107): デザイン選択画面では黄色を被せず lift のみ
                  "card-hover-lift",
                  isSelected
                    ? "border-lime-400 ring-2 ring-lime-300/50"
                    : "border-border",
                )}
              >
                <div className="relative z-10 p-4 flex flex-col gap-3">
                  <div>
                    <h2 className="text-base font-bold">{entry.label}</h2>
                    <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
                      {entry.description}
                    </p>
                  </div>
                  {/* Step S2: モバイルでカード本体を縮小 (sizes.ts は対局画面と
                      共通のため触らず、このページのプレビュー領域のみ override) */}
                  <div className="card-design-mobile-shrink flex flex-wrap items-end gap-3 sm:gap-5">
                    {NORMAL_SIZES.map((s) => (
                      <SizeLabeled key={s} label={s}>
                        <Component size={s} />
                      </SizeLabeled>
                    ))}
                    <DeckStackPreview Component={Component} size="md" count={15} />
                    <DeckStackPreview Component={Component} size="lg" count={15} />
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <p className="text-xs text-muted-foreground mt-6 text-center">
          設定はこの端末のみに保存されます (ログイン同期は将来対応予定)。
        </p>
      </div>
    </main>
  );
}
