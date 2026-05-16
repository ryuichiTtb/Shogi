// Issue #193 / PR1d-1: cardDigest 評価ダイジェスト構造 + 計算/評価関数。
//
// 設計の核 (親計画 md L350-356 / PR1d 計画 md L178-189):
// - 探索開始時に root で 1 回だけ computeCardDigest(cardState) を呼ぶ
// - evaluate の戻り値に evaluateCardDigest(cardDigest, variant) を加算 (1 op、ホットパス影響無視可)
// - cardDigest を引数として子ノードに伝播 (= ホットパスでの再計算を構造的に禁止、W-1 反映)
// - sente 絶対視点で固定 (W-2 反映、evaluate 既存実装 sign = piece.owner === "sente" ? 1 : -1 と符号整合)
//
// 段階拡張ロードマップ (PR1d 計画 md L191-196、実装での確定を反映):
// - PR1d-1: manaDelta / manaCap / handValueDelta / drawProgressDelta
// - PR1d-3: doubleMoveActive は **スキップ** (判断2=案B)。CardGameState に doubleMove
//   フィールドが無く production root では常に null のため root スカラー化が無意味。
//   二手指し価値は search.ts の super-action 局所探索が直接捕捉する。
// - PR1d-4 (本コミット): trapPresence (TrapInstance.defId 抽出) +
//   noPromoteMarkCountDelta (ギャップ1=案A: 玉位置非依存の sente-gote マーク数差。
//   計画 md L1310 の positions 配列は evaluateCardDigest が GameState/玉位置を
//   持たず proximity 不可のため単純カウント差に簡略化、ZZ 反映)。

import type { CardGameState, CardId } from "../../cards/types";
import type { RuleVariant } from "../../types";
import { MANA_CAP } from "../../cards/definitions";
import {
  MANA_DELTA_COEFFICIENT,
  HAND_VALUE_BASE,
  HAND_VALUE_DECAY,
  DRAW_PROGRESS_COEFFICIENT,
  TRAP_VALUE_NO_PROMOTE,
  TRAP_VALUE_CHECK_BREAK,
  NO_PROMOTE_MARK_COEFFICIENT,
} from "./heuristics";

export interface CardDigest {
  // mana.sente - mana.gote (W-2 反映: sente 絶対視点で、sente 有利なら正)
  manaDelta: number;
  // 将来動的化想定 (現状静的だが枠は確保、definitions.ts:228 MANA_CAP = 20)
  manaCap: number;
  // handValue(sente hand) - handValue(gote hand) (W-2: sente 絶対視点、単調減衰関数で算出)
  handValueDelta: number;
  // drawProgress.sente - drawProgress.gote (W-2: sente 絶対視点)
  drawProgressDelta: number;
  // PR1d-4: 盤上トラップ存在。各プレイヤーの TrapInstance.defId (なければ null)。
  // W-2 整合: sente/gote 両者を絶対視点で保持し、evaluateCardDigest で
  // 「sente 盤上トラップ = +、gote 盤上トラップ = -」に変換。
  trapPresence: { sente: CardId | null; gote: CardId | null };
  // PR1d-4 (ギャップ1=案A): no_promote マーク数差 = sente 数 - gote 数。
  // W-2 sente 絶対視点。計画 md L1310 の positions 配列 + proximity 評価は
  // evaluateCardDigest が GameState/玉位置非依存 (W-1 root スカラー方式) のため
  // 実装不可 → 玉位置非依存の単純カウント差に簡略化 (ZZ 反映)。
  noPromoteMarkCountDelta: number;
}

/**
 * 探索開始時に root で 1 回だけ呼ぶ (W-1 反映: 子ノードでは引数として伝播、再計算しない)。
 *
 * W-2 反映: sente 絶対視点で固定 (player 引数なし)。evaluate 既存実装と符号整合し、
 * 観戦モードでも両プレイヤーで同じ digest を共有可能。
 */
export function computeCardDigest(cardState: CardGameState): CardDigest {
  const manaDelta = cardState.mana.sente - cardState.mana.gote;
  const handValueDelta =
    computeHandValue(cardState.hand.sente.length) -
    computeHandValue(cardState.hand.gote.length);
  const drawProgressDelta =
    cardState.drawProgress.sente - cardState.drawProgress.gote;
  // PR1d-4: cardState.trap は Record<Player, TrapInstance | null>。
  // TrapInstance.defId を抽出 (盤上トラップなしは null)。
  const trapPresence = {
    sente: cardState.trap.sente?.defId ?? null,
    gote: cardState.trap.gote?.defId ?? null,
  };
  // PR1d-4 (ギャップ1=案A): cardState.noPromoteMarks は Record<Player, PieceMark[]>。
  // 玉位置非依存の単純カウント差 (sente 数 - gote 数、W-2 sente 絶対視点)。
  const noPromoteMarkCountDelta =
    cardState.noPromoteMarks.sente.length - cardState.noPromoteMarks.gote.length;
  return {
    manaDelta,
    manaCap: MANA_CAP,
    handValueDelta,
    drawProgressDelta,
    trapPresence,
    noPromoteMarkCountDelta,
  };
}

// 単調減衰関数 (F-5 仮基準): handSize が増えるほど追加 1 枚の価値が下がる。
// HAND_VALUE_BASE = 20、HAND_VALUE_DECAY = 3.0 (3 枚で 95% 価値)。bench で調整。
function computeHandValue(handSize: number): number {
  return HAND_VALUE_BASE * (1 - Math.exp(-handSize / HAND_VALUE_DECAY));
}

/**
 * cardDigest を cp 単位の評価値に変換。evaluate に引数として渡された cardDigest を加算するときに使う。
 *
 * sente 絶対視点 (sente 有利で正)、PIECE_VALUES と整合する単位 cp で表現。
 * W-3 反映: variant.id !== "card-shogi" のときは 0 を返し、standard variant への影響を排除。
 */
export function evaluateCardDigest(
  digest: CardDigest,
  variant: RuleVariant,
): number {
  if (variant.id !== "card-shogi") return 0;
  let value =
    digest.manaDelta * MANA_DELTA_COEFFICIENT +
    digest.handValueDelta +
    digest.drawProgressDelta * DRAW_PROGRESS_COEFFICIENT;
  // PR1d-4: 盤上トラップ価値 (sente 絶対視点: sente 盤上トラップ = +、gote = -)
  value += evaluateTrapPresence(digest.trapPresence);
  // PR1d-4 (ギャップ1=案A): no_promote マーク数差 × 係数 (玉位置非依存)。
  // sente 絶対視点: sente の no_promote マークが多いほど + (敵の成りを抑止して有利)。
  value += digest.noPromoteMarkCountDelta * NO_PROMOTE_MARK_COEFFICIENT;
  return value;
}

// 盤上トラップの sente 絶対視点価値。sente の盤上トラップは正、gote は負。
// check_break は王手回避用途で no_promote より戦略価値が高い (定数で表現)。
function evaluateTrapPresence(
  trapPresence: CardDigest["trapPresence"],
): number {
  let v = 0;
  if (trapPresence.sente === "no_promote") v += TRAP_VALUE_NO_PROMOTE;
  else if (trapPresence.sente === "check_break") v += TRAP_VALUE_CHECK_BREAK;
  if (trapPresence.gote === "no_promote") v -= TRAP_VALUE_NO_PROMOTE;
  else if (trapPresence.gote === "check_break") v -= TRAP_VALUE_CHECK_BREAK;
  return v;
}
