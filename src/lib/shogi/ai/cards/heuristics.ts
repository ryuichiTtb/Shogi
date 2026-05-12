// Issue #193 / PR1d-1: cardDigest 評価関連の名前付き定数集約 (マジックナンバー禁止)。
//
// 親計画 md L411-413 / PR1d 計画 md L460-470 参照。
//
// 注: SPECTATOR_TIME_LIMIT_MS / SPECTATOR_MAX_MOVES / SPECTATOR_MAX_CARD_OPS_PER_TURN
// 等の観戦モード関連定数は既存の src/lib/shogi/ai/strategy 配下で管理 (PR1a で導入済)。
// 重複 export を避けるため本ファイルには再定義しない (将来 refactor PR で集約検討)。

// ドロー判定 (PR1d-1):
//   ・MIN_MANA_RESERVE: ドロー判定で「手動ドロー使用後もマナ余裕を保つ」しきい値 (マナ単位)
//     現状 DRAW_COST = 2 + 1 = 3 が安全側だが、F-4 解釈 (drawProgress < AUTO_DRAW_INTERVAL - 1
//     ガードと組み合わせて自然な絞り込みとなる) を踏まえて 2 で開始、bench で調整。
//   ・DRAW_VALUE_BONUS: ドローアクションを最善手候補に押し出す追加価値 (cp)
//     根拠: マナ -2 のコスト (= -20 cp) + 手札 +1 の単調減衰価値 (HAND_VALUE_BASE 上限 = 20 cp) +
//     自動ドローを 1 ターン後送りにできる相対価値 (= DRAW_PROGRESS_COEFFICIENT × 1 ≒ 3 cp) を合算した
//     上で、PR1c-2 / PR1d-1 主棋力 DoD (depthCompleted -10% 以内) と整合する控えめな値 (30 cp ≒ 歩 1/3)。
//   ・DRAW_COST は src/lib/shogi/cards/definitions.ts:233 で 2 と定義済 (本ファイルでは参照のみ)
//   ・AUTO_DRAW_INTERVAL は src/lib/shogi/cards/definitions.ts:238 で 5 と定義済 (本ファイルでは参照のみ)
export const MIN_MANA_RESERVE = 2;
export const DRAW_VALUE_BONUS = 30;

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

// PR1d-3 で追加予定 (Phase 0 で枠だけ確保、V-1 反映で DOUBLE_MOVE_ACTIVE_VALUE 追加も明示):
// export const DOUBLE_MOVE_TOP_K = 10;             // bench で +30% 超過時のフォールバック上限手数
// export const DOUBLE_MOVE_ACTIVE_VALUE = 200;     // V-1 反映: 二手指し継続中の cardDigest 評価値 (cp、bench で調整)
