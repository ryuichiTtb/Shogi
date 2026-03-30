"use client";

import { cn } from "@/lib/utils";
import type { Hand, Player } from "@/lib/shogi/types";
import { ShogiPiece } from "./shogi-piece";

interface CapturedPiecesProps {
  hand: Hand;
  player: Player;
  playerColor: Player;
  isCurrentPlayer: boolean;
  selectedHandPiece: string | null;
  onPieceClick: (pieceType: string) => void;
  label: string;
}

// 手駒の表示順
const HAND_PIECE_ORDER = ["rook", "bishop", "gold", "silver", "knight", "lance", "pawn"];

export function CapturedPieces({
  hand,
  player,
  playerColor,
  isCurrentPlayer,
  selectedHandPiece,
  onPieceClick,
  label,
}: CapturedPiecesProps) {
  const pieces = hand[player];
  const sortedPieces = HAND_PIECE_ORDER.filter(
    (type) => (pieces[type] ?? 0) > 0
  ).map((type) => ({ type, count: pieces[type]! }));

  return (
    <div
      className={cn(
        "p-1 lg:p-2 rounded-lg border shrink-0",
        "h-10 lg:h-20 overflow-hidden",
        isCurrentPlayer ? "border-primary bg-primary/5" : "border-border bg-muted/30"
      )}
    >
      <div className="text-[0.6rem] lg:text-xs text-muted-foreground mb-0.5 lg:mb-1 font-medium leading-none">{label}の持ち駒</div>
      <div className="flex flex-wrap gap-0.5 lg:gap-1">
        {sortedPieces.length === 0 ? (
          <span className="text-xs text-muted-foreground">なし</span>
        ) : (
          sortedPieces.map(({ type, count }) => (
            <button
              key={type}
              onClick={(e) => { if (isCurrentPlayer) { e.stopPropagation(); onPieceClick(type); } }}
              disabled={!isCurrentPlayer}
              className={cn(
                "relative w-7 h-7 lg:w-9 lg:h-9 rounded-sm flex items-center justify-center",
                isCurrentPlayer && "cursor-pointer",
                !isCurrentPlayer && "cursor-default opacity-80",
                selectedHandPiece === type && isCurrentPlayer && "ring-2 ring-blue-500",
              )}
            >
              <ShogiPiece
                piece={{ type, owner: player }}
                isSmall
                isSelected={selectedHandPiece === type && isCurrentPlayer}
                playerColor={playerColor}
              />
              {count > 1 && (
                <span className="absolute bottom-0 right-0.5 text-[0.55rem] lg:text-xs text-muted-foreground leading-none z-10">
                  {count}
                </span>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
