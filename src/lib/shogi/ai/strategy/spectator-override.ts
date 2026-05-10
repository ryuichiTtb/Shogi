// Issue #193 / PR1a: 観戦モード (CPU vs CPU) で適用する Strategy パラメータの定数集約。
//
// 第 4 次レビュー F-1 進行中チェックリストの推奨に従い、本ファイルは
// 「定数集約のみ」に責務限定する。観戦モードの timeLimitMs 上書きは
// 各 Strategy の constructor (opts.spectator) で内部処理する設計。
//
// 詳細: docs/plans/issue-193.md「PR1a 主な変更 6.」参照。

// 観戦モード時の探索時間上限 (ms)。CPU 1 手 3.5s × 100 手 ≒ 6 分の体験を
// 1500ms × 100 手 ≒ 2.5 分に短縮し、観戦体験の冗長さを抑える。
// bench fixture (棋力評価) は元の timeLimitMs (3500ms 等) で実行 — 観戦時の短縮は UX 用、棋力測定は元値。
export const SPECTATOR_TIME_LIMIT_MS = 1500;

// 観戦モード時の 1 局あたり最大手数 (gameState.moveCount は両者合計 ply)。
// 200 ply (= 各 100 手) で強制引き分け扱い。無限カードドロー・膠着への保険。
// 終局判定優先順位: 千日手 (最優先、既存仕様) → カードアクション上限 → 200 手到達。
export const SPECTATOR_MAX_MOVES = 200;

// 観戦モード時の 1 ターンあたりカードアクション上限。
// 現行ルールは 1 ターン 1 アクションのため発動しないが、PR3 以降のルール変更
// (任意回数のドロー/カード使用) 時の安全弁として PR1a 段階で定数だけ用意。
export const SPECTATOR_MAX_CARD_OPS_PER_TURN = 5;
