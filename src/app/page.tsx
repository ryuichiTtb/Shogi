"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CHARACTERS } from "@/data/characters";
import { createGame } from "@/app/actions/game";
import type { Difficulty, Player } from "@/lib/shogi/types";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { History, Swords } from "lucide-react";
import { ThemeSelector } from "@/components/game/theme-selector";

const DIFFICULTY_INFO: Record<Difficulty, { label: string; description: string; color: string }> = {
  beginner: { label: "初級", description: "将棋を覚えたばかりの方に", color: "bg-green-100 text-green-800 border-green-200" },
  intermediate: { label: "中級", description: "ある程度指せる方に", color: "bg-yellow-100 text-yellow-800 border-yellow-200" },
  advanced: { label: "上級", description: "強い相手に挑みたい方に", color: "bg-red-100 text-red-800 border-red-200" },
};

type ColorOption = Player | "random";

export default function Home() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [selectedDifficulty, setSelectedDifficulty] = useState<Difficulty>("beginner");
  const [selectedColor, setSelectedColor] = useState<ColorOption>("sente");

  // Safari互換: CSS 100dvh ではなく JS window.innerHeight を使用
  const [viewportHeight, setViewportHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    const update = () => setViewportHeight(window.innerHeight);
    update();

    let timeoutId: ReturnType<typeof setTimeout>;
    const handleResize = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(update, 100);
    };
    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleResize);
    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
    };
  }, []);

  const selectedCharacter = CHARACTERS.find((c) => c.difficulty === selectedDifficulty)!;

  async function handleStart() {
    setIsLoading(true);
    try {
      const color: Player =
        selectedColor === "random"
          ? Math.random() < 0.5
            ? "sente"
            : "gote"
          : selectedColor;

      const gameId = await createGame(
        selectedDifficulty,
        color,
        selectedCharacter.id
      );
      router.push(`/game/${gameId}`);
    } catch (e) {
      console.error(e);
      setIsLoading(false);
    }
  }

  const colorOptions: { value: ColorOption; icon: string; label: string; desc: string }[] = [
    { value: "sente", icon: "▲", label: "先手（下手）", desc: "先に指す" },
    { value: "gote",  icon: "△", label: "後手（上手）", desc: "後から指す" },
    { value: "random", icon: "🎲", label: "ランダム", desc: "どちらかをランダムで決定" },
  ];

  return (
    <main
      className="flex flex-col bg-gradient-to-b from-amber-50 dark:from-amber-950/30 to-background safe-area-inset overflow-hidden"
      style={{ height: viewportHeight ?? "100dvh" }}
    >
      {/* ヘッダー */}
      <div className="relative text-center py-4 sm:py-8 px-4 shrink-0">
        <div className="absolute top-3 right-4">
          <ThemeSelector />
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-1">将棋</h1>
        <p className="text-sm text-muted-foreground">AIと対局しよう</p>
      </div>

      <div className="flex-1 flex flex-col max-w-2xl mx-auto w-full px-4 pb-4 space-y-3 sm:space-y-4 min-h-0">
        {/* 難易度・キャラクター選択 */}
        <Card className="shrink-0">
          <CardHeader className="pb-2 sm:pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Swords className="w-4 h-4" />
              対局相手を選ぶ
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-3">
            {/* モバイル: コンパクトリスト / デスクトップ: カードグリッド */}
            <div className="sm:hidden flex flex-col gap-1.5">
              {CHARACTERS.map((character) => {
                const diffInfo = DIFFICULTY_INFO[character.difficulty];
                const isSelected = selectedDifficulty === character.difficulty;

                return (
                  <button
                    key={character.id}
                    onClick={() => setSelectedDifficulty(character.difficulty)}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-lg border-2 text-left transition-all",
                      "cursor-pointer",
                      isSelected
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/40"
                    )}
                  >
                    <span className="text-2xl shrink-0">{character.avatarEmoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm">{character.name}</span>
                        <Badge
                          variant="outline"
                          className={cn("text-[10px] px-1.5 py-0", diffInfo.color)}
                        >
                          {diffInfo.label}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">{character.title}</div>
                    </div>
                    {isSelected && (
                      <div className="w-2 h-2 rounded-full bg-primary shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* デスクトップ: 従来のカードグリッド */}
            <div className="hidden sm:grid grid-cols-3 gap-3">
              {CHARACTERS.map((character) => {
                const diffInfo = DIFFICULTY_INFO[character.difficulty];
                const isSelected = selectedDifficulty === character.difficulty;

                return (
                  <button
                    key={character.id}
                    onClick={() => setSelectedDifficulty(character.difficulty)}
                    className={cn(
                      "relative p-4 rounded-xl border-2 text-left transition-all",
                      "hover:shadow-md cursor-pointer",
                      isSelected
                        ? "border-primary bg-primary/5 shadow-sm"
                        : "border-border hover:border-primary/40"
                    )}
                  >
                    {isSelected && (
                      <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-primary" />
                    )}
                    <div className="text-3xl mb-2">{character.avatarEmoji}</div>
                    <div className="font-bold text-sm">{character.name}</div>
                    <div className="text-xs text-muted-foreground mb-2">{character.title}</div>
                    <Badge
                      variant="outline"
                      className={cn("text-xs", diffInfo.color)}
                    >
                      {diffInfo.label}
                    </Badge>
                    <p className="text-xs text-muted-foreground mt-1">
                      {diffInfo.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* 手番選択 */}
        <Card className="shrink-0">
          <CardHeader className="pb-2 sm:pb-3">
            <CardTitle className="text-base">手番を選ぶ</CardTitle>
          </CardHeader>
          <CardContent className="pb-3">
            {/* モバイル: コンパクト横並び / デスクトップ: カードグリッド */}
            <div className="sm:hidden flex gap-2">
              {colorOptions.map(({ value, icon, label }) => (
                <button
                  key={value}
                  onClick={() => setSelectedColor(value)}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg border-2 transition-all cursor-pointer",
                    selectedColor === value
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/40"
                  )}
                >
                  <span className="text-base">{icon}</span>
                  <span className="font-medium text-xs">{label}</span>
                </button>
              ))}
            </div>

            {/* デスクトップ: 従来のカードグリッド */}
            <div className="hidden sm:grid grid-cols-3 gap-3">
              {colorOptions.map(({ value, icon, label, desc }) => (
                <button
                  key={value}
                  onClick={() => setSelectedColor(value)}
                  className={cn(
                    "p-4 rounded-xl border-2 text-center transition-all cursor-pointer",
                    "hover:shadow-md",
                    selectedColor === value
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/40"
                  )}
                >
                  <div className="text-2xl mb-1">{icon}</div>
                  <div className="font-medium text-sm">{label}</div>
                  <div className="text-xs text-muted-foreground">{desc}</div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* スペーサー（モバイルでボタンを下寄せ） */}
        <div className="flex-1 sm:hidden" />

        {/* 対局開始ボタン */}
        <Button
          size="lg"
          className="w-full text-base py-6 sm:py-6 shrink-0"
          onClick={handleStart}
          disabled={isLoading}
        >
          {isLoading ? (
            <span className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              準備中...
            </span>
          ) : (
            `${selectedCharacter.name}と対局開始！`
          )}
        </Button>

        {/* 棋譜履歴へのリンク */}
        <div className="text-center shrink-0">
          <Link
            href="/history"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <History className="w-4 h-4" />
            対局履歴を見る
          </Link>
        </div>
      </div>
    </main>
  );
}
