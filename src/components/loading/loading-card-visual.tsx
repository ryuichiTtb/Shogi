// Issue #155: LoadingOverlay 中央に表示する「ふわふわ回転カード」。
//
// 実装方針:
//   - rotateY 360° の連続ループを CSS keyframes (loading-card-flip) で再生し、
//     表面と裏面の 2 枚を [transform-style: preserve-3d] の親に重ねて
//     [backface-visibility: hidden] で半周ごとに表裏を切替える。
//   - 表面はレア度演出 (epic オーブ・shine・グラデ) を OFF にした最小描画で、
//     モバイル端末の発熱を抑える (Issue #109 性能観点)。
//   - prefers-reduced-motion: reduce のときは framer-motion の useReducedMotion
//     経由で reduce フラグを取得し、回転を止めて CardBack のみを静止表示する。
//   - サイズはレスポンシブに clamp(140px, 40vw, 240px)、アスペクト比 8:5 を維持。
"use client";

import { memo } from "react";
import { useReducedMotion } from "framer-motion";

import { CardBack } from "@/components/card-back/card-back";
import { CARD_DEFS } from "@/lib/shogi/cards/definitions";
import type { CardId, CardRarity } from "@/lib/shogi/cards/types";
import { cn } from "@/lib/utils";

interface LoadingCardVisualProps {
  // CardId は CARD_DEFS のキーと一致するリテラル union 型。string 受けにすると
  // CARD_DEFS[card.cardId] のインデックスアクセスで型エラー (Vercel ビルド失敗)
  // となるため、呼び出し側に CardId 型での渡し方を強制する。
  card: { cardId: CardId } | { variant: "generic" };
}

// レア度の枠色のみローディング用に簡略化して引用 (Issue #104 配色と整合)。
// 動的グラデ・shine・オーブ等の重演出は意図的に OFF。
const RARITY_FRAME_CLASS: Record<CardRarity, string> = {
  common: "border-slate-400 dark:border-slate-500",
  rare: "border-sky-500",
  super_rare: "border-amber-400",
  epic: "border-violet-500",
};

const SIZE_STYLE = {
  width: "clamp(140px, 40vw, 240px)",
  aspectRatio: "8 / 5",
} as const;

interface LoadingCardFaceProps {
  cardId: CardId;
}

// 表面の最小描画 (アイコン+コスト+カード名のみ)。
// CardView の動的演出 (epic オーブ等) を持ち込まないことで GPU 負荷を抑える。
function LoadingCardFace({ cardId }: LoadingCardFaceProps) {
  const def = CARD_DEFS[cardId];
  return (
    <div
      className={cn(
        "w-full h-full rounded-md border-2 bg-card text-card-foreground shadow-sm",
        "flex items-center gap-2 px-2 overflow-hidden",
        RARITY_FRAME_CLASS[def.rarity],
      )}
    >
      <div className="flex flex-col items-center gap-0.5 shrink-0">
        <span
          className={cn(
            "rounded-full px-1 leading-tight font-bold tabular-nums whitespace-nowrap inline-flex items-center gap-0.5 text-[10px]",
            def.kind === "trap"
              ? "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200"
              : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
          )}
        >
          <span aria-hidden>💎</span>
          <span>×{def.cost}</span>
        </span>
        <span className="text-3xl leading-none" aria-hidden>
          {def.icon}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-bold text-xs leading-tight truncate">{def.name}</div>
      </div>
    </div>
  );
}

export const LoadingCardVisual = memo(function LoadingCardVisual({
  card,
}: LoadingCardVisualProps) {
  const reduce = useReducedMotion() ?? false;
  const isGeneric = "variant" in card;
  // 不正な cardId が渡された場合は generic にフォールバックして安全側に倒す。
  const def = !isGeneric ? CARD_DEFS[card.cardId] : null;
  const showFace = def !== null;

  // reduce 時は静止 (CardBack のみ)。表裏切替アニメも止めるため preserve-3d 不要。
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
      <div className="relative w-full h-full animate-loading-card-flip">
        {/* 裏面: rotateY(0deg) を起点とし、ループの 0°・360° で正面に来る。
            backface-visibility: hidden により 90°〜270° の範囲は自動で隠れる。 */}
        <div className="absolute inset-0 [backface-visibility:hidden]">
          <CardBack className="!w-full !h-full" />
        </div>
        {/* 表面: rotateY(180deg) を初期姿勢にして裏面と背中合わせに重ねる。
            ループの 180° で正面に来る (= 半周ごとに表裏が切替わる)。 */}
        {showFace && !isGeneric && (
          <div
            className="absolute inset-0 [backface-visibility:hidden]"
            style={{ transform: "rotateY(180deg)" }}
          >
            <LoadingCardFace cardId={card.cardId} />
          </div>
        )}
      </div>
    </div>
  );
});
