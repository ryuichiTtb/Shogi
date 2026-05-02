// Issue #110: カード裏面デザイン検討用モック比較ページ。
// 採用案決定後、CardBack 共通コンポーネントとして本実装し、
// このページとモックコンポーネント (src/components/card-back-mocks/) は削除する。
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { CardBackEmblem } from "@/components/card-back-mocks/back-emblem";
import { CardBackSeigaiha } from "@/components/card-back-mocks/back-seigaiha";
import { CardBackManaCrystal } from "@/components/card-back-mocks/back-mana-crystal";
import { CardBackMinimal } from "@/components/card-back-mocks/back-minimal";
import { CardBackDiagonal } from "@/components/card-back-mocks/back-diagonal";
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
    desc: "深紺×ゴールド。中央に駒シルエット +「玉」。放射状の薄い光線が 40s でゆっくり回転、エンブレムは 6s で脈動。表面の super_rare(ゴールド枠)とトーン共有。",
    Component: CardBackEmblem,
  },
  {
    key: "seigaiha",
    label: "案 B: 青海波 + 金箔",
    desc: "藍ベースに青海波(波柄)を全面リピート。中央に駒シルエット +「将」。左→右の薄ゴールド sheen が 5s で通過。和の世界観強め、対局の格調を演出。",
    Component: CardBackSeigaiha,
  },
  {
    key: "mana-crystal",
    label: "案 C: マナクリスタル",
    desc: "深紫グラデ。中央から滲む光渦(24s 回転)+ 💎 菱形格子。中央 💎 が 4s で呼吸。マナ概念と直結、表面の epic(紫枠)と近い世界観。将棋感は薄め。",
    Component: CardBackManaCrystal,
  },
  {
    key: "minimal",
    label: "案 D: 黒漆「将」ミニマル",
    desc: "漆黒+シルバー。筆文字「将」を中央配置、四隅に金菱形、内側ゴールド細枠。8s で薄シマー。最も控えめで sm でも崩れにくく、表面の派手演出と喧嘩しない。",
    Component: CardBackMinimal,
  },
  {
    key: "diagonal",
    label: "案 E: 駒型タイル + 斜め金線",
    desc: "藍×金。45° 斜めの細いゴールドストライプが 10s でスライド、中央は駒シルエット +「歩」(common 寄りの中庸トーン)。将棋らしさと程よい動き。",
    Component: CardBackDiagonal,
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
              Issue #110 — 5 案を比較し採用案を決定する
            </p>
          </div>
        </header>

        <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
          各案を sm / md / lg / xl と山札風(md・lg) で並べています。実際のカード演出は{" "}
          <code className="px-1 rounded bg-muted">/</code> ホーム→対局画面 で確認してください。
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
