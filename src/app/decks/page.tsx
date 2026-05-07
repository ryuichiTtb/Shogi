// Issue #117 (#128): /decks を runtime レンダリングに変更。
// 旧実装は Static (ビルド時 DB アクセス) で生成されていたが、Vercel 上で /decks 表示時に
// Chrome NETERR が頻発する事象が起きていた。原因切り分けのため runtime 解決にし、
// ビルド時 DB 状態への依存と pre-render キャッシュの汚染リスクを排除する。
export const dynamic = "force-dynamic";

import {
  listDecksForCurrentUser,
  listOwnedCardsForCurrentUser,
} from "@/app/actions/deck";
import { DecksPage } from "@/components/decks/decks-page";
import { AppBackground } from "@/components/layout/app-background";
import { BgmProvider } from "@/components/audio/bgm-provider";

export const metadata = {
  title: "デッキ編成 | カード将棋",
};

// Issue #155 (origin/main): ヘッダ (「ホームへ戻る」リンク + AuthControls) と
// wrapper のレイアウトは DecksPage / DecksPageHeader 側に内包され、editor 保存中
// に Client 側で「ホームへ戻る」を disabled にできる。
// Server Component はデータ取得 + ページ枠 (main + AppBackground) + Issue #79 BGM
// (BgmProvider) のみを責務とする。
export default async function DecksRoute() {
  const [decks, owned] = await Promise.all([
    listDecksForCurrentUser(),
    listOwnedCardsForCurrentUser(),
  ]);

  return (
    <main className="h-dvh flex flex-col">
      <BgmProvider eventKey="bgm_home" />
      <AppBackground variant="page" />
      <DecksPage initialDecks={decks} ownedCards={owned} />
    </main>
  );
}
