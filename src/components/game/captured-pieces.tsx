"use client";

import { cn } from "@/lib/utils";
import { PIECE_DEF_MAP } from "@/lib/shogi/variants/standard";
import type { Hand, Player } from "@/lib/shogi/types";

interface CapturedPiecesProps {
  hand: Hand;
  player: Player;
  isCurrentPlayer: boolean;
  selectedHandPiece: string | null;
  onPieceClick: (pieceType: string) => void;
  label: string;
}

function getPieceKanji(type: string): string {
  const def = PIECE_DEF_MAP.get(type);
  return def?.kanji ?? type.slice(0, 1);
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
        "p-2 rounded-lg border min-h-12",
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
              onClick={() => isCurrentPlayer && onPieceClick(type)}
              disabled={!isCurrentPlayer}
              className={cn(
                "relative flex items-center justify-center",
                "w-9 h-9 rounded-sm border",
                "bg-amber-100 border-amber-400 text-gray-900",
                "text-sm font-bold leading-none",
                "transition-all duration-100",
                isCurrentPlayer && "hover:bg-amber-200 cursor-pointer",
                !isCurrentPlayer && "cursor-default opacity-80",
                selectedHandPiece === type && isCurrentPlayer && "ring-2 ring-blue-500 bg-blue-100",
                // 後手の持ち駒は表示を逆にしない（UIの見やすさのため）
              )}
            >
              <span>{getPieceKanji(type)}</span>
              {count > 1 && (
                <span className="absolute bottom-0 right-0.5 text-xs text-muted-foreground leading-none">
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
