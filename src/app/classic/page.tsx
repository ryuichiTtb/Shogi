// Issue #117: 通常将棋の対局相手・手番選択画面 (旧ホーム相当、モードタブなし)。
// 新ホーム (/) は card-shogi トップに作り変えたため、standard モードの専用導線として分離。
import { ArrowLeft, History } from "lucide-react";
import { MatchSetup } from "@/components/home/match-setup";
import { AppBackground } from "@/components/layout/app-background";
import { PageMotion } from "@/components/layout/page-motion";
import { ThemeSelector } from "@/components/game/theme-selector";
import { BgmProvider } from "@/components/audio/bgm-provider";
import { AuthControls } from "@/components/auth/auth-controls";
import { MaskedLink } from "@/components/navigation/masked-link";

export const metadata = {
  title: "通常将棋",
};

export default function ClassicPage() {
  return (
    <PageMotion>
      <main className="flex flex-col h-dvh safe-area-inset overflow-hidden">
        <BgmProvider eventKey="bgm_match_setup" />
        <AppBackground variant="setup" />

        <div className="relative text-center py-2 sm:py-6 px-4 shrink-0">
          <div className="absolute top-2 left-4 sm:top-3">
            <MaskedLink
              href="/"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              aria-label="ホームへ戻る"
              loadingVariant="spinner"
            >
              <ArrowLeft className="w-4 h-4" />
              ホーム
            </MaskedLink>
          </div>
          <div className="absolute top-2 right-4 sm:top-3 flex items-center gap-2">
            <AuthControls variant="indicator" />
            <ThemeSelector />
          </div>
          <h1 className="text-xl sm:text-3xl font-bold tracking-tight">通常将棋</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">AIと正統派ルールで対局</p>
        </div>

        <MatchSetup mode="standard" />

        {/* 対局履歴へのリンク (旧ホームと同じ位置に配置) */}
        <div className="text-center shrink-0 px-4 pb-3">
          <MaskedLink
            href="/history"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <History className="w-4 h-4" />
            対局履歴を見る
          </MaskedLink>
        </div>
      </main>
    </PageMotion>
  );
}
