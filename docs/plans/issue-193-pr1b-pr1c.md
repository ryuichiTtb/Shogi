# Issue #193 PR1b + PR1c 並行着手計画

本フェーズ計画 md。Issue #193 段階的実装の **PR1a (マージ済) → PR1b + PR1c (本フェーズ並行着手)** の実装方針を整理する。実装着手前に別レビュワーレビューを受けて確定させる目的のドキュメント (AGENTS.md ルール 8: 重要マイルストーン 3 段階レビューの第 1 段階「実装計画策定後」)。

---

## Context

Issue #193 (AI/CPU アーキ刷新 + カード戦略統合 + CPU vs CPU 観戦) の段階的実装計画 (PR1a〜PR1e + PR2-6 = 計 11 PR) のうち、**第 1 段階 PR1a は既に main にマージ済** ([95d49ce](https://github.com/ryuichiTtb/Shogi/commit/95d49ce) PR #202 / [f603c50](https://github.com/ryuichiTtb/Shogi/commit/f603c50) PR #203)。

本フェーズでは **第 2 段階 PR1b と PR1c を並行着手** する。両 PR は親計画 md ([docs/plans/issue-193.md](issue-193.md)) L74 のロードマップで「PR1a 並行可」と明示されており、依存関係的に独立。

### 各 PR の概要

| PR | スコープ | 規模 | デグレリスク | 主要 DoD |
|----|---------|------|--------------|----------|
| **PR1b** | Phase 3 探索専用 legal moves 分離 (`getSearchLegalMoves` を `getFullLegalMoves` の wrap として export) | 小 (3 日) | **低** (実装は wrap、振る舞い完全保持) | 200-300 局面 fixture で出力 set 完全一致 |
| **PR1c** | Phase 4 足場 (評価関数 5 関数を `export` 化 + `evaluateWithBreakdown` ヘルパ追加) | 小 (3 日) | **中** (1 cp ずれ厳禁) | 1000 局面 byte-level equality (`evaluate(state, variant)` の戻り値が export 前後で 1 cp も変わらない) |

### 本フェーズの目的

1. **fixture-driven 安全網の基盤確立**: PR1c-2 (Strategy 再集約 refactor) / PR1d (cardDigest 評価) / PR2 (評価関数モジュール本体分離) で参照される fixture を整備
2. **fixture 生成スクリプトの慣習確立**: `scripts/gen-fixture-evaluate.ts` を新設し、後続 PR (PR1c-2 / PR2 / 観戦モード基準 fixture) で再利用可能なパターンを作る
3. **探索ホットパスの別シンボル化**: 後続 PR で内部最適化 (枝刈り等) する余地を作るため、`getSearchLegalMoves` を別ファイルに分離

---

## 着手方針 (確定事項)

| 項目 | 確定内容 |
|------|---------|
| 着手範囲 | PR1b + PR1c **並行** (同セッションで両方完成、push まで) |
| fixture 生成戦略 | **PR1b/PR1c 両方 script 化で慣習統一** (X-4/X-5 対応): PR1b は `scripts/gen-fixture-legal-moves.ts` で 200-300 局面 / PR1c は `scripts/gen-fixture-evaluate.ts` で 1000 局面、両者とも JSON 化 + git 管理。両 script で共通の `scripts/utils/prng.ts` (Mulberry32) を使用 |
| ブランチ運用 | **単一ブランチ × 2** (`feature/#193-pr1b` と `feature/#193-pr1c`、それぞれ `origin/main` 起点で作成) |
| Worktree | 使用しない (本ディレクトリでブランチ切替) |
| マージ | **明示指示まで実施しない** (AGENTS.md ルール 1)。push まで完了して止まる |

### fixture 生成戦略の根拠 (X-4/X-5 対応で第 2 版から方針変更)

**第 1 版方針 (取り消し)**: PR1b は `legal-moves.test.ts` 内に hardcode で 200-300 局面 → 現実性なし (200 × 81 マス board + hand 等を直書きすると test ファイルが数万行になる)

**第 2 版方針 (確定、X-4/X-5 反映)**: PR1b/PR1c 両方とも script 化で慣習統一

- PR1b: `scripts/gen-fixture-legal-moves.ts` で 200-300 局面生成 → `legal-moves-baseline.json` に保存 → `legal-moves.test.ts` で import
- PR1c: `scripts/gen-fixture-evaluate.ts` で 1000 局面生成 → `evaluate-baseline.json` に保存 → `evaluate-equivalence.test.ts` で import
- 両 script で共通の `scripts/utils/prng.ts` (Mulberry32) を import して deterministic seed 管理

**この方針の利点**:

- 本フェーズの目的「fixture 生成スクリプトの慣習確立」と整合 (親計画 md L568-571 の `gen:fixture:legal-moves` / `gen:fixture:evaluate` / `gen:fixture:strategy` / `gen:fixture:spectator` の 4 種に対応)
- PR1c-2 / PR2 / PR1d / 観戦モード基準 fixture でも同じ慣習を継承可能 (script + JSON + Mulberry32)
- 200-300 局面 hardcode の現実性問題 (test ファイル数万行) を回避
- fixture 再生成時の手順統一 (`npm run gen:fixture:legal-moves` / `gen:fixture:evaluate`)

### 「並行」の用語整理 (N-1 対応)

「並行」と「同セッション完成」を区別する:

- **依存関係: 並行可** — PR1b と PR1c は両者 `origin/main` 直派生で **互いに独立**。PR1c は PR1b マージ前でも push 可能 (依存関係的に制約なし)
- **進行手順: 同セッション内で順次** — 本セッションでは PR1b → PR1c の順で実装する (時間的に直列、想定スケジュール参照)。これは「依存関係の並行」と「実装作業の並行」を区別した運用

これにより、レビュー粒度は PR ごとに分離され、デグレ発生時の切り分けも容易。

---

## 共通設計指針 — PR1b/PR1c の fixture 生成共通仕様 (Z-5/Z-6 対応)

PR1b の `gen-fixture-legal-moves.ts` と PR1c の `gen-fixture-evaluate.ts` は、両者とも **同じ設計指針** で実装する。本セクションを **共通の前段** として明示し、各 script 設計セクションでは本セクションを参照する形に整理 (重複記述を避ける)。

### 1. 局面の合法性保証 (M-4 / Z-6 対応)

**背景**: AI 評価関数 `evaluate(state, variant)` は以下の特殊値を返す ([evaluate.ts:716-719](https://github.com/ryuichiTtb/Shogi/blob/main/src/lib/shogi/ai/evaluate.ts#L716-L719)):

- `state.status === "checkmate"` → **±100000** (手番側勝ち / 負け)
- `state.status !== "active"` (resign / repetition / impasse 等) → **0**

このため、不正・特殊状態の局面が混入すると **fixture が「特殊値のみで意味のない検証」になるリスク**がある。

PR1b の `gen-fixture-legal-moves.ts` でも、random walk (パターン 6-7: 平凡局面 / card-shogi) でこの問題は同じく発生するため、**両 script で共通の二段ガード** を適用する。

**二段ガード**:

1. **random walk で生成** (主):
   - 初期局面 (`createInitialGameState`) からランダムに合法手を打って到達した局面のみ採用
   - 各 phase の moveCount 範囲 (opening 0-15 / midgame 15-50 / endgame 50+) は walk 手数で制御
   - 合法手は `getFullLegalMoves(state, player, variant)` から **Mulberry32 deterministic seed** で 1 手選択
   - 詰み・千日手・ステールメイトに到達した時点で打ち切り、その手前の active 局面を採用

2. **`state.status === "active"` filter** (念のため):
   - 生成後に `state.status === "active"` を検証し、満たさない局面は除外して再生成
   - 二重ガードとして機能 (random walk が想定外の終局状態に到達した場合の保険)

**全パターン共通**: PR1b の全 7 カテゴリー (駒種境界 / 王手中合駒 / ピン駒 / 持ち駒打ち / 王手放置 / 平凡な中盤・終盤 / card-shogi) で random walk + accept フィルタ方式を採用する (R-4 訂正反映、計画当初の「template ベース手書き定数」案は 200-300 個の board 配置を手書きする現実性問題から不採用)。各カテゴリーの accept フィルタ (= 当該パターンに該当する局面かを判定する条件) は実装側 `scripts/gen-fixture-legal-moves.ts` L17-22 / L40-45 の簡素化方針記述を参照。

### 2. fixture JSON serialize 方針 (N-2 / Z-5 対応)

`state` (= `GameState`) を `JSON.stringify` する際、`board: Piece[][]` / `hand: HandState` 等の構造化型はプレーンオブジェクト化される。TypeScript の `interface` はランタイム情報を持たないため:

- **serialize**: `JSON.stringify(state)` で直接 (board や hand の prototype 不要)
- **deserialize**: 型アサーション `as GameState` で復元 (Piece クラスの new 呼出は不要、prototype 復元処理も不要)
- 既存 `serializeGameState` / `deserializeGameState` ([src/lib/shogi/board.ts:249, 259](https://github.com/ryuichiTtb/Shogi/blob/main/src/lib/shogi/board.ts#L249)) が利用可能なら **優先使用** (Game レコード保存時の慣習)

PR1b の `legal-moves-baseline.json` も同じ方針で serialize / deserialize する (= entries の `state` フィールドはプレーンオブジェクト)。

### 3. fixture JSON 形式の統一

両 script の出力 JSON は同じ形式に揃える:

- メイン fixture: `{ version: "1.0", entries: [{ id, state, player?, variantId, expected }] }`
  - PR1b: `expected: Move[]` (合法手リスト)
  - PR1c: `expected: number` (cp 単位の評価値)
  - PR1c では `player` フィールドは不要 (`evaluate` が `state.currentPlayer` から判定)
- メタ情報: `{ generatedAt: "ISO date", seed: 42, ... }` を別ファイル `*-baseline.meta.json` に分離 (Y-2 対応、CI 差分ノイズ回避)

### 4. Mulberry32 seed 管理 (X-2 対応)

両 script は共通の `scripts/utils/prng.ts` (Mulberry32) を import する。デフォルト seed は `42`、`--seed=N` フラグでオーバーライド可。

詳細実装は本ファイル「## PR1c 実装ステップ」内の「乱数 seed 管理」セクション参照。

---

## Issue #193 リオープン後の運用方針 (M-2 対応)

PR #202 マージ時に Issue #193 が GitHub の自動クローズで一旦クローズされたが、本フェーズ着手前にユーザーがリオープン済 (本 Issue は PR1a〜PR6 = 計 11 PR の親 Issue で、PR1b 以降も継続中)。

**運用ルール**:

1. **PR1b/PR1c 以降の PR description で `Closes #193` は記述しない** (記述すると再度自動クローズが発生し、リオープン手間が増える)
   - 代わりに「Related: #193」「Issue #193 PR1b」等の参照表記を使用
2. **本 Issue の最終クローズは PR6 完了後にユーザー明示指示でのみ実施** (AGENTS.md ルール 1 遵守)
3. 集約 Issue (#190 / #76) も同様に、本 Issue 全 PR 完了時のユーザー明示指示でのみクローズ
   - **本フェーズ着手時点 (2026-05-10) で Issue #190 / #76 は両方とも `state: "open"` を確認済** (Y-4 対応、計画策定時の状態スナップショット)

---

## PR1b 実装ステップ — Phase 3 探索専用 legal moves 分離

### ブランチ作成

```bash
git fetch origin
git checkout -b feature/#193-pr1b origin/main
```

### 影響ファイル

| 種別 | パス | 内容 |
|------|------|------|
| 新規 | `src/lib/shogi/ai/legal-moves.ts` | `getSearchLegalMoves(state, player, variant)` を export |
| 新規 | `scripts/utils/prng.ts` | Mulberry32 PRNG (X-2 対応、PR1b/PR1c 両方で利用、後続 PR の fixture 生成でも共有) — **PR1b で先行新設**、PR1c は import のみ |
| 新規 | `scripts/gen-fixture-legal-moves.ts` | 200-300 局面を Mulberry32 seed で生成 → `legal-moves-baseline.json` に保存 (X-4/X-5 対応) |
| 新規 | `src/lib/shogi/ai/__tests__/fixtures/legal-moves-baseline.json` | 生成済 200-300 局面の正解値 (git 管理、CI で読込のみ) |
| 新規 | `src/lib/shogi/ai/__tests__/legal-moves.test.ts` | **二重ガード** (Z-4 対応): (1) fixture (= 生成済 `getFullLegalMoves` の正解値 JSON) と `getSearchLegalMoves` の出力 set 完全一致、(2) test 実行時に `getFullLegalMoves` を再計算して `getSearchLegalMoves` と直接一致を検証 |
| 編集 | `src/lib/shogi/ai/search.ts` | 3 箇所の `getFullLegalMoves` 呼出を `getSearchLegalMoves` に置換、**L3 import 文から `getFullLegalMoves` を削除** (置換完了後は使用 0 件、`isInCheck` のみ残す)、新規 import で `getSearchLegalMoves` を `./legal-moves` から取込 — M-1 対応 |
| 編集 | `package.json` | `"gen:fixture:legal-moves": "tsx scripts/gen-fixture-legal-moves.ts"` 追加 |

### `legal-moves.ts` 実装イメージ

```ts
// Issue #193 / PR1b: 探索ホットパス専用の合法手生成。
// 現時点では getFullLegalMoves の透過的な wrap。後続 PR (PR2 等) で
// 探索ホットパス用に枝刈り等を加える余地を作るため別シンボル化する。

import { getFullLegalMoves } from "@/lib/shogi/moves";
import type { GameState, Move, Player, RuleVariant } from "@/lib/shogi/types";

export function getSearchLegalMoves(
  state: GameState,
  player: Player,
  variant: RuleVariant,
): Move[] {
  return getFullLegalMoves(state, player, variant);
}
```

### `search.ts` 置換箇所 (3 箇所、Explore レポートで確定済)

| 行 | コンテキスト | 置換 |
|----|------------|------|
| L238 | quiescence 王手中の合法手生成 | `getFullLegalMoves` → `getSearchLegalMoves` |
| L339 | negamax 本探索 | 同上 |
| L512 | findBestMove root | 同上 |

### 置換対象外 (search 経路ではないため、PR1b スコープ外)

- `engine.ts` L159 (定跡手の合法性検証) / L204, L221 (fallback / blunder guard) — engine 経路、search 内部ではない
- `moves.ts` L187 (`isCheckmate` 内) — rule logic
- `rules.ts` L122 (終局判定) — rule logic
- `turn/current-rules.ts` L27 (PR1d 以降の AI turn action 経路、別 PR スコープ)
- `use-shogi-game.ts` (UI 経路)

### `gen-fixture-legal-moves.ts` 設計 (X-4/X-5 対応で script 化)

**機能**:
- Mulberry32 seed (`scripts/utils/prng.ts` から import) で deterministic 生成
- 200-300 局面を以下のパターンで網羅 (親計画 md L270-274 準拠、R-4 訂正反映で全パターン random walk + accept フィルタ方式に統一):
  1. **駒種 8 種 × 成り駒 6 種 × 成りゾーン進入境界** (~40 局面、random walk + accept フィルタ)
  2. **王手中の合駒・回避** (打ち歩詰め禁則含む、~40 局面、random walk + accept フィルタ = `isInCheck` で採用)
  3. **ピン駒** (飛角香の利き上の自駒、~30 局面、random walk + accept フィルタ = `hasPotentialPinPiece` で近似採用)
  4. **持ち駒の打ちたて** (二歩禁、行きどころなし、打ち歩詰め、~50 局面、random walk + accept フィルタ = `hasAnyHandPiece` で採用)
  5. **王手放置の自殺手禁止** (~30 局面、random walk + accept フィルタ = `isInCheck` で採用)
  6. **平凡な中盤・終盤局面** (~50 局面、random walk)
  7. **card-shogi 局面** (variant 引数の動作確認、~20 局面、random walk)
- 各局面で `getFullLegalMoves(state, player, variant)` を呼んで正解の合法手リストを取得 → JSON に保存
- 出力: `src/lib/shogi/ai/__tests__/fixtures/legal-moves-baseline.json`
- 形式: `{ version: "1.0", entries: [{ id, category, state, player, variantId, expected: Move[] }] }`
  (`generatedAt` は別ファイル `legal-moves-baseline.meta.json` に分離 — Y-2 対応)

**生成方針** (R-4 訂正反映、実装方針 = `scripts/gen-fixture-legal-moves.ts` L17-22 と完全整合):

- **全パターン random walk + accept フィルタで採取**: 初期局面から Mulberry32 seed で合法手 walk し、各カテゴリーの accept フィルタ (パターン 1: 一般進行 / パターン 2,5: `isInCheck` / パターン 3: `hasPotentialPinPiece` / パターン 4: `hasAnyHandPiece` / パターン 6,7: 制約なし) で採用判定
- 計画当初の「template ベース」案 (パターン 1-5 を手書き定数 board として持つ) は **200-300 個の board 配置を手書きする現実性問題** から不採用 (実装側 `gen-fixture-legal-moves.ts` L17-22 で簡素化方針として記述済)
- 二段ガード (random walk + `state.status === "active"` filter) は本ファイル「## 共通設計指針」セクション参照

**合法性保証 / fixture JSON serialize 方針** は本ファイル冒頭「## 共通設計指針 — PR1b/PR1c の fixture 生成共通仕様 (Z-5/Z-6 対応)」セクション参照。両 script で **同じ二段ガード** (random walk + `state.status === "active"` filter) と同じ serialize 方針を適用する。

**実装の慣習**: 既存 `scripts/bench-ai.ts` (tsx 形式) を参考、`scripts/utils/prng.ts` を共有。

### `legal-moves.test.ts` 設計

```ts
import baseline from "./fixtures/legal-moves-baseline.json";
import { getSearchLegalMoves } from "../legal-moves";
import { getFullLegalMoves } from "@/lib/shogi/moves";
import { getVariantById } from "@/lib/shogi/variants";

describe("getSearchLegalMoves: getFullLegalMoves との完全一致 (PR1b 振る舞いキープ)", () => {
  it("200-300 局面 fixture で出力 set 完全一致", () => {
    for (const entry of baseline.entries) {
      const variant = getVariantById(entry.variantId);
      const expected = new Set(entry.expected.map(moveToCanonical));
      const actual = new Set(
        getSearchLegalMoves(entry.state, entry.player, variant).map(moveToCanonical),
      );
      expect(actual).toEqual(expected);
    }
  });

  it("getFullLegalMoves と getSearchLegalMoves は常に同じ結果を返す", () => {
    for (const entry of baseline.entries) {
      const variant = getVariantById(entry.variantId);
      const full = getFullLegalMoves(entry.state, entry.player, variant);
      const search = getSearchLegalMoves(entry.state, entry.player, variant);
      expect(new Set(search.map(moveToCanonical))).toEqual(new Set(full.map(moveToCanonical)));
    }
  });
});
```

**DoD**: 各局面で `getSearchLegalMoves(state, player, variant)` の出力 set が `getFullLegalMoves(state, player, variant)` の出力 set と完全一致 (Set 比較)。

### 検証

```bash
npm run gen:fixture:legal-moves   # 初回 fixture 生成 (Mulberry32 seed=42)
npm run lint        # PR1b 起因 warning 0 件目標
npm run typecheck   # PR1b 起因エラー 0 件目標
npm run test:ci     # 既存 311 テスト + 新 legal-moves.test.ts 全件緑
npm run build       # ✓ Compiled successfully
```

### PR1b の DoD まとめ

- [ ] `legal-moves.ts` の `getSearchLegalMoves` が export されている
- [ ] `search.ts` の `getFullLegalMoves` 直接呼出が **0 件** (3 箇所すべて置換済)、L3 import からも削除済
- [ ] `scripts/utils/prng.ts` (Mulberry32) が新設され、`scripts/gen-fixture-legal-moves.ts` から import されている
- [ ] `scripts/gen-fixture-legal-moves.ts` が新規追加、`npm run gen:fixture:legal-moves` で 200-300 局面 fixture を再生成可能
- [ ] 200-300 局面 fixture が緑、`getSearchLegalMoves(state, player, variant)` の出力 set が `getFullLegalMoves` と完全一致
- [ ] `package.json` に `gen:fixture:legal-moves` script 追加
- [ ] lint / typecheck / test:ci / build すべてパス
- [ ] Vercel preview deploy で実機動作確認 (人間 vs CPU 通常モード / 観戦モードの両方で棋力に違和感なし)

---

## PR1c 実装ステップ — Phase 4 足場 (評価関数 export + breakdown)

### ブランチ作成 (PR1b 完了後 or 並行、`origin/main` から直接派生)

```bash
git fetch origin
git checkout -b feature/#193-pr1c origin/main
```

### 影響ファイル

| 種別 | パス | 内容 |
|------|------|------|
| 編集 | `src/lib/shogi/ai/evaluate.ts` | 5 関数に `export` 追加 + `evaluateWithBreakdown` 新設 |
| 新規 | `scripts/gen-fixture-evaluate.ts` | 1000 局面の正解値を生成して JSON 出力 |
| 新規 | `src/lib/shogi/ai/__tests__/fixtures/evaluate-baseline.json` | 1000 局面の評価値 (cp 単位) |
| 新規 | `src/lib/shogi/ai/__tests__/evaluate-equivalence.test.ts` | 1000 局面 byte-level equality 検証 |
| 編集 | `package.json` | `"gen:fixture:evaluate": "tsx scripts/gen-fixture-evaluate.ts"` 追加 |

### `evaluate.ts` 編集 (5 関数を export 化)

5 関数に `export` 追加 (本体ロジックは触らない):

| 関数 | 行番号 | 引数 |
|------|--------|------|
| `evaluatePieceSafety` | L383 | `(state, player, variant)` |
| `evaluatePromotionThreats` | L426 | `(state, player, variant)` |
| `evaluateCastle` | L544 | `(state, player, kingRow, kingCol, variant)` |
| `evaluateKingSafety` | L592 | `(state, player, variant)` |
| `evaluateRookFiles` | L675 | `(state, player, variant)` |

### `evaluateWithBreakdown` 新設 (`evaluate` 本体は変更しない)

```ts
export interface EvaluationBreakdown {
  total: number;
  material: number;        // 盤上駒価値 + PST
  hand: number;            // 手駒価値
  kingSafety: number;      // 玉安全度差 (sente - gote)
  rookFiles: number;       // 飛車オープンファイル差
  pieceSafety: number;     // タダ取り・損な交換差
  promotionThreats: number; // 成り込み脅威差
  tempo: number;           // 手番ボーナス (currentPlayer == sente ? +15 : -15)
}

export function evaluateWithBreakdown(
  state: GameState,
  variant: RuleVariant = STANDARD_VARIANT,
): EvaluationBreakdown {
  // evaluate 本体と同じ計算を分解して返す。
  // total === evaluate(state, variant) を fixture で検証する。
}
```

**用途 (N-3 対応)**: `evaluateWithBreakdown` は **debug 専用**。本番探索ホットパス (negamax / quiescence 内の評価呼出) では呼ばれない (= 計算コスト 2 倍化を許容、debug build / `DEBUG_AI_EVAL` env 等で有効化する想定。本番有効化は親計画 md L386 PR2 セクションに記載)。

**DoD**: `evaluateWithBreakdown(state, variant).total === evaluate(state, variant)` が 1000 局面で完全一致。

### `scripts/gen-fixture-evaluate.ts` 設計

**機能**:
- 1000 局面を以下のミックスで生成 (variant 分布を明示、X-3 対応):
  - **standard variant: 800 局面** (opening 160 / midgame 320 / endgame 160 / random 160)
  - **card-shogi variant: 200 局面** (opening 40 / midgame 80 / endgame 40 / random 40)
  - phase 内訳: opening (序盤、moveCount 0-15) / midgame (中盤、moveCount 15-50) / endgame (終盤、moveCount 50+) / random (構造化乱数局面)
  - card-shogi 200 局面を含めることで「将来 cardDigest 加算で evaluate 戻り値が変動するケース」のデグレ検知に対応 (PR1d 着手時に再生成 → 新基準として固定)
- 各局面で `evaluate(state, variant)` を呼んで評価値を計算 → JSON に保存
- 出力: `src/lib/shogi/ai/__tests__/fixtures/evaluate-baseline.json`
- 形式: `{ version: "1.0", entries: [{ id, sfen?, state, variantId, expected }] }`
  (`generatedAt` は別ファイル `evaluate-baseline.meta.json` に分離 — Y-2 対応)

**乱数 seed 管理 (X-2 対応、Mulberry32 採用)**:

- JavaScript 組込 `Math.random` は seed 指定不可のため、自前 PRNG (Mulberry32) を採用 (外部依存追加なし、AGENTS.md ルール 7 と整合)
- 共有モジュール `scripts/utils/prng.ts` を **PR1b で先行新設**、PR1c は import のみ
- 実装イメージ:
  ```ts
  // scripts/utils/prng.ts (10 行程度)
  export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  ```
- 使用方法: `const rng = mulberry32(42); const r = rng();` で 0-1 の乱数を deterministic に取得
- script に `--seed=N` フラグでオーバーライド可 (デフォルト `seed = 42`)
- 後続 PR (PR1c-2 strategy fixture / PR1d cardDigest fixture / PR2 evaluate fixture 再生成 / 観戦モード基準 fixture) でも `scripts/utils/prng.ts` を共有

**実装の慣習**: 既存 `scripts/bench-ai.ts` (tsx 形式) を参考。**局面の合法性保証 / fixture JSON serialize 方針** は本ファイル冒頭「## 共通設計指針 — PR1b/PR1c の fixture 生成共通仕様 (Z-5/Z-6 対応)」セクション参照 (PR1b の random walk 生成にも同じ方針を適用)。

### `evaluate-equivalence.test.ts` 設計

```ts
import baseline from "./fixtures/evaluate-baseline.json";

describe("evaluate: byte-level equality (PR1c 振る舞いキープ)", () => {
  it("1000 局面で fixture と完全一致", () => {
    for (const entry of baseline.entries) {
      const variant = getVariantById(entry.variantId);
      expect(evaluate(entry.state, variant)).toBe(entry.expected);
    }
  });

  it("evaluateWithBreakdown.total が evaluate と一致", () => {
    for (const entry of baseline.entries) {
      const variant = getVariantById(entry.variantId);
      const breakdown = evaluateWithBreakdown(entry.state, variant);
      expect(breakdown.total).toBe(entry.expected);
    }
  });
});
```

### `package.json` 追加

```json
{
  "scripts": {
    "gen:fixture:evaluate": "tsx scripts/gen-fixture-evaluate.ts"
  }
}
```

### 検証

```bash
npm run gen:fixture:evaluate   # 初回 fixture 生成
npm run lint
npm run typecheck
npm run test:ci                # 1000 局面 byte-level equality 緑
npm run build
```

**重要**: PR1c では **既存 `evaluate(state, variant)` の戻り値が 1 cp も変わらない** ことを最重要 DoD とする。export 追加と `evaluateWithBreakdown` の新設のみで、本体ロジックは一切変更しない。

### PR1c の DoD まとめ

- [ ] `evaluate.ts` の 5 関数 (`evaluatePieceSafety` / `evaluatePromotionThreats` / `evaluateKingSafety` / `evaluateCastle` / `evaluateRookFiles`) が export されている
- [ ] `evaluateWithBreakdown(state, variant)` が新設され、`total === evaluate(state, variant)` を満たす
- [ ] `scripts/gen-fixture-evaluate.ts` が新規追加、`npm run gen:fixture:evaluate` で 1000 局面 fixture を再生成可能
- [ ] 1000 局面 fixture で byte-level equality (1 cp の差なし) を検証
- [ ] `package.json` に `gen:fixture:evaluate` script 追加
- [ ] lint / typecheck / test:ci / build すべてパス
- [ ] Vercel preview deploy で実機動作確認 (棋力デグレなし)

---

## ブランチ運用と push 手順

### PR1b

```bash
git checkout -b feature/#193-pr1b origin/main
# 実装・テスト・コミット
npm run lint && npm run typecheck && npm run test:ci && npm run build
git push -u origin feature/#193-pr1b
# AGENTS.md ルール 1: PR 作成・マージは明示指示まで実施しない (push のみ完了)
```

### PR1c (PR1b 非依存、`origin/main` 直派生)

```bash
git checkout main
git fetch origin
git checkout -b feature/#193-pr1c origin/main
# 実装・テスト・コミット
npm run gen:fixture:evaluate   # fixture 初回生成
npm run lint && npm run typecheck && npm run test:ci && npm run build
git push -u origin feature/#193-pr1c
```

**重要**: PR1c は PR1b に依存しないため、`origin/main` から直接派生する。PR1b マージ前でも PR1c は独立して push 可能。

---

## コミットメッセージ規約 (AGENTS.md ルール 7)

- 日本語、第三者にも分かる粒度で「なぜ」重視
- フックスキップ禁止 (`--no-verify` は明示指示時のみ)
- 末尾に `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`

例:

```
feat: #193-PR1b Phase 3 探索専用 legal moves 分離

src/lib/shogi/ai/legal-moves.ts を新設し、getSearchLegalMoves を
getFullLegalMoves の wrap として export。後続 PR で探索ホットパス用に
枝刈り等を加える余地を作る (現時点は透過的)。

search.ts の 3 箇所 (quiescence L238 / negamax L339 / findBestMove L512) を
置換、200-300 局面 fixture で出力 set 完全一致を検証。

検証: lint / typecheck / test:ci / build すべてパス、Vercel preview deploy 確認

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## 重要マイルストーン (AGENTS.md ルール 8 = Issue #109 観点レビュー)

各 PR で 3 段階レビュー:

1. **計画策定後** (本フェーズ計画 md = 本ファイル) → **本フェーズ Phase 0 で別レビュワーレビュー実施 (進行中)**
2. **実装完了後** (push 前) → lint / typecheck / test:ci / build を実行 + 親計画 md / 進行中チェックリスト 19 件と照合
3. **マージ前** (ユーザーレビュー) → Vercel preview で実機検証 + ユーザー確認

---

## 進行中チェックリスト 19 件 + 第 1 次レビュー新規追加項目で本フェーズ対応 (Y-3 対応で分類整理)

PR1b/PR1c は **アーキ刷新の足場 PR** で振る舞いを変えないため、進行中チェックリストの大半は対応スコープ外 (PR1c-2 / PR1d / PR2 で対応)。

### A. 進行中チェックリスト 19 件由来 ([#issuecomment-4414636364](https://github.com/ryuichiTtb/Shogi/issues/193#issuecomment-4414636364))

本フェーズで再確認すべき項目:

- ✅ **G-4 (fixture 生成の CI 分離)**: `npm run gen:fixture:legal-moves` / `gen:fixture:evaluate` は手動実行を前提、CI で fixture 再生成は走らせない (生成済 JSON を git 管理して CI は読込のみ)
- ⚠️ **D-5 (fixture 再生成トリガー条件)**: `gen-fixture-legal-moves.ts` / `gen-fixture-evaluate.ts` のヘッダコメントに「再生成すべきタイミング」を明記
  - `gen-fixture-legal-moves.ts`: PR1b 後の最適化時 / `moves.ts` 改修時
  - `gen-fixture-evaluate.ts`: PR2 評価関数モジュール本体分離時 / PR1d で cardDigest 加算が evaluate 戻り値に影響する場合

### B. 第 1 次レビュー新規追加 ([#issuecomment-4415518533](https://github.com/ryuichiTtb/Shogi/issues/193#issuecomment-4415518533))

第 1 次レビューで本フェーズ計画 md に新規追加された項目 (進行中チェックリスト 19 件には含まれない):

- ✅ **M-5 (`evaluate-equivalence.test.ts` の CI 対象判断)**: **CI 対象とする**。理由は以下:
  - 1000 局面 × `evaluate` 呼出の実行時間は数秒程度の見込み (bench 系 = 3.5 秒 × 50 局面 × 4 難易度 ≒ 数分と比べて軽量)
  - 全 PR でデグレ自動検知できるメリットが大きい (PR1c-2 / PR1d / PR2 で意図せず evaluate 戻り値が変わるケースを CI で即時検知)
  - bench 系 (`perf-bench*.test.ts` / `strategy-equivalence.test.ts` 180 局面、CI 対象外) との区別: bench 系は `findBestMoveWithStats` を実時間で呼ぶため遅い vs `evaluate` は単発関数呼出で軽量
  - PR1c 実装時に実行時間を計測し、想定 (数秒) を大幅に超えた場合 (例: 30 秒以上) は CI 対象外への分離を検討
  - 詳細指針: `evaluate-equivalence.test.ts` の冒頭コメントに「本 fixture は CI 対象。実行時間が CI 全体で目立つようになった場合は別カテゴリ (`@perf` 等) に分離検討」を明記

### C. PR1c-2 着手前に対応する項目 (本フェーズでは対応不要、メモのみ)

- A-2 / A-3 / B-1 (PR1c-2 着手前)
- C-1 (観戦モード基準 fixture 生成、PR1c-2 着手前)
- F-3 (`isAiThinking` ⇔ `isPaused` 相互作用、PR1c-2 着手時に再確認)
- F-4 / F-5 (PR1d-1 着手時)

---

## 運用注意書き — Issue / PR コメント参照時の comment_id 取得ルール (Z-1 対応、第 3 次レビュー)

**背景**: 本フェーズのレビューサイクルで、レビュー報告コメントを参照する際に `comment_id` の誤記が **3 サイクル連続で再発** した (M-3 / X-1 / Z-1)。原因は AI が 10 桁の数字 id を短期記憶でタイプしていたため。

**運用ルール (本フェーズ以降の全 PR / 全レビューサイクルで踏襲)**:

1. **正しい comment_id は `gh api` コマンドで取得し、推測タイプは禁止**:
   ```bash
   gh api repos/:owner/:repo/issues/<n>/comments --jq '.[] | {id, created_at, length: (.body | length)}'
   ```
   出力の `id` フィールドを **コピペ** で使用 (タイプし直さない)。
2. **代替手段**: GitHub UI でコメントの「...」メニュー → 「Copy link」で URL 全体をコピペ
3. **参照前のセルフチェック**: コメント参照前に `gh api repos/:owner/:repo/issues/comments/<id>` で 200 が返ることを確認 (404 なら誤り)
4. **計画 md / Issue コメントへの記述時**: 同じ comment_id を別箇所で複数回参照する場合、**最初の 1 回だけ手作業**、以降はファイル内 grep / Edit replace_all で複製 (タイプを増やさない)

**過去の誤記履歴 (再発防止のための記録)**:

| サイクル | 誤った id | 正しい id | 検知 |
|---------|----------|----------|------|
| 第 1 次 M-3 | `4415459081` | `4415458652` | レビューで指摘 |
| 第 2 次 X-1 | `4415512049` | `4415518533` | レビューで指摘 |
| 第 3 次 Z-1 | `4415540843` | `4415542513` | レビューで指摘、本セクション追加で再発防止 |

---

## 参照ファイル

- 親計画 md (正本): [docs/plans/issue-193.md](issue-193.md) (740 行)
  - PR1b 詳細: L259-281
  - PR1c 詳細: L283-305
- 引き渡しガイド: [Issue #193 #issuecomment-4415458652](https://github.com/ryuichiTtb/Shogi/issues/193#issuecomment-4415458652)
- 進行中チェックリスト 19 件: [Issue #193 #issuecomment-4414636364](https://github.com/ryuichiTtb/Shogi/issues/193#issuecomment-4414636364)
- 関連実装ソース:
  - `src/lib/shogi/moves.ts` L439-449 (`getFullLegalMoves`)
  - `src/lib/shogi/ai/search.ts` L238 / L339 / L512 (置換 3 箇所)
  - `src/lib/shogi/ai/evaluate.ts` L383 / L426 / L544 / L592 / L675 (export 対象 5 関数) / L712 (`evaluate` 本体)
  - `scripts/bench-ai.ts` (tsx 慣習の参考)
  - `src/lib/shogi/ai/__tests__/strategy-equivalence.test.ts` (PR1a で確立した test 構造)
  - `package.json` scripts (`tsx scripts/...` 慣習)

---

## 想定スケジュール (目安)

| Phase | 作業 | 想定時間 |
|-------|------|---------|
| **Phase 0** | 本フェーズ計画 md (`docs/plans/issue-193-pr1b-pr1c.md`) 作成 + push + Issue コメント | 30-60 分 |
| **Phase 0** | 別レビュワーレビュー反映 (**1-4 サイクル想定**、PR1a で 4 サイクル運用を踏まえ複数サイクルを許容 — Y-1 対応) | レビュー時間に依存 |
| PR1b | ブランチ作成 + legal-moves.ts 新設 | 30 分 |
| PR1b | search.ts 3 箇所置換 (L3 import 含む) | 15 分 |
| PR1b | `scripts/utils/prng.ts` (Mulberry32) 新設 (Z-2 対応で script 化方針反映) | 15 分 |
| PR1b | `scripts/gen-fixture-legal-moves.ts` 実装 (template 5 パターン + random walk 2 パターン、合法性保証 + status filter) | 1-2 時間 |
| PR1b | `legal-moves.test.ts` 実装 (二重ガード) + `legal-moves-baseline.json` 初回生成 | 30 分 |
| PR1b | `package.json` に `gen:fixture:legal-moves` script 追加 | 5 分 |
| PR1b | 必須チェック + 修正 + push | 30 分 |
| PR1c | ブランチ作成 + evaluate.ts export 化 | 20 分 |
| PR1c | evaluateWithBreakdown 実装 | 1 時間 |
| PR1c | gen-fixture-evaluate.ts 実装 | 1-2 時間 |
| PR1c | evaluate-equivalence.test.ts 実装 | 30 分 |
| PR1c | fixture 初回生成 + 必須チェック + 修正 + push | 1 時間 |
| **合計 (実装のみ)** | | **7-9 時間** |
| **合計 (Phase 0 含む)** | | **7-10 時間 + レビュー待ち** |

並行着手のため両 PR を本セッションで完成させる想定だが、PR1c の fixture 生成で 1 cp ずれが見つかった場合は調査時間が追加で必要 (本来は wrap だけで済むはずだが、念のため余裕を持つ)。

**Phase 0 を先行**することで、別レビュワーから「PR1b の fixture スコープ過剰/不足」「PR1c の breakdown 構造異論」等の指摘があれば、実装着手前に手戻りを回避できる。PR1a で 4 サイクルレビュー累計 43 件を反映した品質を、PR1b/PR1c でも継承する運用。

---

## レビュー観点 (別レビュワー向け)

本フェーズ計画 md のレビューでは特に以下を厳しく評価いただきたい。Issue #109 共通レビュールール準拠。

1. **PR1b スコープの妥当性**: 200-300 局面 fixture のカバレッジは十分か、不足/過剰なパターンはないか
2. **PR1c の 1 cp ずれ厳禁担保策**: export 追加と `evaluateWithBreakdown` 新設のみで本当に評価値が変わらないか、見落としがないか
3. **fixture 生成戦略 (Z-3 反映で記述更新)**: PR1b/PR1c 両方とも script 化で**慣習統一**の方針は適切か、`scripts/gen-fixture-legal-moves.ts` / `gen-fixture-evaluate.ts` の設計 (Mulberry32 seed 管理 / 局面ミックス / 合法性保証 (random walk + status filter)) は妥当か、`scripts/utils/prng.ts` を PR1b で先行新設して PR1c が import する依存関係は妥当か
4. **ブランチ運用**: PR1b と PR1c を同セッションで両方完成させる方針 + `origin/main` 直派生は AGENTS.md と整合するか
5. **進行中チェックリスト 19 件 + 第 1 次レビュー新規追加 + 第 2 次レビュー新規追加との整合**: A (進行中チェックリスト由来 G-4 / D-5) / B (第 1 次レビュー新規 M-5) / C (PR1c-2 着手前メモ) の分類で妥当か、見落としはないか
6. **後続 PR への影響**: 本フェーズ成果物 (`getSearchLegalMoves` / `evaluateWithBreakdown` / `gen-fixture-evaluate.ts`) が PR1c-2 / PR1d / PR2 で正しく再利用できる設計か

レビュー指摘があれば本ファイル (`docs/plans/issue-193-pr1b-pr1c.md`) を改訂 → 再 push → 再レビューのサイクルで進める (PR1a の 4 サイクル運用と同じ)。

---

## 第 3 次レビュー指摘の反映履歴 ([#issuecomment-4415759175](https://github.com/ryuichiTtb/Shogi/issues/193#issuecomment-4415759175))

第 3 次レビュー (Must-fix 1 件 + Should-fix 3 件 + Nice-to-have 2 件 = 計 6 件) を全件反映済 (本改訂版):

| # | カテゴリ | 指摘 | 反映箇所 |
|---|---------|------|---------|
| **Z-1** | **Must** | comment_id 誤記の **3 サイクル連続再発** | (1) `4415540843` → `4415542513` に訂正、(2) **新セクション「運用注意書き」を計画 md に追加** (`gh api` コマンドで取得した正確な id を使用、推測タイプ禁止)、(3) 過去 3 サイクルの誤記履歴を表として記録 (再発防止のためのトレース) |
| **Z-2** | Should | 想定スケジュール「hardcode」表記が方針変更を反映していない | スケジュール表 PR1b 行を 4 行に分割: (1) ブランチ + legal-moves.ts、(2) search.ts 置換、(3) `prng.ts` 新設、(4) `gen-fixture-legal-moves.ts` 実装、(5) `legal-moves.test.ts` + 初回生成、(6) `package.json`、(7) 必須チェック + push |
| **Z-3** | Should | レビュー観点「使い分け」表記が方針変更を反映していない | レビュー観点 3 を「**慣習統一の妥当性**」に修正、`scripts/utils/prng.ts` 先行新設の依存関係も観点に追加 |
| **Z-4** | Should | 影響ファイル `legal-moves.test.ts` 説明の精度 | **二重ガード明示**: (1) fixture と `getSearchLegalMoves` の出力 set 一致、(2) test 実行時に `getFullLegalMoves` を再計算して直接一致 |
| **Z-5** | Nice | fixture JSON serialize 方針が PR1c 専用 | **新セクション「## 共通設計指針 — PR1b/PR1c の fixture 生成共通仕様」を計画冒頭に追加**、両 script で同じ serialize 方針を共有 |
| **Z-6** | Nice | 局面合法性保証も PR1c 専用 | Z-5 と同じ共通設計指針セクションに集約 (二段ガード = random walk + status filter) |

---

## 第 2 次レビュー指摘の反映履歴 ([#issuecomment-4415542513](https://github.com/ryuichiTtb/Shogi/issues/193#issuecomment-4415542513))

第 2 次レビュー (Should-fix 5 件 + Nice-to-have 4 件 = 計 9 件) を全件反映済 (本改訂版):

| # | 指摘 | 反映箇所 |
|---|------|---------|
| **X-1** | comment_id 誤記の再発 | `4415512049` → `4415518533` に訂正 |
| **X-2** | random walk seed 管理方法 | **Mulberry32 (自前 PRNG) を採用**、`scripts/utils/prng.ts` に 10 行実装で集約、PR1b/PR1c 両方で共有、後続 PR の fixture 生成でも再利用 |
| **X-3** | 1000 局面の variant 分布 | standard 800 局面 / card-shogi 200 局面に明示、各 phase 内訳も記載 |
| **X-4** | PR1b の hardcode 現実性 | **PR1b も script 化に方針変更**、`scripts/gen-fixture-legal-moves.ts` 新設、template ベース + random walk で 200-300 局面生成 |
| **X-5** | PR1b と PR1c の慣習不統一 | 両者とも script + JSON + Mulberry32 で慣習統一、親計画 md L568-571 の 4 種 (`gen:fixture:legal-moves` / `evaluate` / `strategy` / `spectator`) と整合 |
| **Y-1** | Phase 0 サイクル数 | 「**1-4 サイクル想定**、PR1a で 4 サイクル運用を踏まえ複数サイクルを許容」に明示 |
| **Y-2** | fixture JSON `generatedAt` の CI 差分対策 | `generatedAt` を別ファイル (`legal-moves-baseline.meta.json` / `evaluate-baseline.meta.json`) に分離 |
| **Y-3** | 進行中チェックリストと第 1 次レビュー新規追加の分類整理 | 「進行中チェックリスト」セクションを A (進行中チェックリスト 19 件由来) / B (第 1 次レビュー新規追加) / C (PR1c-2 着手前に対応) の 3 セクションに分割整理 |
| **Y-4** | 集約 Issue #190 / #76 の現状 state | 「Issue #193 リオープン後の運用方針」セクションに「本フェーズ着手時点 (2026-05-10) で Issue #190 / #76 は両方とも open 確認済」を追記 |

---

## 第 1 次レビュー指摘の反映履歴 ([#issuecomment-4415518533](https://github.com/ryuichiTtb/Shogi/issues/193#issuecomment-4415518533))

第 1 次レビュー (Should-fix 5 件 + Nice-to-have 3 件 = 計 8 件) を全件反映済 (本改訂版):

| # | 指摘 | 反映箇所 |
|---|------|---------|
| **M-1** | search.ts L3 import 文更新漏れ | PR1b 影響ファイル表で「`getFullLegalMoves` を import から削除、`getSearchLegalMoves` を新規 import」を明示 |
| **M-2** | Issue #193 リオープン後の運用 | 新セクション「Issue #193 リオープン後の運用方針」追加。PR1b 以降で `Closes #193` 不記載・最終クローズはユーザー指示まで保留 |
| **M-3** | comment_id 誤記訂正 | `4415459081` → `4415458652` に訂正 |
| **M-4** | random 200 局面の合法性保証 | `gen-fixture-evaluate.ts` 設計に「局面の合法性保証 (random walk + status filter)」セクション追加 |
| **M-5** | `evaluate-equivalence.test.ts` の CI 対象判断 | **CI 対象とする** (1000 局面 × evaluate 呼出は数秒程度想定、bench 系より軽量、デグレ自動検知メリット大)。進行中チェックリストの M-5 項目に判断根拠を明示 |
| **N-1** | 「並行」と「同セッション完成」の用語整理 | 「並行」用語整理セクション追加。**依存関係: 並行可** vs **進行手順: 同セッション内で順次** を区別 |
| **N-2** | fixture JSON serialize 方針 | `gen-fixture-evaluate.ts` 設計に「fixture JSON serialize 方針 (型アサーションで復元、prototype 復元不要)」セクション追加 |
| **N-3** | `evaluateWithBreakdown` の用途 (debug 専用) | `evaluateWithBreakdown` 新設セクションに「用途: debug 専用、本番探索ホットパスでは呼ばれない」明記 |
