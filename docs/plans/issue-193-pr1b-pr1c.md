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
| fixture 生成戦略 | **親計画 md 準拠** (PR1b: test ファイル内 hardcode 200-300 局面 / PR1c: `scripts/gen-fixture-evaluate.ts` で 1000 局面生成 + JSON 化) |
| ブランチ運用 | **単一ブランチ × 2** (`feature/#193-pr1b` と `feature/#193-pr1c`、それぞれ `origin/main` 起点で作成) |
| Worktree | 使用しない (本ディレクトリでブランチ切替) |
| マージ | **明示指示まで実施しない** (AGENTS.md ルール 1)。push まで完了して止まる |

### fixture 生成戦略の根拠 (なぜ計画 md 準拠か)

- PR1b は wrap だけなので 200-300 局面 hardcode で十分 (`legal-moves.test.ts` ファイル 1 つで完結)
- PR1c は 1000 局面が必要で **hardcode 不可能** → script 化が必須
- PR1c で整備した `scripts/gen-fixture-evaluate.ts` は **PR2 (評価関数モジュール実体分離) で再利用される** (= 投資が無駄にならない)
- PR1c-2 / PR2 / PR1d で観戦モード基準 fixture / strategy fixture も script 化が必要 → fixture 生成パターンを PR1c で確立しておくと、後続 PR で慣習が継承される

### 「並行」の用語整理 (N-1 対応)

「並行」と「同セッション完成」を区別する:

- **依存関係: 並行可** — PR1b と PR1c は両者 `origin/main` 直派生で **互いに独立**。PR1c は PR1b マージ前でも push 可能 (依存関係的に制約なし)
- **進行手順: 同セッション内で順次** — 本セッションでは PR1b → PR1c の順で実装する (時間的に直列、想定スケジュール参照)。これは「依存関係の並行」と「実装作業の並行」を区別した運用

これにより、レビュー粒度は PR ごとに分離され、デグレ発生時の切り分けも容易。

---

## Issue #193 リオープン後の運用方針 (M-2 対応)

PR #202 マージ時に Issue #193 が GitHub の自動クローズで一旦クローズされたが、本フェーズ着手前にユーザーがリオープン済 (本 Issue は PR1a〜PR6 = 計 11 PR の親 Issue で、PR1b 以降も継続中)。

**運用ルール**:

1. **PR1b/PR1c 以降の PR description で `Closes #193` は記述しない** (記述すると再度自動クローズが発生し、リオープン手間が増える)
   - 代わりに「Related: #193」「Issue #193 PR1b」等の参照表記を使用
2. **本 Issue の最終クローズは PR6 完了後にユーザー明示指示でのみ実施** (AGENTS.md ルール 1 遵守)
3. 集約 Issue (#190 / #76) も同様に、本 Issue 全 PR 完了時のユーザー明示指示でのみクローズ

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
| 新規 | `src/lib/shogi/ai/__tests__/legal-moves.test.ts` | 200-300 局面 hardcode fixture で出力 set 完全一致を検証 |
| 編集 | `src/lib/shogi/ai/search.ts` | 3 箇所の `getFullLegalMoves` 呼出を `getSearchLegalMoves` に置換、**L3 import 文から `getFullLegalMoves` を削除** (置換完了後は使用 0 件、`isInCheck` のみ残す)、新規 import で `getSearchLegalMoves` を `./legal-moves` から取込 — M-1 対応 |

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

### `legal-moves.test.ts` fixture スコープ (200-300 局面 hardcode)

親計画 md L270-274 に従い、以下のパターンを網羅:

1. **駒種 8 種 × 成り駒 6 種 × 成りゾーン進入境界** (~40 局面)
2. **王手中の合駒・回避** (打ち歩詰め禁則含む、~40 局面)
3. **ピン駒** (飛角香の利き上の自駒、~30 局面)
4. **持ち駒の打ちたて** (二歩禁、行きどころなし、打ち歩詰め、~50 局面)
5. **王手放置の自殺手禁止** (~30 局面)
6. **平凡な中盤・終盤局面** (バランス用、~50 局面)
7. **card-shogi 局面** (variant 引数の動作確認、~20 局面)

**DoD**: 各局面で `getSearchLegalMoves(state, player, variant)` の出力 set が `getFullLegalMoves(state, player, variant)` の出力 set と完全一致 (Set 比較)。

### 検証

```bash
npm run lint        # PR1b 起因 warning 0 件目標
npm run typecheck   # PR1b 起因エラー 0 件目標
npm run test:ci     # 既存 311 テスト + 新 legal-moves.test.ts 全件緑
npm run build       # ✓ Compiled successfully
```

### PR1b の DoD まとめ

- [ ] `legal-moves.ts` の `getSearchLegalMoves` が export されている
- [ ] `search.ts` の `getFullLegalMoves` 直接呼出が **0 件** (3 箇所すべて置換済)
- [ ] 200-300 局面 fixture が緑、`getSearchLegalMoves(state, player, variant)` の出力 set が `getFullLegalMoves` と完全一致
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
- 1000 局面を以下のミックスで生成:
  - opening (序盤、moveCount 0-15): 200 局面
  - midgame (中盤、moveCount 15-50): 400 局面
  - endgame (終盤、moveCount 50+): 200 局面
  - random (構造化乱数局面): 200 局面
- 各局面で `evaluate(state, variant)` を呼んで評価値を計算 → JSON に保存
- 出力: `src/lib/shogi/ai/__tests__/fixtures/evaluate-baseline.json`
- 形式: `{ version: "1.0", generatedAt: "ISO date", entries: [{ id, sfen?, state, variantId, expected }] }`

**乱数 seed 管理**:
- 再現性のため deterministic seed を使用 (例: `seed = 42`)
- script に `--seed=N` フラグでオーバーライド可

**実装の慣習**: 既存 `scripts/bench-ai.ts` (tsx 形式) を参考。

**局面の合法性保証 (M-4 対応)**:

`evaluate(state, variant)` は以下の特殊値を返す ([evaluate.ts:716-719](https://github.com/ryuichiTtb/Shogi/blob/main/src/lib/shogi/ai/evaluate.ts#L716-L719)):
- `state.status === "checkmate"` → **±100000** (手番側勝ち / 負け)
- `state.status !== "active"` (resign / repetition / impasse 等) → **0**

このため、不正・特殊状態の局面が混入すると **fixture が「特殊値のみで意味のない検証」になるリスク**がある。以下の 2 段階で合法性を保証する:

1. **random walk で生成** (主):
   - 初期局面 (`createInitialGameState`) からランダムに合法手を打って到達した局面のみ採用
   - 各 phase の moveCount 範囲 (opening 0-15 / midgame 15-50 / endgame 50+) は walk 手数で制御
   - 合法手は `getFullLegalMoves(state, player, variant)` から deterministic seed で 1 手選択
   - 詰み・千日手・ステールメイトに到達した時点で打ち切り、その手前の active 局面を採用

2. **`state.status === "active"` filter** (念のため):
   - 生成後に `state.status === "active"` を検証し、満たさない局面は除外して再生成
   - 二重ガードとして機能 (random walk が想定外の終局状態に到達した場合の保険)

**fixture JSON serialize 方針 (N-2 対応)**:

`state` (= `GameState`) を JSON.stringify する際、`board: Piece[][]` / `hand: HandState` 等の構造化型はプレーンオブジェクト化される。TypeScript の `interface` はランタイム情報を持たないため:

- **serialize**: `JSON.stringify(state)` で直接 (board や hand の prototype 不要)
- **deserialize**: 型アサーション `as GameState` で復元 (Piece クラスの new 呼出は不要、prototype 復元処理も不要)
- 既存 `serializeGameState` / `deserializeGameState` ([src/lib/shogi/board.ts](https://github.com/ryuichiTtb/Shogi/blob/main/src/lib/shogi/board.ts)) が利用可能なら優先使用 (Game レコード保存時の慣習)

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

## 進行中チェックリスト 19 件 ([Issue #193 #issuecomment-4414636364](https://github.com/ryuichiTtb/Shogi/issues/193#issuecomment-4414636364)) のうち本フェーズで対応すべき項目

PR1b/PR1c は **アーキ刷新の足場 PR** で振る舞いを変えないため、進行中チェックリストの大半は対応スコープ外 (PR1c-2 / PR1d / PR2 で対応)。本フェーズで再確認すべきは以下のみ:

- ✅ **G-4 (fixture 生成の CI 分離)**: `npm run gen:fixture:evaluate` は手動実行を前提、CI で fixture 再生成は走らせない (生成済 JSON を git 管理して CI は読込のみ)
- ✅ **M-5 (`evaluate-equivalence.test.ts` の CI 対象判断)**: **CI 対象とする**。理由は以下:
  - 1000 局面 × `evaluate` 呼出の実行時間は数秒程度の見込み (bench 系 = 3.5 秒 × 50 局面 × 4 難易度 ≒ 数分と比べて軽量)
  - 全 PR でデグレ自動検知できるメリットが大きい (PR1c-2 / PR1d / PR2 で意図せず evaluate 戻り値が変わるケースを CI で即時検知)
  - bench 系 (`perf-bench*.test.ts` / `strategy-equivalence.test.ts` 180 局面、CI 対象外) との区別: bench 系は `findBestMoveWithStats` を実時間で呼ぶため遅い vs `evaluate` は単発関数呼出で軽量
  - PR1c 実装時に実行時間を計測し、想定 (数秒) を大幅に超えた場合 (例: 30 秒以上) は CI 対象外への分離を検討
  - 詳細指針: `evaluate-equivalence.test.ts` の冒頭コメントに「本 fixture は CI 対象。実行時間が CI 全体で目立つようになった場合は別カテゴリ (`@perf` 等) に分離検討」を明記
- ⚠️ **D-5 (fixture 再生成トリガー条件)**: `gen-fixture-evaluate.ts` のヘッダコメントに「再生成すべきタイミング (PR2 評価関数モジュール本体分離時、PR1d で cardDigest 加算が evaluate 戻り値に影響する場合)」を明記

PR1c-2 着手前に対応する項目 (本フェーズでは対応不要、メモのみ):
- A-2 / A-3 / B-1 (PR1c-2 着手前)
- C-1 (観戦モード基準 fixture 生成、PR1c-2 着手前)
- F-3 (`isAiThinking` ⇔ `isPaused` 相互作用、PR1c-2 着手時に再確認)
- F-4 / F-5 (PR1d-1 着手時)

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
| **Phase 0** | 別レビュワーレビュー反映 (1 サイクル想定、必要なら追加サイクル) | レビュー時間に依存 |
| PR1b | ブランチ作成 + legal-moves.ts 新設 | 30 分 |
| PR1b | search.ts 3 箇所置換 | 15 分 |
| PR1b | legal-moves.test.ts 200-300 局面 hardcode | 2-3 時間 |
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
3. **fixture 生成戦略**: PR1b hardcode / PR1c script 化の使い分けは適切か、`scripts/gen-fixture-evaluate.ts` の設計 (乱数 seed 管理 / 局面ミックス / 合法性保証) は妥当か
4. **ブランチ運用**: PR1b と PR1c を同セッションで両方完成させる方針 + `origin/main` 直派生は AGENTS.md と整合するか
5. **進行中チェックリスト 19 件との整合**: 本フェーズで対応すべき項目 (G-4 / D-5 / M-5) の判断は妥当か、見落としはないか
6. **後続 PR への影響**: 本フェーズ成果物 (`getSearchLegalMoves` / `evaluateWithBreakdown` / `gen-fixture-evaluate.ts`) が PR1c-2 / PR1d / PR2 で正しく再利用できる設計か

レビュー指摘があれば本ファイル (`docs/plans/issue-193-pr1b-pr1c.md`) を改訂 → 再 push → 再レビューのサイクルで進める (PR1a の 4 サイクル運用と同じ)。

---

## 第 1 次レビュー指摘の反映履歴 ([#issuecomment-4415512049](https://github.com/ryuichiTtb/Shogi/issues/193#issuecomment-4415512049))

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
