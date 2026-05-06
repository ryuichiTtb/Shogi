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
// 対局駒のデフォルトグラデ (Issue #155 派生): ユーザ指定の淡いトーン。
// 0% / 100% を起点とし、30% / 60% は線形補間で自然なカーブを描く。
//   0%   (254, 240, 200) #fef0c8 — 淡黄ハイライト
//   30%  (238, 212, 169) #eed4a9 — 補間値: 0% から 30% 進んだ位置
//   60%  (222, 185, 138) #deb98a — 補間値: 0% から 60% 進んだ位置
//   100% (200, 148,  96) #c89460 — 中明の檜茶
// ローディング表面は別パターン (やや濃いめ・シャドウ強め) を使うため、
// LoadingCardFace 側で colorOverride を渡して上書きしている。
export const DEFAULT_PIECE_GRADIENT: readonly ShogiPieceFillStop[] = [
  { offset: "0%",   color: "#fef0c8" },
  { offset: "30%",  color: "#eed4a9" },
  { offset: "60%",  color: "#deb98a" },
  { offset: "100%", color: "#c89460" },
];
export const DEFAULT_PIECE_BORDER = "#4a2e15";

// 王手・選択時は枠線を専用色 (赤/青) に切替えて識別性を担保する。
// 塗り (gradient) は base のまま、半透明の tint オーバーレイを polygon の上に
// 重ねて色味を加算する方式。完全に色を差替えると「元の駒色」が失われ、青/赤
// 一色の駒に見えてしまうため、ベースの檜木グラデは保つ。
const IN_CHECK_BORDER = "#7f1d1d";
const SELECTED_BORDER = "#1e3a8a";

// 半透明オーバーレイ。
//
// なぜこの値か: 旧実装 (Issue #155 派生対応前) は ShogiPiece の fillColor を
// "#dbeafe" / "#fee2e2" の単色で「完全に上書き」していたため、駒は純粋な淡水
// 色 / 淡桜色に見えていた。新実装はベースの檜木グラデを残してその上に半透明
// オーバーレイを重ねる方式のため、alpha が低いとベース茶 (#fef0c8〜#c89460)
// が透けて「青 × 茶 = くすんだ青グレー」のように暗く見える問題があった。
//
// tint の色を旧 fillColor と同一 (#dbeafe / #fee2e2) にし、alpha を 0.9 まで
// 上げることで「ベース茶は 10% 程度しか透けず、ほぼ旧実装と同じ淡水/淡桜の
// 見え方」になる。それでもベース茶がわずかに透けるので、駒の温かみは僅かに
// 保たれる。
const IN_CHECK_TINT = "rgba(254, 226, 226, 0.9)";   // 旧 fillColor #fee2e2 相当
const SELECTED_TINT = "rgba(219, 234, 254, 0.9)";   // 旧 fillColor #dbeafe 相当

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

  // 駒塗りはベースの檜木グラデ (colorOverride.innerGradient ?? DEFAULT_PIECE_GRADIENT)。
  // 王手・選択時もこのベースを保ち、半透明 tint を polygon 上に重ねて色味を加算する。
  // borderColor のみ専用の赤・青に切替えて識別性を担保。
  const baseGradient = colorOverride?.innerGradient ?? DEFAULT_PIECE_GRADIENT;
  const baseBorder = colorOverride?.border ?? DEFAULT_PIECE_BORDER;
  const borderColor = isInCheck
    ? IN_CHECK_BORDER
    : isSelected
      ? SELECTED_BORDER
      : baseBorder;
  const tintColor = isInCheck
    ? IN_CHECK_TINT
    : isSelected
      ? SELECTED_TINT
      : null;

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
              {baseGradient.map((stop, i) => (
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
          {/* 王手・選択時の半透明ティント (元の檜木グラデを残しつつ青/赤を加算)。 */}
          {tintColor && (
            <polygon
              points={POLYGON_POINTS}
              fill={tintColor}
              stroke="none"
              pointerEvents="none"
            />
          )}
          {/* Issue #155 派生: 右辺と下辺だけ太線で上塗りし、光が左上から当たって
              右下に影が落ちる立体感を演出する。右肩 → 右下 → 左下 を polyline
              の一筆書きで描画 (五角形右下の 3 頂点)。strokeLinejoin/Linecap は
              round で面取りを揃える。
              倍率は 3.5 倍 (= 5.25px、viewBox 100 に対し 5.25%)。1.9 倍では
              視覚的に変化が分かりにくかったため引き上げ。 */}
          <polyline
            points="96,22 100,100 0,100"
            fill="none"
            stroke={borderColor}
            strokeWidth={strokeWidth * 3.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>

        {/* 駒の文字（SVG の上に絶対配置）。kanji が 2 文字以上のときは
            縦書き (writing-mode: vertical-rl) にして駒シルエットに収める。 */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className={cn(
              "leading-none font-normal font-[family-name:var(--font-yuji-boku)]",
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
