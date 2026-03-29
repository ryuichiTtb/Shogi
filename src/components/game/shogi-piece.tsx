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
        "relative flex items-center justify-center rounded-sm cursor-pointer select-none transition-all duration-150",
        isSmall ? "w-8 h-8 text-sm" : "w-full h-full text-base",
        // 駒の形（五角形風）
        "bg-amber-100 border border-amber-400",
        // 先手・後手で色分け
        piece.owner === "sente"
          ? "text-gray-900 hover:bg-amber-200"
          : "text-gray-900 hover:bg-amber-200",
        // 選択中
        isSelected && "ring-2 ring-blue-500 bg-blue-100",
        // 成り駒は赤文字
        promoted && "text-red-700",
        // 王手中の王は赤文字・太枠
        isInCheck && "text-red-600 border-red-500 border-2",
        // 後手は180度回転
        isGote && "rotate-180",
        // 影
        "shadow-sm hover:shadow"
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
