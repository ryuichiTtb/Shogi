"use client";

import { useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { CardView } from "@/components/game/card-shogi/card-view";
import { cn } from "@/lib/utils";
import { CARD_DEFS } from "@/lib/shogi/cards/definitions";
import type { CardId, CardRarity } from "@/lib/shogi/cards/types";
import { MarqueeText } from "./marquee-text";

export type DeckArea = "deck" | "owned";

// モバイルのコンパクトタイル用レア度ビジュアル。CardView と揃える形で
// 「枠色 + 動的グラデ背景 (rare/super_rare/epic) + 斜め閃光 (super_rare/epic)」
// を 1 行に集約。クラス本体は globals.css で定義済み。
const COMPACT_RARITY_CLASS: Record<CardRarity, string> = {
  common:
    "bg-card text-card-foreground border-slate-400 dark:border-slate-500",
  rare: "card-rarity-bg-rare border-sky-500",
  super_rare: "card-rarity-bg-super-rare border-amber-400 card-rarity-shine",
  epic: "card-rarity-bg-epic border-violet-500 card-rarity-shine",
};

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

// Issue #183: PC でも長押しで詳細を出す方針に伴い、450ms → 250ms へ短縮。
// 通常タップ (50〜200ms) との交絡を避けつつ、PC マウス操作での待ち感を最小化。
const LONG_PRESS_MS = 250;
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
  // Issue #132: react-hooks/rules-of-hooks 修正。
  // 旧実装は `useRef(ref)` の後に `if (!def) return null;` で早期 return し、
  // その下に `useRef × 3` / `useCallback × 2` を呼んでいた。条件付き return 後の hook 呼出
  // は順序保証を破壊するため lint エラー (orphan cardId 時に hook が呼ばれず React 内部
  // 状態がズレる)。全 hook を関数先頭で呼び切ってから def チェックに進むように並べ替えた。
  const ref = useRef<HTMLDivElement>(null);
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
      // disabled (0 枚カードなど) でも長押し詳細は発火させる。
      // 通常 click だけ handleClick 側で disabled 早期 return する。
      if (!onLongPress) return;
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
    [cardId, onLongPress],
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

  // ---- 長押し検出 (compact / mobile 用) hook 呼出はここまで。以降は def チェック後の通常 render ----
  const def = CARD_DEFS[cardId];
  // Issue #117 (#128): server 側で orphan を弾いているので通常は発生しないが、
  // データドリフト時に画面全体クラッシュさせない最終防御として早期 return。
  // (CARD_DEFS に居ない cardId が来た場合 = `def === undefined` で `def.rarity` NPE になる)
  if (!def) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[DeckCardTile] Unknown cardId "${cardId}" — skipping render`);
    }
    return null;
  }

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
      // Issue #183: PC でもクリック長押しで詳細を表示できるよう、pointer event を
      // 親 motion.div で一元的に listen する。pointer event は子 (mobile button /
      // desktop CardView) から bubble するため、ブレークポイント別 (lg:hidden /
      // hidden lg:block) の表示切替に関わらず両方で同じ長押しロジックが効く。
      // user-select / callout 抑止も親で吸収して mobile / desktop 共通に適用。
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={cancelLongPress}
      onPointerLeave={cancelLongPress}
      onPointerCancel={cancelLongPress}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        WebkitUserSelect: "none",
        WebkitTouchCallout: "none",
        userSelect: "none",
      }}
    >
      {/* モバイル: コンパクトタイル (cost + icon + name) + 長押し詳細
          注意: 0 枚カードでも長押しで詳細を見せたいので HTML disabled は
          付けず aria-disabled + 見た目だけ無効にする。click は handleClick
          側で disabled 早期 return。長押し検出は親 motion.div 側に集約。 */}
      <button
        type="button"
        onClick={handleClick}
        aria-disabled={disabled}
        className={cn(
          "lg:hidden relative overflow-hidden w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md border-2",
          "transition-all touch-manipulation",
          // shine / 動的グラデ背景は relative overflow-hidden が前提。
          COMPACT_RARITY_CLASS[def.rarity],
          !disabled && "cursor-pointer active:scale-95",
          disabled && "saturate-50 opacity-55 cursor-not-allowed",
        )}
      >
        <span
          // レア度別の暗色背景 (card-rarity-bg-*) でも読めるよう、コスト
          // バッジは常に明色 + 暗色テキスト固定にする。
          className="rounded-full bg-white/90 text-slate-900 w-5 h-5 text-[11px] flex items-center justify-center font-bold tabular-nums shrink-0 ring-1 ring-black/20 z-10 relative"
          aria-label={`コスト ${def.cost}`}
        >
          {def.cost}
        </span>
        <span className="relative z-10 text-base shrink-0" aria-hidden>
          {def.icon}
        </span>
        {/* container 幅より長いカード名は ping-pong スクロールで全文を見せる。
            z-10 で背景の動的グラデや閃光より前面に。 */}
        <MarqueeText
          text={def.name}
          className="relative z-10 text-[11px] font-medium flex-1 text-left"
        />
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
