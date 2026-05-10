// Issue #193 / PR1a: CPU vs CPU 観戦モード画面 (揮発モード)。
//
// 設計判断:
// - DB に Game レコードを作らない (createSpectatorGameState が揮発初期化を返す)。
//   ページ離脱・リロードで初期化される (G-2 進行中チェックリストの UX 想定)。
// - レイアウトは /play (MatchSetup) と統一。CHARACTERS 配列から先手 / 後手の
//   2 キャラを選ぶカードグリッドで「強さ + キャラ」を 1 操作で決定 (各 difficulty に
//   1 キャラ対応のため、別々の select で分ける必要なし)。
// - ホームへ戻るリンクは MaskedLink で nav_back SFX + ローディングマスクを統一。

"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Eye } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CHARACTERS } from "@/data/characters";
import { CardShogiGame } from "@/components/game/card-shogi/card-shogi-game";
import { createSpectatorGameState } from "@/app/actions/game";
import { AppBackground } from "@/components/layout/app-background";
import { PageMotion } from "@/components/layout/page-motion";
import { ThemeSelector } from "@/components/game/theme-selector";
import { AuthControls } from "@/components/auth/auth-controls";
import { MaskedLink } from "@/components/navigation/masked-link";
import { LoadingOverlay } from "@/components/loading-overlay";
import { LOADING_STAGES } from "@/lib/loading-stages";
import { cn } from "@/lib/utils";
import type { CardGameState } from "@/lib/shogi/cards/types";
import type { Difficulty, GameState } from "@/lib/shogi/types";

const DIFFICULTY_INFO: Record<Difficulty, { label: string; description: string; color: string }> = {
  beginner: { label: "初級", description: "将棋を覚えたばかり", color: "bg-green-100 text-green-800 border-green-200" },
  intermediate: { label: "中級", description: "ある程度指せる", color: "bg-yellow-100 text-yellow-800 border-yellow-200" },
  advanced: { label: "上級", description: "強い相手", color: "bg-red-100 text-red-800 border-red-200" },
  expert: { label: "超上級", description: "五段クラス最強 AI", color: "bg-purple-100 text-purple-800 border-purple-200" },
};

interface SpectatorGame {
  gameId: string;
  initialState: GameState;
  initialCardState: CardGameState;
}

export default function SpectatePage() {
  // ホームへ戻るリンクは MaskedLink (href="/") で完結するため useRouter は不要。
  // 観戦開始 → 観戦画面遷移は client-side state (game) の切替で処理する。
  // 既定値: 先手 = 龍王 (超上級)、後手 = さくら (初級)。観戦体験として強さ差がある方が手の違いが見えやすい。
  const [characterIdA, setCharacterIdA] = useState<string>("ryuou");
  const [characterIdB, setCharacterIdB] = useState<string>("sakura");
  const [game, setGame] = useState<SpectatorGame | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const characterA = CHARACTERS.find((c) => c.id === characterIdA) ?? CHARACTERS[3];
  const characterB = CHARACTERS.find((c) => c.id === characterIdB) ?? CHARACTERS[0];

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
          difficulty: characterA.difficulty,
          playerColor: "sente", // 観戦モードでは未使用 (両プレイヤー AI 駆動)
          characterId: characterIdA,
          soundEnabled: true,
          commentaryEnabled: false,
          spectatorMode: true,
          difficultyB: characterB.difficulty,
          characterIdB: characterIdB,
        }}
      />
    );
  }

  // 観戦設定画面 (レイアウトは /play の MatchSetup と統一)
  return (
    <PageMotion>
      <main className="flex flex-col h-dvh safe-area-inset overflow-hidden">
        <AppBackground variant="setup" />

        <div className="relative text-center py-2 sm:py-6 px-4 shrink-0">
          {/* 画面左上: ホームへ戻るリンク (MaskedLink で nav_back SFX + spinner overlay) */}
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
          <h1 className="text-xl sm:text-3xl font-bold tracking-tight">CPU 同士を観る</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">2 人の AI を選んで観戦</p>
        </div>

        <div className="flex-1 flex flex-col max-w-2xl mx-auto w-full px-4 pb-2 sm:pb-4 space-y-2 min-h-0 overflow-y-auto">
          {/* 先手 (A) 選択 */}
          <CharacterPicker
            label="先手 (A) を選ぶ"
            selectedId={characterIdA}
            onSelect={setCharacterIdA}
            layoutGroup="a"
            disabled={pending}
          />

          {/* 後手 (B) 選択 */}
          <CharacterPicker
            label="後手 (B) を選ぶ"
            selectedId={characterIdB}
            onSelect={setCharacterIdB}
            layoutGroup="b"
            disabled={pending}
          />

          {error && (
            <div className="text-xs sm:text-sm text-destructive text-center">エラー: {error}</div>
          )}

          {/* スペーサー(モバイルでボタンを下寄せ) */}
          <div className="flex-1 sm:hidden" />

          {/* 観戦開始ボタン */}
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
              disabled={pending}
            >
              <Eye className="w-4 h-4 mr-2" />
              {`${characterA.name} vs ${characterB.name} を観戦`}
            </Button>
          </motion.div>

          <p className="text-[10px] sm:text-xs text-muted-foreground text-center px-2">
            観戦モードは思考時間を 1.5 秒に短縮、200 手で強制引き分けです。観戦結果は保存されません。
          </p>
        </div>

        <LoadingOverlay
          show={pending}
          fullScreen
          card
          stages={LOADING_STAGES.matchSetup}
          progress
          message="準備中..."
        />
      </main>
    </PageMotion>
  );
}

interface CharacterPickerProps {
  label: string;
  selectedId: string;
  onSelect: (id: string) => void;
  layoutGroup: string; // motion.layoutId 衝突回避用 ("a" / "b")
  disabled: boolean;
}

// MatchSetup と同じレイアウト (モバイル: 縦リスト / デスクトップ: 4列グリッド)。
function CharacterPicker({ label, selectedId, onSelect, layoutGroup, disabled }: CharacterPickerProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: 0.06, ease: "easeOut" }}
    >
      <Card size="sm" className="shrink-0 bg-card/85 backdrop-blur-sm">
        <CardHeader className="pb-0 pt-0">
          <CardTitle className="text-sm sm:text-base">{label}</CardTitle>
        </CardHeader>
        <CardContent className="pb-0">
          {/* モバイル: コンパクトリスト */}
          <div className="sm:hidden flex flex-col gap-1 relative">
            {CHARACTERS.map((character) => {
              const diffInfo = DIFFICULTY_INFO[character.difficulty];
              const isSelected = selectedId === character.id;
              return (
                <button
                  key={character.id}
                  onClick={() => !disabled && onSelect(character.id)}
                  disabled={disabled}
                  className={cn(
                    "relative flex items-center gap-2 px-2.5 py-1.5 rounded-lg border-2 text-left transition-all",
                    "cursor-pointer disabled:cursor-not-allowed disabled:opacity-60",
                    isSelected ? "border-transparent bg-primary/5" : "border-border hover:border-primary/40",
                  )}
                >
                  {isSelected && (
                    <motion.div
                      layoutId={`spectator-${layoutGroup}-mobile`}
                      className="absolute inset-0 rounded-lg border-2 border-primary pointer-events-none"
                      transition={{ type: "spring", stiffness: 320, damping: 28 }}
                    />
                  )}
                  <span className="text-xl shrink-0">{character.avatarEmoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm">{character.name}</span>
                      <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", diffInfo.color)}>
                        {diffInfo.label}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">{character.title}</div>
                  </div>
                  {isSelected && <div className="w-2 h-2 rounded-full bg-primary shrink-0 relative z-10" />}
                </button>
              );
            })}
          </div>

          {/* デスクトップ: 4列グリッド */}
          <div className="hidden sm:grid grid-cols-4 gap-3 relative">
            {CHARACTERS.map((character) => {
              const diffInfo = DIFFICULTY_INFO[character.difficulty];
              const isSelected = selectedId === character.id;
              return (
                <button
                  key={character.id}
                  onClick={() => !disabled && onSelect(character.id)}
                  disabled={disabled}
                  className={cn(
                    "relative p-3 rounded-xl border-2 text-left transition-all",
                    "hover:shadow-md cursor-pointer disabled:cursor-not-allowed disabled:opacity-60",
                    isSelected ? "border-transparent bg-primary/5 shadow-sm" : "border-border hover:border-primary/40",
                  )}
                >
                  {isSelected && (
                    <motion.div
                      layoutId={`spectator-${layoutGroup}-desktop`}
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
                  <Badge variant="outline" className={cn("text-xs", diffInfo.color)}>
                    {diffInfo.label}
                  </Badge>
                  <p className="text-xs text-muted-foreground mt-0.5">{diffInfo.description}</p>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
