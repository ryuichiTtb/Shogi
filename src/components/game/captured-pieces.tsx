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
  // 縦幅を縮める(card-shogi のモバイル等で持ち駒エリアの高さを抑えたいとき)
  compact?: boolean;
}

// 手駒の表示順
const HAND_PIECE_ORDER = ["rook", "bishop", "gold", "silver", "knight", "lance", "pawn"];

// 固定高さ: 72px（padding上下12px + ラベル12px + gap2px + 駒行最大44px + 余裕2px = 72px）
// handPieceSize は Math.max(36, Math.min(44, squareSize * 0.85)) で最大44pxになるため、
// PC(squareSize大)で見切れないよう十分な高さを確保する。
export const CAPTURED_PIECES_HEIGHT = 72;
// compact: モバイル時の縦幅縮小用 (駒は 36px、ラベル省略可)
export const CAPTURED_PIECES_HEIGHT_COMPACT = 52;

export function CapturedPieces({
  hand,
  player,
  playerColor,
  isCurrentPlayer,
  selectedHandPiece,
  onPieceClick,
  label,
  squareSize = 40,
  compact = false,
}: CapturedPiecesProps) {
  const pieces = hand[player];
  const sortedPieces = HAND_PIECE_ORDER.filter(
    (type) => (pieces[type] ?? 0) > 0
  ).map((type) => ({ type, count: pieces[type]! }));

  const handPieceSize = compact
    ? Math.max(32, Math.min(36, squareSize * 0.75))
    : Math.max(36, Math.min(44, squareSize * 0.85));

  return (
    <div
      className={cn(
        "rounded-lg border overflow-hidden",
        compact ? "px-2 py-0.5" : "px-2 py-1.5",
        isCurrentPlayer ? "border-primary bg-primary/5" : "border-border bg-muted/30"
      )}
      style={{ height: compact ? CAPTURED_PIECES_HEIGHT_COMPACT : CAPTURED_PIECES_HEIGHT }}
    >
      <div className={cn("text-xs text-muted-foreground font-medium leading-none", compact ? "mb-0" : "mb-0.5")}>
        {label}の持ち駒
      </div>
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
