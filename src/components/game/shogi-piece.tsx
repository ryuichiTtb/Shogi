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

// 将棋駒の五角形クリップパス（先端が尖った形）
const PIECE_CLIP = "polygon(50% 0%, 96% 22%, 100% 100%, 0% 100%, 4% 22%)";

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

  // 枠線・内側の色を状態に応じて切り替え
  const borderColor = isInCheck
    ? "bg-red-500"
    : isSelected
    ? "bg-blue-500"
    : "bg-[#7a5c1e]";

  const innerColor = isInCheck
    ? "bg-red-100"
    : isSelected
    ? "bg-blue-100"
    : "bg-[#e8c87a] hover:bg-[#ddb85a]";

  return (
    <div
      onClick={onClick}
      style={{ clipPath: PIECE_CLIP }}
      className={cn(
        "relative flex items-center justify-center cursor-pointer select-none transition-all duration-150",
        isSmall ? "w-8 h-8" : "w-full h-full",
        // 後手は180度回転
        isGote && "rotate-180",
        // 枠線の色（外側）
        borderColor,
      )}
    >
      {/* 駒の内側（枠線を残して1.5px内側に配置） */}
      <div
        style={{ clipPath: PIECE_CLIP }}
        className={cn(
          "absolute inset-[1.5px] flex items-center justify-center transition-colors duration-150",
          innerColor,
        )}
      >
        <span
          className={cn(
            "font-bold leading-none font-[family-name:var(--font-yuji-boku)]",
            isSmall ? "text-xs" : "text-sm md:text-base",
            promoted ? "text-red-700" : isInCheck ? "text-red-700" : "text-gray-900",
          )}
        >
          {kanji}
        </span>
      </div>
    </div>
  );
}
