// Issue #235 S2a: L1 カードフレームワーク (CardSpec registry) の **client-safe / meta-only** 層。
//
// 目的 (epic doc §3 L1 / §4 / S2 計画 docs/plans/issue-235-s2-cardspec.md §2):
//   1 カードが 6+ ファイルに分散している現状 (definitions CARD_DEFS + CARD_USE_CONDITIONS +
//   effects applyXxx + digest/heuristics 係数 + action-generator 候補 + undo-policy isCardOpEvent +
//   reducer/kernel 効果分岐) を、単一 `CardSpec` registry に集約する (P2/P5 解消)。
//
// 本ファイルの責務 = **関数を持たない meta データのみ** (Server→Client 境界を serialize 可能):
//   - `CardMeta` 型 + `CARD_META` レコード (CARD_DEFS から派生する client-safe な subset、§9 A6)
//   - registry SSOT helper (`getValidCardIds` / `getActiveCards` / `getPlayableCards`)
//   関数 (effect.apply / useCondition / valueModel / onTrigger) を持つ `CardSpec` 本体は
//   サーバ専用モジュール `card-spec-server.ts` に物理分離する (§5 R-2 / §9 A5。S2d で ESLint により
//   `src/components/**`・`src/hooks/**` からの server import を禁止する)。
//
// S2a の大前提 (§1): 本 registry は **production 未配線 (additive)**。挙動完全不変。
//   meta は CARD_DEFS から派生し (§3 S2a「meta は CARD_DEFS から」)、definitions.ts を SSOT のまま
//   維持する。旧 CARD_DEFS / ALL_CARD_DEFS の一本化 (registry 由来 re-export) は S2d で扱う
//   (seed が CardMeta 非包含の description/effectId を必要とするため、本段では re-export しない)。

import type { CardDefinition, CardId, CardKind, CardPhase, CardRarity, CardStatus, GameEvent } from "./types";
import { CARD_DEFS } from "./definitions";

// カードの client-safe メタデータ (§9 A6)。CardDefinition の subset。
// **除外フィールド** (= meta に含めない): description / detailDescription / useConditionDescription /
//   addedAt (表示文字列・履歴。catalog UI は引き続き CardDefinition から取得) / effectId / targeting /
//   checkUsage (targeting・checkUsage は CardSpec の top-level フィールドとして card-spec-server が保持)。
export interface CardMeta {
  id: CardId;
  kind: CardKind;
  name: string;
  icon: string;
  cost: number;
  rarity: CardRarity;
  phase?: CardPhase;
  status: CardStatus;
  relatedIssues?: number[];
}

// カードの「使用/設置」イベント種別 (= undo-policy.isCardOpEvent を registry から導出する元、§9 A6)。
// 通常/マルチ ply カード → "cardPlayEvent"、トラップ設置 → "trapSetEvent"。
// トラップ発動 ("trapTriggerEvent") は別ライフサイクル (相手手番で発火) のため card 自身の
// eventKind には含めない (S2c の isCardOpEvent 導出時に trapTriggerEvent を別途合算する)。
export type CardEventKind = Extract<GameEvent["kind"], "cardPlayEvent" | "trapSetEvent">;

// CardDefinition → CardMeta 射影 (§3 S2a「meta は CARD_DEFS から」)。
// 除外フィールドを落とし client-safe subset に縮約する。
function toCardMeta(def: CardDefinition): CardMeta {
  return {
    id: def.id,
    kind: def.kind,
    name: def.name,
    icon: def.icon,
    cost: def.cost,
    rarity: def.rarity,
    phase: def.phase,
    status: def.status,
    relatedIssues: def.relatedIssues,
  };
}

// 全カードの client-safe meta レコード。CARD_DEFS と同一の挿入順を保持する
// (Object.keys/values の列挙順 = mana_up, pawn_return, double_pawn, piece_return,
//  check_break, double_move, no_promote)。
export const CARD_META: Record<CardId, CardMeta> = Object.fromEntries(
  (Object.keys(CARD_DEFS) as CardId[]).map((id) => [id, toCardMeta(CARD_DEFS[id])]),
) as Record<CardId, CardMeta>;

// ===== registry SSOT helper (§8 / §9 B4) =====
// seed orphan-guard / deck.ts VALID_CARD_IDS / user-bootstrap・merge の playable 抽出などが
// 現状 ALL_CARD_DEFS を直読している。S2c/S2d でこれら helper 経由へ移行する (本段では additive に提供のみ)。

// registry に登録された全 CardId (= seed orphan-guard の validCardIds 相当)。
export function getValidCardIds(): CardId[] {
  return Object.keys(CARD_META) as CardId[];
}

// 公開中 (status === "active") のカード meta。
export function getActiveCards(): CardMeta[] {
  return Object.values(CARD_META).filter((m) => m.status === "active");
}

// プレイアブル (status !== "deprecated") のカード meta。
// = deck.ts / user-bootstrap / merge の `ALL_CARD_DEFS.filter(d => d.status !== "deprecated")` 相当。
export function getPlayableCards(): CardMeta[] {
  return Object.values(CARD_META).filter((m) => m.status !== "deprecated");
}
