// Issue #117: 新ホーム = カード将棋トップ。
// 旧ホームのモードタブ + 対局相手選択は /play (card-shogi) と /classic (standard) に分離した。
// このページは Hero ビジュアル + 機能タイル + 主要 CTA「相手を選ぶ」+ セカンダリ「通常将棋で遊ぶ」+ 履歴 を並べる。
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { History, Swords, Castle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ThemeSelector } from "@/components/game/theme-selector";
import { LoadingOverlay } from "@/components/loading-overlay";
import { useAssetPreloader } from "@/hooks/use-asset-preloader";
import { AppBackground } from "@/components/layout/app-background";
import { PageMotion } from "@/components/layout/page-motion";
import { CardShogiTiles } from "@/components/home/card-shogi-tiles";
import { HeroCardStack } from "@/components/home/hero-card-stack";
import { cn } from "@/lib/utils";

export default function Home() {
  const router = useRouter();
  const reduce = useReducedMotion();

  // ロビー段階で SFX を先読み。
  useAssetPreloader();

  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const isPending = pendingLabel !== null;

  function navigateTo(href: string, label = "読み込み中...") {
    if (isPending) return;
    setPendingLabel(label);
    router.push(href);
  }

  return (
    <PageMotion>
      <main className="flex flex-col min-h-dvh safe-area-inset overflow-x-hidden">
        <AppBackground variant="hero" />

        {/* ヘッダー (ThemeSelector を右上に配置、見出し付き) */}
        <div className="relative text-center pt-3 sm:pt-6 px-4 shrink-0">
          <div className="absolute top-2 right-4 sm:top-3">
            <ThemeSelector />
          </div>
          <motion.h1
            initial={!reduce ? { opacity: 0, y: 8 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.05, ease: "easeOut" }}
            className="text-2xl sm:text-4xl font-bold tracking-tight"
          >
            カード将棋
          </motion.h1>
          <motion.p
            initial={!reduce ? { opacity: 0, y: 8 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.13, ease: "easeOut" }}
            className="text-xs sm:text-sm text-muted-foreground"
            style={{ fontFamily: "var(--font-yuji-boku, inherit)" }}
          >
            駒とマナで奏でる、新しい一手
          </motion.p>
        </div>

        <div className="flex-1 flex flex-col max-w-2xl mx-auto w-full px-4 py-3 sm:py-5 space-y-3 sm:space-y-4">
          {/* Hero カードスタック */}
          <motion.div
            initial={!reduce ? { opacity: 0, y: 12 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.21, ease: "easeOut" }}
            className="flex justify-center pt-2 pb-3 sm:pt-3 sm:pb-4"
          >
            <HeroCardStack />
          </motion.div>

          {/* カード機能タイル */}
          <CardShogiTiles onNavigate={navigateTo} disabled={isPending} />

          {/* 主要 CTA: 相手を選ぶ → /play */}
          <motion.div
            initial={!reduce ? { opacity: 0, y: 8 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.32, ease: "easeOut" }}
          >
            <Button
              size="lg"
              onClick={() => navigateTo("/play", "対局画面を開いています...")}
              disabled={isPending}
              className={cn(
                "w-full text-base py-5 sm:py-6 font-bold",
                !reduce && "home-cta-pulse",
              )}
              aria-label="カード将棋の対局を始める"
            >
              <Swords className="w-5 h-5 mr-2" />
              相手を選ぶ
            </Button>
          </motion.div>

          {/* セカンダリ導線: 通常将棋で遊ぶ → /classic */}
          <motion.div
            initial={!reduce ? { opacity: 0, y: 8 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.38, ease: "easeOut" }}
          >
            <Button
              variant="outline"
              size="lg"
              onClick={() => navigateTo("/classic", "通常将棋を開いています...")}
              disabled={isPending}
              className="w-full text-sm sm:text-base py-3 sm:py-4 bg-card/60 backdrop-blur-sm"
              aria-label="通常将棋で遊ぶ"
            >
              <Castle className="w-4 h-4 mr-2" />
              通常将棋で遊ぶ
            </Button>
          </motion.div>

          {/* 履歴リンク */}
          <motion.div
            initial={!reduce ? { opacity: 0 } : false}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, delay: 0.45 }}
            className="text-center pt-1"
          >
            <button
              type="button"
              onClick={() => navigateTo("/history", "履歴を読み込んでいます...")}
              disabled={isPending}
              className={cn(
                "inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors",
                "disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer",
              )}
            >
              <History className="w-4 h-4" />
              対局履歴を見る
            </button>
          </motion.div>
        </div>

        <LoadingOverlay show={isPending} fullScreen message={pendingLabel ?? "読み込み中..."} />
      </main>
    </PageMotion>
  );
}
