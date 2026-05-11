# Issue #193 PR1c-2 (Strategy 再集約 refactor) + R-4 対応計画

本フェーズ計画 md。Issue #193 段階的実装の **PR1a/PR1b/PR1c (マージ済) → PR1c-2 (Strategy 再集約 refactor) + R-4 (PR1b/PR1c 計画 md 訂正)** の実装方針を整理する。実装着手前に別レビュワーレビューを受けて確定させる目的のドキュメント (AGENTS.md ルール 8: 重要マイルストーン 3 段階レビューの第 1 段階「実装計画策定後」)。

---

## Context

Issue #193 (AI/CPU アーキ刷新 + カード戦略統合 + CPU vs CPU 観戦) の段階的実装計画 (PR1a〜PR1e + PR2-6 = 計 11 PR) のうち、**3 PR が main にマージ済**:

- PR1a: [95d49ce](https://github.com/ryuichiTtb/Shogi/commit/95d49ce) (#202) + [f603c50](https://github.com/ryuichiTtb/Shogi/commit/f603c50) (#203)
- PR1b: [ba0080f](https://github.com/ryuichiTtb/Shogi/commit/ba0080f) (#204)
- PR1c: [7af6813](https://github.com/ryuichiTtb/Shogi/commit/7af6813) (#205)

本フェーズでは **PR1c-2 (Strategy 再集約 refactor) + R-4 (PR1b/PR1c 計画 md 訂正)** を 3 PR 構成で進める。両者の依存関係 (PR1c-2 マージ前後で R-4 を反映可能) は独立だが、関連派生作業として同時計画する。

### 各 PR の概要

| PR | スコープ | 規模 | デグレリスク | 主要 DoD |
|----|---------|------|--------------|----------|
| **Phase A** (`chore/#193-pr1c-2-fixture`) | Strategy fixture baseline 確立 (180 局面 + 観戦 4 シナリオ) + `gen-fixture-strategy.ts` 新設 | 小〜中 (2-3 日) | 低 (新規 fixture 追加) | `npm run gen:fixture:strategy` 成功 + `strategy-equivalence.test.ts` 緑 |
| **Phase B** (`refactor/#193-pr1c-2`) | engine.ts の DIFFICULTY_PARAMS 直接参照を Strategy 経由参照に切替 (振る舞いキープ) | 小 (1-2 日) | 中 (1 cp ずれ厳禁、advanced/expert) | 180 局面 fixture で advanced/expert 完全一致 + grep 0 件 |
| **Phase C** (`chore/#193-pr1b-pr1c-plan`) | R-4: PR1b/PR1c 計画 md の「template ベース」記述を実装方針に合わせて訂正 | 微小 (15-30 分) | 低 (ドキュメントのみ) | 「template ベース」記述が 0 件 (grep 確認) |

### 本フェーズの目的

1. **PR1d 着手前の土台仕上げ**: `addNoise` / `nearEqualThreshold` / `useBook` を Strategy 経由参照に切替え、PR1d で「キャラ別ロジック分岐」(例: `RyuouStrategy.shouldDraw(state, digest)`) を Strategy 内に閉じ込められる構造を確立
2. **振る舞いキープの fixture-driven 安全網確立**: PR1a 時点で生成と書かれていたが実態未生成だった 180 局面 fixture + 観戦モード基準 fixture を Phase A で確立
3. **計画 md 整合性回復 (R-4)**: PR1b/PR1c 計画 md の「template ベース」記述を実装方針 (random walk + accept フィルタ) に合わせて訂正

---

## Phase 1 調査で判明した親計画 md とのギャップ (本計画 md の肝)

`docs/plans/issue-193.md` L307-342 の PR1c-2 詳細セクションに対し、実態確認で以下のギャップを発見:

| # | 親計画 md の記述 | 実態 | 影響 |
|---|------------------|------|------|
| 1 | 「Strategy に 3 フィールド (addNoise / nearEqualThreshold / useBook) を取り込み」 | PR1a 時点で **既に取込済** (`SearchStrategy` interface に 8 フィールド保持) | Phase B のスコープが「Strategy への取込」ではなく「呼び出し側の置換」のみ |
| 2 | 「search.ts L674 の addNoise 直接参照を Strategy 経由に切替」 | 実態は **search.ts ではなく engine.ts 側の置換** (engine.ts L153/L190/L192/L193、search.ts は `SearchOptions` 経由で間接受領) | Phase B の置換箇所が engine.ts 4-5 箇所に確定 |
| 3 | 「PR1a 時点の strategy-equivalence.test.ts (180 局面: standard 100 + card-shogi 80) で完全一致を強制」 | **180 局面 fixture は未生成** (現状 90 行の最小限テスト = factory 動作確認 / targetReadingPly / パススルー / spectator timeLimitMs のみ) | Phase A で 180 局面 fixture を新規生成する必要 |
| 4 | 「観戦モード基準 fixture (PR1a 保存版) との一致」 | **`spectator-baseline.json` も未生成** | Phase A で観戦モード fixture も同時生成 |

### Phase 2 (批判的レビュー) で発見した重大論点

**最重要**: `search.ts:677` の `Math.random() < options.addNoise` は seed 制御不能。**beginner (addNoise=0.50) / intermediate (addNoise=0.10) で fixture 完全一致 DoD は原理的に達成不能**。これは親計画 md 策定時に見落とされた本質的な前提崩壊。

**対策**: addNoise=0 の advanced/expert のみ fixture 完全一致 DoD、beginner/intermediate は Strategy フィールド値検証で代用する 2 層構造を採用 (D-2 で詳述)。

### 親計画 md 自体への反映方針

本計画 md レビュー確定後、親計画 md (`docs/plans/issue-193.md`) L307-342 のギャップ箇所を訂正する派生対応も検討する (本フェーズ範囲外、別 chore PR 想定)。

---

## 着手方針 (確定事項)

| 項目 | 確定内容 |
|------|---------|
| 全体構成 | **3 PR 構成** (Phase A → Phase B → Phase C)、それぞれ独立 PR |
| Fixture と refactor の commit 分離 | **別 PR で先行マージ** (Phase A → Phase B)。fixture が「refactor 前の動作 baseline」であることを PR 履歴で証拠化 |
| addNoise 揺らぎ対策 | **advanced/expert のみ完全一致 DoD、beginner/intermediate は Strategy フィールド値検証** で代用 (2 層構造) |
| R-4 対応 | **別 PR (`chore/#193-pr1b-pr1c-plan` ブランチ再利用)** |
| route.ts 扱い | PR1c-2 では触らない (`findBestMoveWithStats` 内部に閉じる)、Strategy 経由切替は PR1d 以降 |
| `SearchOptions` 扱い | シグネチャ変更なし (最小変更、Strategy から値抽出して渡す案 (a) を採用) |
| `useBook` の variant ガード | engine.ts 側に残す (variant 判断は engine の責務、Strategy は character/difficulty の責務) |
| ブランチ運用 | 3 ブランチを別個に `origin/main` 起点で作成 (Phase B は Phase A マージ後) |
| Worktree | 使用しない (本ディレクトリでブランチ切替) |
| マージ | **明示指示まで実施しない** (AGENTS.md ルール 1)。各 PR push まで完了で止まる |

---

## Issue #193 リオープン後の運用方針 (継承)

PR1a/PR1b/PR1c 計画 md と同じ運用ルール:

1. **PR1c-2 以降の PR description で `Closes #193` は記述しない** (記述すると GitHub の自動クローズで Issue #193 がクローズされてしまう。本 Issue は PR6 完了後にユーザー明示指示でクローズ予定)
2. 集約 Issue (#190 / #76) も同様に、本 Issue 全 PR 完了時のユーザー明示指示でのみクローズ
   - **本フェーズ着手時点 (2026-05-11) で Issue #190 / #76 は両方とも `state: "open"` を確認済**

---

## 共通設計指針 (PR1b/PR1c から継承)

PR1b の `gen-fixture-legal-moves.ts` と PR1c の `gen-fixture-evaluate.ts` で確立した設計指針を、Phase A の `gen-fixture-strategy.ts` でも踏襲する。詳細は [PR1b/PR1c 計画 md](issue-193-pr1b-pr1c.md) の「## 共通設計指針 — PR1b/PR1c の fixture 生成共通仕様」参照。

要約:

1. **局面の合法性保証 (二段ガード)**: random walk で初期局面から合法手 walk + `state.status === "active"` filter
2. **fixture JSON serialize 方針**: `serializeGameState` / `deserializeGameState` ([board.ts:249, 259](../../src/lib/shogi/board.ts)) を流用、型アサーション `as GameState` で復元 (prototype 復元不要)
3. **fixture JSON 形式の統一**: `{ version: "1.0", entries: [{ id, state, ... , expected }] }` + `*-baseline.meta.json` で `generatedAt` 分離
4. **Mulberry32 seed 管理**: 共通 `scripts/utils/prng.ts` を import、デフォルト seed=42、`--seed=N` フラグでオーバーライド可

---

## Strategy 再集約方針 (Phase 1 調査反映、Phase B の核)

### engine.ts の DIFFICULTY_PARAMS 直接参照箇所 (置換マッピング)

Phase 1 調査で確認した engine.ts 4-5 箇所の置換イメージ:

| 箇所 | 現在 (params 直接参照) | Phase B 後 (Strategy 経由) | 備考 |
|------|------------------------|----------------------------|------|
| L141 (推定) | `params.timeLimitMs` | `strategy.timeLimitMs` | 観戦モード spectator override が既に Strategy 内で処理済 (Math.min) |
| L153 | `params.useBook && variant.id === "standard"` | `strategy.useBook && variant.id === "standard"` | variant ガードは engine.ts に残す |
| L190 | `params.maxDepth` | `strategy.maxSearchDepth` | フィールド名が異なる (Strategy は `maxSearchDepth`) |
| L192 | `params.addNoise` | `strategy.addNoise` | search.ts 内部の `Math.random() < options.addNoise` は無変更 |
| L193 | `params.nearEqualThreshold` | `strategy.nearEqualThreshold` | SearchOptions のシグネチャは無変更 (値だけ Strategy 由来) |

実装着手時に `grep -n "params\." src/lib/shogi/ai/engine.ts` で全箇所を再確認し、置換漏れを防ぐ。

### `findBestMoveWithStats` 内部での Strategy 生成

`findBestMoveWithStats` のシグネチャは無変更 (`(state, player, difficulty, variant, options, cardState?)`)。関数内部で `createStrategy(difficulty, { spectator })` を呼んで Strategy インスタンスを取得し、上記置換マッピングに従って参照する。

```ts
// engine.ts 内 (擬似コード、Phase B 実装イメージ)
export function findBestMoveWithStats(
  state, player, difficulty, variant, options, cardState?
) {
  const spectator = options?.spectator ?? false;
  const strategy = createStrategy(difficulty, { spectator });

  // openingBook lookup (variant ガードは engine.ts に残す)
  if (strategy.useBook && variant.id === "standard" && state.moveCount < MAX_BOOK_MOVES * 2) {
    // ... openingBook 処理 ...
  }

  // search.ts に SearchOptions として値を渡す (シグネチャ無変更)
  const move = findBestMove(state, player, {
    maxDepth: strategy.maxSearchDepth,
    timeLimitMs: strategy.timeLimitMs,
    addNoise: strategy.addNoise,
    nearEqualThreshold: strategy.nearEqualThreshold,
  }, variant, ctx);
  // ...
}
```

### route.ts 扱い

`src/app/api/ai-move/route.ts` は **PR1c-2 では触らない**。理由:

- 親計画 md L329-335 (PR1c-2 影響ファイル一覧) に route.ts への言及なし
- `findBestMoveWithStats` 内部で Strategy 生成する形なら、route.ts は引数 `difficulty: Difficulty` を渡すだけで済み、外部 API シグネチャ無変更
- route.ts の Strategy 経由切替 (= `difficulty: Difficulty` を `strategy: SearchStrategy` に変更等) は **PR1d 以降のスコープ**

### `SearchOptions` 扱い

search.ts の `SearchOptions { maxDepth, timeLimitMs, addNoise, nearEqualThreshold }` のシグネチャは無変更。engine.ts 側で Strategy から値を抽出してオプションオブジェクトに詰めて渡す形 (= 最小変更、案 (a) を採用)。

`SearchOptions` 自体を `SearchStrategy` に置換する案 (b) は PR2 以降の責務とする (大規模 refactor のため PR1c-2 のスコープを超える)。

---

## addNoise 揺らぎ対策 (2 層構造)

### 問題

`search.ts:677` の `Math.random() < options.addNoise` は **seed 制御不能**:

- beginner: `addNoise = 0.50` → 半分の確率でランダムな手を選択 → fixture 再現性なし
- intermediate: `addNoise = 0.10` → 10% の確率でランダム → fixture 再現性なし
- advanced: `addNoise = 0` → 完全決定的 → fixture 再現可能
- expert: `addNoise = 0` → 完全決定的 → fixture 再現可能

`Math.random` を Mulberry32 seed 制御可能に変更するのは PR1c-2 スコープ外 (refactor 純度を損なう、PR2 以降で検討)。

### 対策: 2 層構造の検証

| 検証層 | 対象 difficulty | 検証手段 |
|--------|----------------|----------|
| **層 1 (完全一致 DoD)** | advanced / expert | 180 局面 fixture で `findBestMoveWithStats(state, player, difficulty, variant)` の返却 move が baseline と完全一致 |
| **層 2 (フィールド値検証)** | beginner / intermediate / advanced / expert (全 4) | `createStrategy(difficulty).addNoise === DIFFICULTY_PARAMS[difficulty].addNoise` 等、Strategy インスタンスのフィールド値が DIFFICULTY_PARAMS と完全一致 |

層 1 で振る舞いの完全一致を直接検証、層 2 で「Strategy が DIFFICULTY_PARAMS パススルーとして正しく機能している」ことを補強検証する構造。

### test 構造 (`strategy-equivalence.test.ts` 拡張イメージ)

```ts
describe("Strategy fixture (advanced/expert 完全一致)", () => {
  it("standard 100 局面 + card-shogi 80 局面 で fixture と完全一致", () => {
    // advanced / expert のみ
    for (const entry of fixture.entries.filter(e => ["advanced", "expert"].includes(e.difficulty))) {
      const move = findBestMoveWithStats(state, player, entry.difficulty, variant);
      expect(move).toEqual(entry.expected.move);
    }
  });
});

describe("Strategy フィールド値検証 (全 4 difficulty)", () => {
  for (const difficulty of ["beginner", "intermediate", "advanced", "expert"]) {
    it(`${difficulty}: Strategy フィールドが DIFFICULTY_PARAMS と一致`, () => {
      const strategy = createStrategy(difficulty);
      expect(strategy.addNoise).toBe(DIFFICULTY_PARAMS[difficulty].addNoise);
      expect(strategy.nearEqualThreshold).toBe(DIFFICULTY_PARAMS[difficulty].nearEqualThreshold);
      expect(strategy.useBook).toBe(DIFFICULTY_PARAMS[difficulty].useBook);
      // 他のフィールドも同様
    });
  }
});
```

---

## Phase A: fixture 生成 PR

### ブランチ作成

```bash
git fetch origin
git checkout -b chore/#193-pr1c-2-fixture origin/main
```

### 影響ファイル

| 種別 | パス | 内容 |
|------|------|------|
| 新規 | `scripts/gen-fixture-strategy.ts` | 180 局面 (standard 100 + card-shogi 80) + 観戦モード 4 シナリオ生成、random walk + accept フィルタ + Mulberry32 |
| 新規 | `src/lib/shogi/ai/__tests__/fixtures/strategy-baseline.json` | 生成済 180 局面の正解値 (advanced/expert 用、addNoise=0 で再現可能) |
| 新規 | `src/lib/shogi/ai/__tests__/fixtures/strategy-baseline.meta.json` | `generatedAt`, `seed`, `categoryCounts` (Y-2 対応) |
| 新規 | `src/lib/shogi/ai/__tests__/fixtures/spectator-baseline.json` | 観戦モード 4 シナリオ (advanced vs advanced / expert vs expert / advanced vs expert / expert vs advanced、各 50 手) |
| 新規 | `src/lib/shogi/ai/__tests__/fixtures/spectator-baseline.meta.json` | 同上 |
| 編集 | `src/lib/shogi/ai/__tests__/strategy-equivalence.test.ts` | 現状 90 行 → 拡張 (advanced/expert 完全一致 + 全 difficulty フィールド値検証 + 観戦モード fixture 検証) |
| 編集 | `package.json` | `"gen:fixture:strategy": "tsx scripts/gen-fixture-strategy.ts"` 追加 |

### `gen-fixture-strategy.ts` 設計

#### 機能

- Mulberry32 seed (`scripts/utils/prng.ts` から import) で deterministic 生成
- **180 局面分布** (advanced/expert 用、addNoise=0 の完全一致 fixture):
  - standard variant: 100 局面 (opening 30 / midgame 40 / endgame 30)
  - card-shogi variant: 80 局面 (midgame 40 / endgame 40)
- **観戦モード 4 シナリオ** (advanced/expert の組合せ各 50 手):
  - advanced vs advanced
  - expert vs expert
  - advanced vs expert
  - expert vs advanced
- 各 entry の `expected` は `findBestMoveWithStats(state, player, difficulty, variant)` の戻り値 move
- 出力: `strategy-baseline.json` + `spectator-baseline.json` + 対応 `.meta.json`

#### 生成方針

- **局面生成は random walk + accept フィルタ** (PR1b の `gen-fixture-legal-moves.ts` と同じ手法、二段ガード)
  - `state.status === "active"` filter で特殊値局面を除外
  - 「template ベース」は採用しない (= 計画 md でも `template` の語は使わない、R-7 対策)
- **fixture 生成は Phase A の commit 時点 (refactor 前の main 動作) で実行** → これが PR1c-2 の baseline
- 観戦モード fixture は 4 シナリオに絞ることで生成時間を抑制 (50 手 × 4 シナリオ × ~3.5s ≒ 12 分程度を許容)

#### 実装の慣習

- 既存 `scripts/gen-fixture-legal-moves.ts` / `gen-fixture-evaluate.ts` (tsx 形式) を参考、`scripts/utils/prng.ts` を import
- 合法性保証 / fixture JSON serialize 方針は本ファイル冒頭「## 共通設計指針」参照

### `strategy-equivalence.test.ts` 拡張

現状の 90 行テストに以下を追加:

1. **180 局面 fixture 検証** (advanced/expert 完全一致): `strategy-baseline.json` を import、各 entry で `findBestMoveWithStats` の戻り値と `expected.move` を比較
2. **全 4 difficulty フィールド値検証**: `createStrategy(difficulty).addNoise === DIFFICULTY_PARAMS[difficulty].addNoise` 等、Strategy インスタンスの 3 フィールド (addNoise / nearEqualThreshold / useBook) が DIFFICULTY_PARAMS と一致
3. **観戦モード 4 シナリオ fixture 検証** (advanced/expert 完全一致): `spectator-baseline.json` を import、各シナリオの手系列が baseline と完全一致

### Phase A の DoD

- [ ] `scripts/gen-fixture-strategy.ts` が新規追加、`npm run gen:fixture:strategy` で 180 局面 + 4 観戦シナリオ生成成功
- [ ] `strategy-baseline.json` (180 局面) + `spectator-baseline.json` (4 シナリオ) が生成、`.meta.json` も同梱
- [ ] `strategy-equivalence.test.ts` が拡張済、3 種の検証 (fixture 完全一致 / フィールド値検証 / 観戦モード) すべて緑
- [ ] `package.json` に `gen:fixture:strategy` script 追加
- [ ] lint / typecheck / test:ci / build すべてパス
- [ ] Vercel preview deploy で実機動作確認 (Phase A は fixture 追加のみで AI 動作変更なし)

---

## Phase B: PR1c-2 refactor PR

### ブランチ作成 (Phase A マージ後)

```bash
git fetch origin
git checkout -b refactor/#193-pr1c-2 origin/main
```

### 影響ファイル

| 種別 | パス | 内容 |
|------|------|------|
| 編集 | `src/lib/shogi/ai/engine.ts` | `params.useBook` / `params.maxDepth` / `params.addNoise` / `params.nearEqualThreshold` / `params.timeLimitMs` (該当箇所のみ) を Strategy 経由参照に切替、`findBestMoveWithStats` 内で `createStrategy(difficulty, { spectator })` を呼ぶ |

### Phase B の DoD

- [ ] **standard variant fixture** (100 局面、advanced/expert): Phase B 前後で `findBestMoveWithStats` の返却 move が完全一致
- [ ] **card-shogi 中盤・終盤 fixture** (80 局面、advanced/expert): 完全一致
- [ ] **観戦モード基準 fixture** (4 シナリオ、advanced/expert): 完全一致
- [ ] **全 4 difficulty フィールド値検証**: Strategy インスタンスの addNoise / nearEqualThreshold / useBook が DIFFICULTY_PARAMS と一致 (Phase A で追加した test が緑)
- [ ] `engine.ts` に `params.addNoise` / `params.nearEqualThreshold` / `params.useBook` の直接参照が **0 件** (`grep -n "params\.\(addNoise\|nearEqualThreshold\|useBook\)" src/lib/shogi/ai/engine.ts` で 0 件)
- [ ] expert の探索 `nodes/sec` が Phase B 前後で同等 (性能影響なし、+/- 5% 以内目安)
- [ ] lint / typecheck / test:ci / build すべてパス
- [ ] Vercel preview deploy で実機動作確認 (人間 vs CPU 通常モード / 観戦モードの両方で AI 指し手が PR1c 時点と同じ)

---

## Phase C: R-4 訂正 PR

### ブランチ (既存ブランチ再利用)

```bash
git checkout chore/#193-pr1b-pr1c-plan
git fetch origin && git rebase origin/main
# rebase 中の conflict が発生したら手動解決 (origin/main 取込後の状態に整合)
```

### 影響ファイル

| 種別 | パス | 内容 |
|------|------|------|
| 編集 | `docs/plans/issue-193-pr1b-pr1c.md` | PR1b セクションの「template ベース (パターン 1-5)」記述を「全パターン random walk + accept フィルタで採取」に訂正、関連 DoD / レビュー観点 / 反映履歴の文言も更新 |

### 訂正対象の文言例

訂正前 (現状の PR1b/PR1c 計画 md):

> 「template ベース (パターン 1-5: 駒種境界 / 王手中合駒 / ピン駒 / 持ち駒打ち / 王手放置)」

訂正後 (実装方針に合わせる):

> 「全パターン random walk + accept フィルタで採取 (200-300 局面の board 配置を手書きするのは現実性が低く、検証目的 (= 出力 set 一致) には random walk で各カテゴリーに該当する局面を抽出するほうが効率的)」

実装側 `scripts/gen-fixture-legal-moves.ts` L17-22 の簡素化方針記述と完全整合させる。

### Phase C の DoD

- [ ] PR1b/PR1c 計画 md 内の「template ベース」記述が **0 件** (`grep -n "template ベース" docs/plans/issue-193-pr1b-pr1c.md` で 0 件)
- [ ] 実装側 `gen-fixture-legal-moves.ts` L17-22 の方針と完全整合
- [ ] lint / typecheck / test:ci / build 影響なし (ドキュメントのみの変更)

---

## ブランチ運用と push 手順

### Phase A

```bash
git fetch origin
git checkout -b chore/#193-pr1c-2-fixture origin/main
# 実装・テスト・コミット
npm run gen:fixture:strategy   # fixture 初回生成 (Mulberry32 seed=42)
npm run lint && npm run typecheck && npm run test:ci && npm run build
git push -u origin chore/#193-pr1c-2-fixture
# AGENTS.md ルール 1: PR 作成・マージは明示指示まで実施しない (push のみ完了)
```

### Phase B (Phase A マージ後)

```bash
git checkout main
git fetch origin
git pull --ff-only origin main   # Phase A マージ済を取込
git checkout -b refactor/#193-pr1c-2 origin/main
# 実装・テスト・コミット
npm run lint && npm run typecheck && npm run test:ci && npm run build
git push -u origin refactor/#193-pr1c-2
```

### Phase C (Phase A/B 並行可、または独立)

```bash
git checkout chore/#193-pr1b-pr1c-plan
git fetch origin
git rebase origin/main
# conflict 発生時は手動解決
# 「template ベース」訂正コミット追加
grep -n "template ベース" docs/plans/issue-193-pr1b-pr1c.md   # 0 件確認
git push --force-with-lease origin chore/#193-pr1b-pr1c-plan
```

**重要**: `git push --force-with-lease` は **AGENTS.md ルール 5 (破壊的操作)** のため、push 実行前にユーザー確認を取る。

---

## コミットメッセージ規約 (AGENTS.md ルール 7)

- 日本語、第三者にも分かる粒度で「なぜ」重視
- フックスキップ禁止 (`--no-verify` は明示指示時のみ)
- 末尾に `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`

例 (Phase A):

```
feat: #193-PR1c-2 Phase A Strategy fixture baseline 生成

scripts/gen-fixture-strategy.ts を新設し、Mulberry32 seed=42 で 180 局面
(standard 100 + card-shogi 80) + 観戦モード 4 シナリオを生成。
strategy-equivalence.test.ts を拡張し、advanced/expert 完全一致 + 全 4
difficulty フィールド値検証 + 観戦モード fixture 検証の 3 層構造を確立。

これにより、後続 Phase B (PR1c-2 refactor) の振る舞いキープ検証の
baseline を確立する。

検証: lint / typecheck / test:ci / build すべてパス、Vercel preview deploy 確認

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

例 (Phase B):

```
refactor: #193-PR1c-2 Phase B engine.ts の DIFFICULTY_PARAMS 直接参照を Strategy 経由に切替

engine.ts の 4-5 箇所 (L141 timeLimitMs / L153 useBook / L190 maxDepth /
L192 addNoise / L193 nearEqualThreshold) を Strategy インスタンス経由参照に切替。
findBestMoveWithStats 内部で createStrategy(difficulty, { spectator }) を
呼ぶ形で完結し、route.ts は無変更 (SearchOptions シグネチャも無変更)。

これにより、PR1d で Strategy 別ロジック分岐 (例: Strategy.shouldDraw(state, digest))
を Strategy 内に閉じ込められる構造を確立。

検証: Phase A で確立した fixture (180 局面 + 4 観戦シナリオ) で advanced/expert
完全一致、全 4 difficulty フィールド値検証緑、grep で params.* 直接参照 0 件。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## 重要マイルストーン (AGENTS.md ルール 8 = Issue #109 観点レビュー)

各 PR で 3 段階レビュー:

1. **計画策定後** (本フェーズ計画 md = 本ファイル) → **本フェーズ Phase 0 で別レビュワーレビュー実施 (進行中)**
2. **実装完了後** (push 前) → lint / typecheck / test:ci / build を実行 + 親計画 md / 進行中チェックリスト 19 件と照合
3. **マージ前** (ユーザーレビュー) → Vercel preview で実機検証 + ユーザー確認

---

## 進行中チェックリスト 19 件 + 第 1〜5 次レビュー新規追加項目で本フェーズ対応

PR1c-2 は「振る舞いキープ refactor」のため、進行中チェックリストの大半は対応スコープ外 (PR1d / PR2 で対応)。本フェーズで再確認すべきは以下のみ。

### A. 進行中チェックリスト 19 件由来 ([#issuecomment-4414636364](https://github.com/ryuichiTtb/Shogi/issues/193#issuecomment-4414636364))

- ✅ **A-2** (観戦両者対称性の定量定義): Phase A の観戦モード 4 シナリオが「advanced vs advanced / expert vs expert / advanced vs expert / expert vs advanced」で対称性を担保。本計画 md「観戦モード 4 シナリオ」セクション参照
- ✅ **A-3** (PR1c-2 観戦モード fixture の検証意義): 親計画 md 通り、addNoise=0 のため Strategy 経由参照に切替えてもトリビアルに成立。主要検証は **standard variant 100 + card-shogi 80** であることを明示
- ✅ **B-1** (PR1d-1 で Strategy 再集約と digest 加算の同居問題): 本フェーズ (PR1c-2) で Strategy 再集約を独立完了させることで、PR1d-1 は cardDigest 加算 + ドロー判定の機能追加に専念可能
- ⚠️ **F-3** (`isAiThinking` ⇔ `isPaused` 相互作用): 観戦モード fixture 生成時に再確認 (Phase A の `gen-fixture-strategy.ts` 実装時に、観戦モードの一時停止フラグが fixture 生成に影響しないか検証)

### B. 第 4 次レビュー残 (PR1d 着手前対応想定の他項目)

PR1c-2 着手前: A-2 / A-3 / B-1 が本フェーズで対応済となる。

### C. PR1d-1 着手前に対応する項目 (本フェーズでは対応不要、メモのみ)

- C-2 (`enumerateTargets` 擬似コードの具体化)
- C-4 (PR1d-1 Strategy 別ロジック分岐 API 例): 本フェーズで Strategy 経由参照構造を確立したことで、PR1d-1 で `Strategy.shouldDraw(state, digest)` 等の API 追加が自然に行える土台が完成
- F-4 / F-5 (PR1d-1 着手時)

---

## 運用注意書き — Issue / PR コメント参照時の comment_id 取得ルール (Z-1 継承)

**背景**: PR1a/PR1b/PR1c 計画 md レビューサイクルで `comment_id` の誤記が **3 サイクル連続で再発** した (M-3 / X-1 / Z-1)。原因は AI が 10 桁の数字 id を短期記憶でタイプしていたため。

**運用ルール (本フェーズ以降の全 PR / 全レビューサイクルで踏襲)**:

1. **正しい comment_id は `gh api` コマンドで取得し、推測タイプは禁止**:
   ```bash
   gh api repos/:owner/:repo/issues/<n>/comments --jq '.[] | {id, created_at, length: (.body | length)}'
   ```
   出力の `id` フィールドを **コピペ** で使用 (タイプし直さない)
2. **代替手段**: GitHub UI でコメントの「...」メニュー → 「Copy link」で URL 全体をコピペ
3. **参照前のセルフチェック**: コメント参照前に `gh api repos/:owner/:repo/issues/comments/<id>` で 200 が返ることを確認 (404 なら誤り)
4. **同じ id を複数回参照する場合**: 最初の 1 回だけ手作業、以降はファイル内 grep / Edit replace_all で複製 (タイプを増やさない)

**PR description 更新時の追加運用 (PR1b/PR1c で確立)**:

- `gh pr edit --body` は GraphQL Projects (classic) のエラーで失敗する可能性がある
- 確実な方法: **REST API 直接呼び出し** `gh api --method PATCH /repos/:owner/:repo/pulls/<N> -f body="..."`
- 検証は Summary セクションだけでなく、**問題箇所 (= 訂正対象の旧記述があった箇所) を grep で 0 件確認** することで担保

**過去の誤記履歴 (再発防止のための記録)**:

| サイクル | 誤った id | 正しい id | 検知 |
|---------|----------|----------|------|
| 第 1 次 M-3 | `4415459081` | `4415458652` | レビューで指摘 |
| 第 2 次 X-1 | `4415512049` | `4415518533` | レビューで指摘 |
| 第 3 次 Z-1 | `4415540843` | `4415542513` | レビューで指摘、運用ルール導入で再発防止 |

---

## 想定リスクと対策

| # | リスク | 対策 |
|---|--------|------|
| **R1** | addNoise 揺らぎによる fixture 再現性破綻 (beginner addNoise=0.50 / intermediate addNoise=0.10) | **2 層構造**: addNoise=0 の advanced/expert のみ完全一致 DoD、beginner/intermediate は Strategy フィールド値検証で代用 (D-2) |
| **R2** | `params.timeLimitMs` 等の置換漏れ | 計画 md 内で engine.ts の `params.*` 全参照を grep ベースで列挙、各箇所の置換可否を表で明示。Phase B 実装時に `grep -n "params\." src/lib/shogi/ai/engine.ts` を再実行 |
| **R3** | SearchOptions シグネチャ変更の波及 | 案 (a) 最小変更を採用、`SearchOptions` は無変更 (engine.ts で Strategy から値抽出して渡す)。案 (b) は PR2 以降のスコープ |
| **R4** | useBook の variant-specific 補正 (engine.ts L153) | variant ガード (`variant.id === "standard"`) は engine.ts 側に残す (variant 判断は engine の責務、Strategy は character/difficulty の責務) |
| **R5** | spectator timeLimitMs の二重 override | `findBestMoveWithStats` 内で `options.timeLimitMs` オプションを廃止し strategy.timeLimitMs から取得。Strategy 構築時に spectator override 済 |
| **R6** | fixture 生成スクリプトの実行時間爆発 | 観戦モード fixture は 4 シナリオに絞る、advanced/expert のみ fixture 生成。`--time-limit-ms=N` フラグで bench 短縮許容も検討 (Phase A 実装時に判断) |
| **R7** | R-4 訂正反映漏れ (本計画 md にも「template」記述書く危険) | 本計画 md 内で「random walk + accept フィルタ方式」と明示、`template` という単語を使わない (Phase A 設計セクションで実証済) |
| **R8** | comment_id 誤記の 4 サイクル目再発 | 本計画 md「## 運用注意書き」セクションで Z-1 運用ルールを継承、`gh api` で正確な id 取得 + grep 検証を徹底 |

---

## 検証計画

### 各 PR 共通

- AGENTS.md「実装ガイドライン 6. 必須チェック」に従い `npm run lint` → `npm run typecheck` → `npm run test:ci` → `npm run build` をすべてパス
- Vercel Preview deploy で実機確認
- bench fixture (PR1d で導入) を毎 PR で実行、棋力指標を継続観測

### fixture 生成・更新ワークフロー (本フェーズで追加分)

| スクリプト | 用途 | 再生成すべきタイミング |
|-----------|------|-----------------------|
| `npm run gen:fixture:strategy` | Phase A で新規追加。180 局面 (standard 100 + card-shogi 80) + 観戦モード 4 シナリオ | Phase B (PR1c-2 refactor) 完了後は再生成不要 (= refactor 前の baseline として固定)。PR1d で Strategy 別ロジック分岐を入れる場合、`addNoise=0` の advanced/expert で振る舞いキープなら再生成不要、変更を意図する場合は再生成し新基準として固定 |

---

## 想定スケジュール (目安)

| Phase | 作業 | 想定時間 |
|-------|------|---------|
| **Phase 0** | 本フェーズ計画 md (`docs/plans/issue-193-pr1c-2.md`) 作成 + push + Issue コメント | 30-60 分 |
| **Phase 0** | 別レビュワーレビュー反映 (**1-4 サイクル想定**、PR1a で 4 サイクル運用を踏まえ複数サイクルを許容) | レビュー時間に依存 |
| **Phase A** | ブランチ作成 + `scripts/utils/prng.ts` は流用 | 5 分 |
| **Phase A** | `scripts/gen-fixture-strategy.ts` 実装 (random walk + accept フィルタ + Mulberry32) | 1-2 時間 |
| **Phase A** | `strategy-baseline.json` + `spectator-baseline.json` 初回生成 (`npm run gen:fixture:strategy`) | 15-30 分 (観戦モード 4 シナリオ生成で 10-15 分) |
| **Phase A** | `strategy-equivalence.test.ts` 拡張 (3 種の検証) | 1 時間 |
| **Phase A** | `package.json` に `gen:fixture:strategy` script 追加 | 5 分 |
| **Phase A** | 必須チェック + 修正 + push | 30 分 |
| **Phase A 合計** | | **3-4 時間** |
| **Phase B** | ブランチ作成 + engine.ts 4-5 箇所置換 | 30 分 |
| **Phase B** | `findBestMoveWithStats` 内で createStrategy 呼び出し追加 | 30 分 |
| **Phase B** | 必須チェック + grep 0 件確認 + 修正 + push | 30 分 |
| **Phase B 合計** | | **1.5-2 時間** |
| **Phase C** | 既存ブランチ rebase + 「template ベース」記述訂正 + grep 0 件確認 + push | 30 分 |
| **合計 (実装のみ)** | | **5-7 時間** |
| **合計 (Phase 0 含む)** | | **5-8 時間 + レビュー待ち** |

**Phase 0 を先行**することで、別レビュワーから「Phase A の fixture スコープ過剰/不足」「Phase B の置換箇所漏れ」等の指摘があれば、実装着手前に手戻りを回避できる。PR1a で 4 サイクル / PR1b/PR1c で 3-5 サイクルレビューを反映した品質を、PR1c-2 でも継承する運用。

---

## AGENTS.md 規約準拠の確認

- [x] 絶対ルール 1: PR 作成・マージ・Issue クローズは指示まで禁止 → 各 PR はユーザー指示でのみマージ。Issue #190/#76 は本 Issue 全 PR 完了時に **ユーザー明示指示があってから** クローズ (自動クローズはしない)
- [x] 絶対ルール 2: 専用ブランチで作業、軽微派生は同居 → `chore/#193-pr1c-2-fixture` / `refactor/#193-pr1c-2` / `chore/#193-pr1b-pr1c-plan` で進める
- [x] 絶対ルール 3: ブランチ命名規則 → Phase A: `chore/` (新規スクリプト + fixture 生成のみで本体機能には触らない)、Phase B: `refactor/` (性質正確性原則、振る舞いキープ refactor)、Phase C: `chore/` (ドキュメントのみ)
- [x] 絶対ルール 4: 新規ブランチは origin/main 起点 → 各 Phase で `git fetch origin && git checkout -b ... origin/main` (Phase B は Phase A マージ後)
- [x] 絶対ルール 5: 破壊的操作は事前確認 → Phase C で `git push --force-with-lease` を使う際は事前確認、本フェーズ計画 md 内で明示
- [x] 絶対ルール 6: Vercel デプロイ確認のため push まで → 各 PR で push 後に止まる
- [x] 絶対ルール 7: コミット意味単位、PR タイトル簡潔、Issue タイトル簡潔 → Phase A/B/C 分離で機能/refactor/docs を混ぜない、コミットメッセージは日本語、`--no-verify` 禁止
- [x] 絶対ルール 8: 重要マイルストーンレビュー → 計画策定後・実装完了後・マージ前の 3 段階で Issue #109 観点レビュー
- [x] 絶対ルール 9: Worktree 推奨 → 本フェーズは Phase A/B/C 順次進行のため Worktree 不要 (= ブランチ切替で進める)。並行進行が必要になれば worktree 利用を検討
- [x] 実装ガイドライン: パフォーマンス >= 保守性 > 可読性 → Strategy 経由参照は関数呼び出しオーバーヘッドが微小に追加されるが、V8 JIT で大半は最適化される想定 (R3 で性能影響なしを DoD で担保)
- [x] UI/UX: PC/モバイル両対応、観戦モードでバッテリー/発熱対策 → 本フェーズは refactor のため UX 影響なし (Phase A の観戦モード fixture 生成で観戦体験を再現するが、production には影響なし)
- [x] マジックナンバー禁止 → 本フェーズで新規定数追加は最小限。`SPECTATOR_TIME_LIMIT_MS` 等は PR1a で `heuristics.ts` に集約済
- [x] 必須チェック: lint → typecheck → test:ci → build → 各 PR で実施
- [x] 機密情報: `.env*` は読まない、Neon URL を出力しない
- [x] カード追加チェックリスト破綻防止 → 本フェーズはカード追加なし

---

## 主要参照ファイル (実装時に必読)

### 親計画 md
- [docs/plans/issue-193.md](issue-193.md) (740 行) — PR1c-2 詳細 L307-342 (Phase 1 で発見したギャップあり)

### PR1b/PR1c 計画 md (運用継承の参考)
- [docs/plans/issue-193-pr1b-pr1c.md](issue-193-pr1b-pr1c.md) (657 行) — 運用パターン参考、R-4 訂正対象

### 既存実装ソース (Phase B で変更対象)
- `src/lib/shogi/ai/engine.ts` (236 行) — `findBestMoveWithStats` / DIFFICULTY_PARAMS / L141-L193 周辺が変更対象
- `src/lib/shogi/ai/strategy/types.ts` — `SearchStrategy` interface (8 フィールド + spectator)
- `src/lib/shogi/ai/strategy/legacy-adapter.ts` — `LegacyStrategyAdapter` (DIFFICULTY_PARAMS パススルー、spectator override L50-52)
- `src/lib/shogi/ai/strategy/sakura.ts` / `musashi.ts` / `geno-musashi.ts` / `ryuo.ts` — 4 キャラ別 Strategy
- `src/lib/shogi/ai/__tests__/strategy-equivalence.test.ts` (現状 90 行) — Phase A で拡張

### 既存実装 (Phase A の参考)
- `scripts/utils/prng.ts` (Mulberry32、PR1b/PR1c 取込済、Phase A で流用)
- `scripts/gen-fixture-legal-moves.ts` (PR1b の参考実装、random walk + accept フィルタ方式)
- `scripts/gen-fixture-evaluate.ts` (PR1c の参考実装)
- `src/lib/shogi/board.ts` L249/L259 — `serializeGameState` / `deserializeGameState`

### R-4 訂正対象 (Phase C)
- [docs/plans/issue-193-pr1b-pr1c.md](issue-193-pr1b-pr1c.md) — 「template ベース」記述箇所、`gen-fixture-legal-moves.ts` L17-22 と整合化

### ガバナンス
- `AGENTS.md` — 絶対ルール 1-9 / 実装ガイドライン / カード追加チェックリスト
- `MEMORY.md` — auto memory
- Issue #109 — 共通レビュールール (各 PR の重要マイルストーンで参照)

---

## レビュー観点 (別レビュワー向け)

本フェーズ計画 md のレビューでは特に以下を厳しく評価いただきたい。Issue #109 共通レビュールール準拠。

1. **Phase 1 で発見した親計画 md とのギャップの扱い**: 4 項目のギャップ (Strategy 既取込 / search.ts ではなく engine.ts / 180 局面 fixture 未生成 / spectator-baseline 未生成) の対処方針が妥当か、親計画 md への反映が必要か
2. **addNoise 揺らぎ対策の 2 層構造**: addNoise=0 の advanced/expert のみ完全一致 / beginner/intermediate はフィールド値検証で代用する DoD 設計は妥当か、Math.random の seed 制御化を本フェーズで行わない判断は適切か
3. **fixture 生成と refactor の commit 分離方針 (3 PR 構成)**: Phase A → Phase B → Phase C の順次進行は適切か、PR 数の増加 (+2 PR) が運用負荷として許容範囲か
4. **観戦モード fixture の 4 シナリオ制限**: advanced vs advanced / expert vs expert / advanced vs expert / expert vs advanced (各 50 手) で観戦両者対称性検証として十分か、シナリオ数や手数の調整が必要か
5. **route.ts / SearchOptions 扱い (PR1c-2 では触らない)**: 親計画 md L329-335 に基づく判断だが、PR1d-1 着手時に問題が発生しないか、本フェーズで先行対応すべきか
6. **R-4 同梱方針 (別 PR、chore/#193-pr1b-pr1c-plan 再利用)**: AGENTS.md ルール 7 (コミット粒度) との整合、`git push --force-with-lease` 必要性とリスク
7. **進行中チェックリスト 19 件 + 第 1〜5 次レビュー新規追加との整合**: A (A-2 / A-3 / B-1 本フェーズ対応) / B (PR1d-1 着手前メモ) / C (PR1d-1 着手時メモ) の分類で妥当か、見落としはないか
8. **後続 PR への影響**: 本フェーズ成果物 (`strategy-baseline.json` + `spectator-baseline.json` + Strategy 経由参照構造) が PR1d / PR2 で正しく再利用できる設計か

レビュー指摘があれば本ファイル (`docs/plans/issue-193-pr1c-2.md`) を改訂 → 再 push → 再レビューのサイクルで進める (PR1a の 4 サイクル / PR1b/PR1c の 3-5 サイクル運用と同じ)。
