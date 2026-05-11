// Issue #193 / PR1c (Phase 4 足場): evaluate fixture 生成スクリプト。
//
// 目的:
// `evaluate(state, variant)` の戻り値を 1000 局面で固定し、PR1c の export 化前後で
// **byte-level equality (1 cp の差なし)** を fixture-driven に検証する。
// 後続 PR (PR1c-2 / PR1d / PR2) で評価関数を改修した際のデグレ自動検知に活用する。
//
// 局面ミックス (X-3 対応):
//   - standard variant: 800 局面
//     - opening (moveCount 0-15): 160
//     - midgame (moveCount 15-50): 320
//     - endgame (moveCount 50+): 160
//     - random (構造化乱数局面、moveCount 任意): 160
//   - card-shogi variant: 200 局面
//     - opening: 40 / midgame: 80 / endgame: 40 / random: 40
//   合計: 1000 局面
//
// 二段ガード:
//   1. random walk で生成 (= 詰み・千日手・ステールメイトに到達したら破棄)
//   2. state.status === "active" filter (二重ガード)
//   詳細は計画 md「## 共通設計指針 — 局面の合法性保証」参照。
//
// 出力:
//   - src/lib/shogi/ai/__tests__/fixtures/evaluate-baseline.json
//   - src/lib/shogi/ai/__tests__/fixtures/evaluate-baseline.meta.json
//
// 使い方:
//   npm run gen:fixture:evaluate
//   npm run gen:fixture:evaluate -- --seed=123
//
// 再生成タイミング:
//   - PR2 評価関数モジュール本体分離時 (= モジュール分離後の戻り値が変わらない確認)
//   - PR1d で cardDigest 加算が evaluate 戻り値に影響する場合 (新基準として固定)
//   - 評価関数の数値が変わる任意の改修時

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInitialGameState, applyMove, serializeGameState } from "@/lib/shogi/board";
import { getFullLegalMoves } from "@/lib/shogi/moves";
import { evaluateGameEnd } from "@/lib/shogi/rules";
import { evaluate } from "@/lib/shogi/ai/evaluate";
import { STANDARD_VARIANT } from "@/lib/shogi/variants/standard";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";
import type { GameState, RuleVariant } from "@/lib/shogi/types";
import { mulberry32, randomChoice, parseSeedFromArgv } from "./utils/prng";

// ----- 出力先 (process.cwd() = リポジトリ root 前提) -----
const REPO_ROOT = process.cwd();
const FIXTURE_PATH = resolve(
  REPO_ROOT,
  "src/lib/shogi/ai/__tests__/fixtures/evaluate-baseline.json",
);
const META_PATH = resolve(
  REPO_ROOT,
  "src/lib/shogi/ai/__tests__/fixtures/evaluate-baseline.meta.json",
);

// ----- 局面ジェネレータ -----

interface FixtureEntry {
  id: string;
  category: string; // "opening" | "midgame" | "endgame" | "random"
  state: object; // serializeGameState の出力 (JSON-safe)
  variantId: string;
  expected: number; // cp 単位の評価値
}

interface CategorySpec {
  variantId: string;
  variant: RuleVariant;
  category: string;
  count: number;
  // walk 手数の最小・最大
  walkMin: number;
  walkMax: number;
}

// random walk で局面生成 (PR1b の gen-fixture-legal-moves.ts と同じ手法)。
function generateRandomWalkState(
  variant: RuleVariant,
  rng: () => number,
  targetPly: number,
): GameState | null {
  let state = createInitialGameState(variant);
  for (let ply = 0; ply < targetPly; ply++) {
    state = evaluateGameEnd(state, variant);
    if (state.status !== "active") return null;
    const moves = getFullLegalMoves(state, state.currentPlayer, variant);
    if (moves.length === 0) return null;
    const chosen = randomChoice(rng, moves);
    if (!chosen) return null;
    state = applyMove(state, chosen);
  }
  state = evaluateGameEnd(state, variant);
  if (state.status !== "active") return null;
  return state;
}

function generateCategoryEntry(
  spec: CategorySpec,
  rng: () => number,
  index: number,
): FixtureEntry | null {
  const MAX_TRIES_PER_ENTRY = 200;
  for (let attempt = 0; attempt < MAX_TRIES_PER_ENTRY; attempt++) {
    const targetPly =
      spec.walkMin + Math.floor(rng() * (spec.walkMax - spec.walkMin + 1));
    const state = generateRandomWalkState(spec.variant, rng, targetPly);
    if (!state) continue;
    const expected = evaluate(state, spec.variant);
    return {
      id: `${spec.variantId}-${spec.category}-${String(index).padStart(3, "0")}`,
      category: spec.category,
      state: serializeGameState(state),
      variantId: spec.variantId,
      expected,
    };
  }
  return null;
}

// 採取するカテゴリー定義 (合計目標 1000 局面、X-3 対応 variant 分布明示)。
const CATEGORY_SPECS: CategorySpec[] = [
  // standard variant: 800 局面
  { variantId: "standard", variant: STANDARD_VARIANT, category: "opening", count: 160, walkMin: 0, walkMax: 15 },
  { variantId: "standard", variant: STANDARD_VARIANT, category: "midgame", count: 320, walkMin: 15, walkMax: 50 },
  { variantId: "standard", variant: STANDARD_VARIANT, category: "endgame", count: 160, walkMin: 50, walkMax: 100 },
  { variantId: "standard", variant: STANDARD_VARIANT, category: "random", count: 160, walkMin: 5, walkMax: 80 },
  // card-shogi variant: 200 局面
  { variantId: "card-shogi", variant: CARD_SHOGI_VARIANT, category: "opening", count: 40, walkMin: 0, walkMax: 15 },
  { variantId: "card-shogi", variant: CARD_SHOGI_VARIANT, category: "midgame", count: 80, walkMin: 15, walkMax: 50 },
  { variantId: "card-shogi", variant: CARD_SHOGI_VARIANT, category: "endgame", count: 40, walkMin: 50, walkMax: 100 },
  { variantId: "card-shogi", variant: CARD_SHOGI_VARIANT, category: "random", count: 40, walkMin: 5, walkMax: 80 },
];

// ----- メインエントリー -----

function main() {
  const seed = parseSeedFromArgv(process.argv);
  const rng = mulberry32(seed);

  const entries: FixtureEntry[] = [];
  const categoryCounts: Record<string, number> = {};

  for (const spec of CATEGORY_SPECS) {
    const key = `${spec.variantId}/${spec.category}`;
    let collected = 0;
    let index = 0;
    const MAX_ATTEMPTS_PER_CATEGORY = spec.count * 50;
    let attempts = 0;
    while (collected < spec.count && attempts < MAX_ATTEMPTS_PER_CATEGORY) {
      attempts++;
      const entry = generateCategoryEntry(spec, rng, index);
      if (entry) {
        entries.push(entry);
        index++;
        collected++;
      }
    }
    categoryCounts[key] = collected;
    if (collected < spec.count) {
      console.warn(
        `[gen-fixture-evaluate] category "${key}": collected ${collected}/${spec.count} (max attempts reached)`,
      );
    }
  }

  mkdirSync(dirname(FIXTURE_PATH), { recursive: true });

  const fixturePayload = {
    version: "1.0",
    entries,
  };
  writeFileSync(FIXTURE_PATH, JSON.stringify(fixturePayload, null, 2) + "\n", "utf8");

  const metaPayload = {
    generatedAt: new Date().toISOString(),
    seed,
    totalEntries: entries.length,
    categoryCounts,
    note:
      "evaluate baseline fixture generated by scripts/gen-fixture-evaluate.ts. " +
      "Re-generate when the evaluation function returns different cp values " +
      "(PR2 module split, PR1d cardDigest addition, etc).",
  };
  writeFileSync(META_PATH, JSON.stringify(metaPayload, null, 2) + "\n", "utf8");

  console.log(`[gen-fixture-evaluate] generated ${entries.length} entries:`);
  for (const [key, count] of Object.entries(categoryCounts)) {
    console.log(`  - ${key}: ${count}`);
  }
  console.log(`  fixture: ${FIXTURE_PATH}`);
  console.log(`  meta:    ${META_PATH}`);
}

main();
