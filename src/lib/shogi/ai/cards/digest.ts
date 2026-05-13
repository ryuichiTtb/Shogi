// Issue #193 / PR1d-1: cardDigest 評価ダイジェスト構造 + 計算/評価関数。
//
// 設計の核 (親計画 md L350-356 / PR1d 計画 md L178-189):
// - 探索開始時に root で 1 回だけ computeCardDigest(cardState) を呼ぶ
// - evaluate の戻り値に evaluateCardDigest(cardDigest, variant) を加算 (1 op、ホットパス影響無視可)
// - cardDigest を引数として子ノードに伝播 (= ホットパスでの再計算を構造的に禁止、W-1 反映)
// - sente 絶対視点で固定 (W-2 反映、evaluate 既存実装 sign = piece.owner === "sente" ? 1 : -1 と符号整合)
//
// 段階拡張ロードマップ (PR1d 計画 md L191-196):
// - PR1d-1 (本コミット): manaDelta / manaCap / handValueDelta / drawProgressDelta
// - PR1d-3: doubleMoveActive: Player | null (sente/gote の生値、evaluateCardDigest で sente 絶対視点に変換)
// - PR1d-4: trapPresence / noPromoteMarksPositions (W-7 反映: TrapInstance / PieceMark 抽出経路)

import type { CardGameState } from "../../cards/types";
import type { RuleVariant } from "../../types";
import { MANA_CAP } from "../../cards/definitions";
import {
  MANA_DELTA_COEFFICIENT,
  HAND_VALUE_BASE,
  HAND_VALUE_DECAY,
  DRAW_PROGRESS_COEFFICIENT,
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
    manaCap: MANA_CAP,
    handValueDelta,
    drawProgressDelta,
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
  return (
    digest.manaDelta * MANA_DELTA_COEFFICIENT +
    digest.handValueDelta +
    digest.drawProgressDelta * DRAW_PROGRESS_COEFFICIENT
  );
}
