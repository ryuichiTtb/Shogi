"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { CharacterPanel } from "@/components/character/character-panel";
import { MoveHistory } from "./move-history";
import { CardShogiHistory } from "./card-shogi/card-shogi-history";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { gameResultText } from "@/lib/shogi/notation";
import { MessageCircle, ScrollText, ChevronUp, ChevronDown } from "lucide-react";
import { MaskedLink } from "@/components/navigation/masked-link";
import type { Character } from "@/data/characters";
import type { CommentaryEvent } from "@/app/actions/commentary";
import type { Move, GameStatus, Player } from "@/lib/shogi/types";
import type { GameEvent } from "@/lib/shogi/cards/types";

interface MobileDrawerProps {
  character: Character;
  commentEvent: CommentaryEvent | null;
  isAiThinking: boolean;
  moves: Move[];
  isGameActive: boolean;
  gameStatus: GameStatus;
  gameWinner?: Player | "draw";
  onPlayAgain: () => void;
  isPending: boolean;
  // ホームへ戻るリンクの遷移先 (Issue #117)。
  // standard variant は "/classic"、card-shogi variant は "/" を渡す。
  // default 値を持たせず必須にすることで、呼び出し側の渡し忘れを TypeScript で検出。
  homeHref: string;
  // card-shogi の場合に渡す。指定された場合は MoveHistory ではなく CardShogiHistory を表示。
  cardEventLog?: GameEvent[];
  // ゲーム終了 Card の表示を抑止する(card-shogi では別エリアに配置するため)
  hideEndCard?: boolean;
}

type Tab = "character" | "history";

export function MobileDrawer({
  character,
  commentEvent,
  isAiThinking,
  moves,
  isGameActive,
  gameStatus,
  gameWinner,
  onPlayAgain,
  isPending,
  homeHref,
  cardEventLog,
  hideEndCard = false,
}: MobileDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("character");
  // Step S4 (Issue #107): モバイルで盤面下端を隠さないよう、終了カードを
  // 最小化できる。閉じると 1 行バーになり、タップで再展開。
  const [endCardMinimized, setEndCardMinimized] = useState(false);

  return (
    <div className="fixed bottom-0 left-0 right-0 z-20 safe-area-bottom">
      {/* ゲーム終了表示（ドロワー外・タブバー上に常時表示）。card-shogi では hideEndCard で抑止 */}
      {/* Step S5 (Issue #107): max-height + opacity の transition で開閉時に
          パッと出ず滑らかに遷移。閉じるボタンはアイコン統一のため ChevronDown。 */}
      {!isGameActive && !hideEndCard && (
        <div
          className="bg-card/95 backdrop-blur-sm border-t border-border overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* 縮小バー (常に DOM に存在し、最小化時のみ可視。max-height で smooth 遷移) */}
          <div
            className={cn(
              "overflow-hidden transition-all duration-300 ease-in-out",
              endCardMinimized ? "max-h-[40px] opacity-100" : "max-h-0 opacity-0",
            )}
          >
            <button
              type="button"
              onClick={() => setEndCardMinimized(false)}
              className="w-full px-3 py-1.5 text-xs flex items-center justify-center gap-1.5 transition-colors active:bg-primary/10 hover:bg-primary/5"
              aria-label="結果を再表示"
            >
              <ChevronUp className="w-3.5 h-3.5" aria-hidden />
              <span className="font-bold">{gameResultText(gameStatus, gameWinner)}</span>
              <span className="text-muted-foreground">(タップで開く)</span>
            </button>
          </div>

          {/* 結果カード本体 (常に DOM に存在し、開いた状態のときだけ可視) */}
          <div
            className={cn(
              "overflow-hidden transition-all duration-300 ease-in-out",
              endCardMinimized ? "max-h-0 opacity-0" : "max-h-[200px] opacity-100",
            )}
          >
            {/* 手札ドロワーと同じヘッダ + 「閉じる」ラベルボタン (Step S5 改修) */}
            <div className="px-3 py-1.5 border-b flex items-center justify-between">
              <span className="text-sm font-bold">結果</span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => setEndCardMinimized(true)}
              >
                閉じる
              </Button>
            </div>
            <div className="px-3 py-2">
              <Card className="p-3 text-center border-2 border-primary/20 bg-primary/5">
                <p className="text-sm font-bold mb-2">
                  {gameResultText(gameStatus, gameWinner)}
                </p>
                <div className="flex gap-2 justify-center">
                  <MaskedLink href={homeHref} loadingVariant="spinner">
                    <Button size="sm" variant="outline">
                      ホームへ
                    </Button>
                  </MaskedLink>
                  <Button size="sm" onClick={onPlayAgain} disabled={isPending}>
                    {isPending ? "準備中..." : "もう一局"}
                  </Button>
                </div>
              </Card>
            </div>
          </div>
        </div>
      )}

      {/* タブバー（常に表示） */}
      <div
        className={cn(
          "flex items-center bg-card/95 backdrop-blur-sm border-t border-border",
          isOpen && "border-b"
        )}
      >
        <button
          onClick={(e) => { e.stopPropagation(); setActiveTab("character"); setIsOpen(true); }}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors",
            activeTab === "character" && isOpen ? "text-primary" : "text-muted-foreground"
          )}
        >
          <MessageCircle className="w-4 h-4" />
          {character.name}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); setActiveTab("history"); setIsOpen(true); }}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors",
            activeTab === "history" && isOpen ? "text-primary" : "text-muted-foreground"
          )}
        >
          <ScrollText className="w-4 h-4" />
          棋譜
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }}
          className="px-3 py-2.5 text-muted-foreground"
        >
          {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
        </button>
      </div>

      {/* ドロワーコンテンツ */}
      <div
        className={cn(
          "bg-card/95 backdrop-blur-sm overflow-hidden transition-all duration-300 ease-in-out",
          isOpen ? "max-h-64" : "max-h-0"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-3 h-64 overflow-y-auto">
          {activeTab === "character" && (
            <CharacterPanel
              character={character}
              commentEvent={commentEvent}
              isAiThinking={isAiThinking}
              className="flex-row items-start gap-3"
            />
          )}
          {activeTab === "history" && (
            <div className="h-full flex flex-col">
              {cardEventLog ? (
                <CardShogiHistory eventLog={cardEventLog} />
              ) : (
                <MoveHistory moves={moves} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
