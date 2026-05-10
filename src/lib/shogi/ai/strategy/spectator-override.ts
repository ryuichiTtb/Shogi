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
