// Issue #235 S2a: L1 カードフレームワーク (CardSpec registry) の **サーバ専用 / 関数** 層。
//
// 目的 (S2 計画 docs/plans/issue-235-s2-cardspec.md §2/§5): card-spec.ts (meta-only) に対し、
//   関数 (effect.apply / useCondition / valueModel / onTrigger) を持つ `CardSpec` 本体 + registry
//   `CARD_SPECS` を定義する。effects.ts / world-kernel(WorldState 型) / heuristics 相当の
//   値付けを内包するため Client へ出してはならない (§5 R-2。S2d で ESLint により
//   `src/components/**`・`src/hooks/**` からの import を禁止する)。
//
// S2a の大前提 (§1): **production 未配線 (additive)**。挙動完全不変。
//   - effect.apply は既存 applyXxx を包む薄い wrapper (再実装しない → 構造的に等価)。
//   - 効果適用の dispatch (consumeNormalCard / mana 減算 / event 構築 / removeNoPromoteMark 等の
//     sideEffect) は kernel `applyCardEffectLogic` 側の汎用処理であり、本 registry は **盤面変更のみ**
//     を表現する (§2 / §9 B3)。registry を実際に dispatch へ繋ぐのは S2b。
//
// 設計判断 (M1 確定、§9):
//   - **multiPly は EffectSpec 共用体外** (CardSpec.multiPly?: number)。double_move は applyCardEffectLogic
//     対象外でフラグセットのみ、遅延消費は finalizeDoubleMoveLogic という S1d 既存 orchestration が担う。
//     registry は plies 数のメタのみ保持し effect は持たない (A1/A2)。
//   - **trap = Route B** (R-1): `setTrap` は **set のみ** registry 化。trigger (no_promote 成り抑止 /
//     check_break 王手崩し) は move-effects.ts インライン温存。`onTrigger` は型枠のみ (@deferred、実配線 S3)。
//   - **valueModel は枠のみ** (R-4): S3 値付けの interface 固定先。中身は静的 per-card 値を返す薄い stub。

import type { GameState, Player, Position } from "@/lib/shogi/types";
import type { CardCheckUsage, CardGameState, CardId, CardTarget, CardTargeting, TrapTrigger } from "./types";
import type { CardEventKind, CardMeta } from "./card-spec";
import { CARD_META } from "./card-spec";
import { CARD_DEFS, CARD_USE_CONDITIONS } from "./definitions";
import { applyDoublePawn, applyPawnReturn, applyPieceReturn } from "./effects";

// L1 が参照するカード文脈の最小ビュー (gameState + cardState)。
// useCondition / onTrigger は二手指し継続状態 (doubleMove) を要さないため、kernel の WorldState 全体
// ではなく本最小型に縮約する。これにより cards/ → kernel/ の型依存を断つ (M2 D1-1: S2b で world-kernel が
// CARD_SPECS を value import するため、card-spec-server が WorldState を type import すると型レベル循環が
// 生じる)。world-kernel.WorldState ({gameState, cardState, doubleMove}) と ai の AiTurnState はいずれも
// 本型へ構造的に代入可能 (caller 側は従来どおり渡せる)。
export interface CardWorldView {
  gameState: GameState;
  cardState: CardGameState;
}

// ===== EffectSpec 判別共用体 (M1 §2) =====
// CONFIRM 時の効果適用を type 別テンプレで宣言する。新カードは type 選択 + パラメータ埋め (ビジョン⑥)。
export type EffectSpec =
  // modifyBoard: 盤面のみ変更し GameState | null を返す (pawn_return / piece_return / double_pawn)。
  //   持ち駒消費 (consumeNormalCard)・event 構築・removeNoPromoteMark 等の sideEffect は
  //   dispatcher (S2b の applyCardEffectLogic) が汎用処理する (§9 B3)。apply は applyXxx を包む薄い wrapper。
  | {
      type: "modifyBoard";
      apply: (gameState: GameState, player: Player, target: CardTarget) => GameState | null;
    }
  // setTrap: set のみ registry 化 (Route B、R-1)。trigger は「いつ発火するか」のメタ。
  //   onTrigger は **未配線 stub** (型枠のみ、@deferred、実配線 S3)。実 trigger は move-effects.ts インライン。
  | {
      type: "setTrap";
      trigger: TrapTrigger;
      onTrigger?: (world: CardWorldView) => CardWorldView;
    }
  // modifyResource: mana/draw のリソース変更を宣言的に (mana_up)。
  | { type: "modifyResource"; mana?: number; draw?: number };

// 使用条件 (マナ以外の独自条件)。CARD_USE_CONDITIONS を (world, player) シグネチャに統一して内包する
// (§8 / §B2。現行 CardUseCondition の 3 引数目 cardState は未使用)。
export type UseCondition = (world: CardWorldView, player: Player) => boolean;

// カード価値モデル (cp)。S2 は静的 stub、S3 で局面・コスト依存値付け (R-4)。シグネチャを固定する。
export type ValueModel = (gameState: GameState, player: Player) => number;

// 単一カード仕様 (epic §4 / M1 §2)。registry の値オブジェクト。
export interface CardSpec {
  meta: CardMeta; // client-safe (card-spec.ts)
  targeting: CardTargeting;
  // CONFIRM 時の効果。double_move は multiPly のみで本フィールドを持たない (effect 共用体外、A1/A2)。
  effect?: EffectSpec;
  // double_move 専用: 1 ターンに消費する ply 数 (= 2)。遅延消費/flip 抑止は既存 orchestration が担う。
  multiPly?: number;
  useCondition?: UseCondition;
  checkUsage: CardCheckUsage;
  valueModel: ValueModel;
  eventKind: CardEventKind;
}

// ===== valueModel ブリッジ (S2 stub、R-4) =====
// **本ブリッジが card 価値の将来 SSOT (L1)**。現状 ai/cards/heuristics の TRAP_VALUE_NO_PROMOTE=50 /
// TRAP_VALUE_CHECK_BREAK=80 / (MANA_DELTA_COEFFICIENT=10 × +3 mana = 30) と同値だが、`cards/ → ai/` の
// 上向き依存を新規導入しないため import せず併記する。S3 で valueModel を card 価値の単一源とし、ai 側を
// 本 valueModel 参照へ切替えて依存を正方向 (ai → L1) に統一する。それまで両者は同値を保つ
// (valueModel は S2 では未配線 = inert のため、仮に drift しても探索挙動には影響しない)。
// 盤面系 (pawn_return/piece_return/double_pawn) と double_move は現行で静的 per-card 値を持たず
// (局面評価 digest / super-action 探索が間接捕捉)、S3 で局面依存値付けするまで 0。
const CARD_VALUE_BRIDGE: Record<CardId, number> = {
  no_promote: 50,
  check_break: 80,
  mana_up: 30,
  pawn_return: 0,
  piece_return: 0,
  double_pawn: 0,
  double_move: 0,
};

// 静的値を返す valueModel stub (gameState/player は S3 まで未使用)。
function staticValueModel(value: number): ValueModel {
  return (gameState, player) => {
    void gameState;
    void player;
    return value;
  };
}

// modifyBoard effect: applyXxx (Position 受け) を CardTarget (square) 受けに包む薄い wrapper。
function boardEffect(
  apply: (state: GameState, player: Player, target: Position) => GameState | null,
): EffectSpec {
  return {
    type: "modifyBoard",
    apply: (gameState, player, target) =>
      target.kind === "square"
        ? apply(gameState, player, { row: target.row, col: target.col })
        : null,
  };
}

// CARD_USE_CONDITIONS を (world, player) シグネチャに統一して内包 (§8)。
// 現行条件は gameState のみ参照 (cardState 未使用) のため、world.gameState への委譲で等価。
// 条件が未登録のカードは undefined (= 常に使用可)。
// 命名: `use` 始まりにすると react-hooks/rules-of-hooks が Hook と誤検知するため `resolve...` とする。
function resolveUseCondition(id: CardId): UseCondition | undefined {
  const fn = CARD_USE_CONDITIONS[id];
  return fn ? (world, player) => fn(world.gameState, player, world.cardState) : undefined;
}

// eventKind 派生規則 (§9 A6): trap → "trapSetEvent"、それ以外 (normal/multiPly) → "cardPlayEvent"。
// 単一規則として encode し、各カードで個別ハードコードしない。
function deriveEventKind(meta: CardMeta): CardEventKind {
  return meta.kind === "trap" ? "trapSetEvent" : "cardPlayEvent";
}

// CardSpec 組み立て共通処理。targeting / checkUsage / eventKind / useCondition は CARD_DEFS・CARD_META
// から派生し (S2a additive = definitions.ts を SSOT 維持)、effect / valueModel / multiPly のみ registry が付与する。
function buildSpec(
  id: CardId,
  effect: EffectSpec | undefined,
  valueModel: ValueModel,
  opts: { multiPly?: number } = {},
): CardSpec {
  const def = CARD_DEFS[id];
  const meta = CARD_META[id];
  return {
    meta,
    targeting: def.targeting,
    effect,
    multiPly: opts.multiPly,
    useCondition: resolveUseCondition(id),
    checkUsage: def.checkUsage,
    valueModel,
    eventKind: deriveEventKind(meta),
  };
}

// ===== 7 カード registry (SSOT) =====
// 挿入順は CARD_DEFS / CARD_META と一致させる。
export const CARD_SPECS: Record<CardId, CardSpec> = {
  // 廃止 (status: "deprecated")。即時マナ +3 (上限 manaCap でクランプ)。
  mana_up: buildSpec(
    "mana_up",
    { type: "modifyResource", mana: 3 },
    staticValueModel(CARD_VALUE_BRIDGE.mana_up),
  ),
  // 自盤上の歩 / と金 1 枚を持ち駒へ (unpromote)。
  pawn_return: buildSpec(
    "pawn_return",
    boardEffect(applyPawnReturn),
    staticValueModel(CARD_VALUE_BRIDGE.pawn_return),
  ),
  // 持ち駒の歩 1 枚を自分の歩がいる列の空マスへ (二歩禁則の一時解除)。
  double_pawn: buildSpec(
    "double_pawn",
    boardEffect(applyDoublePawn),
    staticValueModel(CARD_VALUE_BRIDGE.double_pawn),
  ),
  // 自盤上の駒 (玉以外) 1 枚を持ち駒へ (unpromote)。歩戻しの上位互換。
  piece_return: buildSpec(
    "piece_return",
    boardEffect(applyPieceReturn),
    staticValueModel(CARD_VALUE_BRIDGE.piece_return),
  ),
  // トラップ: 相手の王手宣言時に王手駒を全て持ち駒化 (発火は move-effects インライン = Route B)。
  check_break: buildSpec(
    "check_break",
    { type: "setTrap", trigger: "check_declared" },
    staticValueModel(CARD_VALUE_BRIDGE.check_break),
  ),
  // 二手指し: 1 ターンに続けて 2 手指す。effect なし・multiPly: 2 のみ (A1/A2)。
  double_move: buildSpec(
    "double_move",
    undefined,
    staticValueModel(CARD_VALUE_BRIDGE.double_move),
    { multiPly: 2 },
  ),
  // トラップ: 相手の成り宣言を無効化し「成り不可」を永続付与 (発火は move-effects インライン = Route B)。
  no_promote: buildSpec(
    "no_promote",
    { type: "setTrap", trigger: "promotion_declared" },
    staticValueModel(CARD_VALUE_BRIDGE.no_promote),
  ),
};

// 単一カード仕様を取得。
export function getCardSpec(id: CardId): CardSpec {
  return CARD_SPECS[id];
}

// 全カード仕様 (挿入順)。
export function getAllCardSpecs(): CardSpec[] {
  return Object.values(CARD_SPECS);
}
