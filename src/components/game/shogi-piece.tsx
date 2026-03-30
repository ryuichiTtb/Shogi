"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import { PIECE_DEF_MAP } from "@/lib/shogi/variants/standard";
import type { Piece, Player } from "@/lib/shogi/types";

interface ShogiPieceProps {
  piece: Piece;
  isSelected?: boolean;
  isSmall?: boolean;
  isLarge?: boolean;
  isInCheck?: boolean;
  playerColor?: Player;
  onClick?: () => void;
}

// 五角形の頂点座標（viewBox 0 0 100 100 基準）
const POLYGON_POINTS = "50,0 96,22 100,100 0,100 4,22";

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

// 盤上サイズ: 元の駒種で判定（成り駒は成る前の駒サイズを引き継ぐ）
const SMALL_PIECES = new Set(["pawn", "lance", "knight", "promoted_pawn", "promoted_lance", "promoted_knight"]);
const MEDIUM_PIECES = new Set(["silver", "gold", "promoted_silver"]);

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

export const ShogiPiece = memo(function ShogiPiece({
  piece,
  isSelected = false,
  isSmall = false,
  isLarge = false,
  isInCheck = false,
  playerColor,
  onClick,
}: ShogiPieceProps) {
  const kanji = getPieceKanji(piece.type);
  const promoted = isPromoted(piece.type);
  // playerColor が渡された場合は「相手の駒を回転」、未指定時は後手駒を回転（後方互換）
  const isGote = playerColor ? piece.owner !== playerColor : piece.owner === "gote";
  const colors = getPieceColors(piece.type);
  const isThickBorder = THICK_BORDER_PIECES.has(piece.type);
  const isBoldFont = BOLD_FONT_PIECES.has(piece.type);

  const borderColor = isInCheck ? "#ef4444" : isSelected ? "#3b82f6" : colors.border;
  const fillColor   = isInCheck ? "#fee2e2" : isSelected ? "#dbeafe" : colors.inner;
  // strokeWidth の半分が外側にはみ出すため viewBox に 3px のマージンを確保
  const strokeWidth = 1.5;

  // isSmall（持ち駒）は親コンテナを満たす、盤上は駒種別サイズ比率
  const sizeClass = isSmall
    ? "w-full h-full"
    : SMALL_PIECES.has(piece.type)
      ? "w-[85%] h-[85%]"
      : MEDIUM_PIECES.has(piece.type)
        ? "w-[90%] h-[90%]"
        : "w-full h-full";

  return (
    <div
      onClick={onClick}
      className={cn(
        "relative cursor-pointer select-none transition-all duration-150",
        "w-full h-full flex items-center justify-center",
        isGote && "rotate-180",
      )}
    >
      {/* 盤上サイズ調整用のラッパー */}
      <div className={cn("relative", sizeClass)}>
        {/* SVG で五角形を描画（stroke が辺に沿って均一な枠線になる） */}
        <svg
          viewBox="-3 -3 106 106"
          className="absolute inset-0 w-full h-full hover:brightness-90 transition-all duration-150"
        >
          <polygon
            points={POLYGON_POINTS}
            fill={fillColor}
            stroke={borderColor}
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
          />
        </svg>

        {/* 駒の文字（SVG の上に絶対配置） */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className={cn(
              "leading-none font-[family-name:var(--font-yuji-boku)]",
              // clamp() でセルサイズに連動したレスポンシブテキスト
              isLarge
                ? "text-[clamp(1.25rem,8vmin,3rem)]"
                : isSmall
                  ? "text-[clamp(0.65rem,4vmin,1rem)]"
                  : "text-[clamp(0.7rem,6vmin,1.5rem)]",
              piece.type === "king" ? "font-bold" : "font-normal",
              promoted ? "text-red-700" : isInCheck ? "text-red-700" : "text-gray-900",
            )}
          >
            {kanji}
          </span>
        </div>
      </div>
    </div>
  );
});
