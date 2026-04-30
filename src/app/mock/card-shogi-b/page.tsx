"use client";

import { useState } from "react";
import { ShogiBoard } from "@/components/game/shogi-board";
import { CapturedPieces } from "@/components/game/captured-pieces";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { createInitialGameState } from "@/lib/shogi/board";
import { STANDARD_VARIANT } from "@/lib/shogi/variants/standard";
import type { Player, Position } from "@/lib/shogi/types";
import { cn } from "@/lib/utils";
import { ChevronUp, ChevronDown } from "lucide-react";

import { MockNavLinks } from "../_shared/components/MockNavLinks";
import { MockManaGauge } from "../_shared/components/MockManaGauge";
import { MockHandArea } from "../_shared/components/MockHandArea";
import { MockTrapSlot } from "../_shared/components/MockTrapSlot";
import { MockDeckPile } from "../_shared/components/MockDeckPile";
import { MockCardPlayDialog } from "../_shared/components/MockCardPlayDialog";
import { useMockCardState } from "../_shared/use-mock-card-state";
import { useMockBoardSize } from "../_shared/use-mock-board-size";

const PLAYER_COLOR: Player = "sente";

// B案: 上端細バー(約36px) + 下端ドロワーバー(約56px)+ヘッダー+持ち駒2行+ラベル
// ドロワーが閉じている前提のreserved。盤面サイズが最大化される
const EXTRA_RESERVED = 100;

export default function MockCardShogiB() {
  const initialState = createInitialGameState(STANDARD_VARIANT);
  const [currentPlayer, setCurrentPlayer] = useState<Player>("sente");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const card = useMockCardState();
  const { squareSize, isMobile } = useMockBoardSize({ extraReservedVertical: EXTRA_RESERVED });

  const opponent: Player = PLAYER_COLOR === "sente" ? "gote" : "sente";

  const noop = (_: Position) => { void _; };
  const noopHand = (_: string) => { void _; };

  return (
    <main className="flex flex-col h-dvh overflow-hidden bg-gradient-to-b from-amber-50 dark:from-amber-950/30 to-background relative">
      {/* デバッグヘッダー */}
      <div className="shrink-0 px-2 py-1 border-b bg-card/80 backdrop-blur flex flex-wrap items-center gap-2 justify-between">
        <MockNavLinks current="b" />
        <div className="flex items-center gap-1 text-xs">
          <Badge variant="outline">手番: {currentPlayer === "sente" ? "▲先手" : "△後手"}</Badge>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => card.chargeMana(currentPlayer, 1)}>マナ+1</Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setCurrentPlayer((p) => (p === "sente" ? "gote" : "sente"))}>
            手番交代
          </Button>
        </div>
      </div>

      {/* 相手ステータスバー(上端細長) */}
      <section className="shrink-0 px-2 py-1 border-b bg-muted/40 flex items-center gap-2 text-xs">
        <Badge variant="outline" className="shrink-0">△ 相手</Badge>
        <MockManaGauge current={card.state.mana[opponent]} cap={card.state.manaCap} compact />
        <span className="text-muted-foreground">手札 {card.state.hand[opponent].length}</span>
        <span className="text-muted-foreground">山札 {card.state.deck[opponent].length}</span>
        <div className="ml-auto">
          <MockTrapSlot trap={card.state.trap[opponent]} faceDown size="sm" />
        </div>
      </section>

      {/* 盤面エリア */}
      <section className="flex-1 min-h-0 flex flex-col items-center justify-start gap-1 py-2 overflow-y-auto">
        <CapturedPieces
          hand={initialState.hand}
          player={opponent}
          playerColor={PLAYER_COLOR}
          isCurrentPlayer={currentPlayer === opponent}
          selectedHandPiece={null}
          onPieceClick={noopHand}
          label={opponent === "sente" ? "先手" : "後手"}
          squareSize={squareSize}
        />
        <ShogiBoard
          board={initialState.board}
          currentPlayer={currentPlayer}
          playerColor={PLAYER_COLOR}
          selectedSquare={null}
          legalMoves={[]}
          lastMove={null}
          isAiThinking={false}
          inCheck={false}
          onSquareClick={noop}
          squareSize={squareSize}
          isMobile={isMobile}
        />
        <CapturedPieces
          hand={initialState.hand}
          player={PLAYER_COLOR}
          playerColor={PLAYER_COLOR}
          isCurrentPlayer={currentPlayer === PLAYER_COLOR}
          selectedHandPiece={null}
          onPieceClick={noopHand}
          label={PLAYER_COLOR === "sente" ? "先手" : "後手"}
          squareSize={squareSize}
        />
      </section>

      {/* 下端ドロワーバー(常時表示) */}
      <section
        className="shrink-0 px-2 py-1.5 border-t bg-card flex items-center gap-2 z-30"
        style={{ paddingBottom: "max(0.375rem, env(safe-area-inset-bottom))" }}
      >
        <Button
          size="sm"
          variant="default"
          className="h-9 gap-1"
          onClick={() => setDrawerOpen((v) => !v)}
        >
          {drawerOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          手札 {card.state.hand[PLAYER_COLOR].length}枚
        </Button>
        <MockManaGauge current={card.state.mana[PLAYER_COLOR]} cap={card.state.manaCap} compact />
        <MockDeckPile
          count={card.state.deck[PLAYER_COLOR].length}
          canDraw={card.state.mana[PLAYER_COLOR] >= 5}
          onDraw={() => card.drawCard(PLAYER_COLOR)}
          size="sm"
        />
        <div className="ml-auto">
          <MockTrapSlot trap={card.state.trap[PLAYER_COLOR]} size="sm" />
        </div>
      </section>

      {/* ドロワー本体(下からスライドアップ) */}
      <div
        className={cn(
          "fixed left-0 right-0 z-20 bg-card border-t-2 border-primary shadow-2xl transition-transform duration-300",
          drawerOpen ? "translate-y-0" : "translate-y-full",
        )}
        style={{
          bottom: "calc(56px + env(safe-area-inset-bottom))",
          maxHeight: "55dvh",
        }}
      >
        <div className="px-3 py-2 border-b flex items-center justify-between">
          <span className="text-sm font-bold">あなたの手札</span>
          <Button size="sm" variant="ghost" onClick={() => setDrawerOpen(false)}>閉じる</Button>
        </div>
        <div className="p-3 overflow-x-auto">
          <MockHandArea
            hand={card.state.hand[PLAYER_COLOR]}
            currentMana={card.state.mana[PLAYER_COLOR]}
            size="lg"
            onCardClick={(id) => {
              card.beginPlayCard(PLAYER_COLOR, id);
              setDrawerOpen(false);
            }}
          />
        </div>
      </div>

      {/* ドロワー背景 */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-10 bg-black/40"
          onClick={() => setDrawerOpen(false)}
          aria-hidden
        />
      )}

      <MockCardPlayDialog
        pendingCard={card.state.pendingCard}
        onConfirm={card.confirmPlayCard}
        onCancel={card.cancelPlayCard}
      />
    </main>
  );
}
