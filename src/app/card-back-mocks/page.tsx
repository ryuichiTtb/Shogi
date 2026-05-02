// Issue #110: カード裏面デザイン検討用モック比較ページ。
// 採用案決定後、CardBack 共通コンポーネントとして本実装し、
// このページとモックコンポーネント (src/components/card-back-mocks/) は削除する。
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { CardBackEmblem } from "@/components/card-back-mocks/back-emblem";
import { CardBackSeigaiha } from "@/components/card-back-mocks/back-seigaiha";
import { CardBackMinimal } from "@/components/card-back-mocks/back-minimal";
import type { MockSize } from "@/components/card-back-mocks/sizes";

export const metadata = {
  title: "カード裏面モック | カード将棋",
};

type BackComponent = (props: { size?: MockSize; fullWidth?: boolean }) => React.ReactNode;

interface Variant {
  key: string;
  label: string;
  desc: string;
  Component: BackComponent;
}

const VARIANTS: Variant[] = [
  {
    key: "emblem",
    label: "案 A: 玉将エンブレム",
    desc: "深紺グラデ + 45° の金色斜線(左下→右上、静止)。3.5s で広い閃光が左→右に通過し、斜線が呼応して光る。中央に駒シルエット(金属グラデ)が 6s で脈動。内側ゴールド細枠 + 四隅菱形。",
    Component: CardBackEmblem,
  },
  {
    key: "seigaiha",
    label: "案 B: 青海波 + 金箔",
    desc: "深紺グラデに青海波(波柄)を全面リピート(静止)。中央に駒シルエット。5s で薄ゴールド sheen が通過。内側ゴールド細枠 + 四隅菱形。",
    Component: CardBackSeigaiha,
  },
  {
    key: "minimal",
    label: "案 D: 黒漆ミニマル",
    desc: "黒ベース(画面の 7 割超)+ 左上の小さな黄色→金茶ラジアル + 控えめな白ハイライト。中央に大きな駒シルエット(金属グラデ)、四隅に金菱形+内側ゴールド細枠。8s で薄シマー。",
    Component: CardBackMinimal,
  },
];

const NORMAL_SIZES: MockSize[] = ["sm", "md", "lg"];

// 山札の積み重ね表現を再現 (deck-pile.tsx STACK_MAX=4 と整合)。
function DeckStackPreview({
  Component,
  size,
  count,
}: {
  Component: BackComponent;
  size: "md" | "lg";
  count: number;
}) {
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
              style={{
                transform: `translate(${ox}px, ${oy}px)`,
                zIndex: i,
              }}
            >
              <Component size={size} />
            </div>
          );
        })}
        <div className="relative z-10">
          <Component size={size} />
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white pointer-events-none">
            <div className="text-[11px] font-medium opacity-90 leading-none mt-2">
              山札
            </div>
            <div className="text-base font-bold tabular-nums leading-none mt-1">
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

export default function CardBackMocksPage() {
  return (
    <main className="min-h-dvh bg-gradient-to-b from-slate-50 dark:from-slate-950 to-background pb-16">
      <div className="max-w-5xl mx-auto px-4 pt-4 sm:pt-6 w-full">
        <header className="flex items-center gap-3 mb-4 sm:mb-6">
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
              カード裏面モック
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Issue #110 — A / B / D の 3 案 (E は A に集約のため廃止)
            </p>
          </div>
        </header>

        <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
          各案を sm / md / lg / xl と山札風(md・lg) で並べています。中央の駒シルエットは
          将来ユーザー設定でアイコン差し替え可能にする想定で、文字は入れていません。
          現状の裏面(山札 amber 系・相手手札 indigo 系)を置換する候補です。
        </p>

        {VARIANTS.map((v) => {
          const Component = v.Component;
          return (
            <section key={v.key} className="mb-10">
              <h2 className="text-lg font-bold mb-1">{v.label}</h2>
              <p className="text-xs sm:text-sm text-muted-foreground mb-3 leading-relaxed">
                {v.desc}
              </p>

              {/* 通常サイズ + 山札風 */}
              <div className="flex flex-wrap items-end gap-5 p-4 rounded-lg bg-white dark:bg-slate-900/60 shadow-sm border">
                {NORMAL_SIZES.map((s) => (
                  <SizeLabeled key={s} label={s}>
                    <Component size={s} />
                  </SizeLabeled>
                ))}
                <DeckStackPreview Component={Component} size="md" count={15} />
                <DeckStackPreview Component={Component} size="lg" count={15} />
              </div>

              {/* xl (ドロー演出用、ページ幅をはみ出す可能性があるため横スクロール) */}
              <div className="mt-3 p-4 rounded-lg bg-white dark:bg-slate-900/60 shadow-sm border overflow-x-auto">
                <SizeLabeled label="xl (ドロー演出時の中央拡大)">
                  <Component size="xl" />
                </SizeLabeled>
              </div>
            </section>
          );
        })}

        <footer className="mt-12 pt-6 border-t text-xs text-muted-foreground">
          採用案が決まったら、`CardBack` 共通コンポーネントとして
          [card-view.tsx](src/components/game/card-shogi/card-view.tsx) と{" "}
          [deck-pile.tsx](src/components/game/card-shogi/deck-pile.tsx) から参照する。
        </footer>
      </div>
    </main>
  );
}
