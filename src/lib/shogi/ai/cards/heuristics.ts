// Issue #193 / PR1d-1: cardDigest 評価関連の名前付き定数集約 (マジックナンバー禁止)。
//
// 親計画 md L411-413 / PR1d 計画 md L460-470 参照。
// PR3-1 (本コミット) で動的ドロー価値・死にマナペナルティ・phase 判定の定数群を追加
// (計画 md docs/plans/issue-193-pr3-1-card-calibration.md 4.1〜4.3 章)。
//
// 注: SPECTATOR_TIME_LIMIT_MS / SPECTATOR_MAX_MOVES / SPECTATOR_MAX_CARD_OPS_PER_TURN
// 等の観戦モード関連定数は既存の src/lib/shogi/ai/strategy 配下で管理 (PR1a で導入済)。
// 重複 export を避けるため本ファイルには再定義しない (将来 refactor PR で集約検討)。

import type { GameState, Player } from "../../types";
import type { CardGameState } from "../../cards/types";

// ドロー判定 (PR1d-1 → PR3-1 で動的化):
//   ・MIN_MANA_RESERVE: ドロー判定で「手動ドロー使用後もマナ余裕を保つ」しきい値 (マナ単位)
//     現状 DRAW_COST = 2 + 1 = 3 が安全側だが、F-4 解釈 (drawProgress < AUTO_DRAW_INTERVAL - 1
//     ガードと組み合わせて自然な絞り込みとなる) を踏まえて 2 で開始、bench で調整。
//   ・(旧 DRAW_VALUE_BONUS=30 固定は PR3-1 で getDrawValue() に置換、退化原因 ① 解消)
//   ・DRAW_COST は src/lib/shogi/cards/definitions.ts:233 で 2 と定義済 (本ファイルでは参照のみ)
//   ・AUTO_DRAW_INTERVAL は src/lib/shogi/cards/definitions.ts:238 で 5 と定義済 (本ファイルでは参照のみ)
export const MIN_MANA_RESERVE = 2;

// handValue 単調減衰関数 (PR1d-1、第 5 次レビュー F-5 仮基準):
//   handValue(handSize) = HAND_VALUE_BASE × (1 - exp(-handSize / HAND_VALUE_DECAY))
//   ・HAND_VALUE_BASE: 手札 1 枚目の最大価値 (cp、歩 = 90 cp の 1/4 ≒ 22.5、本仮基準は 20)
//   ・HAND_VALUE_DECAY: 手札増加に対する減衰係数 (3 枚で 95% 価値、bench で調整)
//   ・HAND_LIMIT は導入しない (= しきい値方式は不要、単調減衰関数で滑らかに価値が下がる、親計画 md L412-413)
export const HAND_VALUE_BASE = 20;
export const HAND_VALUE_DECAY = 3.0;

// cardDigest 評価係数 (PR1d-1、F-5 仮基準で歩 = 90 cp に整合):
//   ・MANA_DELTA_COEFFICIENT: マナ 1 差 = 10 cp (歩 1/9 ≒ 10 cp)
//   ・DRAW_PROGRESS_COEFFICIENT: drawProgress 1 差 = 3 cp (小さく見積もる、自動ドローの相対価値)
export const MANA_DELTA_COEFFICIENT = 10;
export const DRAW_PROGRESS_COEFFICIENT = 3;

// PR1d-3 (判断 1 = 案 B「depth=0 簡易評価」採用):
//   ・DOUBLE_MOVE_TOP_K: super-action 内部探索の 1 手目候補上限。案 B では 2 手指し
//     組合せ (1 手目 × 全 2 手目) を depth=0 で全評価するため計算量は O(K × ~80)。
//     計画 md L1254 は「+30% 超過時のみ発動・デフォルト無効」だが、それは案 A
//     (negamax 深読み + αβ pruning) 前提の試算。案 B は depth=0 全探索で αβ
//     pruning が効かないため、PR1d-3 初版から常時 K=10 に絞り 1 手目を heuristic
//     順 (scoreMoveForOrdering) 上位に限定する (ZZ 反映: 案 B 採用に伴う性能調整)。
export const DOUBLE_MOVE_TOP_K = 10;

// 判断 2 = 案 B でコミット 3 (cardDigest doubleMoveActive) はスキップ確定のため
// DOUBLE_MOVE_ACTIVE_VALUE は導入しない。理由: CardGameState に doubleMove
// フィールドが無く、production root では engine.ts が doubleMove:null 固定で
// AiTurnState を構築するため root スカラー cardDigest の doubleMoveActive は
// 常に無意味化する。二手指しの価値は super-action 探索の局所評価が直接捕捉する。
// 将来 reducer の doubleMove を route.ts 経由で AI に渡す統合時に再検討
// (計画 md PR1d-3 コミット 3 セクションに ZZ 反映)。

// PR1d-4: トラップ系カード (no_promote / check_break) の cardDigest 評価係数
// (sente 絶対視点、PIECE_VALUES と整合する cp 単位、bench で調整、計画 md L1390-1395)。
//   ・TRAP_VALUE_NO_PROMOTE: 盤上 no_promote トラップ 1 枚の価値
//   ・TRAP_VALUE_CHECK_BREAK: 盤上 check_break トラップ 1 枚の価値 (王手対応で no_promote より高評価)
//   ・NO_PROMOTE_MARK_COEFFICIENT: no_promote マーク 1 個あたり価値 (ギャップ1=案A の
//     玉位置非依存カウント差に対する係数。計画 md L1395 NO_PROMOTE_PROXIMITY_BONUS=30 を
//     proximity でなく単純カウント差の係数として流用、ZZ 反映)
export const TRAP_VALUE_NO_PROMOTE = 50;
export const TRAP_VALUE_CHECK_BREAK = 80;
export const NO_PROMOTE_MARK_COEFFICIENT = 30;

// PR1d-4 コミット 3 (action-generator トラップ系候補生成) で使用予定の
// 使用条件ヒューリスティクスしきい値 (計画 md L1392-1394、コミット 3 で参照):
//   ・EARLY_GAME_THRESHOLD: no_promote を「序盤に 1 回」セットする両者合計 ply 上限
//   ・MIN_MANA_RESERVE_FOR_TRAP: トラップセット時に確保したいマナ余裕
//   ・CHECK_BREAK_TRIGGER_THRESHOLD: check_break をプリエンプティブセットする
//     玉の安全度悪化しきい値 (cp、負方向)
export const EARLY_GAME_THRESHOLD = 40;
export const MIN_MANA_RESERVE_FOR_TRAP = 6;
export const CHECK_BREAK_TRIGGER_THRESHOLD = -200;

// ===== PR3-1: 局面段階判定 + 動的ドロー価値 + 死にマナペナルティ =====
//
// 計画 md docs/plans/issue-193-pr3-1-card-calibration.md (4.1〜4.3 章)。
// 本コミット (C-1) では定数定義と phase 判定ヘルパのみ追加し、既存挙動は変更しない
// (C-2 でドロー経路、C-3 で死にマナ項を実際に呼び出す)。

// computePhaseStage: GameState.moveCount (両者合計 ply) で序盤(0)/中盤(1)/終盤(2) を判定。
// 既存 EARLY_GAME_THRESHOLD=40 を 0→1 境界に流用 (no_promote 序盤判定と共通閾値で
// 意味も整合)。ENDGAME_THRESHOLD=100 は仮値で bench 校正可能。
export const ENDGAME_THRESHOLD = 100;

export function computePhaseStage(state: GameState): 0 | 1 | 2 {
  const ply = state.moveCount;
  if (ply < EARLY_GAME_THRESHOLD) return 0;
  if (ply < ENDGAME_THRESHOLD) return 1;
  return 2;
}

// 動的ドロー価値 (C-2 で getDrawValue から参照):
//   getDrawValue(state, player, cardState)
//     = DRAW_VALUE_BASE
//     + max(0, mana - DRAW_MANA_SURPLUS_THRESHOLD) * DRAW_MANA_SURPLUS_COEF (死にマナ回収)
//     + (phase === 1 ? DRAW_PHASE_MID_BONUS : phase === 2 ? DRAW_PHASE_END_BONUS : 0)
//     - max(0, handSize - DRAW_HAND_THRESHOLD) * DRAW_HAND_PENALTY_PER_CARD
//   退化原因 ① (固定 DRAW_VALUE_BONUS=30) を解消。各仮値は bench で再校正。
export const DRAW_VALUE_BASE = 20;
export const DRAW_HAND_THRESHOLD = 4;
export const DRAW_HAND_PENALTY_PER_CARD = 8;
export const DRAW_MANA_SURPLUS_THRESHOLD = 8;
export const DRAW_MANA_SURPLUS_COEF = 3;
export const DRAW_PHASE_MID_BONUS = 15;
export const DRAW_PHASE_END_BONUS = 5;

// 死にマナペナルティ (C-3 で evaluateDeadManaPenalty から参照):
//   evaluateCardDigest に絶対マナ上限近接ペナルティ項を追加 (sente 絶対視点)。
//   DEAD_MANA_THRESHOLD=16 (MANA_CAP=20 の 80%) を超えた分に DEAD_MANA_PENALTY_COEF=4 cp/マナ。
//   退化原因 ④ (マナ上限で manaDelta 価値消失) を解消。
export const DEAD_MANA_THRESHOLD = 16;
export const DEAD_MANA_PENALTY_COEF = 4;

// 動的ドロー価値 (PR3-1 C-2): 旧固定値 DRAW_VALUE_BONUS=30 を置き換える。
//   退化原因 ① (固定 +30) を解消し、手札枚数・マナ余剰・局面段階で動的に算出する。
//   呼び出し元は search.ts evaluateAction の draw 経路 1 箇所のみ (player 視点で signed と加算)。
//
//   構成 (計画 md 4.1.1 章):
//     +DRAW_VALUE_BASE                                    基底
//     +max(0, mana - DRAW_MANA_SURPLUS_THRESHOLD) * COEF  死にマナ回収ボーナス
//     +DRAW_PHASE_MID_BONUS / DRAW_PHASE_END_BONUS        局面段階ボーナス (序盤=0)
//     -max(0, handSize - DRAW_HAND_THRESHOLD) * PENALTY   手札過多ペナルティ
export function getDrawValue(
  _state: GameState,
  player: Player,
  cardState: CardGameState,
): number {
  const handSize = cardState.hand[player].length;
  const mana = cardState.mana[player];

  const handPenalty =
    Math.max(0, handSize - DRAW_HAND_THRESHOLD) * DRAW_HAND_PENALTY_PER_CARD;

  const manaBonus =
    Math.max(0, mana - DRAW_MANA_SURPLUS_THRESHOLD) * DRAW_MANA_SURPLUS_COEF;

  // phase は GameState 経由で computePhaseStage が判定。本関数は cardState だけでなく
  // state も受けることで将来の phase 拡張 (材料残量等) も同じシグネチャで吸収可能。
  const phase = computePhaseStage(_state);
  const phaseBonus =
    phase === 1 ? DRAW_PHASE_MID_BONUS : phase === 2 ? DRAW_PHASE_END_BONUS : 0;

  return DRAW_VALUE_BASE + manaBonus + phaseBonus - handPenalty;
}
