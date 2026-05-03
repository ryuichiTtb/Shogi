import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import {
  listDecksForCurrentUser,
  listOwnedCardsForCurrentUser,
} from "@/app/actions/deck";
import { DecksPage } from "@/components/decks/decks-page";

export const metadata = {
  title: "デッキ編成 | カード将棋",
};

export default async function DecksRoute() {
  const [decks, owned] = await Promise.all([
    listDecksForCurrentUser(),
    listOwnedCardsForCurrentUser(),
  ]);

  return (
    <main className="h-dvh flex flex-col bg-gradient-to-b from-amber-50 dark:from-amber-950/30 to-background">
      {/* lg+ は左カラムを 560px に広げた分、全体幅も拡大して右カラム
          (編集エリア) のサイズを維持する。 */}
      <div className="max-w-6xl lg:max-w-[1440px] mx-auto px-4 pt-4 sm:pt-6 pb-2 w-full flex flex-col flex-1 min-h-0">
        <header className="flex items-center gap-3 mb-3 sm:mb-4 shrink-0">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            aria-label="ホームへ戻る"
          >
            <ArrowLeft className="w-4 h-4" />
            ホーム
          </Link>
          <div className="flex-1">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">デッキ編成</h1>
            <p className="text-xs sm:text-sm text-muted-foreground">
              カード将棋のデッキを作成・編集する
            </p>
          </div>
        </header>

        <DecksPage initialDecks={decks} ownedCards={owned} />
      </div>
    </main>
  );
}
