"use client";

import { cn } from "@/lib/utils";
import { PIECE_DEF_MAP } from "@/lib/shogi/variants/standard";
import type { Piece } from "@/lib/shogi/types";

interface ShogiPieceProps {
  piece: Piece;
  isSelected?: boolean;
  isSmall?: boolean;
  isInCheck?: boolean;
  onClick?: () => void;
}

// 駒の漢字を取得
function getPieceKanji(type: string): string {
  const def = PIECE_DEF_MAP.get(type);
  return def?.kanji ?? type.slice(0, 1);
}

// 成り駒か判定
function isPromoted(type: string): boolean {
  return type.startsWith("promoted_");
}

export function ShogiPiece({
  piece,
  isSelected = false,
  isSmall = false,
  isInCheck = false,
  onClick,
}: ShogiPieceProps) {
  const kanji = getPieceKanji(piece.type);
  const promoted = isPromoted(piece.type);
  const isGote = piece.owner === "gote";

  return (
    <div
      onClick={onClick}
      className={cn(
        "relative flex items-center justify-center cursor-pointer select-none transition-all duration-150",
        isSmall ? "w-8 h-8 text-sm" : "w-full h-full text-base",
        // 将棋駒の五角形（先端が尖った形）
        "[clip-path:polygon(50%_0%,96%_22%,100%_100%,0%_100%,4%_22%)]",
        "bg-amber-100",
        "[filter:drop-shadow(0_0_1px_rgb(180_83_9))]",
        // ホバー
        "hover:bg-amber-200",
        // 選択中
        isSelected && "bg-blue-200 [filter:drop-shadow(0_0_2px_rgb(59_130_246))]",
        // 成り駒は赤文字
        promoted && "text-red-700",
        // 王手中の王
        isInCheck && "bg-red-200 text-red-600 [filter:drop-shadow(0_0_2px_rgb(220_38_38))]",
        // 後手は180度回転
        isGote && "rotate-180",
      )}
    >
      <span
        className={cn(
          "font-bold leading-none font-[family-name:var(--font-yuji-boku)]",
          isSmall ? "text-xs" : "text-sm md:text-base"
        )}
      >
        {kanji}
      </span>
    </div>
  );
}
