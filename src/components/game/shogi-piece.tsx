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

const MAJOR_PIECES = new Set(["rook", "bishop", "promoted_rook", "promoted_bishop"]);

// 駒の漢字を取得
function getPieceKanji(type: string): string {
  const def = PIECE_DEF_MAP.get(type);
  return def?.kanji ?? type.slice(0, 1);
}

// 成り駒か判定
function isPromoted(type: string): boolean {
  return type.startsWith("promoted_");
}

// 駒種別の色設定（枠色・内側色）
function getPieceColors(type: string): { border: string; inner: string } {
  if (type === "king") {
    return { border: "#5c3a1e", inner: "#d4a96a" }; // Eパターン: ダーク木材
  }
  if (MAJOR_PIECES.has(type)) {
    return { border: "#7a5c1e", inner: "#e8c87a" }; // Cパターン: 黄土色
  }
  return { border: "#8b5e3c", inner: "#f5deb3" };   // Aパターン: 木目ナチュラル
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
  const colors = getPieceColors(piece.type);

  const borderBg = isInCheck ? "#ef4444" : isSelected ? "#3b82f6" : colors.border;
  const innerBg  = isInCheck ? "#fee2e2" : isSelected ? "#dbeafe" : colors.inner;

  return (
    <div
      onClick={onClick}
      style={{ clipPath: PIECE_CLIP, backgroundColor: borderBg }}
      className={cn(
        "relative flex items-center justify-center cursor-pointer select-none transition-all duration-150",
        isSmall ? "w-8 h-8" : "w-full h-full",
        isGote && "rotate-180",
      )}
    >
      {/* 駒の内側（1.5px内側で枠線を表現、ホバーでやや暗く） */}
      <div
        style={{ clipPath: PIECE_CLIP, backgroundColor: innerBg }}
        className="absolute inset-[1.5px] flex items-center justify-center hover:brightness-90 transition-all duration-150"
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
