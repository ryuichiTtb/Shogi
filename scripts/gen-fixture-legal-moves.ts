// Issue #193 / PR1b (Phase 3): legal-moves fixture 生成スクリプト。
//
// 目的:
// `getSearchLegalMoves` (= 現状は `getFullLegalMoves` の wrap) の振る舞いキープを
// 200-300 局面で fixture-driven に検証するため、Mulberry32 deterministic seed で
// 局面と正解合法手リストを生成し、JSON に書き出す。
//
// 生成パターン (親計画 md L270-274 / 本フェーズ計画 md L195-204 準拠):
//   1. 駒種境界 (成りゾーン進入境界) — random walk から status=active 採用
//   2. 王手中の合駒・回避 (打ち歩詰め禁則含む) — random walk から isInCheck 採用
//   3. ピン駒 — random walk から status=active 採用
//   4. 持ち駒の打ちたて (二歩禁、行きどころなし、打ち歩詰め含む) — random walk
//   5. 王手放置の自殺手禁止 — random walk から isInCheck 採用 (合法手リストに自殺手なし確認)
//   6. 平凡な中盤・終盤局面 — random walk
//   7. card-shogi 局面 — variant=card-shogi で random walk
//
// 簡素化方針:
// 「template ベース」 (パターン 1-5) と書いた当初は手書き定数 board を想定したが、
// 200-300 個の board 配置を手書きするのは現実性が低く、また検証目的 (= 出力 set
// 一致) には random walk で各カテゴリーに該当する局面を抽出するほうが効率的。
// 本実装では、random walk + フィルタで各パターンを満たす局面を採取する。
// 二段ガード (random walk + status filter) は計画 md「## 共通設計指針」L70 参照。
//
// 出力:
//   - src/lib/shogi/ai/__tests__/fixtures/legal-moves-baseline.json
//   - src/lib/shogi/ai/__tests__/fixtures/legal-moves-baseline.meta.json
//
// 使い方:
//   npm run gen:fixture:legal-moves
//   npm run gen:fixture:legal-moves -- --seed=123
//
// 再生成タイミング:
//   - PR1b 後の moves.ts / legal-moves.ts 内部実装変更時 (枝刈り・最適化追加等)
//   - getFullLegalMoves の合法手生成ロジック変更時

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInitialGameState, applyMove, serializeGameState } from "@/lib/shogi/board";
import { getFullLegalMoves, isInCheck } from "@/lib/shogi/moves";
import { evaluateGameEnd } from "@/lib/shogi/rules";
import { STANDARD_VARIANT } from "@/lib/shogi/variants/standard";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";
import type { GameState, Move, Player, RuleVariant } from "@/lib/shogi/types";
import { mulberry32, randomChoice, parseSeedFromArgv } from "./utils/prng";

// ----- 出力先 (process.cwd() = リポジトリ root 前提) -----
// tsx 経由で `npm run gen:fixture:legal-moves` を実行する想定。
// __dirname の挙動は tsx の loader モードによって変わるため、安定的に
// process.cwd() ベースで解決する (npm script は package.json と同じ階層で実行されるため安全)。
const REPO_ROOT = process.cwd();
const FIXTURE_PATH = resolve(
  REPO_ROOT,
  "src/lib/shogi/ai/__tests__/fixtures/legal-moves-baseline.json",
);
const META_PATH = resolve(
  REPO_ROOT,
  "src/lib/shogi/ai/__tests__/fixtures/legal-moves-baseline.meta.json",
);

// ----- 局面ジェネレータ -----

interface FixtureEntry {
  id: string;
  category: string; // "boundary" | "in-check" | "pinned" | "drop" | "no-suicide" | "midgame" | "card-shogi"
  state: object; // serializeGameState の出力 (JSON-safe)
  player: Player;
  variantId: string;
  expected: Move[];
}

interface CategorySpec {
  id: string;
  variant: RuleVariant;
  count: number;
  // 局面採用条件 (= 計画書の各カテゴリーフィルタ)
  accept: (state: GameState, player: Player) => boolean;
  // walk 手数の最小・最大 (random walk で何 ply まで進めるか)
  walkMin: number;
  walkMax: number;
}

// random walk で局面を生成。詰み・千日手・ステールメイト等に到達したら打ち切り、
// その手前の active 局面を返す (= 二段ガードの 1 段目)。
function generateRandomWalkState(
  variant: RuleVariant,
  rng: () => number,
  targetPly: number,
): GameState | null {
  let state = createInitialGameState(variant);
  for (let ply = 0; ply < targetPly; ply++) {
    state = evaluateGameEnd(state, variant);
    if (state.status !== "active") return null; // 終局到達 → この walk は破棄
    const moves = getFullLegalMoves(state, state.currentPlayer, variant);
    if (moves.length === 0) return null;
    const chosen = randomChoice(rng, moves);
    if (!chosen) return null;
    state = applyMove(state, chosen);
  }
  state = evaluateGameEnd(state, variant);
  // 二段ガードの 2 段目: status === "active" filter
  if (state.status !== "active") return null;
  return state;
}

// 指定カテゴリーの局面を採取する (1 件生成)。
// 採用条件 (`accept`) を満たす局面に当たるまで random walk を繰り返す。
// 上限試行回数を超えた場合は null (呼出側でリトライ or スキップ)。
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
    const player = state.currentPlayer;
    if (!spec.accept(state, player)) continue;
    const expected = getFullLegalMoves(state, player, spec.variant);
    if (expected.length === 0) continue; // 念のため (active なら必ず手がある)
    return {
      id: `${spec.id}-${String(index).padStart(3, "0")}`,
      category: spec.id,
      state: serializeGameState(state),
      player,
      variantId: spec.variant.id,
      expected,
    };
  }
  return null;
}

// 自駒 (king 以外) が相手駒の利きで取られる位置にあるか (ピン候補の簡易判定)。
// 完全なピン判定 (ピン解除すると王手) は重いので、accept の近似として使う。
function hasPotentialPinPiece(state: GameState, player: Player, variant: RuleVariant): boolean {
  // walk で生成された通常局面では、自駒が相手の利きで攻撃されている状況は頻出。
  // ピン駒「自駒の利き上」判定は重く近似が難しいため、ここでは「相手から攻撃されている自駒が存在」で代用。
  const opponent: Player = player === "sente" ? "gote" : "sente";
  const board = state.board;
  const { rows, cols } = variant.boardSize;
  // moves.ts の isSquareAttackedByFast を直接使うのは循環依存になるためここでは簡略化:
  // 相手の合法手生成結果の to マスを使って攻撃されているか判定する。
  const opponentMoves = getFullLegalMoves(state, opponent, variant);
  const attackedSquares = new Set(
    opponentMoves.map((m) => `${m.to.row},${m.to.col}`),
  );
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const piece = board[r][c];
      if (!piece || piece.owner !== player || piece.type === "king") continue;
      if (attackedSquares.has(`${r},${c}`)) return true;
    }
  }
  return false;
}

// 持ち駒を 1 枚以上持つか (drop 候補の判定)。
function hasAnyHandPiece(state: GameState, player: Player): boolean {
  return Object.values(state.hand[player]).some((c) => (c ?? 0) > 0);
}

// 採取するカテゴリー定義 (合計目標 ~250 局面)。
const CATEGORY_SPECS: CategorySpec[] = [
  // 1. 駒種境界 (成りゾーン進入境界) — random walk から status=active を 40 件
  {
    id: "boundary",
    variant: STANDARD_VARIANT,
    count: 40,
    accept: () => true, // 一般的な進行局面で成りゾーン境界も含むため特別なフィルタなし
    walkMin: 5,
    walkMax: 25,
  },
  // 2. 王手中の合駒・回避 — isInCheck 採用
  {
    id: "in-check",
    variant: STANDARD_VARIANT,
    count: 40,
    accept: (state, player) => isInCheck(state, player, STANDARD_VARIANT),
    walkMin: 10,
    walkMax: 50,
  },
  // 3. ピン駒 (近似: 自駒が相手の利きで攻撃されている) — 30 件
  {
    id: "pinned",
    variant: STANDARD_VARIANT,
    count: 30,
    accept: (state, player) => hasPotentialPinPiece(state, player, STANDARD_VARIANT),
    walkMin: 15,
    walkMax: 60,
  },
  // 4. 持ち駒の打ちたて — 50 件
  {
    id: "drop",
    variant: STANDARD_VARIANT,
    count: 50,
    accept: (state, player) => hasAnyHandPiece(state, player),
    walkMin: 15,
    walkMax: 80,
  },
  // 5. 王手放置の自殺手禁止 — 30 件
  // 王手中の合法手生成は内部で leavesKingInCheck フィルタを通すため、
  // 王手中局面で legal moves が正しく自殺手を除外することを fixture で検証する。
  {
    id: "no-suicide",
    variant: STANDARD_VARIANT,
    count: 30,
    accept: (state, player) => isInCheck(state, player, STANDARD_VARIANT),
    walkMin: 5,
    walkMax: 40,
  },
  // 6. 平凡な中盤・終盤局面 — 40 件
  {
    id: "midgame",
    variant: STANDARD_VARIANT,
    count: 40,
    accept: () => true,
    walkMin: 30,
    walkMax: 80,
  },
  // 7. card-shogi 局面 — 20 件
  {
    id: "card-shogi",
    variant: CARD_SHOGI_VARIANT,
    count: 20,
    accept: () => true,
    walkMin: 5,
    walkMax: 40,
  },
];

// ----- メインエントリー -----

function main() {
  const seed = parseSeedFromArgv(process.argv);
  const rng = mulberry32(seed);

  const entries: FixtureEntry[] = [];
  const categoryCounts: Record<string, number> = {};

  for (const spec of CATEGORY_SPECS) {
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
    categoryCounts[spec.id] = collected;
    if (collected < spec.count) {
      console.warn(
        `[gen-fixture-legal-moves] category "${spec.id}": collected ${collected}/${spec.count} (max attempts reached)`,
      );
    }
  }

  // ディレクトリ確保 + JSON 書き出し
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
      "legal-moves baseline fixture generated by scripts/gen-fixture-legal-moves.ts. " +
      "Re-generate when moves.ts or legal-moves.ts internal implementation changes.",
  };
  writeFileSync(META_PATH, JSON.stringify(metaPayload, null, 2) + "\n", "utf8");

  console.log(`[gen-fixture-legal-moves] generated ${entries.length} entries:`);
  for (const [id, count] of Object.entries(categoryCounts)) {
    console.log(`  - ${id}: ${count}`);
  }
  console.log(`  fixture: ${FIXTURE_PATH}`);
  console.log(`  meta:    ${META_PATH}`);
}

main();
