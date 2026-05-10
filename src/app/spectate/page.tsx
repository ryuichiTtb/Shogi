// Issue #193 / PR1a: CPU vs CPU 観戦モード画面 (揮発モード)。
//
// 設計判断:
// - DB に Game レコードを作らない (createSpectatorGameState が揮発初期化を返す)。
//   ページ離脱・リロードで初期化される (G-2 進行中チェックリストの UX 想定)。
// - phase: "setup" で難易度 A/B + キャラ A/B を選択、"playing" で CardShogiGame を
//   spectatorMode=true で呼び両プレイヤー AI 駆動で対局を進行。
// - PR1a 段階 7 では UI 切替は最小限 (faceDown 表示・ポーズボタン詳細実装は後追い)。
//   観戦時は CardShogiGame が gameConfig.spectatorMode を見て useCardShogiGame の
//   AI 自動応手 useEffect 経由で両 CPU を駆動する。

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CardShogiGame } from "@/components/game/card-shogi/card-shogi-game";
import { CHARACTERS } from "@/data/characters";
import { Button } from "@/components/ui/button";
import { DIFFICULTY_LABELS } from "@/lib/shogi/ai/engine";
import { createSpectatorGameState } from "@/app/actions/game";
import type { CardGameState } from "@/lib/shogi/cards/types";
import type { Difficulty, GameState } from "@/lib/shogi/types";

interface SpectatorGame {
  gameId: string;
  initialState: GameState;
  initialCardState: CardGameState;
}

export default function SpectatePage() {
  const router = useRouter();
  // 既定値は「両者超上級 (龍王)」。観戦体験として一番駒運びが安定するため。
  const [difficultyA, setDifficultyA] = useState<Difficulty>("expert");
  const [difficultyB, setDifficultyB] = useState<Difficulty>("expert");
  const [characterIdA, setCharacterIdA] = useState<string>("ryuou");
  const [characterIdB, setCharacterIdB] = useState<string>("ryuou");
  const [game, setGame] = useState<SpectatorGame | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStart = async () => {
    setPending(true);
    setError(null);
    try {
      const result = await createSpectatorGameState();
      setGame(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };

  // 観戦中: CardShogiGame をフルスクリーンで描画。useCardShogiGame の
  // AI 自動応手 useEffect が両プレイヤー (gameState.currentPlayer) を駆動する。
  if (game) {
    return (
      <CardShogiGame
        initialGameState={game.initialState}
        initialCardState={game.initialCardState}
        gameId={game.gameId}
        gameConfig={{
          variantId: "card-shogi",
          difficulty: difficultyA,
          playerColor: "sente", // 観戦モードでは未使用 (両プレイヤー AI 駆動)
          characterId: characterIdA,
          soundEnabled: true,
          commentaryEnabled: false,
          spectatorMode: true,
          difficultyB,
          characterIdB,
        }}
      />
    );
  }

  // 観戦設定画面
  return (
    <main className="min-h-dvh flex flex-col items-center justify-center p-6 gap-6">
      <h1 className="text-2xl font-bold">CPU 同士を観る</h1>
      <p className="text-sm text-muted-foreground text-center max-w-md">
        2 人の AI を選んで対局を観戦できます。観戦結果は保存されません (
        ページを閉じると初期化されます)。
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl w-full">
        <div className="space-y-2">
          <label className="block text-sm font-medium">先手 (A)</label>
          <select
            value={difficultyA}
            onChange={(e) => setDifficultyA(e.target.value as Difficulty)}
            disabled={pending}
            className="w-full p-2 border rounded bg-background"
          >
            {(["beginner", "intermediate", "advanced", "expert"] as const).map((d) => (
              <option key={d} value={d}>
                {DIFFICULTY_LABELS[d]}
              </option>
            ))}
          </select>
          <select
            value={characterIdA}
            onChange={(e) => setCharacterIdA(e.target.value)}
            disabled={pending}
            className="w-full p-2 border rounded bg-background"
          >
            {CHARACTERS.filter((c) => c.difficulty === difficultyA).map((c) => (
              <option key={c.id} value={c.id}>
                {c.avatarEmoji} {c.name} - {c.title}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium">後手 (B)</label>
          <select
            value={difficultyB}
            onChange={(e) => setDifficultyB(e.target.value as Difficulty)}
            disabled={pending}
            className="w-full p-2 border rounded bg-background"
          >
            {(["beginner", "intermediate", "advanced", "expert"] as const).map((d) => (
              <option key={d} value={d}>
                {DIFFICULTY_LABELS[d]}
              </option>
            ))}
          </select>
          <select
            value={characterIdB}
            onChange={(e) => setCharacterIdB(e.target.value)}
            disabled={pending}
            className="w-full p-2 border rounded bg-background"
          >
            {CHARACTERS.filter((c) => c.difficulty === difficultyB).map((c) => (
              <option key={c.id} value={c.id}>
                {c.avatarEmoji} {c.name} - {c.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="text-sm text-destructive">エラー: {error}</div>
      )}

      <div className="flex gap-3">
        <Button onClick={() => router.push("/")} variant="outline" disabled={pending}>
          ホームへ戻る
        </Button>
        <Button onClick={handleStart} disabled={pending}>
          {pending ? "準備中..." : "観戦を開始"}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground max-w-md text-center mt-4">
        観戦モードでは思考時間が短縮 (1.5 秒/手) され、200 手で強制引き分けとなります。
        観戦体験を快適にするための設定で、AI 棋力評価とは独立した値です。
      </p>
    </main>
  );
}
