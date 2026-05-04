// Issue #117: カード将棋の対局相手・手番選択画面。
// 旧ホーム (page.tsx) のセットアップ部分を分離し、card-shogi 専用の対局開始フローを提供する。
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { MatchSetup } from "@/components/home/match-setup";
import { AppBackground } from "@/components/layout/app-background";
import { PageMotion } from "@/components/layout/page-motion";
import { ThemeSelector } from "@/components/game/theme-selector";

export const metadata = {
  title: "対局を始める | カード将棋",
};

export default function PlayPage() {
  return (
    <PageMotion>
      <main className="flex flex-col h-dvh safe-area-inset overflow-hidden">
        <AppBackground variant="setup" />

        <div className="relative text-center py-2 sm:py-6 px-4 shrink-0">
          <div className="absolute top-2 left-4 sm:top-3">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              aria-label="ホームへ戻る"
            >
              <ArrowLeft className="w-4 h-4" />
              ホーム
            </Link>
          </div>
          <div className="absolute top-2 right-4 sm:top-3">
            <ThemeSelector />
          </div>
          <h1 className="text-xl sm:text-3xl font-bold tracking-tight">対局を始める</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">カード将棋</p>
        </div>

        <MatchSetup mode="card-shogi" />
      </main>
    </PageMotion>
  );
}
