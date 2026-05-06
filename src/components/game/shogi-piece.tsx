"use client";

import { memo, useId } from "react";
import { cn } from "@/lib/utils";
import { PIECE_DEF_MAP } from "@/lib/shogi/variants/standard";
import type { Piece, Player } from "@/lib/shogi/types";

// Issue #155: ShogiPiece の塗りに金属グラデを使うときの 1 stop。
// linearGradient は左上 (0.15, 0) → 右下 (0.85, 1) で固定し、stops で色相を
// 制御する (KomaShape の metallic と同じ斜め方向)。
export interface ShogiPieceFillStop {
  offset: string;
  color: string;
}

interface ShogiPieceProps {
  piece: Piece;
  isSelected?: boolean;
  isSmall?: boolean;
  isLarge?: boolean;
  isInCheck?: boolean;
  playerColor?: Player;
  onClick?: () => void;
  squareSize?: number;
  // Issue #155: 駒の色 (枠・内側) を上書きする。ローディング演出のように
  // 通常対局とは異なる雰囲気で描画したい用途で使用。未指定時は従来通り
  // getPieceColors の駒種別配色を使う。
  // innerGradient を指定すると polygon の塗りを linearGradient に切替え、
  // 駒に金属感のあるツヤを付ける (KomaShape の metallic と同方式)。
  colorOverride?: {
    border: string;
    inner: string;
    innerGradient?: readonly ShogiPieceFillStop[];
  };
  // 駒に表示する文字を上書き (例: ローディング演出で「歩」「香車」「桂馬」等
  // の正式名称を出したいとき)。未指定時は PIECE_DEF_MAP の 1 文字漢字。
  // 2 文字以上を渡すと自動で縦書き (writing-mode: vertical-rl) にし、
  // フォントサイズも自動で縮める。
  kanjiOverride?: string;
}

// 五角形の頂点座標（viewBox 0 0 100 100 基準）
const POLYGON_POINTS = "50,0 96,22 100,100 0,100 4,22";

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

// Issue #155 派生: 対局画面の駒塗りを「檜木調 + 金属グラデ」で統一する。
//   - 旧 getPieceColors の king/大駒/通常 3 段階配色は撤去 (識別性は文字・字の太さで補う)。
//   - LoadingCardFace と完全に同じ stops を使い、ローディングと対局でカードと駒の世界観を一致させる。
//   - 王手 (isInCheck) / 選択 (isSelected) は gradient OFF にせず、赤系・青系の stops に
//     差替えて gradient を保つ。これにより質感 (左上ハイライト → 右下シャドウ) が保たれる。
export const DEFAULT_PIECE_GRADIENT: readonly ShogiPieceFillStop[] = [
  { offset: "0%",   color: "#fde8b8" }, // 左上: 明るめ金茶ハイライト
  { offset: "30%",  color: "#d8a868" }, // 中明: 金茶 (やや明るめ)
  { offset: "60%",  color: "#b07a40" }, // 中暗: 中濃檜茶
  { offset: "100%", color: "#5c3a1e" }, // 右下: 焦げ茶 (黒寄りを抜き、木の温かみを残す)
];
export const DEFAULT_PIECE_BORDER = "#4a2e15";

const IN_CHECK_GRADIENT: readonly ShogiPieceFillStop[] = [
  { offset: "0%",   color: "#fef2f2" },
  { offset: "30%",  color: "#fca5a5" },
  { offset: "60%",  color: "#dc2626" },
  { offset: "100%", color: "#7f1d1d" },
];
const IN_CHECK_BORDER = "#7f1d1d";

const SELECTED_GRADIENT: readonly ShogiPieceFillStop[] = [
  { offset: "0%",   color: "#eff6ff" },
  { offset: "30%",  color: "#93c5fd" },
  { offset: "60%",  color: "#2563eb" },
  { offset: "100%", color: "#1e3a8a" },
];
const SELECTED_BORDER = "#1e3a8a";

export const ShogiPiece = memo(function ShogiPiece({
  piece,
  isSelected = false,
  isSmall = false,
  isLarge = false,
  isInCheck = false,
  playerColor,
  onClick,
  squareSize,
  colorOverride,
  kanjiOverride,
}: ShogiPieceProps) {
  const kanji = kanjiOverride ?? getPieceKanji(piece.type);
  const isMultiChar = kanji.length > 1;
  const promoted = isPromoted(piece.type);
  // playerColor が渡された場合は「相手の駒を回転」、未指定時は後手駒を回転（後方互換）
  const isGote = playerColor ? piece.owner !== playerColor : piece.owner === "gote";
  const isBoldFont = BOLD_FONT_PIECES.has(piece.type);

  // 通常時の駒塗り: colorOverride 不指定なら「檜木調グラデ」を使う (LoadingCardFace と同じ)。
  // 王手・選択は gradient を OFF にせず、赤・青系 stops に差替えて gradient を保つ。
  const baseGradient = colorOverride?.innerGradient ?? DEFAULT_PIECE_GRADIENT;
  const baseBorder = colorOverride?.border ?? DEFAULT_PIECE_BORDER;
  const activeGradient = isInCheck
    ? IN_CHECK_GRADIENT
    : isSelected
      ? SELECTED_GRADIENT
      : baseGradient;
  const borderColor = isInCheck
    ? IN_CHECK_BORDER
    : isSelected
      ? SELECTED_BORDER
      : baseBorder;

  // strokeWidth の半分が外側にはみ出すため viewBox に 3px のマージンを確保
  const strokeWidth = 1.5;

  // SVG defs id (同一ページで複数描画される場合の id 衝突回避)。各 ShogiPiece が
  // 独自の useId() を呼ぶことで盤上 40 駒 + 持ち駒の各 linearGradient が
  // 衝突しない。
  const uid = useId();
  const gradientId = `piece-grad-${uid}`;

  // フォントサイズの計算。複数文字 (例: "香車") のときは縦書きにし、
  // 1 文字目安より小さく (約 65%) して駒シルエットに収まるよう調整する。
  const multiCharScale = 0.65;
  const fontSize = isLarge
    ? (isMultiChar ? Math.round(48 * multiCharScale) : 48)
    : isSmall
      ? (isMultiChar ? Math.round(14 * multiCharScale) : 14)
      : squareSize
        ? Math.max(
            isMultiChar ? 8 : 12,
            squareSize * (isMultiChar ? 0.45 * multiCharScale : 0.45),
          )
        : (isMultiChar ? Math.round(18 * multiCharScale) : 18);

  // isSmall（持ち駒・ダイアログ用）の場合は固定サイズ、盤上は駒種別サイズ
  const sizeClass = isSmall
    ? "w-7 h-8"
    : SMALL_PIECES.has(piece.type)
      ? "w-[73%] h-[85%]"
      : MEDIUM_PIECES.has(piece.type)
        ? "w-[77%] h-[90%]"
        : "w-[85%] h-full";

  return (
    <div
      onClick={onClick}
      className={cn(
        "relative cursor-pointer select-none transition-all duration-150",
        // isSmall は絶対サイズ、盤上は親コンテナ内でセンタリング
        isSmall ? sizeClass : "w-full h-full flex items-center justify-center",
        isGote && "rotate-180",
      )}
    >
      {/* 盤上サイズ調整用のラッパー（isSmall 時は不要） */}
      <div className={cn("relative", isSmall ? "w-full h-full" : sizeClass)}>
        {/* SVG で五角形を描画（stroke が辺に沿って均一な枠線になる）。
            常に linearGradient を使って塗る (通常: 檜木調 / 王手: 赤系 /
            選択: 青系)。KomaShape (metallic) と同じ左上 → 右下の斜めグラデ
            方向で「ハイライト → 中間 → シャドウ」の流れを駒に重ねる。 */}
        <svg
          viewBox="-3 -3 106 106"
          preserveAspectRatio="none"
          className="absolute inset-0 w-full h-full hover:brightness-90 transition-all duration-150"
        >
          <defs>
            <linearGradient id={gradientId} x1="0.15" y1="0" x2="0.85" y2="1">
              {activeGradient.map((stop, i) => (
                <stop key={i} offset={stop.offset} stopColor={stop.color} />
              ))}
            </linearGradient>
          </defs>
          <polygon
            points={POLYGON_POINTS}
            fill={`url(#${gradientId})`}
            stroke={borderColor}
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
          />
        </svg>

        {/* 駒の文字（SVG の上に絶対配置）。kanji が 2 文字以上のときは
            縦書き (writing-mode: vertical-rl) にして駒シルエットに収める。 */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className={cn(
              "leading-none font-[family-name:var(--font-yuji-boku)]",
              isBoldFont ? "font-bold" : "font-normal",
              promoted ? "text-red-700" : isInCheck ? "text-red-700" : "text-gray-900",
              isMultiChar && "[writing-mode:vertical-rl]",
            )}
            style={{ fontSize }}
          >
            {kanji}
          </span>
        </div>
      </div>
    </div>
  );
});
