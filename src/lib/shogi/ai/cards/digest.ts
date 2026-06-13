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

import type { CardGameState, CardId, PieceMark } from "../../cards/types";
import type { Player, RuleVariant } from "../../types";
import {
  MANA_DELTA_COEFFICIENT,
  HAND_VALUE_BASE,
  HAND_VALUE_DECAY,
  DRAW_PROGRESS_COEFFICIENT,
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
  // Issue #235 S4d-4 (epic §6 7.5 / M1 B-1 解消): 盤上トラップの defId を帯同し、価値は
  // **leaf で board 由来算出** (evaluate が getCardValue(defId, state, player) を呼ぶ)。旧
  // trapValueDelta スカラーは「trap defId 変化時のみ再計算 = 盤面が動いても prev 流用」で stale に
  // なり、同一 TT key (board+trap defId) に異 score が紐づく誤 hit の根因だった (S4c-2 で trap-skip
  // 回避)。defId 帯同 + leaf 算出にすれば「同 board + 同 trap defId → 同 score」が成立し誤 hit
  // ゼロ + trap 局面でも TT 有効化できる (getCardValue は gameState のみ依存の純粋関数)。
  trap: { sente: CardId | null; gote: CardId | null };
  // Issue #235 S4d-3 (epic §6 7.2(iv)1): no_promote マークを **leaf per-piece 評価**へ届けるため、
  // 両者のマーク slice 参照を帯同する (旧 noPromoteMarkCountDelta スカラー = 符号逆バグ + 玉位置非依存
  // カウント差を per-piece modifier へ移行)。両者マーク空のときは null で leaf を fast path 化
  // (現状ほぼ常時、割当ゼロ)。**参照は cardState.noPromoteMarks slice を流用** (毎ノード再構築しない。
  // updateCardDigest が marks slice 参照変化検知時のみ差し替え = M1 B-1 反映)。
  noPromoteMarks: Record<Player, PieceMark[]> | null;
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
  return {
    manaDelta,
    // Issue #235 S4d-1 (epic §6 7.5③): 旧 MANA_CAP 定数焼き込み → cardState.manaCap 読みに是正
    // (動的マナ上限構想の前提。現行 cap=20 で値不変)。
    manaCap: cardState.manaCap,
    handValueDelta,
    drawProgressDelta,
    // S4d-4: トラップ defId を帯同 (価値は leaf で board 由来算出。stale 排除 + TT 安全化)。
    trap: {
      sente: cardState.trap.sente?.defId ?? null,
      gote: cardState.trap.gote?.defId ?? null,
    },
    // S4d-3: マーク slice を leaf へ帯同 (両者空は null で fast path、符号逆カウント差を per-piece へ移行)。
    noPromoteMarks: foldNoPromoteMarks(cardState),
    // PR3-1: 死にマナペナルティ用に絶対値を併せて保持 (O(1) 追加のみ)。
    manaAbsolute: { sente: cardState.mana.sente, gote: cardState.mana.gote },
  };
}

// Issue #235 S4d-3: cardState.noPromoteMarks を digest 帯同形へ。両者マーク空は null
// (leaf fast path)、非空は cardState slice 参照を流用した {sente, gote} (毎ノード copy しない)。
function foldNoPromoteMarks(
  cardState: CardGameState,
): Record<Player, PieceMark[]> | null {
  const sente = cardState.noPromoteMarks.sente;
  const gote = cardState.noPromoteMarks.gote;
  if (sente.length === 0 && gote.length === 0) return null;
  return { sente, gote };
}

// Issue #235 S4d-4: 旧 computeTrapValueDelta (root スカラー precompute) は撤去。トラップ価値は
// digest に defId のみ帯同し、evaluate が leaf で getCardValue(defId, state, player) を board 由来
// 算出する (stale 排除 + TT 安全化)。digest は gameState 非依存になった (computeCardDigest /
// updateCardDigest から gameState 引数を削除)。

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
  // Issue #235 S4d-4: 盤上トラップの局面依存価値は **evaluate の leaf** で board 由来算出する
  // (digest.trap の defId → getCardValue(defId, state, player))。旧 trapValueDelta スカラー加算は
  // stale で TT 誤 hit の根因だったため撤去 (evaluateCardDigest は gameState を持たないので leaf 算出不可)。
  // Issue #235 S4d-3: 旧 `noPromoteMarkCountDelta × NO_PROMOTE_MARK_COEFFICIENT` を削除
  // (符号逆バグ = 自駒が封じられるほど +有利と誤評価。digest スカラーでは玉位置非依存カウント差しか
  // 表現できなかった)。no_promote の評価寄与は leaf の per-piece modifier (material 減価 +
  // 成り脅威割引、digest.noPromoteMarks 帯同) へ移行し、evaluate が board 由来で算出する。
  // PR3-1: 死にマナペナルティ (sente 絶対視点)。マナが上限に近いほど
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
 * - 等価性: updateCardDigest(computeCardDigest(prev), prev, new) は computeCardDigest(new)
 *   と完全に同じ値を返す (本ファイル隣接の `card-digest.test.ts` 等価性 fixture で保証)。
 *
 * 注意 (W-2 sente 絶対視点維持):
 * - 全フィールドの符号方針は computeCardDigest と同一 (sente が有利なら正)。
 * - Issue #235 S4d-1: manaCap は `newCardState.manaCap` を常に読む (O(1))。現行 cap=20 では
 *   prev 流用と等価だが、動的 manaCap 構想時も自動追従する (旧「常に prev 流用 + 将来手順」を是正)。
 *   死にマナ閾値も evaluateDeadManaPenalty が digest.manaCap × DEAD_MANA_RATIO で動的算出する。
 * - Issue #235 S4d-4: trap 価値が leaf 算出へ移行し digest は gameState 非依存になったため、
 *   旧 gameState 引数を削除 (trap は defId のみ帯同)。
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
  // trap 比較は `defId` のみで `instanceId` は無視 (同 defId のトラップは同 valueModel)。
  // S4d-4: trap は defId を帯同するだけ (価値は leaf 算出) ゆえ、変化時は新 defId へ差し替え。
  const prevSenteTrapDefId = prevCardState.trap.sente?.defId ?? null;
  const prevGoteTrapDefId = prevCardState.trap.gote?.defId ?? null;
  const senteTrapDefId = newCardState.trap.sente?.defId ?? null;
  const goteTrapDefId = newCardState.trap.gote?.defId ?? null;
  const trapChanged =
    senteTrapDefId !== prevSenteTrapDefId || goteTrapDefId !== prevGoteTrapDefId;
  // Issue #235 S4d-3 (M1 B-1): marks 変化検知は length 比較でなく **参照比較**。follow
  // (moveNoPromoteMark) は length 不変・position 変化・新参照ゆえ length 比較では検知漏れ →
  // leaf per-piece eval が stale 座標を見る + (computeCardFold は position fold ゆえ) TT 誤 hit。
  // add/remove/moveNoPromoteMark は変化時のみ新参照を返す (effects.ts) ため参照比較で過不足なし。
  const marksChanged =
    prevCardState.noPromoteMarks.sente !== newCardState.noPromoteMarks.sente ||
    prevCardState.noPromoteMarks.gote !== newCardState.noPromoteMarks.gote;

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
    // S4d-4: trap defId を帯同 (変化時のみ差し替え)。価値は leaf で getCardValue 算出。
    trap: trapChanged
      ? { sente: senteTrapDefId, gote: goteTrapDefId }
      : prev.trap,
    // S4d-3: marks 参照変化時のみ帯同 slice を差し替え (両者空は null fast path)。
    noPromoteMarks: marksChanged
      ? foldNoPromoteMarks(newCardState)
      : prev.noPromoteMarks,
  };
}
