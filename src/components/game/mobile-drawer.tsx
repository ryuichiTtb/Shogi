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
import Link from "next/link";
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
  cardEventLog,
  hideEndCard = false,
}: MobileDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("character");

  return (
    <div className="fixed bottom-0 left-0 right-0 z-20 safe-area-bottom">
      {/* ゲーム終了表示（ドロワー外・タブバー上に常時表示）。card-shogi では hideEndCard で抑止 */}
      {!isGameActive && !hideEndCard && (
        <div
          className="bg-card/95 backdrop-blur-sm border-t border-border px-3 py-2"
          onClick={(e) => e.stopPropagation()}
        >
          <Card className="p-3 text-center border-2 border-primary/20 bg-primary/5">
            <p className="text-sm font-bold mb-2">
              {gameResultText(gameStatus, gameWinner)}
            </p>
            <div className="flex gap-2 justify-center">
              <Link href="/">
                <Button size="sm" variant="outline">
                  ホームへ
                </Button>
              </Link>
              <Button size="sm" onClick={onPlayAgain} disabled={isPending}>
                {isPending ? "準備中..." : "もう一局"}
              </Button>
            </div>
          </Card>
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
