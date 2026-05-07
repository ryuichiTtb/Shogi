// Issue #155: LoadingOverlay 中央に表示する「ふわふわ回転カード」。
//
// 実装方針:
//   - rotateY 360° の連続ループを CSS keyframes (loading-card-flip) で再生し、
//     表面と裏面の 2 枚を [transform-style: preserve-3d] の親に重ねて
//     [backface-visibility: hidden] で半周ごとに表裏を切替える。
//   - 表面は将棋の主要 8 駒 (歩・香車・桂馬・銀将・金将・飛車・角行・王将) から
//     1 枚ランダム選択し、対局時と同じ ShogiPiece (font: yuji-boku、五角形 SVG
//     枠) で描画する。マウントごとにランダムだが、useState 初期化なのでカード
//     表面を見ているあいだは固定される (くるくる入れ替わると目障りなため)。
//   - prefers-reduced-motion: reduce のときは framer-motion の useReducedMotion
//     経由で reduce フラグを取得し、回転を止めて CardBack のみを静止表示する。
//   - サイズはレスポンシブに clamp(140px, 40vw, 240px)、アスペクト比 8:5。
"use client";

import { memo, useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";

import { CardBack } from "@/components/card-back/card-back";
import { ShogiPiece } from "@/components/game/shogi-piece";
import { cn } from "@/lib/utils";

// 表面に出す駒のプール。プロモート駒・成り駒は除外し、初心者にも一目で
// 分かる主要 8 駒に絞る (Issue #155 のユーザー指定)。
// プレビューページ (/dev/loading-preview) からも参照するため export している。
export const LOADING_FACE_PIECE_TYPES = [
  "pawn",
  "lance",
  "knight",
  "silver",
  "gold",
  "rook",
  "bishop",
  "king",
] as const;

export type LoadingFacePieceType = (typeof LOADING_FACE_PIECE_TYPES)[number];

// 駒の正式名称 (ローディング表面で表示する文字)。盤上 1 文字表記とは別に、
// 「歩・香車・桂馬・銀将・金将・飛車・角行・王将」の縦書き表示にする。
export const LOADING_FACE_PIECE_LABEL: Record<LoadingFacePieceType, string> = {
  pawn: "歩",
  lance: "香車",
  knight: "桂馬",
  silver: "銀将",
  gold: "金将",
  rook: "飛車",
  bishop: "角行",
  king: "王将",
};

function pickRandomPieceType(): LoadingFacePieceType {
  const idx = Math.floor(Math.random() * LOADING_FACE_PIECE_TYPES.length);
  return LOADING_FACE_PIECE_TYPES[idx];
}

// 直前と異なる駒を選ぶ (同じ駒が 2 回続くと「切替わった感」が出ないため)。
// プールが 1 種以下なら同じものを返す (理論上ありえないが防御)。
function pickNextRandomPieceType(
  current: LoadingFacePieceType,
): LoadingFacePieceType {
  if (LOADING_FACE_PIECE_TYPES.length <= 1) return current;
  let next: LoadingFacePieceType;
  do {
    next = pickRandomPieceType();
  } while (next === current);
  return next;
}

// 1 周回 (rotateY 0° → 360°) の周期。globals.css の loading-card-flip と同期。
// 周期完了タイミング (= 表が背面に隠れる 0°/360°) で駒を差し替えれば、表が
// 見える 90°〜270° の半周中は安定して同じ駒が表示され、表が背面にあるあいだ
// に次の駒へ静かに切替わる演出になる。
const FLIP_PERIOD_MS = 4000;

const SIZE_STYLE = {
  width: "clamp(140px, 40vw, 240px)",
  aspectRatio: "8 / 5",
} as const;

interface LoadingCardFaceProps {
  pieceType: LoadingFacePieceType;
}

interface LoadingCardVisualProps {
  // 駒種を強制指定する (主に /dev/loading-preview の確認用途)。
  // 未指定時はマウント時にランダム選択 (本番動作)。
  forcePieceType?: LoadingFacePieceType;
}

// ローディング表面の駒色オーバーライド (Issue #155 派生)。
// 対局画面の DEFAULT_PIECE_GRADIENT (淡いトーン) と意図的に分離し、ローディング
// では「黒地 + 中央スポット」の背景に映える「やや濃いめ・シャドウ強め」のトーン
// を採用する。stops は対局駒よりも 1 段濃く、右下シャドウまで深めにすることで、
// 黒地の中で駒が浮き立つコントラストを稼ぐ。
const LOADING_PIECE_COLOR_OVERRIDE = {
  border: "#4a2e15",
  inner: "#a86d3b",
  innerGradient: [
    { offset: "0%",   color: "#fde8b8" }, // 左上: 明るめ金茶ハイライト
    { offset: "30%",  color: "#d8a868" }, // 中明: 金茶
    { offset: "60%",  color: "#b07a40" }, // 中暗: 中濃檜茶
    { offset: "100%", color: "#5c3a1e" }, // 右下: 焦げ茶 (黒地に映える深め)
  ],
} as const;

// Issue #162: モバイル判定 (sm breakpoint < 640px)。
// ShogiPiece の isLarge fontSize (multichar 31px / 1 文字 48px) はカード幅
// 240px 想定の値で、モバイルで縮んだカード (~156px) には大きすぎる。
// モバイル時のみ fontSizeOverride で 22px に縮める (PC は undefined のまま現状維持)。
const MOBILE_LOADING_FONT_SIZE = 22;
const MOBILE_BREAKPOINT_QUERY = "(max-width: 639px)";

function useIsMobileViewport(): boolean {
  // SSR では window が無いので false で初期化 (= PC 表示)。ハイドレーション後の
  // effect で正しい値に再評価される。一瞬の差し替えはローディング表示なので許容。
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(MOBILE_BREAKPOINT_QUERY).matches;
  });
  useEffect(() => {
    const mql = window.matchMedia(MOBILE_BREAKPOINT_QUERY);
    const onChange = () => setIsMobile(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return isMobile;
}

// 表面: 裏面と同じ「金フレーム + 中央スポット + 中央駒」の世界観を保ちつつ、
// 背景は loading-card-face-bg (完全な黒地 + 中央楕円の白スポット) で漆 (minimal)
// とは別パターンに差別化する。中央駒は対局駒の淡いデフォルトとは分け、ローディング
// 専用の濃いめトーン (LOADING_PIECE_COLOR_OVERRIDE) で描画して黒地に映えさせる。
//   - 外枠: amber-400/70 の border-2
//   - 内枠: 内側 3px 位置に amber-300/35 の細枠
//   - 四隅: amber-300/70 の菱形 (45° 回転した小正方形)
//   - 背景: loading-card-face-bg (globals.css の専用 class)
//   - 中央: ランダム駒シルエット (ShogiPiece + ローディング用 colorOverride
//     + 正式名称の縦書き)
//   - Issue #162: モバイルでは駒字 fontSize を 22px に縮小 (PC は現状維持)
function LoadingCardFace({ pieceType }: LoadingCardFaceProps) {
  const isMobile = useIsMobileViewport();
  return (
    <div
      className={cn(
        "relative w-full h-full overflow-hidden rounded-md border-2",
        "border-amber-400/70 loading-card-face-bg",
      )}
    >
      {/* 内側の細枠 (ゴールド) */}
      <div
        className="absolute inset-[3px] rounded-sm border border-amber-300/35 pointer-events-none"
        aria-hidden
      />
      {/* 四隅の菱形 */}
      <span className="absolute top-1 left-1 w-1.5 h-1.5 rotate-45 bg-amber-300/70" aria-hidden />
      <span className="absolute top-1 right-1 w-1.5 h-1.5 rotate-45 bg-amber-300/70" aria-hidden />
      <span className="absolute bottom-1 left-1 w-1.5 h-1.5 rotate-45 bg-amber-300/70" aria-hidden />
      <span className="absolute bottom-1 right-1 w-1.5 h-1.5 rotate-45 bg-amber-300/70" aria-hidden />
      {/* 中央: ランダム駒シルエット (ローディング専用の濃いめグラデ + 正式名称縦書き) */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="h-[78%] aspect-[5/6]">
          <ShogiPiece
            piece={{ type: pieceType, owner: "sente" }}
            isLarge
            colorOverride={LOADING_PIECE_COLOR_OVERRIDE}
            kanjiOverride={LOADING_FACE_PIECE_LABEL[pieceType]}
            fontSizeOverride={isMobile ? MOBILE_LOADING_FONT_SIZE : undefined}
          />
        </div>
      </div>
    </div>
  );
}

export const LoadingCardVisual = memo(function LoadingCardVisual({
  forcePieceType,
}: LoadingCardVisualProps = {}) {
  const reduce = useReducedMotion() ?? false;
  // 表示中の駒種をマウント時にランダム決定 + 回転周期ごとに切替える。
  // forcePieceType 指定時はそれを優先し自動切替を停止 (preview 用)。
  const [pieceType, setPieceType] = useState<LoadingFacePieceType>(
    pickRandomPieceType,
  );
  const displayPieceType = forcePieceType ?? pieceType;

  // FLIP_PERIOD_MS ごとに次のランダム駒へ更新する。CSS の rotateY 0→360 が
  // 完了するタイミングは表が完全に背面にあるため、ユーザの目に映る切替えは
  // 「次の周回で表に出てきたとき初めて別の駒になっている」自然な見え方になる。
  // pieceType の変化は LoadingCardFace のみを再レンダーし、親の
  // animate-loading-card-flip / -bob は触らないので CSS animation は中断しない。
  useEffect(() => {
    if (reduce) return; // reduce 時は静止表示なので切替え不要
    if (forcePieceType) return; // 強制指定時 (preview) は固定
    const interval = setInterval(() => {
      setPieceType((cur) => pickNextRandomPieceType(cur));
    }, FLIP_PERIOD_MS);
    return () => clearInterval(interval);
  }, [reduce, forcePieceType]);

  // reduce 時は静止 (CardBack のみ)。preserve-3d 不要。
  if (reduce) {
    return (
      <div style={SIZE_STYLE} aria-hidden>
        <CardBack className="!w-full !h-full" />
      </div>
    );
  }

  return (
    <div
      className="relative animate-loading-card-bob"
      style={SIZE_STYLE}
      aria-hidden
    >
      <div
        className={cn(
          "relative w-full h-full",
          // Tailwind の任意値で transform-style を確実に適用。globals.css の
          // animation class 側でも同プロパティを指定しているが、Tailwind v4 の
          // ユーティリティ優先度を借りて表裏切替が確実に効くようにする。
          "[transform-style:preserve-3d]",
          "animate-loading-card-flip",
        )}
      >
        {/* 裏面: rotateY(0deg) を起点とし、ループの 0°・360° で正面に来る。
            backface-visibility: hidden により 90°〜270° の範囲は自動で隠れる。 */}
        <div className="absolute inset-0 [backface-visibility:hidden]">
          <CardBack className="!w-full !h-full" />
        </div>
        {/* 表面: rotateY(180deg) を初期姿勢にして裏面と背中合わせに重ねる。
            ループの 180° で正面に来る (= 半周ごとに表裏が切替わる)。 */}
        <div
          className="absolute inset-0 [backface-visibility:hidden]"
          style={{ transform: "rotateY(180deg)" }}
        >
          <LoadingCardFace pieceType={displayPieceType} />
        </div>
      </div>
    </div>
  );
});
