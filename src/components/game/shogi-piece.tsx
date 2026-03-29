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

// 大駒（飛・角）とその成り駒
const MAJOR_PIECES = new Set(["rook", "bishop", "promoted_rook", "promoted_bishop"]);

// 枠線が太い駒（銀・金・飛・角・王 およびその成り駒）
const THICK_BORDER_PIECES = new Set([
  "silver", "gold", "rook", "bishop", "king",
  "promoted_rook", "promoted_bishop", "promoted_silver",
  "promoted_lance", "promoted_knight", "promoted_pawn",
]);

// 字が太い駒（飛・角・王 およびその成り駒）
const BOLD_FONT_PIECES = new Set([
  "rook", "bishop", "king",
  "promoted_rook", "promoted_bishop",
]);

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
    return { border: "#5c3a1e", inner: "#d4a96a" }; // Eパターン: 濃め
  }
  if (MAJOR_PIECES.has(type)) {
    return { border: "#7a5c1e", inner: "#e8c87a" }; // Cパターン: 中濃
  }
  return { border: "#8b5e3c", inner: "#f5deb3" };   // Aパターン: 薄め
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
  const isThickBorder = THICK_BORDER_PIECES.has(piece.type);
  const isBoldFont = BOLD_FONT_PIECES.has(piece.type);

  const borderBg = isInCheck ? "#ef4444" : isSelected ? "#3b82f6" : colors.border;
  const innerBg  = isInCheck ? "#fee2e2" : isSelected ? "#dbeafe" : colors.inner;

  // 枠線の太さ: 太め=2.5px、細め=1px
  const insetClass = isThickBorder ? "inset-[2.5px]" : "inset-[1px]";

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
      {/* 駒の内側（枠線をinsetで表現） */}
      <div
        style={{ clipPath: PIECE_CLIP, backgroundColor: innerBg }}
        className={cn(
          "absolute flex items-center justify-center hover:brightness-90 transition-all duration-150",
          insetClass,
        )}
      >
        <span
          className={cn(
            "leading-none font-[family-name:var(--font-yuji-boku)]",
            isSmall ? "text-xs" : "text-sm md:text-base",
            isBoldFont ? "font-bold" : "font-normal",
            promoted ? "text-red-700" : isInCheck ? "text-red-700" : "text-gray-900",
          )}
        >
          {kanji}
        </span>
      </div>
    </div>
  );
}
