// Issue #193 / PR1d-1: cardDigest 評価ダイジェスト構造 + 計算/評価関数。
//
// 設計の核 (親計画 md L350-356 / PR1d 計画 md L178-189):
// - 探索開始時に root で 1 回だけ computeCardDigest(cardState, gameState) を呼ぶ
// - evaluate の戻り値に evaluateCardDigest(cardDigest, variant) を加算 (1 op、ホットパス影響無視可)
// - cardDigest を引数として子ノードに伝播 (= ホットパスでの再計算を構造的に禁止、W-1 反映)
// - sente 絶対視点で固定 (W-2 反映、evaluate 既存実装 sign = piece.owner === "sente" ? 1 : -1 と符号整合)
//
// 段階拡張ロードマップ (PR1d 計画 md L191-196、実装での確定を反映):
// - PR1d-1: manaDelta / manaCap / handValueDelta / drawProgressDelta
// - PR1d-3: doubleMoveActive は **スキップ** (判断2=案B)。CardGameState に doubleMove
//   フィールドが無く production root では常に null のため root スカラー化が無意味。
//   二手指し価値は search.ts の super-action 局所探索が直接捕捉する。
// - PR1d-4: noPromoteMarkCountDelta (ギャップ1=案A: 玉位置非依存の sente-gote マーク数差)。
// - Issue #235 S3b: トラップ価値を trapPresence (defId) + 固定 TRAP_VALUE_* から、gameState を
//   供給して局面依存 valueModel で precompute する `trapValueDelta` (cp) へ cutover。digest は
//   GameState を持たないため evaluate 時の再計算は不可 = root スカラー方式 (W-1) を維持しつつ局面依存化。

import type { CardGameState } from "../../cards/types";
import type { GameState, RuleVariant } from "../../types";
import { getCardValue } from "../../cards/card-spec-server";
import {
  MANA_DELTA_COEFFICIENT,
  HAND_VALUE_BASE,
  HAND_VALUE_DECAY,
  DRAW_PROGRESS_COEFFICIENT,
  NO_PROMOTE_MARK_COEFFICIENT,
  DEAD_MANA_RATIO,
  DEAD_MANA_PENALTY_COEF,
} from "./heuristics";

export interface CardDigest {
  // mana.sente - mana.gote (W-2 反映: sente 絶対視点で、sente 有利なら正)
  manaDelta: number;
  // 将来動的化想定 (現状静的だが枠は確保、card-system-config.ts MANA_CAP = 20)
  manaCap: number;
  // handValue(sente hand) - handValue(gote hand) (W-2: sente 絶対視点、単調減衰関数で算出)
  handValueDelta: number;
  // drawProgress.sente - drawProgress.gote (W-2: sente 絶対視点)
  drawProgressDelta: number;
  // Issue #235 S3b: 盤上トラップの局面依存価値 (sente 絶対視点、cp)。
  // sente 盤上トラップ = +valueModel(sente)、gote = -valueModel(gote)。valueModel は
  // 局面依存 (check_break=自玉露出度 / no_promote=相手成り脅威度、card-spec-server S3a) の
  // gross 値。**S3a 以前は trapPresence (defId) + 固定 TRAP_VALUE_* だったが、digest 計算へ
  // gameState を供給して局面依存値を precompute する方式へ cutover** (digest は GameState を
  // 持たないため evaluate 時の再計算は不可 = W-1 root スカラー方式を維持しつつ局面依存化)。
  trapValueDelta: number;
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
export function computeCardDigest(
  cardState: CardGameState,
  gameState?: GameState,
): CardDigest {
  const manaDelta = cardState.mana.sente - cardState.mana.gote;
  const handValueDelta =
    computeHandValue(cardState.hand.sente.length) -
    computeHandValue(cardState.hand.gote.length);
  const drawProgressDelta =
    cardState.drawProgress.sente - cardState.drawProgress.gote;
  // PR1d-4 (ギャップ1=案A): cardState.noPromoteMarks は Record<Player, PieceMark[]>。
  // 玉位置非依存の単純カウント差 (sente 数 - gote 数、W-2 sente 絶対視点)。
  const noPromoteMarkCountDelta =
    cardState.noPromoteMarks.sente.length - cardState.noPromoteMarks.gote.length;
  return {
    manaDelta,
    // Issue #235 S4d-1 (epic §6 7.5③): 旧 MANA_CAP 定数焼き込み → cardState.manaCap 読みに是正
    // (動的マナ上限構想の前提。現行 cap=20 で値不変)。
    manaCap: cardState.manaCap,
    handValueDelta,
    drawProgressDelta,
    // S3b: 盤上トラップの局面依存価値を gameState から precompute (W-1 root スカラー)。
    trapValueDelta: computeTrapValueDelta(cardState, gameState),
    noPromoteMarkCountDelta,
    // PR3-1: 死にマナペナルティ用に絶対値を併せて保持 (O(1) 追加のみ)。
    manaAbsolute: { sente: cardState.mana.sente, gote: cardState.mana.gote },
  };
}

// Issue #235 S3b: 盤上トラップの sente 絶対視点価値 (cp)。
// sente トラップ = +valueModel(sente)、gote トラップ = -valueModel(gote)。valueModel は局面依存
// (card-spec-server、S3a) で gross 値を返す。**gameState 省略時はトラップ価値 0** (= 局面情報なしで
// 局面依存値を算出不可。トラップ非保有局面の digest や trap 非対象テストで使用)。production の探索/engine は
// 常に gameState を渡す。コスト (マナ消費) は AI 側 mana 会計が別途反映するため本値はコストを引かない。
function computeTrapValueDelta(
  cardState: CardGameState,
  gameState?: GameState,
): number {
  if (!gameState) return 0;
  let v = 0;
  const senteDefId = cardState.trap.sente?.defId;
  if (senteDefId) v += getCardValue(senteDefId, gameState, "sente");
  const goteDefId = cardState.trap.gote?.defId;
  if (goteDefId) v -= getCardValue(goteDefId, gameState, "gote");
  return v;
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
  // S3b: 盤上トラップの局面依存価値 (sente 絶対視点)。computeCardDigest/updateCardDigest が
  // gameState から valueModel で precompute 済 (W-1 root スカラー方式維持)。
  value += digest.trapValueDelta;
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

// PR3-1: 死にマナペナルティ (sente 絶対視点)。
//   sente が threshold を超えた分 = sente にとって - (機会損失大)
//   gote が threshold を超えた分 = sente にとって + (相手の機会損失)
//   差分 (goteOverflow - senteOverflow) × DEAD_MANA_PENALTY_COEF で対称に算出。
// Issue #235 S4d-1 (epic §6 7.5④): 閾値を定数 16 → `manaCap × DEAD_MANA_RATIO` の動的算出に是正。
// per-node の digest.manaCap を使うため、manaCap 動的化時も cap に追従して誤発火しない
// (現行 cap=20 では 16 で挙動不変)。
function evaluateDeadManaPenalty(digest: CardDigest): number {
  const threshold = digest.manaCap * DEAD_MANA_RATIO;
  const senteOverflow = Math.max(0, digest.manaAbsolute.sente - threshold);
  const goteOverflow = Math.max(0, digest.manaAbsolute.gote - threshold);
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
 * 振る舞いキープ:
 * - 等価性: updateCardDigest(computeCardDigest(prev, gs), prev, new, gs) は computeCardDigest(new, gs)
 *   と完全に同じ値を返す (同一 gameState 供給時。本ファイル隣接の `card-digest.test.ts` 等価性 fixture で保証)。
 *
 * 注意 (W-2 sente 絶対視点維持):
 * - 全フィールドの符号方針は computeCardDigest と同一 (sente が有利なら正)。
 * - Issue #235 S4d-1: manaCap は `newCardState.manaCap` を常に読む (O(1))。現行 cap=20 では
 *   prev 流用と等価だが、動的 manaCap 構想時も自動追従する (旧「常に prev 流用 + 将来手順」を是正)。
 *   死にマナ閾値も evaluateDeadManaPenalty が digest.manaCap × DEAD_MANA_RATIO で動的算出する。
 */
export function updateCardDigest(
  prev: CardDigest,
  prevCardState: CardGameState,
  newCardState: CardGameState,
  gameState?: GameState,
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
  // S3b: trap 比較は `defId` のみで `instanceId` は無視 (同 defId のトラップは同 valueModel)。
  // trap 変化時のみ valueModel で trapValueDelta を再算出する (gameState 供給時)。trap 不変なら
  // prev.trapValueDelta を流用 = root スカラー方式維持 (盤面が動いてもトラップ価値は再計算しない、
  // R-2: 局面依存値は root 1 回評価。深い再計算は S4)。
  const prevSenteTrapDefId = prevCardState.trap.sente?.defId ?? null;
  const prevGoteTrapDefId = prevCardState.trap.gote?.defId ?? null;
  const senteTrapDefId = newCardState.trap.sente?.defId ?? null;
  const goteTrapDefId = newCardState.trap.gote?.defId ?? null;
  const trapChanged =
    senteTrapDefId !== prevSenteTrapDefId || goteTrapDefId !== prevGoteTrapDefId;
  const marksChanged =
    prevCardState.noPromoteMarks.sente.length !==
      newCardState.noPromoteMarks.sente.length ||
    prevCardState.noPromoteMarks.gote.length !==
      newCardState.noPromoteMarks.gote.length;

  return {
    manaDelta: manaChanged
      ? newCardState.mana.sente - newCardState.mana.gote
      : prev.manaDelta,
    // Issue #235 S4d-1: cardState.manaCap を常に読む (O(1)、現行 cap=20 で prev 流用と等価)。
    // 動的 manaCap 構想時もこの読みで自動追従する (旧「常に prev 流用」を是正)。
    manaCap: newCardState.manaCap,
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
    trapValueDelta: trapChanged
      ? computeTrapValueDelta(newCardState, gameState)
      : prev.trapValueDelta,
    noPromoteMarkCountDelta: marksChanged
      ? newCardState.noPromoteMarks.sente.length -
        newCardState.noPromoteMarks.gote.length
      : prev.noPromoteMarkCountDelta,
  };
}
