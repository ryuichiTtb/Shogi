"use client";

import { cn } from "@/lib/utils";
import type { Hand, Player } from "@/lib/shogi/types";
import { ShogiPiece } from "./shogi-piece";

interface CapturedPiecesProps {
  hand: Hand;
  player: Player;
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
        "p-2 rounded-lg border h-20 overflow-hidden",
        isCurrentPlayer ? "border-primary bg-primary/5" : "border-border bg-muted/30"
      )}
    >
      <div className="text-xs text-muted-foreground mb-1 font-medium">{label}の持ち駒</div>
      <div className="flex flex-wrap gap-1">
        {sortedPieces.length === 0 ? (
          <span className="text-xs text-muted-foreground">なし</span>
        ) : (
          sortedPieces.map(({ type, count }) => (
            <button
              key={type}
              onClick={(e) => { if (isCurrentPlayer) { e.stopPropagation(); onPieceClick(type); } }}
              disabled={!isCurrentPlayer}
              className={cn(
                "relative w-9 h-9 rounded-sm",
                isCurrentPlayer && "cursor-pointer",
                !isCurrentPlayer && "cursor-default opacity-80",
                selectedHandPiece === type && isCurrentPlayer && "ring-2 ring-blue-500",
              )}
            >
              <ShogiPiece
                piece={{ type, owner: player }}
                isSmall
                isSelected={selectedHandPiece === type && isCurrentPlayer}
              />
              {count > 1 && (
                <span className="absolute bottom-0 right-0.5 text-xs text-muted-foreground leading-none z-10">
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
