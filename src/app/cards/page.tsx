import { ArrowLeft } from "lucide-react";
import { CardCatalogGrid } from "@/components/cards/card-catalog-grid";
import { ALL_CARD_DEFS } from "@/lib/shogi/cards/definitions";
import { AppBackground } from "@/components/layout/app-background";
import { BgmProvider } from "@/components/audio/bgm-provider";
import { AuthControls } from "@/components/auth/auth-controls";
import { MaskedLink } from "@/components/navigation/masked-link";

export const metadata = {
  title: "カード一覧 | カード将棋",
};

// マスターカタログ一覧ページ (Issue #102)
// ヘッダ+フィルタを上部固定、グリッド領域のみ縦スクロール。
export default function CardsPage() {
  return (
    <main className="h-dvh flex flex-col">
      <BgmProvider eventKey="bgm_home" />
      <AppBackground variant="page" />
      {/* ヘッダ帯 (card-design と同じ視覚パターン): 半透明 + backdrop-blur で
          スクロール時に下のリストが透けないようにし、border-b で領域を分離。 */}
      <header className="shrink-0 bg-background/90 backdrop-blur-sm border-b border-border/50">
        <div className="max-w-4xl mx-auto px-4 py-3 sm:py-4 w-full flex items-center gap-3">
          <MaskedLink
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            aria-label="ホームへ戻る"
            loadingVariant="spinner"
          >
            <ArrowLeft className="w-4 h-4" />
            ホーム
          </MaskedLink>
          <div className="flex-1">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">カード一覧</h1>
            <p className="text-xs sm:text-sm text-muted-foreground">
              カード将棋のマスターカタログ (BETA)
            </p>
          </div>
          <AuthControls variant="indicator" />
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 pt-3 sm:pt-4 pb-2 w-full flex flex-col flex-1 min-h-0">
        <CardCatalogGrid cards={ALL_CARD_DEFS} />
      </div>
    </main>
  );
}
