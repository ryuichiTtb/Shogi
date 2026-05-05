// マスターカタログ画面(Issue #102)で使用する表示ラベル定義。
// CardStatus / CardKind / CardRarity / CardPhase / CardTargeting の日本語表記と
// Badge 表示用カラークラスを集約する。

import type {
  CardCheckUsage,
  CardKind,
  CardRarity,
  CardStatus,
  CardPhase,
  CardTargeting,
} from "./types";

interface LabelInfo {
  label: string;
  className: string;
}

export const STATUS_INFO: Record<CardStatus, LabelInfo> = {
  draft: {
    label: "検討中",
    className:
      "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800/60 dark:text-slate-200 dark:border-slate-700",
  },
  preparing: {
    label: "準備中",
    className:
      "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-800",
  },
  active: {
    label: "公開中",
    className:
      "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-200 dark:border-emerald-800",
  },
  deprecated: {
    label: "廃止",
    className:
      "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/40 dark:text-red-200 dark:border-red-800",
  },
};

export const KIND_INFO: Record<CardKind, LabelInfo> = {
  normal: {
    label: "通常",
    className:
      "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-800",
  },
  trap: {
    label: "トラップ",
    className:
      "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/40 dark:text-purple-200 dark:border-purple-800",
  },
};

export const RARITY_INFO: Record<CardRarity, LabelInfo> = {
  common: {
    label: "ノーマル",
    className:
      "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800/60 dark:text-slate-200 dark:border-slate-700",
  },
  rare: {
    label: "レア",
    className:
      "bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-900/40 dark:text-sky-200 dark:border-sky-800",
  },
  super_rare: {
    label: "激レア",
    className:
      "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-700",
  },
  epic: {
    label: "究極",
    className:
      "bg-violet-100 text-violet-900 border-violet-300 dark:bg-violet-900/40 dark:text-violet-200 dark:border-violet-700",
  },
};

export const PHASE_LABEL: Record<CardPhase, string> = {
  "0": "Phase 0",
  A: "Phase A",
  B: "Phase B",
  C: "Phase C",
};

// 王手中の使用可否 (Issue #82)。詳細ページ/ダイアログで専用セクションとして表示する。
interface CheckUsageInfo {
  label: string;
  description: string;
  className: string;
}

export const CHECK_USAGE_INFO: Record<CardCheckUsage, CheckUsageInfo> = {
  forbidden: {
    label: "使用不可",
    description:
      "カードの効果が王手回避につながらないため、王手中は使用できません。",
    className:
      "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/40 dark:text-red-200 dark:border-red-800",
  },
  conditional: {
    label: "条件付きで使用可",
    description:
      "カードの効果適用先が王手回避になる場合のみ使用できます (合駒・利き切りなど)。",
    className:
      "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-800",
  },
  unconditional: {
    label: "常に使用可",
    description:
      "王手中でも常に使用可能です (カードの効果が必ず王手回避手段を提供するため)。",
    className:
      "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-200 dark:border-emerald-800",
  },
};

export const TARGETING_LABEL: Record<CardTargeting, string> = {
  none: "対象なし",
  ownPiece: "自分の駒",
  enemyPiece: "相手の駒",
  square: "盤面マス",
};

// フィルタ UI で使用する選択肢配列(順序固定)
export const STATUS_OPTIONS: CardStatus[] = ["active", "preparing", "draft", "deprecated"];
export const KIND_OPTIONS: CardKind[] = ["normal", "trap"];
export const RARITY_OPTIONS: CardRarity[] = ["common", "rare", "super_rare", "epic"];
