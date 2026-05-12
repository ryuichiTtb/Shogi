// Issue #193 / PR1c-2 Phase A: strategy/spectator fixture の動的検証スクリプト (CI 外)。
//
// 目的:
// strategy-baseline.json (360 entries) と spectator-baseline.json (4 シナリオ × 25 ply)
// に対して findBestMoveWithStats を再実行し、expected.move と完全一致することを確認する。
//
// 用途:
// 1. Phase B (refactor/#193-pr1c-2) マージ前に手動実行して振る舞いキープを確認
// 2. PR1d 以降の意図的な AI 変更時に fixture 再生成が必要かを判定
// 3. ローカル開発機で Strategy refactor が正しく動作しているかをセルフチェック
//
// CI 不可能の理由 (Phase A 実装時の発見):
// - findBestMoveWithStats({ maxDepth: 6 }) で 1 entry あたり ~8 秒
// - 360 entries × 8 秒 = 約 48 分 (= test:ci で許容不能)
// - 観戦 fixture も 100 ply × 8 秒 = 約 13 分
// - 合計 60 分超のため CI 外で手動実行する設計
//
// 使い方:
//   npm run verify:strategy-fixture        # 全 fixture 検証
//   npm run verify:strategy-fixture -- --strategy-only   # strategy fixture のみ
//   npm run verify:strategy-fixture -- --spectator-only  # spectator fixture のみ
//
// 出力:
//   - 進捗 (10 entries ごとに進捗表示)
//   - 完全一致: 終了コード 0
//   - 不一致: 終了コード 1 + 不一致 entry の id/difficulty を列挙

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deserializeGameState } from "@/lib/shogi/board";
import { findBestMoveWithStats } from "@/lib/shogi/ai/engine";
import { applyMove } from "@/lib/shogi/board";
import { createInitialGameState } from "@/lib/shogi/board";
import { evaluateGameEnd } from "@/lib/shogi/rules";
import { STANDARD_VARIANT } from "@/lib/shogi/variants/standard";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";
import type { Difficulty, Move, Player, RuleVariant } from "@/lib/shogi/types";
import { STRATEGY_FIXTURE_MAX_DEPTH } from "@/lib/shogi/ai/strategy/fixture-constants";

const REPO_ROOT = process.cwd();
const STRATEGY_FIXTURE_PATH = resolve(
  REPO_ROOT,
  "src/lib/shogi/ai/__tests__/fixtures/strategy-baseline.json",
);
const SPECTATOR_FIXTURE_PATH = resolve(
  REPO_ROOT,
  "src/lib/shogi/ai/__tests__/fixtures/spectator-baseline.json",
);

interface StrategyFixtureEntry {
  id: string;
  category: string;
  state: unknown;
  player: Player;
  variantId: string;
  difficulty: Difficulty;
  expected: { move: Move | null };
}

interface StrategyFixturePayload {
  version: string;
  entries: StrategyFixtureEntry[];
}

interface SpectatorScenarioStep {
  ply: number;
  player: Player;
  move: Move | null;
}

interface SpectatorScenario {
  id: string;
  senteDifficulty: Difficulty;
  goteDifficulty: Difficulty;
  moves: SpectatorScenarioStep[];
}

interface SpectatorFixturePayload {
  version: string;
  scenarios: SpectatorScenario[];
}

function variantFromId(id: string): RuleVariant {
  if (id === "standard") return STANDARD_VARIANT;
  if (id === "card-shogi") return CARD_SHOGI_VARIANT;
  throw new Error(`unknown variantId: ${id}`);
}

function moveEquals(a: Move | null, b: Move | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  if (a.type !== b.type) return false;
  if (a.to.row !== b.to.row || a.to.col !== b.to.col) return false;
  if (a.type === "drop") {
    return a.dropPiece === b.dropPiece && a.player === b.player;
  }
  const fromR = a.from?.row;
  const fromC = a.from?.col;
  const fromR2 = b.from?.row;
  const fromC2 = b.from?.col;
  if (fromR !== fromR2 || fromC !== fromC2) return false;
  if (a.piece !== b.piece) return false;
  if ((a.promote ?? false) !== (b.promote ?? false)) return false;
  if (a.player !== b.player) return false;
  return true;
}

function verifyStrategyFixture(): { passed: number; failed: number; mismatches: string[] } {
  console.log("[verify-strategy-fixture] Strategy fixture (360 entries) 検証開始");
  const raw = readFileSync(STRATEGY_FIXTURE_PATH, "utf8");
  const fixture = JSON.parse(raw) as StrategyFixturePayload;

  let passed = 0;
  let failed = 0;
  const mismatches: string[] = [];

  const startTime = Date.now();
  for (let i = 0; i < fixture.entries.length; i++) {
    const entry = fixture.entries[i];
    const variant = variantFromId(entry.variantId);
    const state = deserializeGameState(entry.state);
    const result = findBestMoveWithStats(state, entry.player, entry.difficulty, variant, {
      maxDepth: STRATEGY_FIXTURE_MAX_DEPTH,
      // PR1d-1 (ZZ-1 反映): fixture 生成側 (gen-fixture-strategy.ts:202) と一致させる。
      // 未指定だと strategy.useBook (advanced/expert で true) で openingBook.ts:353 の
      // Math.random 重み付き選択が発火し、生成時と異なる結果になって不一致を再発する。
      // useBook: false で openingBook 経路を完全 bypass、360/360 件 deterministic 一致を保証。
      useBook: false,
    });
    if (moveEquals(result.move, entry.expected.move)) {
      passed++;
    } else {
      failed++;
      mismatches.push(`${entry.id} (${entry.difficulty}, ${entry.category}, player=${entry.player})`);
    }
    if ((i + 1) % 10 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`  進捗: ${i + 1}/${fixture.entries.length} (${elapsed}s)`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[verify-strategy-fixture] Strategy fixture 完了: ${passed} passed, ${failed} failed (${elapsed}s)`);
  return { passed, failed, mismatches };
}

function verifySpectatorFixture(): { passed: number; failed: number; mismatches: string[] } {
  console.log("[verify-strategy-fixture] Spectator fixture (4 シナリオ) 検証開始");
  const raw = readFileSync(SPECTATOR_FIXTURE_PATH, "utf8");
  const fixture = JSON.parse(raw) as SpectatorFixturePayload;

  let passed = 0;
  let failed = 0;
  const mismatches: string[] = [];

  const startTime = Date.now();
  for (const scenario of fixture.scenarios) {
    console.log(`  シナリオ: ${scenario.id} (${scenario.moves.length} ply)`);
    let state = createInitialGameState(CARD_SHOGI_VARIANT);
    for (const step of scenario.moves) {
      state = evaluateGameEnd(state, CARD_SHOGI_VARIANT);
      if (state.status !== "active") break;
      const currentPlayer = state.currentPlayer;
      const difficulty = currentPlayer === "sente" ? scenario.senteDifficulty : scenario.goteDifficulty;
      const result = findBestMoveWithStats(state, currentPlayer, difficulty, CARD_SHOGI_VARIANT, {
        maxDepth: STRATEGY_FIXTURE_MAX_DEPTH,
        spectator: true,
        // PR1d-1 (ZZ-1 反映): fixture 生成側 (gen-fixture-strategy.ts:248) と一致させる。
        // card-shogi では engine.ts L191 の variant.id === "standard" ガードで既に skip だが、
        // 明示性のため指定 (= gen と verify の対称性確保)。
        useBook: false,
      });
      if (moveEquals(result.move, step.move)) {
        passed++;
      } else {
        failed++;
        mismatches.push(`${scenario.id} ply=${step.ply} (player=${step.player}, difficulty=${difficulty})`);
      }
      if (!result.move) break;
      state = applyMove(state, result.move);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[verify-strategy-fixture] Spectator fixture 完了: ${passed} passed, ${failed} failed (${elapsed}s)`);
  return { passed, failed, mismatches };
}

function main() {
  const argv = process.argv;
  const strategyOnly = argv.includes("--strategy-only");
  const spectatorOnly = argv.includes("--spectator-only");

  console.log(`[verify-strategy-fixture] STRATEGY_FIXTURE_MAX_DEPTH=${STRATEGY_FIXTURE_MAX_DEPTH}`);

  let totalFailed = 0;
  const allMismatches: string[] = [];

  if (!spectatorOnly) {
    const result = verifyStrategyFixture();
    totalFailed += result.failed;
    allMismatches.push(...result.mismatches);
  }
  if (!strategyOnly) {
    const result = verifySpectatorFixture();
    totalFailed += result.failed;
    allMismatches.push(...result.mismatches);
  }

  if (totalFailed > 0) {
    console.error(`[verify-strategy-fixture] ❌ ${totalFailed} mismatches:`);
    for (const m of allMismatches) {
      console.error(`  - ${m}`);
    }
    process.exit(1);
  }
  console.log("[verify-strategy-fixture] ✅ 全 fixture 検証完了 (完全一致)");
}

main();
