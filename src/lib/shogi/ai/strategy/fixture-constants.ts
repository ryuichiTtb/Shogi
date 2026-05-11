// Issue #193 / PR1c-2 Phase A (NN-1 反映): fixture 生成・検証用の定数。
//
// 設計詳細:
// - docs/plans/issue-193-pr1c-2.md「## CPU 速度依存性対策」
// - docs/plans/issue-193-pr1c-2.md「## addNoise 揺らぎ対策 (2 層構造)」
//
// 役割分担方式採用 (MM-2、第 2 次レビュー Phase 3 ユーザー意思決定):
// - Strategy fixture (本フェーズ): maxDepth=8 の軽量検証 (= Phase B refactor の
//   関数呼出経路の整合性検証)
// - 深い検証: PR1d 以降の perf-bench.test.ts (advanced/expert × 局面 × p50/p95/max
//   観測) + Vercel preview deploy 実機確認
//
// fixture 生成スクリプト (scripts/gen-fixture-strategy.ts) と test:ci 検証
// (strategy-equivalence.test.ts) の両方が本定数を import することで一元管理。
// 将来 maxDepth を引上げる際も 1 箇所修正で済む。

/**
 * Strategy fixture 生成・検証時の探索深度上限。
 *
 * advanced (DIFFICULTY_PARAMS.advanced.maxDepth=16) / expert (24) と乖離するが、
 * これは設計判断として「関数呼出経路の整合性検証」に役割を絞り込んだ結果。
 * 深い検証は PR1d 以降の bench fixture + Vercel preview 実機確認で補完する。
 */
export const STRATEGY_FIXTURE_MAX_DEPTH = 8;
