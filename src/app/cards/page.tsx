import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CardCatalogGrid } from "@/components/cards/card-catalog-grid";
import { ALL_CARD_DEFS } from "@/lib/shogi/cards/definitions";

export const metadata = {
  title: "カード一覧 | カード将棋",
};

// マスターカタログ一覧ページ (Issue #102)
// 全カードを CardView で並べ、ステータス/種別/レア度で絞り込み可能。
export default function CardsPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-amber-50 dark:from-amber-950/30 to-background">
      <div className="max-w-4xl mx-auto px-4 py-4 sm:py-6">
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
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">カード一覧</h1>
            <p className="text-xs sm:text-sm text-muted-foreground">
              カード将棋のマスターカタログ (BETA)
            </p>
          </div>
        </header>

        <CardCatalogGrid cards={ALL_CARD_DEFS} />
      </div>
    </main>
  );
}
