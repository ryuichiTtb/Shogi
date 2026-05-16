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
