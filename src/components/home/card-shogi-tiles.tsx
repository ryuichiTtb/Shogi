// Issue #117: 新ホームに並べるカード将棋機能タイル。
// 4 枚 (デッキ編成 / カードデザイン / カード一覧 / 開発者ツール) + 将来枠 (ガチャ Coming Soon)。
// 順序は #82 でユーザーが整えた配置に揃え、4 枚目に dev ツール一覧 (/dev) への導線を置く。
// クリックで親ページの onNavigate(href, label) を呼び、LoadingOverlay と整合させる。
"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Layers, Library, Palette, Sparkles, Lock, Wrench } from "lucide-react";

import {
  CARD_BACK_STYLES,
  DEFAULT_CARD_BACK_STYLE,
} from "@/components/card-back/style-options";
import { useCardBackStyle } from "@/components/card-back/card-back-provider";
import { cn } from "@/lib/utils";

interface CardShogiTilesProps {
  onNavigate: (href: string, label?: string) => void;
  disabled?: boolean;
}

interface TileDef {
  href: string;
  label: string;
  description: string;
  Icon: typeof Layers;
}

// #82 で整理された並び順: デッキ編成 → カードデザイン → カード一覧 → 開発者ツール
const TILES: TileDef[] = [
  { href: "/decks",       label: "デッキ編成",     description: "デッキを編成する",  Icon: Library },
  { href: "/card-design", label: "カードデザイン", description: "裏面を選ぶ",        Icon: Palette },
  { href: "/cards",       label: "カード一覧",     description: "全カードを見る",    Icon: Layers },
  { href: "/dev",         label: "開発者ツール",   description: "演出 / 音源 等",    Icon: Wrench },
];

export function CardShogiTiles({ onNavigate, disabled = false }: CardShogiTilesProps) {
  const reduce = useReducedMotion();
  const { style: liveStyle } = useCardBackStyle();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  // 「カードデザイン」タイルのサブテキストに現在のスタイル名を表示。
  // hydration 前は default で固定。
  const currentStyleLabel = CARD_BACK_STYLES[mounted ? liveStyle : DEFAULT_CARD_BACK_STYLE].label;

  return (
    <div className="space-y-2">
      {/* 4 枚なので 2x2 (mobile) / 4 列 (sm 以上) で並べる */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {TILES.map((tile, idx) => {
          const subText = tile.href === "/card-design" ? `裏面: ${currentStyleLabel}` : tile.description;
          return (
            <motion.button
              key={tile.href}
              type="button"
              onClick={() => onNavigate(tile.href)}
              disabled={disabled}
              initial={mounted && !reduce ? { opacity: 0, y: 8 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: 0.06 * idx, ease: "easeOut" }}
              className={cn(
                "relative flex flex-col items-center justify-center gap-1 py-3 px-2",
                "rounded-xl border-2 border-border bg-card/85 backdrop-blur-sm",
                "text-xs sm:text-sm font-medium card-hover-lift",
                "hover:border-primary/40 transition-colors",
                "disabled:opacity-60 disabled:cursor-not-allowed",
                "cursor-pointer",
              )}
              aria-label={`${tile.label}を開く`}
            >
              <tile.Icon className="w-7 h-7 sm:w-8 sm:h-8 text-primary/80" />
              <span className="font-bold leading-tight">{tile.label}</span>
              <span className="text-[10px] sm:text-xs text-muted-foreground leading-tight">
                {subText}
              </span>
            </motion.button>
          );
        })}
      </div>

      {/* 将来枠 (ガチャ Coming Soon) */}
      <motion.div
        initial={mounted && !reduce ? { opacity: 0, y: 8 } : false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: 0.06 * 3, ease: "easeOut" }}
        role="button"
        aria-disabled="true"
        aria-label="ガチャ (近日公開)"
        title="近日公開"
        tabIndex={0}
        className={cn(
          "relative flex items-center justify-center gap-2 py-2.5 px-3",
          "rounded-xl border-2 border-dashed border-border/70 bg-card/40 backdrop-blur-sm",
          "text-xs sm:text-sm text-muted-foreground",
          "cursor-not-allowed",
        )}
      >
        <Lock className="w-3.5 h-3.5" />
        <Sparkles className="w-4 h-4" />
        <span>ガチャ <span className="opacity-70">(近日公開)</span></span>
      </motion.div>
    </div>
  );
}
