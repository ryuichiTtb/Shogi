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

// C案: 上端細バー(約32px) + 下端ステータスバー(約44px) + ヘッダー + 持ち駒2行 + ラベル
// PCでは右側に縦サイドが入る = 縦領域への影響は小さい
// モバイルでは下端横並びにフォールバック
const EXTRA_RESERVED_DESKTOP = 80;
const EXTRA_RESERVED_MOBILE = 180;

export default function MockCardShogiC() {
  const initialState = createInitialGameState(STANDARD_VARIANT);
  const [currentPlayer, setCurrentPlayer] = useState<Player>("sente");
  const card = useMockCardState();
  // モバイル判定はwindow幅で簡易判定。useMockBoardSizeの戻り値も使うが初期状態で正しい値を返す
  const isLikelyMobile = typeof window !== "undefined" ? window.innerWidth < 768 : false;
  const { squareSize, isMobile } = useMockBoardSize({
    extraReservedVertical: isLikelyMobile ? EXTRA_RESERVED_MOBILE : EXTRA_RESERVED_DESKTOP,
  });

  const opponent: Player = PLAYER_COLOR === "sente" ? "gote" : "sente";

  const noop = (_: Position) => { void _; };
  const noopHand = (_: string) => { void _; };

  return (
    <main className="flex flex-col h-dvh overflow-hidden bg-gradient-to-b from-amber-50 dark:from-amber-950/30 to-background">
      {/* デバッグヘッダー */}
      <div className="shrink-0 px-2 py-1 border-b bg-card/80 backdrop-blur flex flex-wrap items-center gap-2 justify-between">
        <MockNavLinks current="c" />
        <div className="flex items-center gap-1 text-xs">
          <Badge variant="outline">手番: {currentPlayer === "sente" ? "▲先手" : "△後手"}</Badge>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => card.chargeMana(currentPlayer, 1)}>マナ+1</Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setCurrentPlayer((p) => (p === "sente" ? "gote" : "sente"))}>
            手番交代
          </Button>
        </div>
      </div>

      {/* 相手細バー */}
      <section className="shrink-0 px-2 py-1 border-b bg-muted/40 flex items-center gap-2 text-xs">
        <Badge variant="outline" className="shrink-0">△</Badge>
        <MockManaGauge current={card.state.mana[opponent]} cap={card.state.manaCap} compact />
        <span className="text-muted-foreground shrink-0">手札 {card.state.hand[opponent].length}</span>
        <div className="ml-auto flex items-center gap-1">
          <MockTrapSlot trap={card.state.trap[opponent]} faceDown size="sm" />
        </div>
      </section>

      {/* メインエリア(PC: 横並び盤面+右サイド | モバイル: 縦並び盤面のみ) */}
      <section className="flex-1 min-h-0 flex overflow-hidden">
        {/* 盤面エリア */}
        <div className="flex-1 min-w-0 flex flex-col items-center justify-start gap-1 py-2 overflow-y-auto">
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
        </div>

        {/* PC: 右サイド縦並びカード */}
        <aside className="hidden md:flex shrink-0 w-32 flex-col gap-2 p-2 border-l bg-muted/30 overflow-y-auto">
          <div className="text-xs font-bold text-muted-foreground">手札</div>
          <MockHandArea
            hand={card.state.hand[PLAYER_COLOR]}
            currentMana={card.state.mana[PLAYER_COLOR]}
            layout="vertical"
            size="md"
            onCardClick={(id) => card.beginPlayCard(PLAYER_COLOR, id)}
          />
        </aside>
      </section>

      {/* モバイル: 下端の手札横並び */}
      <section
        className="md:hidden shrink-0 px-2 py-1.5 border-t bg-card overflow-x-auto"
        style={{ paddingBottom: "max(0.375rem, env(safe-area-inset-bottom))" }}
      >
        <div className="flex items-center gap-2">
          <MockHandArea
            hand={card.state.hand[PLAYER_COLOR]}
            currentMana={card.state.mana[PLAYER_COLOR]}
            layout="stack"
            size="sm"
            onCardClick={(id) => card.beginPlayCard(PLAYER_COLOR, id)}
          />
        </div>
      </section>

      {/* 下端ステータスバー(自分マナ・トラップ・山札) */}
      <section
        className="shrink-0 px-2 py-1 border-t bg-card flex items-center gap-2 text-xs"
        style={{ paddingBottom: "max(0.25rem, env(safe-area-inset-bottom))" }}
      >
        <Badge variant="default" className="shrink-0">▲</Badge>
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

      <MockCardPlayDialog
        pendingCard={card.state.pendingCard}
        onConfirm={card.confirmPlayCard}
        onCancel={card.cancelPlayCard}
      />
    </main>
  );
}
