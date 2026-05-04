"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CHARACTERS } from "@/data/characters";
import { createGame } from "@/app/actions/game";
import type { Difficulty, Player, GameMode } from "@/lib/shogi/types";
import { cn } from "@/lib/utils";
import { Swords } from "lucide-react";
import { LoadingOverlay } from "@/components/loading-overlay";
import { useAssetPreloader } from "@/hooks/use-asset-preloader";
import { prepareAudio } from "@/hooks/use-sound";

const DIFFICULTY_INFO: Record<Difficulty, { label: string; description: string; color: string }> = {
  beginner: { label: "初級", description: "将棋を覚えたばかりの方に", color: "bg-green-100 text-green-800 border-green-200" },
  intermediate: { label: "中級", description: "ある程度指せる方に", color: "bg-yellow-100 text-yellow-800 border-yellow-200" },
  advanced: { label: "上級", description: "強い相手に挑みたい方に", color: "bg-red-100 text-red-800 border-red-200" },
  expert: { label: "超上級", description: "五段クラスの最強AIに挑む", color: "bg-purple-100 text-purple-800 border-purple-200" },
};

type ColorOption = Player | "random";

interface MatchSetupProps {
  mode: GameMode;
}

// /play (card-shogi) と /classic (standard) で共有する対局セットアップフロー。
// 旧 [src/app/page.tsx](src/app/page.tsx) の難易度選択 + 手番選択 + 対局開始ボタンを抽出。
export function MatchSetup({ mode }: MatchSetupProps) {
  const router = useRouter();
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const isPending = pendingLabel !== null;
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

  // Step 4 (Issue #107): SFX を裏で先読み。
  useAssetPreloader();

  async function handleStart() {
    if (isPending) return;
    setPendingLabel("準備中...");
    try {
      // Safari の autoplay policy 対策で AudioContext を resume させる。
      await prepareAudio();

      const color: Player =
        selectedColor === "random"
          ? Math.random() < 0.5
            ? "sente"
            : "gote"
          : selectedColor;

      const gameId = await createGame(
        selectedDifficulty,
        color,
        selectedCharacter.id,
        mode,
      );
      router.push(`/game/${gameId}`);
    } catch (e) {
      console.error(e);
      setPendingLabel(null);
    }
  }

  const colorOptions: { value: ColorOption; icon: string; label: string; desc: string }[] = [
    { value: "sente", icon: "▲", label: "先手（下手）", desc: "先に指す" },
    { value: "gote",  icon: "△", label: "後手（上手）", desc: "後から指す" },
    { value: "random", icon: "🎲", label: "ランダム", desc: "どちらかをランダムで決定" },
  ];

  return (
    <div
      className="flex-1 flex flex-col max-w-2xl mx-auto w-full px-4 pb-2 sm:pb-4 space-y-2 min-h-0"
      style={{ height: viewportHeight ? `${viewportHeight - 64}px` : undefined }}
    >
      {/* 対局相手選択 */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: 0.06, ease: "easeOut" }}
      >
        <Card size="sm" className="shrink-0 bg-card/85 backdrop-blur-sm">
          <CardHeader className="pb-0 pt-0">
            <CardTitle className="text-sm sm:text-base flex items-center gap-2">
              <Swords className="w-4 h-4" />
              対局相手を選ぶ
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-0">
            {/* モバイル: コンパクトリスト / デスクトップ: カードグリッド */}
            <div className="sm:hidden flex flex-col gap-1 relative">
              {CHARACTERS.map((character) => {
                const diffInfo = DIFFICULTY_INFO[character.difficulty];
                const isSelected = selectedDifficulty === character.difficulty;

                return (
                  <button
                    key={character.id}
                    onClick={() => setSelectedDifficulty(character.difficulty)}
                    className={cn(
                      "relative flex items-center gap-2 px-2.5 py-1.5 rounded-lg border-2 text-left transition-all",
                      "cursor-pointer",
                      isSelected
                        ? "border-transparent bg-primary/5"
                        : "border-border hover:border-primary/40"
                    )}
                  >
                    {isSelected && (
                      <motion.div
                        layoutId="character-selected-ring-mobile"
                        className="absolute inset-0 rounded-lg border-2 border-primary pointer-events-none"
                        transition={{ type: "spring", stiffness: 320, damping: 28 }}
                      />
                    )}
                    <span className="text-xl shrink-0">{character.avatarEmoji}</span>
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
                      <div className="w-2 h-2 rounded-full bg-primary shrink-0 relative z-10" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* デスクトップ: 従来のカードグリッド */}
            <div className="hidden sm:grid grid-cols-4 gap-3 relative">
              {CHARACTERS.map((character) => {
                const diffInfo = DIFFICULTY_INFO[character.difficulty];
                const isSelected = selectedDifficulty === character.difficulty;

                return (
                  <button
                    key={character.id}
                    onClick={() => setSelectedDifficulty(character.difficulty)}
                    className={cn(
                      "relative p-3 rounded-xl border-2 text-left transition-all",
                      "hover:shadow-md cursor-pointer",
                      isSelected
                        ? "border-transparent bg-primary/5 shadow-sm"
                        : "border-border hover:border-primary/40"
                    )}
                  >
                    {isSelected && (
                      <motion.div
                        layoutId="character-selected-ring-desktop"
                        className="absolute inset-0 rounded-xl border-2 border-primary pointer-events-none"
                        transition={{ type: "spring", stiffness: 320, damping: 28 }}
                      />
                    )}
                    {isSelected && (
                      <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-primary z-10" />
                    )}
                    <div className="text-3xl mb-1">{character.avatarEmoji}</div>
                    <div className="font-bold text-sm">{character.name}</div>
                    <div className="text-xs text-muted-foreground mb-1">{character.title}</div>
                    <Badge
                      variant="outline"
                      className={cn("text-xs", diffInfo.color)}
                    >
                      {diffInfo.label}
                    </Badge>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {diffInfo.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* 手番選択 */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: 0.12, ease: "easeOut" }}
      >
        <Card size="sm" className="shrink-0 bg-card/85 backdrop-blur-sm">
          <CardHeader className="pb-0 pt-0">
            <CardTitle className="text-sm sm:text-base">手番を選ぶ</CardTitle>
          </CardHeader>
          <CardContent className="pb-0">
            {/* モバイル: コンパクト横並び */}
            <div className="sm:hidden flex gap-2 relative">
              {colorOptions.map(({ value, icon, label }) => {
                const active = selectedColor === value;
                return (
                  <button
                    key={value}
                    onClick={() => setSelectedColor(value)}
                    className={cn(
                      "relative flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg border-2 transition-all cursor-pointer",
                      active
                        ? "border-transparent bg-primary/5"
                        : "border-border hover:border-primary/40"
                    )}
                  >
                    {active && (
                      <motion.div
                        layoutId="color-selected-ring-mobile"
                        className="absolute inset-0 rounded-lg border-2 border-primary pointer-events-none"
                        transition={{ type: "spring", stiffness: 320, damping: 28 }}
                      />
                    )}
                    <span className="text-base">{icon}</span>
                    <span className="font-medium text-xs">{label}</span>
                  </button>
                );
              })}
            </div>

            {/* デスクトップ: 従来のカードグリッド */}
            <div className="hidden sm:grid grid-cols-3 gap-3 relative">
              {colorOptions.map(({ value, icon, label, desc }) => {
                const active = selectedColor === value;
                return (
                  <button
                    key={value}
                    onClick={() => setSelectedColor(value)}
                    className={cn(
                      "relative p-3 rounded-xl border-2 text-center transition-all cursor-pointer",
                      "hover:shadow-md",
                      active
                        ? "border-transparent bg-primary/5"
                        : "border-border hover:border-primary/40"
                    )}
                  >
                    {active && (
                      <motion.div
                        layoutId="color-selected-ring-desktop"
                        className="absolute inset-0 rounded-xl border-2 border-primary pointer-events-none"
                        transition={{ type: "spring", stiffness: 320, damping: 28 }}
                      />
                    )}
                    <div className="text-2xl mb-0.5">{icon}</div>
                    <div className="font-medium text-sm">{label}</div>
                    <div className="text-xs text-muted-foreground">{desc}</div>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* スペーサー（モバイルでボタンを下寄せ） */}
      <div className="flex-1 sm:hidden" />

      {/* 対局開始ボタン */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: 0.18, ease: "easeOut" }}
        className="shrink-0"
      >
        <Button
          size="lg"
          className="w-full text-sm sm:text-base py-3 sm:py-6"
          onClick={handleStart}
          disabled={isPending}
        >
          {`${selectedCharacter.name}と対局開始！`}
        </Button>
      </motion.div>

      <LoadingOverlay show={isPending} fullScreen message={pendingLabel ?? "読み込み中..."} />
    </div>
  );
}
