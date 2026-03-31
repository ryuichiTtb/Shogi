export const dynamic = "force-dynamic";

import { getGameHistory } from "@/app/actions/game";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { gameResultText } from "@/lib/shogi/notation";
import { getCharacterById } from "@/data/characters";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default async function HistoryPage() {
  const games = await getGameHistory();

  return (
    <main className="min-h-[100dvh] min-h-screen py-8 px-4 max-w-2xl mx-auto safe-area-inset">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/">
          <Button variant="ghost" size="sm" className="gap-1.5">
            <ArrowLeft className="w-4 h-4" />
            ホームへ
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">対局履歴</h1>
      </div>

      {games.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <p>まだ対局がありません</p>
            <Link href="/">
              <Button className="mt-4">最初の対局を始める</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {games.map((game: (typeof games)[number]) => {
            const character = getCharacterById(game.characterId);
            const isActive = game.status === "active";
            const resultText = gameResultText(game.status, game.winner ?? undefined);

            return (
              <Link key={game.id} href={`/game/${game.id}`}>
                <Card className="hover:shadow-md transition-shadow cursor-pointer">
                  <CardContent className="py-3 px-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{character.avatarEmoji}</span>
                        <div>
                          <p className="font-medium text-sm">{character.name}との対局</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(game.createdAt).toLocaleDateString("ja-JP", {
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          {game.playerColor === "sente" ? "先手" : "後手"}
                        </Badge>
                        <Badge
                          variant={
                            isActive
                              ? "default"
                              : game.winner === game.playerColor
                              ? "default"
                              : "secondary"
                          }
                          className="text-xs"
                        >
                          {isActive ? "対局中" : resultText}
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
