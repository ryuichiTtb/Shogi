"use client";

import { useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { CardView } from "@/components/game/card-shogi/card-view";
import { cn } from "@/lib/utils";
import { CARD_DEFS } from "@/lib/shogi/cards/definitions";
import { RARITY_INFO } from "@/lib/shogi/cards/labels";
import type { CardId } from "@/lib/shogi/cards/types";

export type DeckArea = "deck" | "owned";

interface DeckCardTileProps {
  // 同一 cardId が複数並ぶときに React key を一意にするための補助。
  instanceKey?: string | number;
  cardId: CardId;
  // フライト元/先を判別するため、領域種別を data 属性として埋める。
  area: DeckArea;
  // タイル右上に重ねるバッジ。例: ×N
  topBadge?: React.ReactNode;
  // 物理的に使用不可 (所持枚数を全部編成済み等)。CardView の disabled と同じ
  // 見た目 (saturate-40% + opacity-55 + cursor-not-allowed) になる。
  disabled?: boolean;
  // クリック時に発火。フライト演出の起点として、タイルの画面座標を渡す。
  onClick?: (sourceRect: DOMRect) => void;
  // 長押し時に発火 (主にモバイル用、カード詳細を表示する)。
  onLongPress?: (cardId: CardId) => void;
  title?: string;
  // フライト中は元タイルを視覚的に隠す (DeckCardTile を render し続けたまま
  // 透明にすることで grid レイアウトの揺れを避ける)。
  ghosted?: boolean;
}

const LONG_PRESS_MS = 450;
// pointer がこの px だけ動いたら長押しはキャンセル (スクロール意図とみなす)。
// 一度キャンセルされたら、指を離すまで再開しない。
const LONG_PRESS_MOVE_THRESHOLD_PX = 10;

// 現在のデッキ・所持カード両方で使う共通タイル。
// モバイル (< lg): cost + icon + name のコンパクト表示 + 長押しで詳細。
// デスクトップ (lg+): フル CardView を表示。
export function DeckCardTile({
  cardId,
  instanceKey,
  area,
  topBadge,
  disabled = false,
  onClick,
  onLongPress,
  title,
  ghosted = false,
}: DeckCardTileProps) {
  const ref = useRef<HTMLDivElement>(null);
  const def = CARD_DEFS[cardId];

  // ---- 長押し検出 (compact / mobile 用) ----
  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const longPressStartPosRef = useRef<{ x: number; y: number } | null>(null);

  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressStartPosRef.current = null;
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (!onLongPress || disabled) return;
      longPressTriggeredRef.current = false;
      longPressStartPosRef.current = { x: e.clientX, y: e.clientY };
      // 既存タイマーは重複しないようクリアしてから再セット。
      if (longPressTimerRef.current !== null) {
        window.clearTimeout(longPressTimerRef.current);
      }
      longPressTimerRef.current = window.setTimeout(() => {
        longPressTriggeredRef.current = true;
        onLongPress(cardId);
        longPressTimerRef.current = null;
        longPressStartPosRef.current = null;
      }, LONG_PRESS_MS);
    },
    [cardId, disabled, onLongPress],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      // タイマー稼働中だけチェック。閾値超えたら以降の長押しは諦める。
      if (longPressTimerRef.current === null) return;
      const start = longPressStartPosRef.current;
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (
        dx * dx + dy * dy >
        LONG_PRESS_MOVE_THRESHOLD_PX * LONG_PRESS_MOVE_THRESHOLD_PX
      ) {
        cancelLongPress();
      }
    },
    [cancelLongPress],
  );

  function handleClick() {
    if (disabled) return;
    if (longPressTriggeredRef.current) {
      // 長押しが先に発火していたら通常 click は無効化
      longPressTriggeredRef.current = false;
      return;
    }
    if (!onClick) return;
    const rect = ref.current?.getBoundingClientRect();
    if (rect) onClick(rect);
  }

  return (
    <motion.div
      ref={ref}
      // layout="position" により、リスト前後関係の変化に追従してタイルが
      // スムーズに移動する。サイズ変化はしないので "position" 限定で十分。
      layout="position"
      transition={{ duration: 0.24, ease: "easeOut" }}
      className={cn("relative transition-opacity", ghosted && "opacity-0")}
      data-deck-area={area}
      data-card-id={cardId}
      data-instance-key={instanceKey ?? "single"}
      title={title}
    >
      {/* モバイル: コンパクトタイル (cost + icon + name) + 長押し詳細 */}
      <button
        type="button"
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={cancelLongPress}
        onPointerLeave={cancelLongPress}
        onPointerCancel={cancelLongPress}
        disabled={disabled}
        className={cn(
          "lg:hidden w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md border-2",
          "transition-all touch-manipulation select-none",
          RARITY_INFO[def.rarity].className,
          !disabled && "cursor-pointer active:scale-95",
          disabled && "saturate-50 opacity-55 cursor-not-allowed",
        )}
      >
        <span
          className="rounded-full bg-background/80 text-foreground w-5 h-5 text-[11px] flex items-center justify-center font-bold tabular-nums shrink-0 ring-1 ring-foreground/15"
          aria-label={`コスト ${def.cost}`}
        >
          {def.cost}
        </span>
        <span className="text-base shrink-0" aria-hidden>
          {def.icon}
        </span>
        <span className="text-[11px] font-medium truncate flex-1 text-left">
          {def.name}
        </span>
      </button>

      {/* デスクトップ: フル CardView */}
      <div className="hidden lg:block">
        <CardView
          card={{
            instanceId: `tile-${area}-${cardId}-${instanceKey ?? "single"}`,
            defId: cardId,
          }}
          size="md"
          fullWidth
          disabled={disabled}
          onClick={onClick ? handleClick : undefined}
        />
      </div>

      {topBadge && (
        <div className="absolute -top-2 -right-1 pointer-events-none z-10">
          {topBadge}
        </div>
      )}
    </motion.div>
  );
}

export function TileBadge({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px] px-1.5 py-0 leading-tight border-2 shadow-sm tabular-nums",
        className,
      )}
    >
      {children}
    </Badge>
  );
}
