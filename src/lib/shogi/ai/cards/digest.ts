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
  DEAD_MANA_THRESHOLD,
  DEAD_MANA_PENALTY_COEF,
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
  // PR3-1: 死にマナペナルティ用の絶対マナ (sente/gote それぞれの生マナ値)。
  // manaDelta だけでは「両者上限到達」を識別できないため、絶対値を別途保持。
  // 計画 md docs/plans/issue-193-pr3-1-card-calibration.md 4.2.2 章。
  manaAbsolute: { sente: number; gote: number };
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
    // PR3-1: 死にマナペナルティ用に絶対値を併せて保持 (O(1) 追加のみ)。
    manaAbsolute: { sente: cardState.mana.sente, gote: cardState.mana.gote },
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
  // PR3-1: 死にマナペナルティ (sente 絶対視点)。マナが MANA_CAP=20 に近いほど
  // 「マナ上限到達後の manaCharge が無効化」する機会損失を負価値として表現。
  // 退化原因 ④ (マナ上限で manaDelta 価値消失) への係数追加。
  //
  // PR3-3 C-9 (レビュー F-4) 補足: PR3-1 単体では cardDigest が root スカラーで
  // 全候補に同値加算 → argmax で打ち消されアクション選択に効かなかった (= inert)。
  // **PR3-3 C-6 で evaluateActionWithLookahead に updateCardDigest を per-action
  // wiring したことで初めてアクション選択に効くようになった**。
  // すなわち「AI にマナ消費を促す」効果は C-6 wiring 後に発現するもので、
  // 本項目 (digest 評価) 単独では不十分。
  value += evaluateDeadManaPenalty(digest);
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

// PR3-1: 死にマナペナルティ (sente 絶対視点)。
//   sente が DEAD_MANA_THRESHOLD を超えた分 = sente にとって - (機会損失大)
//   gote が DEAD_MANA_THRESHOLD を超えた分 = sente にとって + (相手の機会損失)
//   差分 (goteOverflow - senteOverflow) × DEAD_MANA_PENALTY_COEF で対称に算出。
function evaluateDeadManaPenalty(digest: CardDigest): number {
  const senteOverflow = Math.max(0, digest.manaAbsolute.sente - DEAD_MANA_THRESHOLD);
  const goteOverflow = Math.max(0, digest.manaAbsolute.gote - DEAD_MANA_THRESHOLD);
  return (goteOverflow - senteOverflow) * DEAD_MANA_PENALTY_COEF;
}

/**
 * PR3-2: cardDigest の増分更新 API。
 *
 * 既存 digest (= prevCardState から computeCardDigest で生成済) を基に、新 cardState への
 * 遷移で**変化があったフィールドのみ再計算**して新 digest を返す。変化がないフィールドは
 * prev の値をそのまま流用 (オブジェクトも参照流用、=== 比較成立)。
 *
 * 目的 (PR3-3 の前提整備):
 * - PR3-3 で深さ N の子ノードがカード/ドロー候補を取るとき、毎ノードで
 *   computeCardDigest (= 2× Math.exp() 呼び出しを含む全再計算) を回すのを避ける。
 * - 比較は length / 数値 === / null チェックのみで O(1)、変化がないフィールドは
 *   exp() 呼び出しもスキップ。
 *
 * 振る舞いキープ (本 PR スコープ):
 * - 本関数は新規追加のみで production コードからは未呼び出し。PR3-3 で wiring。
 * - 等価性: updateCardDigest(computeCardDigest(prev), prev, new) は computeCardDigest(new) と
 *   完全に同じ値を返す (本ファイル隣接の `card-digest.test.ts` 等価性 fixture で保証)。
 *
 * 注意 (W-2 sente 絶対視点維持):
 * - 全フィールドの符号方針は computeCardDigest と同一 (sente が有利なら正)。
 * - prev に含まれる manaCap は静的値 (現状 MANA_CAP=20 固定) のため常に流用。
 *   **将来動的化時の拡張手順 (PR3-3 C-9 / レビュー F-7)**:
 *     1. `prevCardState.manaCap !== newCardState.manaCap` チェックを追加
 *     2. 変化時は `manaCap: newCardState.manaCap` を返却 (非変化時は prev 流用)
 *     3. 動的 manaCap が evaluateCardDigest 計算に組み込まれる場合は併せて該当項も追加
 */
export function updateCardDigest(
  prev: CardDigest,
  prevCardState: CardGameState,
  newCardState: CardGameState,
): CardDigest {
  const manaChanged =
    prevCardState.mana.sente !== newCardState.mana.sente ||
    prevCardState.mana.gote !== newCardState.mana.gote;
  const handChanged =
    prevCardState.hand.sente.length !== newCardState.hand.sente.length ||
    prevCardState.hand.gote.length !== newCardState.hand.gote.length;
  const drawChanged =
    prevCardState.drawProgress.sente !== newCardState.drawProgress.sente ||
    prevCardState.drawProgress.gote !== newCardState.drawProgress.gote;
  // PR3-3 C-9 (レビュー F-10) 補足: trap 比較は `defId` のみで `instanceId` は無視。
  // digest.trapPresence は CardId | null 型で `evaluateTrapPresence` も defId のみに
  // 依存するため (同 defId のトラップは同等価値)、instanceId 差分は digest 変化を
  // 引き起こさない。hand 比較 (length のみ) と整合する設計判断。
  const senteTrapDefId = newCardState.trap.sente?.defId ?? null;
  const goteTrapDefId = newCardState.trap.gote?.defId ?? null;
  const trapChanged =
    senteTrapDefId !== prev.trapPresence.sente ||
    goteTrapDefId !== prev.trapPresence.gote;
  const marksChanged =
    prevCardState.noPromoteMarks.sente.length !==
      newCardState.noPromoteMarks.sente.length ||
    prevCardState.noPromoteMarks.gote.length !==
      newCardState.noPromoteMarks.gote.length;

  return {
    manaDelta: manaChanged
      ? newCardState.mana.sente - newCardState.mana.gote
      : prev.manaDelta,
    // manaCap は現状 MANA_CAP 固定 (将来動的化想定で枠は維持、本関数も常に prev 流用)。
    manaCap: prev.manaCap,
    manaAbsolute: manaChanged
      ? { sente: newCardState.mana.sente, gote: newCardState.mana.gote }
      : prev.manaAbsolute,
    handValueDelta: handChanged
      ? computeHandValue(newCardState.hand.sente.length) -
        computeHandValue(newCardState.hand.gote.length)
      : prev.handValueDelta,
    drawProgressDelta: drawChanged
      ? newCardState.drawProgress.sente - newCardState.drawProgress.gote
      : prev.drawProgressDelta,
    trapPresence: trapChanged
      ? { sente: senteTrapDefId, gote: goteTrapDefId }
      : prev.trapPresence,
    noPromoteMarkCountDelta: marksChanged
      ? newCardState.noPromoteMarks.sente.length -
        newCardState.noPromoteMarks.gote.length
      : prev.noPromoteMarkCountDelta,
  };
}
