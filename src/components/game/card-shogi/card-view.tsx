"use client";

import { cn } from "@/lib/utils";
import type { CardInstance, CardRarity } from "@/lib/shogi/cards/types";
import { CARD_DEFS } from "@/lib/shogi/cards/definitions";

export type CardViewSize = "sm" | "md" | "lg" | "xl";

// 枠色 = レア度 (Issue #104)
//   common: シルバー / rare: ブルー / super_rare: ゴールド / epic: パープル
const RARITY_FRAME_CLASS: Record<CardRarity, string> = {
  common: "border-slate-400 dark:border-slate-500",
  rare: "border-sky-500",
  super_rare: "border-amber-400",
  epic: "border-violet-500",
};

// 斜め閃光 (左上→右下にスーッと光る)。super_rare と epic のみ適用。
const RARITY_HAS_SHINE: Record<CardRarity, boolean> = {
  common: false,
  rare: false,
  super_rare: true,
  epic: true,
};

// レア度別の動的グラデ背景 (rare/super_rare/epic のみ。globals.css 定義)
const RARITY_BG_CLASS: Record<CardRarity, string> = {
  common: "",
  rare: "card-rarity-bg-rare",
  super_rare: "card-rarity-bg-super-rare",
  epic: "card-rarity-bg-epic",
};

interface CardViewProps {
  card: CardInstance;
  faceDown?: boolean;
  onClick?: () => void;
  // 物理的に使用不可 (マナ不足など): グレーアウト + クリック不可 + cursor-not-allowed
  disabled?: boolean;
  // 文脈的に操作不可だが「使用不可ではない」(相手番・ドロー演出中など):
  // グレーアウトせず通常表示のまま、ホバー演出だけ抑止しクリックを無効化
  inactive?: boolean;
  size?: CardViewSize;
  selected?: boolean;
  fullWidth?: boolean;
  // 効果説明テキストを非表示にする (Issue #106: ダイアログプレビュー等で
  // 説明はダイアログ側に書く場合に重複を避けるため)
  hideDescription?: boolean;
}

// "sm" はサムネイル(裏向きの相手手札用、縦長)
// "md" / "lg" は表向きの手札(横長、コスト+アイコン+名前+説明)
// "xl" はドロー演出用の中央拡大表示(Issue #78、576x352px)
const SIZE_CLASS: Record<CardViewSize, string> = {
  sm: "w-12 h-16 text-[10px]",
  md: "w-32 h-[80px] text-[13px]",
  lg: "w-40 h-24 text-sm",
  xl: "w-[36rem] h-[22rem] text-2xl",
};

const FULL_WIDTH_HEIGHT: Record<CardViewSize, string> = {
  sm: "h-16",
  md: "h-[80px]",
  lg: "h-24",
  xl: "h-[22rem]",
};

const FULL_WIDTH_TEXT: Record<CardViewSize, string> = {
  sm: "text-[10px]",
  md: "text-[13px]",
  lg: "text-sm",
  xl: "text-2xl",
};

const ICON_SIZE_CLASS: Record<CardViewSize, string> = {
  sm: "text-base",
  md: "text-3xl",
  lg: "text-4xl",
  xl: "text-9xl",
};

const LEFT_W_CLASS: Record<CardViewSize, string> = {
  sm: "w-10",
  md: "w-10",
  lg: "w-10",
  xl: "w-40",
};

const COST_TEXT_CLASS: Record<CardViewSize, string> = {
  sm: "text-xs",
  md: "text-xs",
  lg: "text-xs",
  xl: "text-4xl",
};

const NAME_TEXT_CLASS: Record<CardViewSize, string> = {
  sm: "",
  md: "",
  lg: "",
  xl: "text-4xl",
};

const DESC_TEXT_CLASS: Record<CardViewSize, string> = {
  sm: "text-[10px]",
  md: "text-[11px]",
  lg: "text-[11px]",
  xl: "text-2xl",
};

const TRAP_BADGE_TEXT_CLASS: Record<CardViewSize, string> = {
  sm: "text-[8px]",
  md: "text-[10px]",
  lg: "text-[10px]",
  xl: "text-base",
};

const PADDING_CLASS: Record<CardViewSize, string> = {
  sm: "p-1",
  md: "p-2",
  lg: "p-2",
  xl: "p-6",
};

const GAP_CLASS: Record<CardViewSize, string> = {
  sm: "gap-1",
  md: "gap-2",
  lg: "gap-2",
  xl: "gap-5",
};

const FACEDOWN_SYMBOL_CLASS: Record<CardViewSize, string> = {
  sm: "text-2xl",
  md: "text-2xl",
  lg: "text-2xl",
  xl: "text-9xl",
};

/* epic オーブの size 別配置。
 * カタログ md=3個 を基準に、カードが大きいほど粒数を増やす。
 * 軌道 keyframes は orb-1/2/3 の 3 種しかないので、xl では同じ軌道を
 * 異なる delay で再利用して画面に分散させる。
 *   orbit: 既存の軌道(left/top の % 経路)
 *   color: 配色 class
 *   delay / delayHue: それぞれ位置アニメと色相揺らぎの開始ずれ (秒)
 */
type OrbVariant = {
  orbit: 1 | 2 | 3;
  color: "purple" | "blue" | "red";
  delay: number;
  delayHue: number;
};
const EPIC_ORBS_BY_SIZE: Record<CardViewSize, OrbVariant[]> = {
  sm: [],
  md: [
    { orbit: 1, color: "purple", delay: 0.0, delayHue: 0.0 },
    { orbit: 2, color: "blue",   delay: 0.6, delayHue: 0.4 },
    { orbit: 3, color: "red",    delay: 1.2, delayHue: 0.9 },
  ],
  lg: [
    { orbit: 1, color: "purple", delay: 0.0, delayHue: 0.0 },
    { orbit: 2, color: "blue",   delay: 0.6, delayHue: 0.4 },
    { orbit: 3, color: "red",    delay: 1.2, delayHue: 0.9 },
    { orbit: 2, color: "purple", delay: 2.6, delayHue: 1.6 },
  ],
  xl: [
    { orbit: 1, color: "purple", delay: 0.0, delayHue: 0.0 },
    { orbit: 2, color: "blue",   delay: 0.6, delayHue: 0.4 },
    { orbit: 3, color: "red",    delay: 1.2, delayHue: 0.9 },
    { orbit: 1, color: "blue",   delay: 1.8, delayHue: 1.3 },
    { orbit: 2, color: "red",    delay: 2.4, delayHue: 1.7 },
    { orbit: 3, color: "purple", delay: 3.0, delayHue: 2.2 },
    { orbit: 1, color: "red",    delay: 3.6, delayHue: 2.6 },
    { orbit: 2, color: "purple", delay: 4.2, delayHue: 3.0 },
  ],
};

export function CardView({
  card,
  faceDown = false,
  onClick,
  disabled = false,
  inactive = false,
  size = "md",
  selected = false,
  fullWidth = false,
  hideDescription = false,
}: CardViewProps) {
  const def = CARD_DEFS[card.defId];

  if (faceDown) {
    return (
      <div
        className={cn(
          "rounded-md border-2 border-indigo-700 bg-gradient-to-br from-indigo-700 to-indigo-900",
          "flex items-center justify-center text-white/80 font-bold shrink-0",
          fullWidth ? cn("w-full", FULL_WIDTH_HEIGHT[size]) : SIZE_CLASS[size],
          fullWidth && FACEDOWN_SYMBOL_CLASS[size],
        )}
        aria-label="伏せられたカード"
      >
        ♠
      </div>
    );
  }

  const sizeClass = fullWidth
    ? cn("w-full", FULL_WIDTH_HEIGHT[size], FULL_WIDTH_TEXT[size])
    : SIZE_CLASS[size];

  // disabled でも背景グラデ・閃光・オーブのレア度演出は維持し、saturate を
  // 落として「使えないが豪華さは保つ」表現にする (sm はサムネイル用なので OFF)。
  const isAnimated = size !== "sm";
  // 暗色背景が当たるレア度 (rare 以上、かつ animated 時) はコスト背景・説明文も
  // ダークモード用の色に強制切替して可読性を担保。
  const hasRarityBg = isAnimated && def.rarity !== "common";

  return (
    <button
      type="button"
      // inactive (相手番など) では HTML disabled を立てず onClick だけ無効化する。
      // disabled を立てるとマナ不足と同じ grayout 表現になってしまうため。
      onClick={inactive ? undefined : onClick}
      disabled={disabled}
      data-card-id={card.instanceId}
      data-rarity={def.rarity}
      data-card-size={size}
      className={cn(
        "relative overflow-hidden rounded-md border-2 bg-card text-card-foreground shadow-sm shrink-0",
        "flex flex-row items-stretch text-left transition-all",
        PADDING_CLASS[size],
        GAP_CLASS[size],
        sizeClass,
        // 枠色 = レア度
        RARITY_FRAME_CLASS[def.rarity],
        // 動的グラデ背景 + グロー pulse (rare/super_rare/epic、CSS で
        // animation を 1 プロパティに統合済み。sm/disabled では OFF)
        isAnimated && RARITY_BG_CLASS[def.rarity],
        // 斜め閃光 (super_rare/epic)
        isAnimated && RARITY_HAS_SHINE[def.rarity] && "card-rarity-shine",
        // disabled (マナ不足等の使用不可): 彩度を 40% まで下げて opacity も落とし
        //   「使えない」感を出す。完全モノクロにはせず、レア度の枠色や動的
        //   グラデを薄く残すことでレア/究極レア等の判別を可能にする。
        // inactive (相手番等の操作不可): 通常表示のまま、ホバー演出だけ抑止
        // 活性: card-hover-focus で暖色リング+lift のフォーカス強調
        disabled
          ? "opacity-55 saturate-[40%] cursor-not-allowed"
          : inactive
            ? "cursor-default"
            : "cursor-pointer card-hover-focus",
        // 選択時は ring で強調(枠のレア度色は維持)
        selected && "ring-2 ring-primary ring-offset-1 ring-offset-background",
      )}
      aria-label={`${def.name} (マナコスト ${def.cost})`}
    >
      {/* ホバーフォーカス用の薄黄色オーバーレイ。常に DOM に置き、:hover で
        * opacity をフェードイン (CSS 側 .card-hover-focus:hover .card-hover-overlay)。
        * disabled では :not(:disabled):hover が成立しないので透明のまま。 */}
      <span className="card-hover-overlay" aria-hidden />
      {/* オーブ (epic のみ): 紫・青・赤の光球が舞う。粒数はカードサイズに比例 */}
      {def.rarity === "epic" && isAnimated &&
        EPIC_ORBS_BY_SIZE[size].map((orb, i) => (
          <span
            key={i}
            className={cn(
              "card-rarity-orb",
              `card-rarity-orb-${orb.color}`,
              `card-rarity-orb-${orb.orbit}`,
            )}
            style={{
              ["--orb-delay" as string]: `${orb.delay}s`,
              ["--orb-delay-hue" as string]: `${orb.delayHue}s`,
            }}
            aria-hidden
          />
        ))}
      {/* 左: コストとアイコン */}
      <div
        className={cn(
          "relative z-10 flex flex-col items-center justify-center gap-0.5 shrink-0",
          LEFT_W_CLASS[size],
        )}
      >
        <span
          className={cn(
            "rounded-full leading-tight font-bold tabular-nums whitespace-nowrap inline-flex items-center",
            // Issue #106: 山札のドローコスト表示と統一感を出すため 💎×N 形式に
            // し、数値だけより「マナコスト」と直感的に分かるようにする。
            size === "xl" ? "px-3 py-1 gap-1.5" : "px-1 gap-0.5",
            COST_TEXT_CLASS[size],
            def.kind === "trap"
              ? hasRarityBg
                ? "bg-purple-900/50 text-purple-200"
                : "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200"
              : hasRarityBg
                ? "bg-amber-900/50 text-amber-200"
                : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
          )}
          title={`マナコスト: ${def.cost}`}
        >
          <span aria-hidden>💎</span>
          <span>×{def.cost}</span>
        </span>
        <span className={cn(ICON_SIZE_CLASS[size], "leading-none")} aria-hidden>
          {def.icon}
        </span>
      </div>
      {/* 右: 名前 + 説明 + (TRAPバッジ) */}
      <div className="relative z-10 flex-1 min-w-0 flex flex-col justify-center gap-0.5">
        <div className="flex items-center gap-1">
          <span className={cn("font-bold leading-tight truncate", NAME_TEXT_CLASS[size])}>{def.name}</span>
          {/* hideDescription 時はカード名横にバッジを置かず、下段(説明位置)に
            * 単独で配置する (モバイル手札で名前と被って見づらくなるため)。 */}
          {def.kind === "trap" && !hideDescription && (
            <span
              className={cn(
                "bg-emerald-600 text-white px-1.5 rounded font-bold leading-tight shrink-0 shadow-sm",
                TRAP_BADGE_TEXT_CLASS[size],
              )}
            >
              トラップ
            </span>
          )}
        </div>
        {!hideDescription && (
          <div
            className={cn(
              "leading-tight line-clamp-2",
              hasRarityBg ? "text-slate-300" : "text-muted-foreground",
              DESC_TEXT_CLASS[size],
            )}
          >
            {def.description}
          </div>
        )}
        {/* hideDescription 時のトラップカード: 元々説明があった位置にバッジを表示 */}
        {hideDescription && def.kind === "trap" && (
          <span
            className={cn(
              "bg-emerald-600 text-white px-1.5 rounded font-bold leading-tight shadow-sm self-start",
              TRAP_BADGE_TEXT_CLASS[size],
            )}
          >
            トラップ
          </span>
        )}
      </div>
    </button>
  );
}
