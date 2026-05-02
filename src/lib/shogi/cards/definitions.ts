import type { CardDefinition, CardId } from "./types";

// Phase 0 暫定カード3種(設計ドキュメント 3.5)
// 「状態のみ」「ターゲット選択あり」「トラップ」の3パターンを最小被覆。
export const CARD_DEFS: Record<CardId, CardDefinition> = {
  // Issue #82 で廃止。「マナを使ってマナを増やす」という設計の意義が薄いと判断。
  // 効果コード(applyManaUp / use-card-shogi-game の effectId 分岐)の最終撤去は #80 で扱う。
  mana_up: {
    id: "mana_up",
    kind: "normal",
    name: "マナUP",
    description: "マナを3チャージする",
    cost: 2,
    rarity: "common",
    effectId: "mana_up",
    targeting: "none",
    icon: "💎",
    status: "deprecated",
    phase: "0",
    detailDescription:
      "使用すると即時にマナを +3 する。\n\n- ターゲット選択なし\n- マナ上限(現状20)を超えてチャージしない\n- 1ターン中の使用上限なし(マナ消費分は支払う必要あり)\n\n【廃止】Issue #82 のカード初版検討で廃止判断。マナ消費でマナを増やす設計の意義が薄いため。",
    addedAt: "2026-04-30",
    relatedIssues: [68, 80, 82],
  },
  pawn_return: {
    id: "pawn_return",
    kind: "normal",
    name: "歩戻し",
    description: "自分の盤上の歩を1枚、持ち駒に戻す",
    cost: 1,
    rarity: "common",
    effectId: "pawn_return",
    targeting: "ownPiece",
    icon: "↩️",
    status: "active",
    phase: "0",
    detailDescription:
      "自分の盤上の歩(成り歩=と金は対象外)1枚を選び、持ち駒に戻す。\n\n- ターゲット: 自盤上の歩\n- 成った歩(と金)は対象外\n- 持ち駒に戻った歩は次ターン以降に通常通り打てる",
    addedAt: "2026-04-30",
    relatedIssues: [68, 80, 82],
  },
  no_promote: {
    id: "no_promote",
    kind: "trap",
    name: "成り無効化",
    description: "次に相手が成りを宣言したとき、それを1回無効化する",
    cost: 4,
    rarity: "rare",
    effectId: "no_promote",
    targeting: "none",
    icon: "🛡️",
    status: "active",
    phase: "0",
    detailDescription:
      "自分の盤面に1枚だけセットできるトラップカード。次に相手が成りを宣言したとき、その成りを1回無効化して破棄される。\n\n- 自動発火(セットしておけば該当タイミングで自動で発動)\n- 1枚だけセット可、既にセット済みなら新規セットで上書き(既存は破棄)",
    addedAt: "2026-04-30",
    relatedIssues: [68, 80, 82],
  },

  // --- サンプルカード (Issue #104 レア度ビジュアル検証用、status: "draft") ---
  // 通常×4 + トラップ×4 = 8 種。effectId/cost は仮で、プールには入らない。

  sample_normal_common: {
    id: "sample_normal_common",
    kind: "normal",
    name: "サンプル通常 ノーマル",
    description: "ノーマルレア度の通常カード見本",
    cost: 1,
    rarity: "common",
    effectId: "noop",
    targeting: "none",
    icon: "🟢",
    status: "draft",
    detailDescription: "レア度ビジュアル検証用のサンプル。実プールには出ません。",
    addedAt: "2026-05-01",
    relatedIssues: [104],
  },
  sample_normal_rare: {
    id: "sample_normal_rare",
    kind: "normal",
    name: "サンプル通常 レア",
    description: "レアレア度の通常カード見本",
    cost: 3,
    rarity: "rare",
    effectId: "noop",
    targeting: "none",
    icon: "🔷",
    status: "draft",
    detailDescription: "レア度ビジュアル検証用のサンプル。実プールには出ません。",
    addedAt: "2026-05-01",
    relatedIssues: [104],
  },
  sample_normal_super_rare: {
    id: "sample_normal_super_rare",
    kind: "normal",
    name: "サンプル通常 激レア",
    description: "激レアレア度の通常カード見本",
    cost: 5,
    rarity: "super_rare",
    effectId: "noop",
    targeting: "none",
    icon: "💎",
    status: "draft",
    detailDescription: "レア度ビジュアル検証用のサンプル。実プールには出ません。",
    addedAt: "2026-05-01",
    relatedIssues: [104],
  },
  sample_normal_epic: {
    id: "sample_normal_epic",
    kind: "normal",
    name: "サンプル通常 究極",
    description: "究極レア度の通常カード見本",
    cost: 7,
    rarity: "epic",
    effectId: "noop",
    targeting: "none",
    icon: "👑",
    status: "draft",
    detailDescription: "レア度ビジュアル検証用のサンプル。実プールには出ません。",
    addedAt: "2026-05-01",
    relatedIssues: [104],
  },
  sample_trap_common: {
    id: "sample_trap_common",
    kind: "trap",
    name: "サンプルトラップ ノーマル",
    description: "ノーマルレア度のトラップカード見本",
    cost: 2,
    rarity: "common",
    effectId: "noop",
    targeting: "none",
    icon: "🪤",
    status: "draft",
    detailDescription: "レア度ビジュアル検証用のサンプル。実プールには出ません。",
    addedAt: "2026-05-01",
    relatedIssues: [104],
  },
  sample_trap_rare: {
    id: "sample_trap_rare",
    kind: "trap",
    name: "サンプルトラップ レア",
    description: "レアレア度のトラップカード見本",
    cost: 4,
    rarity: "rare",
    effectId: "noop",
    targeting: "none",
    icon: "🕸️",
    status: "draft",
    detailDescription: "レア度ビジュアル検証用のサンプル。実プールには出ません。",
    addedAt: "2026-05-01",
    relatedIssues: [104],
  },
  sample_trap_super_rare: {
    id: "sample_trap_super_rare",
    kind: "trap",
    name: "サンプルトラップ 激レア",
    description: "激レアレア度のトラップカード見本",
    cost: 6,
    rarity: "super_rare",
    effectId: "noop",
    targeting: "none",
    icon: "☠️",
    status: "draft",
    detailDescription: "レア度ビジュアル検証用のサンプル。実プールには出ません。",
    addedAt: "2026-05-01",
    relatedIssues: [104],
  },
  sample_trap_epic: {
    id: "sample_trap_epic",
    kind: "trap",
    name: "サンプルトラップ 究極",
    description: "究極レア度のトラップカード見本",
    cost: 8,
    rarity: "epic",
    effectId: "noop",
    targeting: "none",
    icon: "🌟",
    status: "draft",
    detailDescription: "レア度ビジュアル検証用のサンプル。実プールには出ません。",
    addedAt: "2026-05-01",
    relatedIssues: [104],
  },
};

export const ALL_CARD_DEFS: CardDefinition[] = Object.values(CARD_DEFS);

// マナ・ドローコストの確定値(Issue #81 / 2026-05-01 確定)
export const INITIAL_MANA: Record<"sente" | "gote", number> = {
  sente: 2,
  gote: 3,
};

// 将来カード効果(自分UP/相手DOWN)で動的化する想定。state 側で保持する初期値として参照する。
export const MANA_CAP = 20;

// マナを消費して山札からドロー
export const DRAW_COST = 3;

// 1ターン消費すると +1、早指し(FAST_THRESHOLD_MS 以内)で +2
export const MANA_PER_TURN = 1;
export const MANA_FAST_BONUS = 1; // 早指し時の追加分(合計+2)
export const FAST_THRESHOLD_MS = 3000;
