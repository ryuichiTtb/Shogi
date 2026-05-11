# Issue #193 PR1c-2 (Strategy 再集約 refactor) + R-4 対応計画

本フェーズ計画 md。Issue #193 段階的実装の **PR1a/PR1b/PR1c (マージ済) → PR1c-2 (Strategy 再集約 refactor) + R-4 (PR1b/PR1c 計画 md 訂正)** の実装方針を整理する。実装着手前に別レビュワーレビューを受けて確定させる目的のドキュメント (AGENTS.md ルール 8: 重要マイルストーン 3 段階レビューの第 1 段階「実装計画策定後」)。

---

## Context

Issue #193 (AI/CPU アーキ刷新 + カード戦略統合 + CPU vs CPU 観戦) の段階的実装計画 (PR1a〜PR1e + PR2-6 = 計 11 PR) のうち、**3 PR が main にマージ済**:

- PR1a: [95d49ce](https://github.com/ryuichiTtb/Shogi/commit/95d49ce) (#202) + [f603c50](https://github.com/ryuichiTtb/Shogi/commit/f603c50) (#203)
- PR1b: [ba0080f](https://github.com/ryuichiTtb/Shogi/commit/ba0080f) (#204)
- PR1c: [7af6813](https://github.com/ryuichiTtb/Shogi/commit/7af6813) (#205)

本フェーズでは **PR1c-2 (Strategy 再集約 refactor) + R-4 (PR1b/PR1c 計画 md 訂正)** を 3 PR 構成で進める。

### 各 PR の概要

| PR | スコープ | 規模 | デグレリスク | 主要 DoD |
|----|---------|------|--------------|----------|
| **Phase A** (`chore/#193-pr1c-2-fixture`) | Strategy fixture baseline 確立 (180 局面 + 観戦 4 シナリオ) + `gen-fixture-strategy.ts` 新設 | 小〜中 (2-3 日) | 低 (新規 fixture 追加) | `npm run gen:fixture:strategy` 成功 + `strategy-equivalence.test.ts` 緑 |
| **Phase B** (`refactor/#193-pr1c-2`) | engine.ts の DIFFICULTY_PARAMS 直接参照を Strategy 経由参照に切替 + `FindBestMoveOptions` に `spectator?` 追加 + route.ts 1 行修正 (振る舞いキープ) | 小 (1-2 日) | 中 (1 cp ずれ厳禁、advanced/expert) | 180 局面 fixture で advanced/expert 完全一致 + grep 0 件 |
| **Phase C** (`chore/#193-pr1b-pr1c-plan`、既存再利用) | R-4: PR1b/PR1c 計画 md の「template ベース」記述を実装方針に合わせて訂正 | 微小 (15-30 分) | 低 (ドキュメントのみ) | 「template ベース」記述が 0 件 (grep 確認) |

### マージ順序の確定 (M-4 対応)

**Phase C を先に main にマージしてから、Phase A / Phase B を進める** ことで、本計画 md L75 / L591 / L606 で参照している `docs/plans/issue-193-pr1b-pr1c.md` の broken link を防止する。

マージ順序:
1. **Phase C 先行** (R-4 訂正、`chore/#193-pr1b-pr1c-plan` 既存ブランチ rebase + 訂正コミット追加 → 別 PR でマージ)
2. **本計画 md (`chore/#193-pr1c-2-plan`) マージ** (Phase C マージ後、`docs/plans/issue-193-pr1b-pr1c.md` への相対リンク有効化保証、SS-4 反映)
3. **Phase A** (fixture 生成 PR)
4. **Phase B** (refactor PR、Phase A マージ後)

順序を厳守することで、本計画 md L113 / L779 の `docs/plans/issue-193-pr1b-pr1c.md` への相対リンク (Phase C マージ後に main 反映) が常に有効化される。

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
| 2 | 「search.ts L674 の addNoise 直接参照を Strategy 経由に切替」 | 実態は **search.ts ではなく engine.ts 側の置換** (engine.ts L141/L153/L190/L192/L193、search.ts は `SearchOptions` 経由で間接受領) | Phase B の置換箇所が engine.ts 5 箇所に確定 |
| 3 | 「PR1a 時点の strategy-equivalence.test.ts (180 局面: standard 100 + card-shogi 80) で完全一致を強制」 | **180 局面 fixture は未生成** (現状 90 行の最小限テスト = factory 動作確認 / targetReadingPly / パススルー / spectator timeLimitMs のみ) | Phase A で 180 局面 fixture を新規生成する必要 |
| 4 | 「観戦モード基準 fixture (PR1a 保存版) との一致」 | **`spectator-baseline.json` も未生成** | Phase A で観戦モード fixture も同時生成 |

### Phase 2 (批判的レビュー) で発見した重大論点

**論点 1 (最重要)**: `search.ts:677` の `Math.random() < options.addNoise` および `search.ts:667-672` の `Math.floor(Math.random() * candidates.length)` (nearEqualThreshold 経路) は **seed 制御不能** (S-1 反映)。**beginner (addNoise=0.50, nearEqualThreshold=200) / intermediate (addNoise=0.10, nearEqualThreshold=80) で fixture 完全一致 DoD は原理的に達成不能**。advanced/expert は両者 0 なので決定的だが、CPU 速度依存性が別問題として残る (論点 2 で詳述)。

**論点 2 (Must-fix M-2)**: addNoise=0 でも `findBestMoveWithStats` は **timeLimitMs で反復深化を打ち切る** (search.ts:537 で `elapsedFromStart > options.timeLimitMs * 0.55` で次 depth 不進行)。CPU 速度差で到達 depth が変わるため、**fixture 完全一致 DoD は CPU 速度依存性で原理的に崩壊**。

**論点 3 (Must-fix M-1)**: `FindBestMoveOptions` には現状 `spectator?` フィールドが存在せず、route.ts は `timeLimitMs: body.spectatorMode ? SPECTATOR_TIME_LIMIT_MS : undefined` で観戦モードを伝達している。「route.ts 無変更 + options.timeLimitMs 廃止 + シグネチャ無変更」の 3 つの宣言が両立不可。

### ユーザー意思決定 (Phase 3 で確定 + 第 1 次レビュー後追加)

| 論点 | 確定方針 |
|------|---------|
| Fixture と refactor の commit 分離 | **別 PR で先行マージ** (Phase A → Phase B) |
| addNoise 揺らぎ対策 | **advanced/expert のみ完全一致 DoD、beginner/intermediate はフィールド値検証** (2 層構造、ただし層 2 の限界も明示) |
| R-4 対応 | **別 PR (`chore/#193-pr1b-pr1c-plan` ブランチ再利用)** |
| **CPU 速度依存性対策 (M-2 反映)** | **`maxDepth` 固定方式**: fixture 生成 + test:ci 検証の両方で `maxDepth` を有限固定 (8 想定)、`timeLimitMs=Infinity` 相当で reproducible 化 |
| **観戦 fixture 検証方式 (S-3 反映)** | **fixture 直接比較方式**: test:ci で観戦 fixture は data integrity のみ確認、動的検証は別 npm script (`npm run verify:strategy-fixture`) でリリース前手動実行 |
| **route.ts 扱い (M-1 反映)** | **`FindBestMoveOptions` に `spectator?: boolean` を追加 + route.ts を 1 行修正** (`timeLimitMs: ...` → `spectator: body.spectatorMode`)、これを PR1c-2 スコープに含める最小変更とする |

### 親計画 md 自体への反映方針

本計画 md レビュー確定後、親計画 md (`docs/plans/issue-193.md`) L307-342 のギャップ箇所を訂正する派生対応も検討する (本フェーズ範囲外、別 chore PR 想定)。

---

## 着手方針 (確定事項)

| 項目 | 確定内容 |
|------|---------|
| 全体構成 | **3 PR 構成** (Phase A / Phase B / Phase C)、それぞれ独立 PR |
| **マージ順序** | **Phase C 先行 (= 計画 md broken link 対策) → Phase A → Phase B** |
| Fixture と refactor の commit 分離 | **別 PR で先行マージ** (Phase A → Phase B) |
| addNoise 揺らぎ対策 | **advanced/expert のみ完全一致 DoD、beginner/intermediate は Strategy フィールド値検証** で代用 (2 層構造)。ただし層 2 検証は「Strategy が DIFFICULTY_PARAMS をパススルーしている」ことのみ保証し、**実際の Math.random 呼び出し回数や順序のずれは検出できない** ことを明示 |
| **CPU 速度依存性対策** | **maxDepth 固定方式 (`maxDepth=8` 想定、Phase A 設計セクションで詳述)** |
| 観戦 fixture 検証方式 | test:ci は fixture 直接比較 (data integrity のみ)、動的検証は別 npm script (リリース前手動実行) |
| R-4 対応 | **別 PR (`chore/#193-pr1b-pr1c-plan` ブランチ再利用)**、Phase C として先行マージ |
| route.ts 扱い | **1 行修正のみ許容** (`timeLimitMs: ...` → `spectator: body.spectatorMode`)。それ以外は触らない |
| `SearchOptions` 扱い | シグネチャ変更なし (最小変更、Strategy から値抽出して渡す案 (a) を採用) |
| `FindBestMoveOptions` 扱い | **`spectator?: boolean` を新規追加** (optional で後方互換、PR1c-2 で唯一の API 拡張) |
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

PR1b の `gen-fixture-legal-moves.ts` と PR1c の `gen-fixture-evaluate.ts` で確立した設計指針を、Phase A の `gen-fixture-strategy.ts` でも踏襲する。詳細は PR1b/PR1c 計画 md (`docs/plans/issue-193-pr1b-pr1c.md` — Phase C で main 取込後参照可能) の「## 共通設計指針 — PR1b/PR1c の fixture 生成共通仕様」参照。

要約:

1. **局面の合法性保証 (二段ガード)**: random walk で初期局面から合法手 walk + `state.status === "active"` filter
2. **fixture JSON serialize 方針**: `serializeGameState` / `deserializeGameState` ([board.ts:249, 259](../../src/lib/shogi/board.ts)) を流用、型アサーション `as GameState` で復元 (prototype 復元不要)
3. **fixture JSON 形式の統一**: `{ version: "1.0", entries: [{ id, state, ... , expected }] }` + `*-baseline.meta.json` で `generatedAt` 分離
4. **Mulberry32 seed 管理**: 共通 `scripts/utils/prng.ts` を import、デフォルト seed=42、`--seed=N` フラグでオーバーライド可

---

## Strategy 再集約方針 (Phase 1 調査反映、Phase B の核)

### `findBestMoveWithStats` の現状シグネチャ (M-3 反映)

現状の engine.ts:132-138 のシグネチャは:

```ts
findBestMoveWithStats(state, player, difficulty, variant, options)
```

`cardState?` 引数は **存在せず、PR1d で追加予定**。Phase B では `cardState?` を追加せずに完結する (= シグネチャ無変更)。

### `FindBestMoveOptions` の拡張 (M-1 反映)

Phase B で **`FindBestMoveOptions` に `spectator?: boolean` フィールドを新規追加** (optional、後方互換):

```ts
// engine.ts の FindBestMoveOptions 拡張
export interface FindBestMoveOptions {
  timeLimitMs?: number;
  signal?: AbortSignal;
  spectator?: boolean;  // ← 新規追加
}
```

これにより、route.ts は `spectator: body.spectatorMode` を 1 行で渡せるようになり、観戦モードを engine 内 Strategy 生成時に直接伝達可能。`timeLimitMs` 経路で観戦モードを推定する hack を排除。

### route.ts の修正範囲 (M-1 反映)

`src/app/api/ai-move/route.ts` は **1 行のみ修正**:

```ts
// 修正前
{ timeLimitMs: body.spectatorMode ? SPECTATOR_TIME_LIMIT_MS : undefined }

// 修正後
{ spectator: body.spectatorMode }
```

それ以外の route.ts 変更は PR1c-2 では行わない (= Strategy 経由切替は PR1d 以降)。

### engine.ts の DIFFICULTY_PARAMS 直接参照箇所 (置換マッピング、S-4 反映)

Phase 1 調査で**実態確認**した engine.ts 5 箇所の置換イメージ:

| 箇所 | 現在 (params 直接参照) | Phase B 後 (Strategy 経由) | 備考 |
|------|------------------------|----------------------------|------|
| L141 | `params.timeLimitMs` (`effectiveTimeLimitMs` 変数の右辺) | `strategy.timeLimitMs` | 観戦モード spectator override が Strategy 内で処理済 (Math.min) |
| L153 | `params.useBook && variant.id === "standard"` | `strategy.useBook && variant.id === "standard"` | variant ガードは engine.ts に残す |
| L190 | `params.maxDepth` | `strategy.maxSearchDepth` | フィールド名が異なる (Strategy は `maxSearchDepth`) |
| L192 | `params.addNoise` | `strategy.addNoise` | search.ts 内部の `Math.random() < options.addNoise` は無変更 |
| L193 | `params.nearEqualThreshold` | `strategy.nearEqualThreshold` | SearchOptions のシグネチャは無変更 (値だけ Strategy 由来) |

実装着手時に `grep -n "params\." src/lib/shogi/ai/engine.ts` で全箇所を再確認し、置換漏れを防ぐ。

### `effectiveTimeLimitMs` 変数の扱い (S-5 反映)

engine.ts L141 の `const effectiveTimeLimitMs = options.timeLimitMs ?? params.timeLimitMs;` は Phase B で **完全削除**。理由:

- `options.timeLimitMs` 経路は廃止 (= 観戦モード情報は新規 `options.spectator` で伝達)
- Strategy 構築時に `spectator` フラグから `timeLimitMs` を `Math.min(base, SPECTATOR_TIME_LIMIT_MS)` で算出済 (legacy-adapter.ts:50-52)
- engine.ts では `strategy.timeLimitMs` を直接使用

連動して、engine.ts L142-144 の `createSearchContext({ timeLimitMs: effectiveTimeLimitMs, signal: options.signal })` も `createSearchContext({ timeLimitMs: strategy.timeLimitMs, signal: options.signal })` に変更。

### `findBestMoveWithStats` 内部での Strategy 生成

`findBestMoveWithStats` のシグネチャは無変更。関数内部で `createStrategy(difficulty, { spectator: options?.spectator ?? false })` を呼んで Strategy インスタンスを取得し、上記置換マッピングに従って参照する。

```ts
// engine.ts 内 (Phase B 実装イメージ、MM-1 + SS-3 統合反映後の最終形)
export function findBestMoveWithStats(
  state: GameState,
  player: Player,
  difficulty: Difficulty,
  variant: RuleVariant,
  options?: FindBestMoveOptions
) {
  const strategy = createStrategy(difficulty, { spectator: options?.spectator ?? false });

  // openingBook lookup (variant ガードは engine.ts に残す)
  if (strategy.useBook && variant.id === "standard" && state.moveCount < MAX_BOOK_MOVES * 2) {
    // ... openingBook 処理 ...
  }

  // MM-1 反映: options.maxDepth 指定時 (= fixture 生成・検証用途) は
  // timeLimitMs を実質無効化することで search.ts:537 の早期打切を回避し、
  // 必ず maxDepth に到達するまで探索を継続する (CPU 速度非依存)。
  const effectiveMaxDepth = options?.maxDepth ?? strategy.maxSearchDepth;
  const effectiveTimeLimitMs = options?.maxDepth !== undefined
    ? Number.MAX_SAFE_INTEGER  // fixture 生成・検証専用 (production では未指定)
    : strategy.timeLimitMs;

  const ctx = createSearchContext({
    timeLimitMs: effectiveTimeLimitMs,
    signal: options?.signal,
  });

  // search.ts に SearchOptions として値を渡す (シグネチャ無変更)
  const move = findBestMove(state, player, {
    maxDepth: effectiveMaxDepth,
    timeLimitMs: effectiveTimeLimitMs,
    addNoise: strategy.addNoise,
    nearEqualThreshold: strategy.nearEqualThreshold,
  }, variant, ctx);
  // ...
}
```

### Strategy.selectMove が production で未使用な事実への言及 (S-2 反映)

現状、`grep -rn createStrategy src/` で production コード (`src/`) で `createStrategy` を呼んでいる箇所は **皆無** (テストのみ)。route.ts は engine.findBestMoveWithStats を直接呼んでいる。つまり PR1a で導入された Strategy 抽象は **production 経路に乗っていない空殻状態**。

Phase B で engine 内で `createStrategy` を呼ぶことで初めて production 経路に乗る。経路の整理:

- **現状**: route.ts → engine.findBestMoveWithStats (Strategy 未使用)
- **Phase B 後**: route.ts → engine.findBestMoveWithStats → engine 内で Strategy 生成 → DIFFICULTY_PARAMS 直参照を Strategy 経由参照に
- **テスト経路**: Strategy.selectMove → engine.findBestMoveWithStats → engine 内 Strategy 再生成 (= 二重生成、production では発生せず、テスト用 LegacyAdapter の慣習で許容)
- **PR1d 以降**: route.ts を Strategy 経由切替 (= `Strategy.selectMove` を production 経路に) で二重化解消

### `SearchOptions` 扱い

search.ts の `SearchOptions { maxDepth, timeLimitMs, addNoise, nearEqualThreshold }` のシグネチャは無変更。engine.ts 側で Strategy から値を抽出してオプションオブジェクトに詰めて渡す形 (= 最小変更、案 (a) を採用)。

`SearchOptions` 自体を `SearchStrategy` に置換する案 (b) は PR2 以降の責務とする (大規模 refactor のため PR1c-2 のスコープを超える)。

---

## addNoise 揺らぎ対策 (2 層構造、S-1 反映)

### 問題

`search.ts:677` の `Math.random() < options.addNoise` および `search.ts:667-672` の `Math.floor(Math.random() * candidates.length)` (nearEqualThreshold > 0 経路) は **seed 制御不能**:

- beginner: `addNoise=0.50, nearEqualThreshold=200` → 二重に非決定的 → fixture 再現性なし
- intermediate: `addNoise=0.10, nearEqualThreshold=80` → 二重に非決定的 → fixture 再現性なし
- advanced: `addNoise=0, nearEqualThreshold=0` → 決定的 → fixture 再現可能 (CPU 速度依存性は別問題、M-2 で対応)
- expert: `addNoise=0, nearEqualThreshold=0` → 決定的 → fixture 再現可能 (同上)

`Math.random` を Mulberry32 seed 制御可能に変更するのは PR1c-2 スコープ外 (refactor 純度を損なう、PR2 以降で検討)。

### 対策: 2 層構造の検証

| 検証層 | 対象 difficulty | 検証手段 | 限界 |
|--------|----------------|----------|------|
| **層 1 (完全一致 DoD)** | advanced / expert | 180 局面 fixture で `findBestMoveWithStats(state, player, difficulty, variant, { maxDepth: 8 })` の返却 move が baseline と完全一致 (maxDepth 固定方式、M-2 反映) | maxDepth=8 限定の検証なので、production の実探索 (maxDepth=16/24) でのデグレ検知は別途 Vercel preview deploy で実機確認 |
| **層 2 (フィールド値検証)** | beginner / intermediate / advanced / expert (全 4) | `createStrategy(difficulty).addNoise === DIFFICULTY_PARAMS[difficulty].addNoise` 等、Strategy インスタンスのフィールド値が DIFFICULTY_PARAMS と完全一致 | **Strategy が DIFFICULTY_PARAMS をパススルーしていることのみ保証**、実際の Math.random 呼び出し回数や順序のずれは検出不能。beginner/intermediate の振る舞いキープは Vercel preview 実機確認で担保 |

層 1 で振る舞いの完全一致を直接検証、層 2 で「Strategy が DIFFICULTY_PARAMS パススルーとして正しく機能している」ことを補強検証する構造。

---

## CPU 速度依存性対策 — maxDepth 固定方式 (M-2 反映)

### 問題

advanced/expert は `addNoise=0` で **探索ロジック自体は decimistic** だが、`findBestMoveWithStats` は `timeLimitMs` (advanced 3000ms / expert 3500ms) で **反復深化を打ち切る** (search.ts:537 で `elapsedFromStart > options.timeLimitMs * 0.55` で次 depth 不進行)。CPU 速度差で到達 depth が変わるため:

- ローカル開発機 (Apple M1): advanced で depth 12 まで到達
- CI runner (slower): 同じ局面が depth 10 で打切られる
- Vercel Pro CPU: depth 11 で打切

**fixture 完全一致 DoD は CPU 速度差で原理的に崩壊**。

### 対策: maxDepth 固定方式

**fixture 生成 + test:ci 検証の両方で `maxDepth` を有限固定** (`maxDepth=8` 想定) し、`timeLimitMs` 経路を無効化する:

- fixture 生成時: `findBestMoveWithStats(state, player, difficulty, variant, { maxDepth: 8, timeLimitMs: Infinity })` で実行 (CPU 速度非依存、必ず maxDepth=8 まで到達)
- test:ci 検証時: 同じ `{ maxDepth: 8, timeLimitMs: Infinity }` で `findBestMoveWithStats` を再実行 → fixture と完全一致を比較
- production: 通常の DIFFICULTY_PARAMS (advanced 16 / expert 24 + timeLimitMs 3000/3500) で動作 → CPU 速度依存性は production 上で許容 (本来の動作)

### maxDepth=8 採用根拠と Strategy fixture の役割再定義 (MM-2 反映)

**Strategy fixture の役割を再定義**: production の通常到達 depth (advanced 12-14 / expert 14-18) と乖離があるが、これは設計判断として **「Phase B refactor の関数呼出経路が壊れていないことの最低限保証 (= 軽量検証)」** に役割を絞り込む。「深い検証」は別途担保する。

**役割分担**:

| 検証層 | 担当 | 検知対象 | 検証深度 |
|--------|------|---------|---------|
| **Strategy fixture (本フェーズ)** | `strategy-equivalence.test.ts` + `strategy-baseline.json` | Phase B refactor の **関数呼出経路の整合性** (Strategy 経由参照が DIFFICULTY_PARAMS パススルー直接参照と完全に同じ move を返すこと) | maxDepth=8 (軽量、CPU 速度非依存) |
| **深い検証 (PR1d 以降)** | PR1d で導入予定の `perf-bench.test.ts` (advanced/expert × 局面 × p50/p95/max nodes 観測) | production の通常到達 depth (advanced 12-18) での棋力指標 | production 動作 (maxDepth 24 + timeLimitMs) |
| **マージ前確認** | Vercel preview deploy 動作確認 (DoD 必須項目) | 実機での AI 指し手・棋力・速度の人間観察 | production と同等 |

**maxDepth=8 の妥当性**:

- 関数呼出経路の整合性検証としては maxDepth=8 で十分 (= Phase B で呼出経路が壊れれば maxDepth に関わらず必ず move が変わる)
- depth ≥ 9 で発生する稀なバグは **Strategy fixture では検知できない** ことを明示 → これらは Vercel preview 実機確認 (DoD) と PR1d の bench fixture で補完
- CI 実行時間: 180 局面 × ~1-3 秒/局面 = **3-9 分** (許容範囲)
- maxDepth=4 だと探索質が低下しすぎてバグを検出しないリスク
- maxDepth=12 だと CI 6-27 分で重くなりすぎる → 役割分担方式を採用

**実装側の named constant 化 (NN-1 反映)**:

`STRATEGY_FIXTURE_MAX_DEPTH = 8` を `src/lib/shogi/ai/strategy/spectator-override.ts` (既存) または新規ファイル `src/lib/shogi/ai/strategy/fixture-constants.ts` に集約。fixture 生成スクリプト (`scripts/gen-fixture-strategy.ts`) と test:ci 検証 (`strategy-equivalence.test.ts`) の両方が同 constant を参照することで一元管理。

`gen-fixture-strategy.ts` には `--max-depth=N` フラグオーバーライドも実装し、ローカル動作確認時に深度変更可能にする (デフォルトは `STRATEGY_FIXTURE_MAX_DEPTH`)。

### Phase B 検証側の対応

Phase B で engine.ts に追加された `FindBestMoveOptions.spectator?` と同様に、**`FindBestMoveOptions.maxDepth?: number` も追加**して fixture 検証時に外部から maxDepth を上書き可能にする (= production 動作には影響しない、test/fixture 専用フラグ)。

```ts
export interface FindBestMoveOptions {
  signal?: AbortSignal;
  spectator?: boolean;
  maxDepth?: number;  // ← Phase B で追加 (fixture 検証専用、production では未指定で Strategy.maxSearchDepth を使用)
}
```

**注**: S-5 反映で `timeLimitMs?` フィールドは廃止。Phase B 後の `FindBestMoveOptions` は上記 3 フィールド (`signal?` / `spectator?` / `maxDepth?`) のみ。

engine.ts 内部の最終形 (MM-1 統合反映後):

```ts
const strategy = createStrategy(difficulty, { spectator: options?.spectator ?? false });
const effectiveMaxDepth = options?.maxDepth ?? strategy.maxSearchDepth;
const effectiveTimeLimitMs = options?.maxDepth !== undefined
  ? Number.MAX_SAFE_INTEGER  // fixture 生成・検証専用 (= timeLimitMs 経路の早期打切を回避)
  : strategy.timeLimitMs;

const ctx = createSearchContext({ timeLimitMs: effectiveTimeLimitMs, signal: options?.signal });
const move = findBestMove(state, player, {
  maxDepth: effectiveMaxDepth,
  timeLimitMs: effectiveTimeLimitMs,
  addNoise: strategy.addNoise,
  nearEqualThreshold: strategy.nearEqualThreshold,
}, variant, ctx);
```

これにより:
- production: `options.maxDepth` 未指定 → `strategy.maxSearchDepth` (advanced 16 / expert 24) 使用
- fixture 生成 + 検証: `options.maxDepth=8` 指定 → CPU 速度非依存

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
| 新規 | `scripts/gen-fixture-strategy.ts` | 180 局面 (standard 100 + card-shogi 80) + 観戦モード 4 シナリオ生成、random walk + accept フィルタ + Mulberry32 + maxDepth 固定 |
| 新規 | `src/lib/shogi/ai/__tests__/fixtures/strategy-baseline.json` | 生成済 180 局面 × 2 difficulty (advanced/expert) = 360 entries の正解値 |
| 新規 | `src/lib/shogi/ai/__tests__/fixtures/strategy-baseline.meta.json` | `generatedAt`, `seed`, `categoryCounts`, `maxDepth`, `timeLimitMs` メタ情報 |
| 新規 | `src/lib/shogi/ai/__tests__/fixtures/spectator-baseline.json` | 観戦モード 4 シナリオ (advanced vs advanced / expert vs expert / advanced vs expert / expert vs advanced、各 50 手) |
| 新規 | `src/lib/shogi/ai/__tests__/fixtures/spectator-baseline.meta.json` | 同上 |
| 編集 | `src/lib/shogi/ai/__tests__/strategy-equivalence.test.ts` | 現状 90 行 → 拡張 (advanced/expert 完全一致 + 全 difficulty フィールド値検証 + 観戦 fixture data integrity 検証) |
| 編集 | `package.json` | `gen:fixture:strategy` script + `verify:strategy-fixture` script 追加 |

**注**: Phase A は engine.ts の `FindBestMoveOptions.maxDepth?` が必要 (M-2 maxDepth 固定方式のため)。これは Phase B で追加するため、**Phase A は Phase B 着手前に追加分の小規模 refactor を先行コミットする**必要がある:

- Phase A の最初のコミット: `FindBestMoveOptions.maxDepth?` 新規追加 + engine.ts で `options.maxDepth ?? strategy.maxSearchDepth` を使う形に書き換え (微小 refactor)
- その後 fixture 生成スクリプトと test 拡張をコミット

または、**Phase A と Phase B を 1 ブランチで進める**選択肢もある (= Phase A の commit (1) maxDepth?追加 + (2) fixture script + (3) fixture 生成 + (4) test 拡張、Phase B の commit (5) Strategy 経由参照切替)。

**確定方針**: Phase A 内で `FindBestMoveOptions.maxDepth?` の追加 + Strategy 経由切替**前**の状態で fixture 生成を実行する。具体的なコミット粒度は次節「Phase A のコミット粒度」参照。

### `strategy-baseline.json` JSON スキーマ (N-1 反映)

```json
{
  "version": "1.0",
  "entries": [
    {
      "id": "standard-opening-001",
      "category": "standard-opening",
      "state": { /* serializeGameState 出力 */ },
      "player": "sente",
      "variantId": "standard",
      "difficulty": "advanced",
      "expected": {
        "move": { /* Move オブジェクト */ }
      }
    },
    {
      "id": "standard-opening-001",
      "category": "standard-opening",
      "state": { /* 同じ state */ },
      "player": "sente",
      "variantId": "standard",
      "difficulty": "expert",
      "expected": {
        "move": { /* expert の Move (advanced と異なる可能性あり) */ }
      }
    }
    // ... 続く
  ]
}
```

- 180 局面 × 2 difficulty (advanced/expert) = **360 entries**
- `id` は同じ局面で difficulty 違いを区別 (重複可)、`category` は局面カテゴリー (standard-opening / standard-midgame / standard-endgame / card-shogi-midgame / card-shogi-endgame)
- `expected.move` は **maxDepth=8 で固定して生成した move** (CPU 速度非依存)

### `spectator-baseline.json` JSON スキーマ

```json
{
  "version": "1.0",
  "scenarios": [
    {
      "id": "advanced-vs-advanced",
      "senteDifficulty": "advanced",
      "goteDifficulty": "advanced",
      "moves": [
        { "ply": 1, "move": { /* sente 1 手目 */ } },
        { "ply": 2, "move": { /* gote 2 手目 */ } }
        // ... 50 手まで
      ]
    },
    { "id": "expert-vs-expert", "senteDifficulty": "expert", "goteDifficulty": "expert", "moves": [...] },
    { "id": "advanced-vs-expert", "senteDifficulty": "advanced", "goteDifficulty": "expert", "moves": [...] },
    { "id": "expert-vs-advanced", "senteDifficulty": "expert", "goteDifficulty": "advanced", "moves": [...] }
  ]
}
```

各シナリオ 50 手 × 4 シナリオ = 200 局面分の指し手系列。

### `gen-fixture-strategy.ts` 設計

#### 機能

- Mulberry32 seed (`scripts/utils/prng.ts` から import) で deterministic 生成
- **180 局面分布** (advanced/expert 用、addNoise=0 の完全一致 fixture):
  - standard variant: 100 局面 (opening 30 / midgame 40 / endgame 30)
  - card-shogi variant: 80 局面 (midgame 40 / endgame 40)
- **観戦モード 4 シナリオ** (advanced/expert の組合せ各 50 手):
  - advanced vs advanced / expert vs expert / advanced vs expert / expert vs advanced
- 各 entry の `expected.move` は `findBestMoveWithStats(state, player, difficulty, variant, { maxDepth: 8 })` の戻り値 move
- 出力: `strategy-baseline.json` + `spectator-baseline.json` + 対応 `.meta.json`

#### 生成方針

- **局面生成は random walk + accept フィルタ** (PR1b の `gen-fixture-legal-moves.ts` と同じ手法、二段ガード)
  - `state.status === "active"` filter で特殊値局面を除外
  - 「template ベース」は採用しない (= 計画 md でも `template` の語は使わない、R-7 対策)
- **fixture 生成は Phase A の commit 時点 (refactor 前の main 動作) で実行** → これが PR1c-2 の baseline
- **maxDepth=8 固定で reproducibility 確保** (CPU 速度非依存)
- 観戦モード fixture は 4 シナリオに絞ることで生成時間を抑制 (50 手 × 4 シナリオ = 200 ply × ~1-3 秒/局面 ≒ **3-10 分目安**、L300 の 1-3 秒/局面想定と整合、SS-2 反映)

#### 実装の慣習

- 既存 `scripts/gen-fixture-legal-moves.ts` / `gen-fixture-evaluate.ts` (tsx 形式) を参考、`scripts/utils/prng.ts` を import
- 合法性保証 / fixture JSON serialize 方針は本ファイル冒頭「## 共通設計指針」参照

### `strategy-equivalence.test.ts` 拡張

現状の 90 行テストに以下を追加:

1. **180 局面 fixture 検証** (advanced/expert 完全一致): `strategy-baseline.json` を import、各 entry で `findBestMoveWithStats(state, player, difficulty, variant, { maxDepth: 8 })` の戻り値と `expected.move` を比較
2. **全 4 difficulty フィールド値検証**: `createStrategy(difficulty).addNoise === DIFFICULTY_PARAMS[difficulty].addNoise` 等、Strategy インスタンスの 3 フィールド (addNoise / nearEqualThreshold / useBook) が DIFFICULTY_PARAMS と一致
3. **観戦モード fixture data integrity 検証** (S-3 反映): `spectator-baseline.json` から各シナリオの **手系列を読み込んで構造妥当性 (シナリオ数 4 / 各 50 手 / Move スキーマ妥当) のみ確認**。動的検証 (両 CPU シミュレーション実行) は `npm run verify:strategy-fixture` 別 script で実施 (CI 外)

### Phase A の DoD

- [ ] `scripts/gen-fixture-strategy.ts` が新規追加、`npm run gen:fixture:strategy` で 180 局面 + 4 観戦シナリオ生成成功
- [ ] `strategy-baseline.json` (360 entries) + `spectator-baseline.json` (4 シナリオ) が生成、`.meta.json` も同梱 (`maxDepth=8`, `seed=42` を記録)
- [ ] `strategy-equivalence.test.ts` が拡張済、3 種の検証 (fixture 完全一致 / フィールド値検証 / 観戦 data integrity) すべて緑
- [ ] `package.json` に `gen:fixture:strategy` + `verify:strategy-fixture` script 追加
- [ ] `FindBestMoveOptions.maxDepth?: number` および `FindBestMoveOptions.spectator?: boolean` が engine.ts に追加 (= Phase A 内の先行 refactor、Phase B の準備、SS-1 反映)
- [ ] `STRATEGY_FIXTURE_MAX_DEPTH = 8` named constant が新規追加 (NN-1 反映、fixture 生成スクリプトと test:ci 検証の両方が同 constant 参照)
- [ ] lint / typecheck / test:ci / build すべてパス
- [ ] Vercel preview deploy で実機動作確認 (Phase A は fixture 追加 + maxDepth? 追加のみで production 動作変更なし)

### Phase A のコミット粒度 (N-2 反映)

AGENTS.md ルール 7 (コミット意味単位) に従い、Phase A は **4 コミットに分割**:

1. **refactor**: `feat: #193-PR1c-2 Phase A FindBestMoveOptions に maxDepth? / spectator? を追加 (M-1/M-2 反映準備)`
2. **feat (script)**: `feat: #193-PR1c-2 Phase A gen-fixture-strategy.ts + package.json script 追加`
3. **feat (fixture)**: `feat: #193-PR1c-2 Phase A strategy-baseline.json + spectator-baseline.json + .meta.json 初回生成`
4. **test**: `test: #193-PR1c-2 Phase A strategy-equivalence.test.ts に 3 種検証 (fixture/field/data-integrity) を追加`

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
| 編集 | `src/lib/shogi/ai/engine.ts` | `params.useBook` / `params.maxDepth` / `params.addNoise` / `params.nearEqualThreshold` / `params.timeLimitMs` を Strategy 経由参照に切替、`findBestMoveWithStats` 内で `createStrategy(difficulty, { spectator: options?.spectator ?? false })` を呼ぶ、`effectiveTimeLimitMs` 変数削除 + `createSearchContext` も `strategy.timeLimitMs` に切替 + MM-1 反映の `effectiveMaxDepth` / `effectiveTimeLimitMs` ロジック追加 |
| 編集 | `src/app/api/ai-move/route.ts` | **1 行のみ修正**: `timeLimitMs: body.spectatorMode ? SPECTATOR_TIME_LIMIT_MS : undefined` → `spectator: body.spectatorMode` |
| 編集 | `src/lib/shogi/ai/strategy/legacy-adapter.ts` | **MM-3 反映**: `selectMove` 内 (L60-65) で `findBestMoveWithStats` 呼出時の `timeLimitMs: this.spectator ? this.timeLimitMs : undefined` を `spectator: this.spectator` に切替。`options.timeLimitMs` 廃止 (S-5 反映) に伴うコンパイルエラー回避 |

### Phase B の DoD

- [ ] **standard variant fixture** (100 局面 × 2 difficulty = 200 entries、advanced/expert): Phase B 前後で `findBestMoveWithStats({ maxDepth: 8 })` の返却 move が完全一致
- [ ] **card-shogi 中盤・終盤 fixture** (80 局面 × 2 difficulty = 160 entries): 完全一致
- [ ] **観戦モード fixture data integrity** (4 シナリオ): structure validity 確認、動的検証は `npm run verify:strategy-fixture` で別途実行
- [ ] **全 4 difficulty フィールド値検証**: Strategy インスタンスの addNoise / nearEqualThreshold / useBook が DIFFICULTY_PARAMS と一致 (Phase A で追加した test が緑)
- [ ] `engine.ts` に `params.addNoise` / `params.nearEqualThreshold` / `params.useBook` / `params.maxDepth` / `params.timeLimitMs` の直接参照が **0 件** (`grep -n "params\." src/lib/shogi/ai/engine.ts` で 0 件)
- [ ] `effectiveTimeLimitMs` 変数が engine.ts から削除されている
- [ ] expert の探索 `nodes/sec` が Phase B 前後で同等 (性能影響なし、±5% 以内目安)
- [ ] lint / typecheck / test:ci / build すべてパス
- [ ] Vercel preview deploy で実機動作確認 (人間 vs CPU 通常モード / 観戦モードの両方で AI 指し手が PR1c 時点と同じ)

### Phase B のコミット粒度

AGENTS.md ルール 7 に従い、Phase B は **3 コミットに分割** (MM-3 反映、legacy-adapter.ts 追加):

1. **refactor (engine)**: `refactor: #193-PR1c-2 Phase B engine.ts の DIFFICULTY_PARAMS 直接参照を Strategy 経由参照に切替 + effectiveMaxDepth/TimeLimitMs ロジック追加`
2. **refactor (route + legacy-adapter)**: `refactor: #193-PR1c-2 Phase B route.ts + legacy-adapter.ts の timeLimitMs 経路を spectator フラグに切替`
3. (オプション) **追加検証**: `test: #193-PR1c-2 Phase B grep 0 件確認 + Vercel preview 動作確認結果反映`

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

### Phase C (先行マージ)

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

### Phase A (Phase C マージ後)

```bash
git fetch origin
git checkout -b chore/#193-pr1c-2-fixture origin/main
# 実装・テスト・コミット (4 コミット粒度)
npm run gen:fixture:strategy   # fixture 初回生成 (Mulberry32 seed=42, maxDepth=8)
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
# 実装・テスト・コミット (2 コミット粒度)
npm run lint && npm run typecheck && npm run test:ci && npm run build
git push -u origin refactor/#193-pr1c-2
```

---

## コミットメッセージ規約 (AGENTS.md ルール 7)

- 日本語、第三者にも分かる粒度で「なぜ」重視
- フックスキップ禁止 (`--no-verify` は明示指示時のみ)
- 末尾に `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`

### 各 Phase のコミット粒度

- **Phase A**: 4 コミット (refactor maxDepth?/spectator? 追加 / feat script / feat fixture / test)
- **Phase B**: 2 コミット (refactor engine / refactor route)
- **Phase C**: 1 コミット (docs 訂正)

### 例 (Phase B engine):

```
refactor: #193-PR1c-2 Phase B engine.ts の DIFFICULTY_PARAMS 直接参照を Strategy 経由参照に切替

engine.ts の 5 箇所 (L141 timeLimitMs / L153 useBook / L190 maxDepth /
L192 addNoise / L193 nearEqualThreshold) を Strategy インスタンス経由参照に切替。
findBestMoveWithStats 内部で createStrategy(difficulty, { spectator: options?.spectator ?? false })
を呼ぶ形で完結。effectiveTimeLimitMs 変数を削除し createSearchContext も
strategy.timeLimitMs に切替。

これにより、PR1d で Strategy 別ロジック分岐 (例: Strategy.shouldDraw(state, digest))
を Strategy 内に閉じ込められる構造を確立。

検証: Phase A で確立した fixture (180 局面 × 2 difficulty + 4 観戦シナリオ) で
advanced/expert 完全一致 (maxDepth=8 固定)、全 4 difficulty フィールド値検証緑、
grep で params.* 直接参照 0 件、effectiveTimeLimitMs 削除確認。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

### push 時の報告フォーマット (N-4 反映)

各 Phase の push 完了時の報告は **AGENTS.md 実装ガイドライン 9. 最終報告テンプレート** (Summary / 変更内容 / 設計判断 / テスト結果 / パフォーマンス UX 観点 / 残課題) に従う。

---

## 重要マイルストーン (AGENTS.md ルール 8 = Issue #109 観点レビュー)

各 PR で 3 段階レビュー:

1. **計画策定後** (本フェーズ計画 md = 本ファイル) → **本フェーズ Phase 0 で別レビュワーレビュー実施 (進行中、第 1 次レビュー完了 + 本改訂版で再依頼)**
2. **実装完了後** (push 前) → lint / typecheck / test:ci / build を実行 + 親計画 md / 進行中チェックリスト 19 件と照合
3. **マージ前** (ユーザーレビュー) → Vercel preview で実機検証 + ユーザー確認

---

## 進行中チェックリスト 19 件 + 第 1〜5 次レビュー新規追加項目で本フェーズ対応

PR1c-2 は「振る舞いキープ refactor」のため、進行中チェックリストの大半は対応スコープ外 (PR1d / PR2 で対応)。本フェーズで再確認すべきは以下のみ。

### A. 進行中チェックリスト 19 件由来 ([#issuecomment-4414636364](https://github.com/ryuichiTtb/Shogi/issues/193#issuecomment-4414636364))

- ✅ **A-2** (観戦両者対称性の定量定義): Phase A の観戦モード 4 シナリオが「advanced vs advanced / expert vs expert / advanced vs expert / expert vs advanced」で対称性を担保
- ✅ **A-3** (PR1c-2 観戦モード fixture の検証意義): 親計画 md 通り、addNoise=0 のため Strategy 経由参照に切替えてもトリビアルに成立。主要検証は **standard variant 100 + card-shogi 80** であることを明示
- ✅ **B-1** (PR1d-1 で Strategy 再集約と digest 加算の同居問題): 本フェーズ (PR1c-2) で Strategy 再集約を独立完了させることで、PR1d-1 は cardDigest 加算 + ドロー判定の機能追加に専念可能
- ⚠️ **F-3** (`isAiThinking` ⇔ `isPaused` 相互作用): 本フェーズの fixture 生成・refactor は production hooks (`use-card-shogi-game.ts` / `use-ai-request.ts`) と独立しているため、F-3 は本フェーズ対応 **スコープ外** に変更 (N-3 反映)。PR1d 着手前に別レビューで対応する想定

### B. 第 4 次レビュー残 (PR1d 着手前対応想定の他項目)

PR1c-2 着手前: A-2 / A-3 / B-1 が本フェーズで対応済となる。

### C. PR1d-1 着手前に対応する項目 (本フェーズでは対応不要、メモのみ)

- C-2 (`enumerateTargets` 擬似コードの具体化)
- C-4 (PR1d-1 Strategy 別ロジック分岐 API 例): 本フェーズで Strategy 経由参照構造を確立したことで、PR1d-1 で `Strategy.shouldDraw(state, digest)` 等の API 追加が自然に行える土台が完成
- F-3 / F-4 / F-5 (PR1d-1 着手時)

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
| **R1** | addNoise / nearEqualThreshold 揺らぎによる fixture 再現性破綻 (beginner / intermediate で二重に非決定的) | **2 層構造**: addNoise=0 の advanced/expert のみ完全一致 DoD、beginner/intermediate は Strategy フィールド値検証で代用。層 2 の限界 (Math.random 呼出回数差の検知不能) を明示し、Vercel preview 実機確認で補完 |
| **R2** | `params.*` 等の置換漏れ | 計画 md 内で engine.ts の `params.*` 全参照を grep ベースで列挙、各箇所の置換可否を表で明示。Phase B 実装時に `grep -n "params\." src/lib/shogi/ai/engine.ts` を再実行 |
| **R3** | SearchOptions シグネチャ変更の波及 | 案 (a) 最小変更を採用、`SearchOptions` は無変更 (engine.ts で Strategy から値抽出して渡す)。案 (b) は PR2 以降のスコープ |
| **R4** | useBook の variant-specific 補正 (engine.ts L153) | variant ガード (`variant.id === "standard"`) は engine.ts 側に残す (variant 判断は engine の責務、Strategy は character/difficulty の責務) |
| **R5** | spectator timeLimitMs の二重 override | `FindBestMoveOptions.spectator?: boolean` を新規追加 (M-1)。route.ts は `spectator: body.spectatorMode` を渡し、engine 内で `createStrategy(difficulty, { spectator })` で Strategy 構築時に Math.min override 済 |
| **R6** | fixture 生成スクリプトの CPU 速度依存性・実行時間爆発 | **maxDepth 固定方式** (`maxDepth=8` 想定) で CPU 速度非依存 + 実行時間予測可能 (180 局面 × maxDepth 8 ≒ 3-9 分)。観戦 fixture は 4 シナリオ × 50 手 ≒ **3-10 分目安** (SS-2 反映) |
| **R7** | R-4 訂正反映漏れ (本計画 md にも「template」記述書く危険) | 本計画 md 内で「random walk + accept フィルタ方式」と明示、`template` という単語を使わない (Phase A 設計セクションで実証済) |
| **R8** | comment_id 誤記の 4 サイクル目再発 | 本計画 md「## 運用注意書き」セクションで Z-1 運用ルールを継承、`gh api` で正確な id 取得 + grep 検証を徹底 |
| **R9 (新規、M-2)** | 標準 fixture 完全一致 DoD が CPU 速度依存性 (timeLimitMs 打切による depth 差) で原理的に崩壊 | **maxDepth 固定方式**: fixture 生成 + test:ci 検証で `maxDepth=8` 固定 (CPU 速度非依存)。production は通常 maxDepth (advanced 16 / expert 24) で動作 → Vercel preview 実機確認で補完 |
| **R10 (新規、M-4)** | `chore/#193-pr1c-2-plan` マージ時に `docs/plans/issue-193-pr1b-pr1c.md` への broken link 発生 | **Phase C 先行マージ** (R-4 訂正で `issue-193-pr1b-pr1c.md` を main に反映) → 本計画 md → Phase A → Phase B の順 (SS-4 反映で本計画 md 自体のマージタイミングも確定) |
| **R11 (新規、MM-1)** | `options.maxDepth` 指定時に `search.ts:537` の `timeLimitMs * 0.55` で早期打切が発生し、maxDepth=8 に到達しない (CPU 速度依存性再発) | engine.ts 内で `options.maxDepth !== undefined` のとき `effectiveTimeLimitMs = Number.MAX_SAFE_INTEGER` に設定し、必ず maxDepth に到達するまで探索継続 (Strategy 再集約方針セクション参照) |
| **R12 (新規、MM-2)** | maxDepth=8 では production の通常到達 depth (advanced 12-18) と乖離大、depth ≥ 9 のバグを検知できない | **役割分担方式**: Strategy fixture (本フェーズ) は「関数呼出経路の整合性検証」に役割を絞り、深い検証は PR1d で導入予定の `perf-bench.test.ts` + Vercel preview 実機確認 (DoD) で補完 |
| **R13 (新規、MM-3)** | Phase B で `options.timeLimitMs` 廃止により `legacy-adapter.ts:60-65` がコンパイルエラー or spectator override 失効 | Phase B 影響ファイルに `legacy-adapter.ts` を追加、`timeLimitMs: this.spectator ? this.timeLimitMs : undefined` を `spectator: this.spectator` に切替 (= 3 コミット粒度に追加) |

---

## 検証計画

### 各 PR 共通

- AGENTS.md「実装ガイドライン 6. 必須チェック」に従い `npm run lint` → `npm run typecheck` → `npm run test:ci` → `npm run build` をすべてパス
- Vercel Preview deploy で実機確認 (Phase B 完了後は AI 指し手が PR1c 時点と同じことを確認)
- bench fixture (PR1d で導入) を毎 PR で実行、棋力指標を継続観測

### fixture 生成・更新ワークフロー (本フェーズで追加分)

| スクリプト | 用途 | 再生成すべきタイミング |
|-----------|------|-----------------------|
| `npm run gen:fixture:strategy` | Phase A で新規追加。180 局面 × 2 difficulty (advanced/expert) = 360 entries + 観戦モード 4 シナリオ (各 50 手) | Phase B (PR1c-2 refactor) 完了後は再生成不要 (= refactor 前の baseline として固定)。PR1d で Strategy 別ロジック分岐を入れる場合、addNoise=0 の advanced/expert で振る舞いキープなら再生成不要、変更を意図する場合は再生成し新基準として固定 |
| `npm run verify:strategy-fixture` | Phase A で新規追加。観戦モード fixture の動的検証 (両 CPU シミュレーション実行) | リリース前手動実行、CI 外。観戦モードのデグレを Vercel preview deploy 動作確認と併せて検出 |

---

## 想定スケジュール (目安)

| Phase | 作業 | 想定時間 |
|-------|------|---------|
| **Phase 0** | 本フェーズ計画 md (`docs/plans/issue-193-pr1c-2.md`) 作成 + push + Issue コメント | 30-60 分 |
| **Phase 0** | 別レビュワーレビュー反映 (**1-4 サイクル想定**、PR1a で 4 サイクル運用を踏まえ複数サイクルを許容) | レビュー時間に依存 |
| **Phase C (先行)** | 既存ブランチ rebase + 「template ベース」記述訂正 + grep 0 件確認 + push | 30 分 |
| **Phase C** | ユーザー承認後マージ | レビュー時間に依存 |
| **Phase A** | ブランチ作成 + `FindBestMoveOptions.maxDepth?` / `spectator?` 追加 (refactor 微小) | 30 分 |
| **Phase A** | `scripts/gen-fixture-strategy.ts` 実装 (random walk + accept フィルタ + Mulberry32 + maxDepth 固定) | 1-2 時間 |
| **Phase A** | `strategy-baseline.json` + `spectator-baseline.json` 初回生成 (`npm run gen:fixture:strategy`) | 30 分 (maxDepth=8 で 4-12 分の実行 + 確認) |
| **Phase A** | `strategy-equivalence.test.ts` 拡張 (3 種の検証) | 1 時間 |
| **Phase A** | `package.json` に script 2 種追加 | 5 分 |
| **Phase A** | 必須チェック + 修正 + push | 30 分 |
| **Phase A 合計** | | **4-5 時間** |
| **Phase B** | ブランチ作成 + engine.ts 5 箇所置換 + `effectiveTimeLimitMs` 削除 | 1 時間 |
| **Phase B** | route.ts 1 行修正 | 5 分 |
| **Phase B** | 必須チェック + grep 0 件確認 + 修正 + push | 30 分 |
| **Phase B 合計** | | **1.5-2 時間** |
| **合計 (実装のみ)** | | **6-8 時間** |
| **合計 (Phase 0 含む)** | | **6-9 時間 + レビュー待ち** |

**Phase 0 を先行**することで、別レビュワーから「Phase A の fixture スコープ過剰/不足」「Phase B の置換箇所漏れ」等の指摘があれば、実装着手前に手戻りを回避できる。PR1a で 4 サイクル / PR1b/PR1c で 3-5 サイクルレビューを反映した品質を、PR1c-2 でも継承する運用。

---

## AGENTS.md 規約準拠の確認

- [x] 絶対ルール 1: PR 作成・マージ・Issue クローズは指示まで禁止 → 各 PR はユーザー指示でのみマージ。Issue #190/#76 は本 Issue 全 PR 完了時に **ユーザー明示指示があってから** クローズ (自動クローズはしない)
- [x] 絶対ルール 2: 専用ブランチで作業、軽微派生は同居 → `chore/#193-pr1c-2-fixture` / `refactor/#193-pr1c-2` / `chore/#193-pr1b-pr1c-plan` (既存再利用) で進める
- [x] 絶対ルール 3: ブランチ命名規則 → Phase A: `chore/` (新規スクリプト + fixture 生成 + 微小 refactor、本体機能変更なし)、Phase B: `refactor/` (性質正確性原則、振る舞いキープ refactor)、Phase C: `chore/` (ドキュメントのみ)
- [x] 絶対ルール 4: 新規ブランチは origin/main 起点 → 各 Phase で `git fetch origin && git checkout -b ... origin/main` (Phase B は Phase A マージ後)
- [x] 絶対ルール 5: 破壊的操作は事前確認 → Phase C で `git push --force-with-lease` を使う際は事前確認、本フェーズ計画 md 内で明示
- [x] 絶対ルール 6: Vercel デプロイ確認のため push まで → 各 PR で push 後に止まる
- [x] 絶対ルール 7: コミット意味単位、PR タイトル簡潔、Issue タイトル簡潔 → Phase A 4 コミット / Phase B 2 コミット / Phase C 1 コミットで意味単位分割、コミットメッセージは日本語、`--no-verify` 禁止
- [x] 絶対ルール 8: 重要マイルストーンレビュー → 計画策定後・実装完了後・マージ前の 3 段階で Issue #109 観点レビュー
- [x] 絶対ルール 9: Worktree 推奨 → 本フェーズは Phase A/B/C 順次進行のため Worktree 不要 (= ブランチ切替で進める)。並行進行が必要になれば worktree 利用を検討
- [x] 実装ガイドライン: パフォーマンス >= 保守性 > 可読性 → Strategy 経由参照は関数呼び出しオーバーヘッドが微小に追加されるが、V8 JIT で大半は最適化される想定 (R3 で性能影響なしを DoD で担保)
- [x] UI/UX: PC/モバイル両対応、観戦モードでバッテリー/発熱対策 → 本フェーズは refactor のため UX 影響なし (Phase A の観戦モード fixture 生成で観戦体験を再現するが、production には影響なし)
- [x] マジックナンバー禁止 → 本フェーズで新規定数追加は最小限。`SPECTATOR_TIME_LIMIT_MS` 等は PR1a で `heuristics.ts` に集約済。**`STRATEGY_FIXTURE_MAX_DEPTH = 8` は計画段階で確定** (NN-1 反映)、`src/lib/shogi/ai/strategy/fixture-constants.ts` (新規) または既存 `spectator-override.ts` に集約。fixture 生成スクリプトと test:ci 検証の両方が同 constant を参照することで一元管理
- [x] 必須チェック: lint → typecheck → test:ci → build → 各 PR で実施
- [x] 機密情報: `.env*` は読まない、Neon URL を出力しない
- [x] カード追加チェックリスト破綻防止 → 本フェーズはカード追加なし
- [x] **実装ガイドライン 9. 最終報告テンプレート** → 各 Phase push 完了時の報告は Summary / 変更内容 / 設計判断 / テスト結果 / パフォーマンス UX 観点 / 残課題 のフォーマットに従う (N-4 反映)

---

## 主要参照ファイル (実装時に必読)

### 親計画 md
- [docs/plans/issue-193.md](issue-193.md) (740 行) — PR1c-2 詳細 L307-342 (Phase 1 で発見したギャップあり、本計画 md レビュー確定後に親計画 md 自体への訂正を別 chore PR で対応)

### PR1b/PR1c 計画 md (運用継承の参考、Phase C で訂正対象)
- [docs/plans/issue-193-pr1b-pr1c.md](issue-193-pr1b-pr1c.md) — Phase C マージ後に main に存在。それ以前は `chore/#193-pr1b-pr1c-plan` ブランチ上のみ存在
  - 運用パターン参考 (PR1b/PR1c は 5 サイクルレビューで確立)
  - R-4 訂正対象 (Phase C)

### 既存実装ソース (Phase B で変更対象)
- `src/lib/shogi/ai/engine.ts` (236 行) — `findBestMoveWithStats` / DIFFICULTY_PARAMS / L141-L193 周辺が変更対象
  - L141: `effectiveTimeLimitMs = options.timeLimitMs ?? params.timeLimitMs` (Phase B で削除)
  - L153: `params.useBook && variant.id === "standard"` (variant ガード残す、useBook を Strategy 経由に)
  - L190: `maxDepth: params.maxDepth` (Strategy 経由 + maxDepth? options 対応)
  - L192: `addNoise: params.addNoise`
  - L193: `nearEqualThreshold: params.nearEqualThreshold`
- `src/lib/shogi/ai/strategy/types.ts` — `SearchStrategy` interface (8 フィールド + spectator)
- `src/lib/shogi/ai/strategy/legacy-adapter.ts` — `LegacyStrategyAdapter` (DIFFICULTY_PARAMS パススルー、spectator override L50-52)
- `src/lib/shogi/ai/strategy/sakura.ts` / `musashi.ts` / `geno-musashi.ts` / `ryuo.ts` — 4 キャラ別 Strategy
- `src/lib/shogi/ai/__tests__/strategy-equivalence.test.ts` (現状 90 行) — Phase A で拡張
- `src/app/api/ai-move/route.ts` — Phase B で 1 行修正 (`timeLimitMs` → `spectator`)

### 既存実装 (Phase A の参考)
- `scripts/utils/prng.ts` (Mulberry32、PR1b/PR1c 取込済、Phase A で流用)
- `scripts/gen-fixture-legal-moves.ts` (PR1b の参考実装、random walk + accept フィルタ方式)
- `scripts/gen-fixture-evaluate.ts` (PR1c の参考実装)
- `src/lib/shogi/board.ts` L249/L259 — `serializeGameState` / `deserializeGameState`

### R-4 訂正対象 (Phase C)
- `docs/plans/issue-193-pr1b-pr1c.md` — 「template ベース」記述箇所、`gen-fixture-legal-moves.ts` L17-22 と整合化

### ガバナンス
- `AGENTS.md` — 絶対ルール 1-9 / 実装ガイドライン (特にガイドライン 9 最終報告テンプレート) / カード追加チェックリスト
- `MEMORY.md` — auto memory
- Issue #109 — 共通レビュールール (各 PR の重要マイルストーンで参照)

---

## レビュー観点 (別レビュワー向け)

本フェーズ計画 md のレビューでは特に以下を厳しく評価いただきたい。Issue #109 共通レビュールール準拠。

1. **Phase 1 で発見した親計画 md とのギャップの扱い**: 4 項目のギャップ (Strategy 既取込 / search.ts ではなく engine.ts / 180 局面 fixture 未生成 / spectator-baseline 未生成) の対処方針が妥当か
2. **addNoise / nearEqualThreshold 揺らぎ対策の 2 層構造**: addNoise=0 の advanced/expert のみ完全一致 / beginner/intermediate はフィールド値検証で代用する DoD 設計は妥当か、層 2 の限界 (Math.random 呼出回数差の検知不能) を Vercel preview 実機確認で補完する方針は妥当か
3. **CPU 速度依存性対策 (maxDepth 固定方式、M-2 反映)**: `maxDepth=8` 固定で fixture 生成 + test:ci 検証は妥当か、production の通常 maxDepth (advanced 16 / expert 24) と乖離する fixture 検証の有効性は十分か
4. **fixture 生成と refactor の commit 分離方針 (3 PR 構成)**: Phase C → Phase A → Phase B のマージ順序 (broken link 対策) は妥当か、運用負荷として許容範囲か
5. **観戦モード fixture 検証方式 (S-3 反映、fixture 直接比較案 1)**: test:ci で data integrity のみ確認、動的検証は別 npm script (CI 外) で実施する方針は妥当か
6. **route.ts 1 行修正と `FindBestMoveOptions.spectator?` 追加 (M-1 反映)**: PR1c-2 の最小変更スコープとして許容範囲か、`options.timeLimitMs` 経路の廃止と整合するか
7. **進行中チェックリスト 19 件 + 第 1〜5 次レビュー新規追加との整合**: A (A-2 / A-3 / B-1 本フェーズ対応) / F-3 のスコープ外化 (N-3) / C (PR1d-1 着手時メモ) の分類で妥当か
8. **後続 PR への影響**: 本フェーズ成果物 (`strategy-baseline.json` + `spectator-baseline.json` + Strategy 経由参照構造 + `FindBestMoveOptions.spectator?`/`maxDepth?`) が PR1d / PR2 で正しく再利用できる設計か

レビュー指摘があれば本ファイル (`docs/plans/issue-193-pr1c-2.md`) を改訂 → 再 push → 再レビューのサイクルで進める (PR1a の 4 サイクル / PR1b/PR1c の 3-5 サイクル運用と同じ)。

---

## 第 1 次レビュー指摘の反映履歴 ([#issuecomment-4421562243](https://github.com/ryuichiTtb/Shogi/issues/193#issuecomment-4421562243))

第 1 次レビュー (Must-fix 4 件 + Should-fix 5 件 + Nice-to-have 4 件 = 計 13 件) を全件反映済 (本改訂版):

| # | カテゴリ | 指摘 | 反映箇所 |
|---|---------|------|---------|
| **M-1** | Must | `findBestMoveWithStats` の spectator 情報伝達経路の設計矛盾 | `FindBestMoveOptions.spectator?: boolean` 新規追加 + route.ts 1 行修正 (`timeLimitMs: ...` → `spectator: body.spectatorMode`) を PR1c-2 スコープに含める。「## Strategy 再集約方針」「## 着手方針」セクションで明示 |
| **M-2** | Must | fixture の CPU 速度依存性 (timeLimitMs 打切による depth 差) | **maxDepth 固定方式 (`maxDepth=8`)**: fixture 生成 + test:ci 検証の両方で maxDepth=8 を固定し CPU 速度非依存化。`FindBestMoveOptions.maxDepth?` 新規追加。「## CPU 速度依存性対策」セクション新設 |
| **M-3** | Must | `findBestMoveWithStats` シグネチャ表記の未来形混入 (`cardState?`) | 現状シグネチャを `(state, player, difficulty, variant, options)` に訂正、`cardState?` は PR1d で追加予定と明示 |
| **M-4** | Must | `docs/plans/issue-193-pr1b-pr1c.md` への broken link 危険 | **マージ順序を明示**: Phase C 先行マージ → Phase A → Phase B の順。「## 着手方針」「## ブランチ運用と push 手順」セクションで明示 |
| **S-1** | Should | `Math.random` は addNoise だけでなく `nearEqualThreshold > 0` でも呼ばれる | 「## addNoise 揺らぎ対策」セクションを「addNoise / nearEqualThreshold 揺らぎ対策」に改題、beginner/intermediate は二重に非決定的であることを明示、層 2 検証の限界も追記 |
| **S-2** | Should | Strategy.selectMove が production で未使用 | 「## Strategy 再集約方針」セクションに「現状: production で Strategy 未使用、Phase B で初めて production 経路に乗る」副節を追加 |
| **S-3** | Should | 観戦モード fixture の検証方式具体化不足 (test:ci 12 分問題) | **fixture 直接比較方式 (案 1) を採用**: test:ci は data integrity のみ確認、動的検証は `npm run verify:strategy-fixture` 別 script (CI 外) で実施。「## Phase A」「## 検証計画」セクションで明示 |
| **S-4** | Should | engine.ts L141 を「推定」と表記している矛盾 | 「## Strategy 再集約方針」の置換マッピング表で「L141 (推定)」を「L141 (確定)」に訂正 |
| **S-5** | Should | `effectiveTimeLimitMs` ロジック扱い未明示 | 「## Strategy 再集約方針」セクションに `effectiveTimeLimitMs` 変数の完全削除 + `createSearchContext` も `strategy.timeLimitMs` に切替を明示 |
| **N-1** | Nice | `strategy-baseline.json` エントリ構造の曖昧さ | 「## Phase A」セクションに JSON スキーマ例 (360 entries = 180 局面 × 2 difficulty) を明示 |
| **N-2** | Nice | Phase A のコミット粒度指針不在 | 「## Phase A のコミット粒度」副節を新設、4 コミット分割例 (refactor / feat script / feat fixture / test) を明示。Phase B も 2 コミット分割で明示 |
| **N-3** | Nice | 進行中チェックリスト F-3 の検証手順不明確 | F-3 は本フェーズ対応 **スコープ外** に変更 (= production hooks 側の問題で fixture 生成と独立)、PR1d 着手前に別レビューで対応する方針に明示 |
| **N-4** | Nice | AGENTS.md 実装ガイドライン 9 最終報告テンプレートとの整合 | 「## コミットメッセージ規約」セクション末尾と「## AGENTS.md 規約準拠の確認」に「push 時の報告は AGENTS.md 実装ガイドライン 9 最終報告テンプレートに従う」を明示 |

**統合解決 (M-2 + S-3)**: M-2 の maxDepth 固定方式と S-3 の fixture 直接比較方式を **「maxDepth=8 固定で fixture 生成 + test:ci で動的再実行 (高速、CPU 速度非依存) + 観戦 fixture は data integrity のみ」** として統合。詳細は本計画 md「## CPU 速度依存性対策」セクション参照。

---

## 第 2 次レビュー指摘の反映履歴 ([#issuecomment-4421732085](https://github.com/ryuichiTtb/Shogi/issues/193#issuecomment-4421732085))

第 2 次レビュー (Must-fix 3 件 + Should-fix 4 件 + Nice-to-have 1 件 = 計 8 件) を全件反映済 (本改訂版):

| # | カテゴリ | 指摘 | 反映箇所 |
|---|---------|------|---------|
| **MM-1** | Must | `options.maxDepth` 指定時の `timeLimitMs` 経路扱いが計画 md で曖昧 (= `search.ts:537` の早期打切で maxDepth=8 に到達しない可能性) | engine.ts 内に `options.maxDepth !== undefined` のとき `effectiveTimeLimitMs = Number.MAX_SAFE_INTEGER` のロジックを追加。「## Strategy 再集約方針」「## CPU 速度依存性対策」セクションで擬似コード統一 (MM-1 + SS-3 統合反映)。リスク表 R11 として追加 |
| **MM-2** | Must | `maxDepth=8` 採用根拠の妥当性 (production 動作 advanced 12-18 と乖離大) | **役割分担方式採用**: Strategy fixture (本フェーズ) を「Phase B refactor の関数呼出経路の整合性検証 (= 軽量検証)」に役割を絞り、「深い検証」は PR1d で導入予定の `perf-bench.test.ts` + Vercel preview 実機確認 (DoD) で補完。L297-322 の採用根拠を訂正、リスク表 R12 として追加 |
| **MM-3** | Must | Phase B 影響ファイルに `legacy-adapter.ts` (`selectMove` 内 `findBestMoveWithStats` 呼出) が抜けている | Phase B 影響ファイル表に `legacy-adapter.ts` 追加 (`timeLimitMs: this.spectator ? this.timeLimitMs : undefined` → `spectator: this.spectator` に切替)、Phase B コミット粒度を 2 → 3 コミットに増加。リスク表 R13 として追加 |
| **SS-1** | Should | Phase A DoD で `spectator?` 言及漏れ | L494 を訂正、「`FindBestMoveOptions.maxDepth?: number` および `FindBestMoveOptions.spectator?: boolean` が engine.ts に追加」と両方明記 |
| **SS-2** | Should | 観戦 fixture 生成時間予測の数字ずれ (1-3 分 vs 計算上 3-10 分) | L478 と R6 を「3-10 分目安」に訂正、L300 の 1-3 秒/局面想定と整合 |
| **SS-3** | Should | `effectiveMaxDepth` 変数の擬似コード不統一 (L313 と L214-220) | Phase B 擬似コード (L195-220 周辺) と CPU 速度依存性対策セクション (L298-322 周辺) を MM-1 統合形に統一、`effectiveMaxDepth` / `effectiveTimeLimitMs` の整合確保 |
| **SS-4** | Should | 本計画 md (`chore/#193-pr1c-2-plan`) 自体のマージ運用が曖昧 | マージ順序を確定: **Phase C → 本計画 md → Phase A → Phase B** の順。L25-34 「マージ順序の確定」と R10 で明示 |
| **NN-1** | Nice | `STRATEGY_FIXTURE_MAX_DEPTH` named constant を計画段階で確定 | 「## CPU 速度依存性対策」セクションに `STRATEGY_FIXTURE_MAX_DEPTH = 8` を計画段階で確定する旨を明示、`src/lib/shogi/ai/strategy/fixture-constants.ts` (新規) または `spectator-override.ts` に集約、Phase A DoD と AGENTS.md 規約準拠セクションにも反映 |

**統合解決 (MM-1 + SS-3)**: MM-1 (timeLimitMs 経路扱い) と SS-3 (擬似コード不統一) を同時解決。engine.ts 内の最終形を:

```ts
const effectiveMaxDepth = options?.maxDepth ?? strategy.maxSearchDepth;
const effectiveTimeLimitMs = options?.maxDepth !== undefined
  ? Number.MAX_SAFE_INTEGER  // fixture 生成・検証専用
  : strategy.timeLimitMs;
```

の形に統一し、Phase B 擬似コードと CPU 速度依存性対策セクションの両方で同じコードを参照する形に整理。

**役割分担方式の採用 (MM-2)**: ユーザー意思決定 (第 2 次レビュー Phase 3) で「役割分担方式」を選択。Strategy fixture は軽量検証に役割を絞り、深い検証は PR1d 以降の bench fixture と Vercel preview 実機確認で補完する設計。
