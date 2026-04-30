"use client";

import { useState } from "react";
import { ShogiBoard } from "@/components/game/shogi-board";
import { CapturedPieces } from "@/components/game/captured-pieces";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { createInitialGameState } from "@/lib/shogi/board";
import { STANDARD_VARIANT } from "@/lib/shogi/variants/standard";
import type { Player, Position } from "@/lib/shogi/types";

import { MockNavLinks } from "../_shared/components/MockNavLinks";
import { MockManaGauge } from "../_shared/components/MockManaGauge";
import { MockHandArea } from "../_shared/components/MockHandArea";
import { MockTrapSlot } from "../_shared/components/MockTrapSlot";
import { MockDeckPile } from "../_shared/components/MockDeckPile";
import { MockCardPlayDialog } from "../_shared/components/MockCardPlayDialog";
import { useMockCardState } from "../_shared/use-mock-card-state";
import { useMockBoardSize } from "../_shared/use-mock-board-size";

const PLAYER_COLOR: Player = "sente";

// A案: 上下に2ゾーン(各ゾーン約120px)、両ゾーン+ヘッダー+持ち駒2行+ラベル等
// 実機で測ったら相手ゾーン/自分ゾーン約 110-120px ずつ。最小32pxで盤面は5x5でも成立
const EXTRA_RESERVED = 240;

export default function MockCardShogiA() {
  const initialState = createInitialGameState(STANDARD_VARIANT);
  const [currentPlayer, setCurrentPlayer] = useState<Player>("sente");
  const card = useMockCardState();
  const { squareSize, isMobile } = useMockBoardSize({ extraReservedVertical: EXTRA_RESERVED });

  const opponent: Player = PLAYER_COLOR === "sente" ? "gote" : "sente";

  const noop = (_: Position) => { void _; };
  const noopHand = (_: string) => { void _; };

  return (
    <main className="flex flex-col h-dvh overflow-hidden bg-gradient-to-b from-amber-50 dark:from-amber-950/30 to-background">
      {/* デバッグヘッダー */}
      <div className="shrink-0 px-2 py-1 border-b bg-card/80 backdrop-blur flex flex-wrap items-center gap-2 justify-between">
        <MockNavLinks current="a" />
        <div className="flex items-center gap-1 text-xs">
          <Badge variant="outline">手番: {currentPlayer === "sente" ? "▲先手" : "△後手"}</Badge>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => card.chargeMana(currentPlayer, 1)}>マナ+1</Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setCurrentPlayer((p) => (p === "sente" ? "gote" : "sente"))}>
            手番交代
          </Button>
        </div>
      </div>

      {/* 相手ゾーン */}
      <section className="shrink-0 px-2 py-1.5 border-b bg-muted/40 flex items-center gap-2 overflow-x-auto">
        <Badge className="shrink-0">△ 相手</Badge>
        <MockTrapSlot trap={card.state.trap[opponent]} faceDown size="sm" />
        <MockHandArea
          hand={card.state.hand[opponent]}
          currentMana={card.state.mana[opponent]}
          faceDown
          size="sm"
          emptyLabel="相手手札なし"
        />
        <MockDeckPile count={card.state.deck[opponent].length} size="sm" />
        <div className="ml-auto shrink-0">
          <MockManaGauge current={card.state.mana[opponent]} cap={card.state.manaCap} compact />
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

      {/* 自分ゾーン */}
      <section
        className="shrink-0 px-2 py-1.5 border-t bg-muted/40 flex items-end gap-2 overflow-x-auto"
        style={{ paddingBottom: "max(0.375rem, env(safe-area-inset-bottom))" }}
      >
        <Badge className="shrink-0" variant="default">▲ 自分</Badge>
        <MockTrapSlot trap={card.state.trap[PLAYER_COLOR]} size="sm" />
        <MockHandArea
          hand={card.state.hand[PLAYER_COLOR]}
          currentMana={card.state.mana[PLAYER_COLOR]}
          size="md"
          onCardClick={(id) => card.beginPlayCard(PLAYER_COLOR, id)}
        />
        <MockDeckPile
          count={card.state.deck[PLAYER_COLOR].length}
          canDraw={card.state.mana[PLAYER_COLOR] >= 5}
          onDraw={() => card.drawCard(PLAYER_COLOR)}
          size="sm"
        />
        <div className="ml-auto shrink-0">
          <MockManaGauge current={card.state.mana[PLAYER_COLOR]} cap={card.state.manaCap} />
        </div>
      </section>

      <MockCardPlayDialog
        pendingCard={card.state.pendingCard}
        onConfirm={card.confirmPlayCard}
        onCancel={card.cancelPlayCard}
      />
    </main>
  );
}
