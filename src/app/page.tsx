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
import { History, Swords, Layers, Library, Palette, Wrench } from "lucide-react";
import { ThemeSelector } from "@/components/game/theme-selector";
import { ModeSelector, type GameMode } from "@/components/home/mode-selector";
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

export default function Home() {
  const router = useRouter();
  // 進行中のメッセージ。null=非アクティブ。null 以外なら LoadingOverlay を出し
  // 全ボタンを disabled にする。各ハンドラから個別の状態を持たせず一元管理。
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const isPending = pendingLabel !== null;
  const [selectedDifficulty, setSelectedDifficulty] = useState<Difficulty>("beginner");
  const [selectedColor, setSelectedColor] = useState<ColorOption>("sente");
  const [selectedMode, setSelectedMode] = useState<GameMode>("standard");

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

  // Step 4 (Issue #107): ロビー滞在中に SFX と選択中キャラの BGM を裏で先読み。
  // 対局画面 mount 時に一気に load することによる初回 SE の遅延を解消する。
  useAssetPreloader({ selectedCharacterId: selectedCharacter.id });

  async function handleStart() {
    if (isPending) return;
    setPendingLabel("準備中...");
    try {
      // Step 4 (Issue #107): ユーザージェスチャ内で AudioContext を resume させる
      // (Safari の autoplay policy 対策)。await でも 1 frame 程度なので体感に
      // 影響しない。失敗しても本番再生は対局画面側でリカバリされるため握りつぶす。
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
        selectedMode,
      );
      router.push(`/game/${gameId}`);
    } catch (e) {
      console.error(e);
      setPendingLabel(null);
    }
  }

  // ナビゲーション (Link の代替)。クリック → overlay 表示 + router.push。
  // ページ遷移完了時にこのコンポーネントは unmount するので明示リセット不要。
  function navigateTo(href: string, label = "読み込み中...") {
    if (isPending) return;
    setPendingLabel(label);
    router.push(href);
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
      {/* ヘッダー (モバイルでは縦幅を更に詰める) */}
      <div className="relative text-center py-2 sm:py-8 px-4 shrink-0">
        <div className="absolute top-2 right-4 sm:top-3">
          <ThemeSelector />
        </div>
        <h1 className="text-2xl sm:text-4xl font-bold tracking-tight">将棋</h1>
        <p className="text-xs sm:text-sm text-muted-foreground">AIと対局しよう</p>
      </div>

      <div className="flex-1 flex flex-col max-w-2xl mx-auto w-full px-4 pb-2 sm:pb-4 space-y-2 min-h-0">
        {/* モード選択 */}
        <ModeSelector mode={selectedMode} onChange={setSelectedMode} className="shrink-0" />

        {/* 難易度・キャラクター選択 (モバイル時 padding を詰める) */}
        <Card size="sm" className="shrink-0">
          <CardHeader className="pb-0 pt-0">
            <CardTitle className="text-sm sm:text-base flex items-center gap-2">
              <Swords className="w-4 h-4" />
              対局相手を選ぶ
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-0">
            {/* モバイル: コンパクトリスト / デスクトップ: カードグリッド */}
            <div className="sm:hidden flex flex-col gap-1">
              {CHARACTERS.map((character) => {
                const diffInfo = DIFFICULTY_INFO[character.difficulty];
                const isSelected = selectedDifficulty === character.difficulty;

                return (
                  <button
                    key={character.id}
                    onClick={() => setSelectedDifficulty(character.difficulty)}
                    className={cn(
                      "flex items-center gap-2 px-2.5 py-1.5 rounded-lg border-2 text-left transition-all",
                      "cursor-pointer",
                      isSelected
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/40"
                    )}
                  >
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
                      <div className="w-2 h-2 rounded-full bg-primary shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* デスクトップ: 従来のカードグリッド */}
            <div className="hidden sm:grid grid-cols-4 gap-3">
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
                        ? "border-primary bg-primary/5 shadow-sm"
                        : "border-border hover:border-primary/40"
                    )}
                  >
                    {isSelected && (
                      <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-primary" />
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

        {/* 手番選択 (モバイル時 padding を詰める) */}
        <Card size="sm" className="shrink-0">
          <CardHeader className="pb-0 pt-0">
            <CardTitle className="text-sm sm:text-base">手番を選ぶ</CardTitle>
          </CardHeader>
          <CardContent className="pb-0">
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
                    "p-3 rounded-xl border-2 text-center transition-all cursor-pointer",
                    "hover:shadow-md",
                    selectedColor === value
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/40"
                  )}
                >
                  <div className="text-2xl mb-0.5">{icon}</div>
                  <div className="font-medium text-sm">{label}</div>
                  <div className="text-xs text-muted-foreground">{desc}</div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* スペーサー（モバイルでボタンを下寄せ） */}
        <div className="flex-1 sm:hidden" />

        {/* 対局開始ボタン (モバイル時 高さを詰める) */}
        <Button
          size="lg"
          className="w-full text-sm sm:text-base py-3 sm:py-6 shrink-0"
          onClick={handleStart}
          disabled={isPending}
        >
          {`${selectedCharacter.name}と対局開始！`}
        </Button>

        {/* カード機能セクション (カード将棋モード時のみ)。
            上段: デッキ編成 / カードデザイン (一般)
            下段: カード一覧 / フライト検証用 (開発者用) */}
        {selectedMode === "card-shogi" && (
          <div className="grid grid-cols-2 gap-2 shrink-0">
            <button
              type="button"
              onClick={() => navigateTo("/decks")}
              disabled={isPending}
              className={cn(
                "flex items-center justify-center gap-1.5 py-2.5 rounded-lg border-2 border-border",
                "bg-card text-xs sm:text-sm font-medium hover:border-primary/40 transition-colors",
                "disabled:opacity-60 disabled:cursor-not-allowed",
              )}
            >
              <Library className="w-4 h-4" />
              デッキ編成
            </button>
            <button
              type="button"
              onClick={() => navigateTo("/card-design")}
              disabled={isPending}
              className={cn(
                "flex items-center justify-center gap-1.5 py-2.5 rounded-lg border-2 border-border",
                "bg-card text-xs sm:text-sm font-medium hover:border-primary/40 transition-colors",
                "disabled:opacity-60 disabled:cursor-not-allowed",
              )}
            >
              <Palette className="w-4 h-4" />
              カードデザイン
            </button>
            <button
              type="button"
              onClick={() => navigateTo("/cards")}
              disabled={isPending}
              className={cn(
                "flex items-center justify-center gap-1.5 py-2.5 rounded-lg border-2 border-border",
                "bg-card text-xs sm:text-sm font-medium hover:border-primary/40 transition-colors",
                "disabled:opacity-60 disabled:cursor-not-allowed",
              )}
            >
              <Layers className="w-4 h-4" />
              カード一覧
            </button>
            <button
              type="button"
              onClick={() => navigateTo("/dev/piece-flight")}
              disabled={isPending}
              className={cn(
                "flex items-center justify-center gap-1.5 py-2.5 rounded-lg border-2 border-border",
                "bg-card text-xs sm:text-sm font-medium hover:border-primary/40 transition-colors",
                "disabled:opacity-60 disabled:cursor-not-allowed",
              )}
            >
              <Wrench className="w-4 h-4" />
              フライト検証用
            </button>
          </div>
        )}

        {/* 棋譜履歴へのリンク */}
        <div className="text-center shrink-0">
          <button
            type="button"
            onClick={() => navigateTo("/history")}
            disabled={isPending}
            className={cn(
              "inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors",
              "disabled:opacity-60 disabled:cursor-not-allowed",
            )}
          >
            <History className="w-4 h-4" />
            対局履歴を見る
          </button>
        </div>

        <LoadingOverlay show={isPending} fullScreen message={pendingLabel ?? "読み込み中..."} />
      </div>
    </main>
  );
}
