// Issue #117 (+#79): 新ホームに並べるカード将棋機能タイル。
// 4 枚 (デッキ編成 / カードデザイン / カード一覧 / 開発者ツール) + 将来枠 (ガチャ Coming Soon)。
// 順序は #82 でユーザーが整えた配置に揃え、4 枚目に dev ツール一覧 (/dev) への導線を置く
// (#79 で旧「フライト検証用」を /dev 配下に集約)。
// クリックで親ページの onNavigate(href) を呼び、LoadingOverlay と整合させる。
// (Issue #155: 親ページが href から自動で適切な stages を解決するため、ここから
// label を渡す必要はない。)
"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Layers, Library, Palette, Sparkles, Lock, Wrench, Grid3x3 } from "lucide-react";

import {
  CARD_BACK_STYLES,
  DEFAULT_CARD_BACK_STYLE,
} from "@/components/card-back/style-options";
import { useCardBackStyle } from "@/components/card-back/card-back-provider";
import { useBoardLayout } from "@/components/board-layout/board-layout-provider";
import { cn } from "@/lib/utils";

interface CardShogiTilesProps {
  onNavigate: (href: string) => void;
  disabled?: boolean;
}

interface TileDef {
  href: string;
  label: string;
  description: string;
  Icon: typeof Layers;
}

// #82 で整理された並び順 + Issue #177 (盤デザイン追加) + #79 (フライト検証 → 開発者ツールに統合)
const TILES: TileDef[] = [
  { href: "/decks",        label: "デッキ編成",     description: "デッキを編成する",      Icon: Library },
  { href: "/card-design",  label: "カードデザイン", description: "裏面を選ぶ",            Icon: Palette },
  { href: "/board-design", label: "盤デザイン",     description: "盤面の見た目を選ぶ",    Icon: Grid3x3 },
  { href: "/cards",        label: "カード一覧",     description: "全カードを見る",        Icon: Layers },
  { href: "/dev",          label: "開発者ツール",   description: "演出 / 音源 等",        Icon: Wrench },
];

export function CardShogiTiles({ onNavigate, disabled = false }: CardShogiTilesProps) {
  const reduce = useReducedMotion();
  const { style: liveStyle } = useCardBackStyle();
  const liveBoardLayout = useBoardLayout();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  // 「カードデザイン」タイルのサブテキストに現在のスタイル名を表示。
  // hydration 前は default で固定。
  const currentStyleLabel = CARD_BACK_STYLES[mounted ? liveStyle : DEFAULT_CARD_BACK_STYLE].label;
  const currentBoardLabel = mounted ? liveBoardLayout.name : "";

  return (
    <div className="space-y-2">
      {/* 5 枚: 2x3 (mobile) / 5 列 (sm 以上) */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {TILES.map((tile, idx) => {
          const subText =
            tile.href === "/card-design"
              ? `裏面: ${currentStyleLabel}`
              : tile.href === "/board-design" && currentBoardLabel
                ? `盤面: ${currentBoardLabel}`
                : tile.description;
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
