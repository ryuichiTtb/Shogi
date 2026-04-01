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
  squareSize?: number;
}

// 手駒の表示順
const HAND_PIECE_ORDER = ["rook", "bishop", "gold", "silver", "knight", "lance", "pawn"];

// 固定高さ: 56px（ラベル14px + gap2px + 駒行40px = 56px）
export const CAPTURED_PIECES_HEIGHT = 56;

export function CapturedPieces({
  hand,
  player,
  playerColor,
  isCurrentPlayer,
  selectedHandPiece,
  onPieceClick,
  label,
  squareSize = 40,
}: CapturedPiecesProps) {
  const pieces = hand[player];
  const sortedPieces = HAND_PIECE_ORDER.filter(
    (type) => (pieces[type] ?? 0) > 0
  ).map((type) => ({ type, count: pieces[type]! }));

  const handPieceSize = Math.max(36, Math.min(44, squareSize * 0.85));

  return (
    <div
      className={cn(
        "px-2 py-1.5 rounded-lg border overflow-hidden",
        isCurrentPlayer ? "border-primary bg-primary/5" : "border-border bg-muted/30"
      )}
      style={{ height: CAPTURED_PIECES_HEIGHT }}
    >
      <div className="text-xs text-muted-foreground mb-0.5 font-medium leading-none">{label}の持ち駒</div>
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
                "captured-piece-btn relative rounded-sm flex items-center justify-center",
                isCurrentPlayer && "cursor-pointer",
                !isCurrentPlayer && "cursor-default opacity-80",
                selectedHandPiece === type && isCurrentPlayer && "ring-2 ring-blue-500",
              )}
              style={{ width: handPieceSize, height: handPieceSize }}
            >
              <ShogiPiece
                piece={{ type, owner: player }}
                isSmall
                isSelected={selectedHandPiece === type && isCurrentPlayer}
                playerColor={playerColor}
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
