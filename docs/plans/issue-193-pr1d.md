# Issue #193 PR1d 対応計画 — cardDigest 評価 + 全カード対応 (内部 4 段階)

## Context

### 各 sub PR の概要

PR1d は親計画 md ([docs/plans/issue-193.md](issue-193.md) L344-523) で「cardDigest 評価 + 全カード対応」スコープが確定済の **大規模 PR (3-4 週間規模)**。本計画 md は PR1d 内部を 4 sub PR (PR1d-1 〜 PR1d-4) に細分化した段階別計画。

| sub PR | スコープ | 規模目安 | デグレリスク | 並行可否 |
|--------|---------|---------|---------------|---------|
| **PR1d-1** | PR1c-2 残課題解消 (`useBook?` 追加 + fixture 再生成) + cardDigest interface 新規 + `evaluateCardDigest` 実装 + DrawAction 候補生成 | 中 (1 週間) | 中 (振る舞いキープ + 機能追加) | 単独 |
| **PR1d-2** | pawn_return / piece_return / double_pawn 判定 (BEGIN_PLAY_CARD 7 項目 + enumerateTargets + blunder guard skip) | 中 (1 週間) | 中 (3 カード機能追加) | PR1d-1 マージ後 |
| **PR1d-3** | double_move super-action 探索 (player 反転禁止 + α/β 継承 + `DOUBLE_MOVE_TOP_K=10` フォールバック) | 大 (1 週間) | 高 (探索仕様が他と大きく異なる) | PR1d-2 マージ後 |
| **PR1d-4** | トラップ系 (no_promote / check_break) + cardDigest 拡張 (`trapPresence` / `noPromoteMarksPositions`) + `perf-bench.test.ts` 整備 | 中 (1 週間) | 高 (発動タイミング予測が評価関数精度に依存) | PR1d-3 マージ後 |

合計 PR1d 完了まで約 4-7 週間 (計画 md レビュー 1-4 サイクル + 各 sub PR 実装レビュー 1-3 サイクル × 4 = 5-16 サイクル、想定 5-8 週間)。

### 本フェーズの目的

1. **CardGameState を評価関数に組み込む基盤確立**: `computeCardDigest(cardState, player)` を root で 1 回計算 → `evaluate` 内で加算する設計 (親計画 md L350-356、Plan エージェント代替案 G-2 の流用)
2. **CPU が全カード 6 種を判断対象にする**: ドロー / pawn_return / piece_return / double_pawn / double_move / no_promote / check_break (active カード 6 枚 + ドローアクション = 計 7 種類のアクション)
3. **PR1c-2 残課題 (openingBook 非決定性) を解消**: `FindBestMoveOptions.useBook?: boolean` を新規追加し、fixture 再生成時に `useBook: false` で固定 → 360/360 件完全一致を達成 ([Issue #193 comment #4428841412](https://github.com/ryuichiTtb/Shogi/issues/193#issuecomment-4428841412))
4. **棋力退化なし**: expert vs advanced の勝率が PR1d 前後で同等以上、`depthCompleted` **-10% 以内 (退化許容範囲、+10% 改善は通常あり得ないため許容方向のみ)** (W-8 反映、人間 vs AI bench で測定)

---

## Phase 1 調査で判明した親計画 md とのギャップ (本計画 md の肝)

`docs/plans/issue-193.md` L344-523 の PR1d 詳細セクションに対し、実態確認で以下のギャップを発見:

| # | 親計画 md の記述 | 実態 | 影響 |
|---|------------------|------|------|
| 1 | 「`src/lib/shogi/ai/cards/digest.ts` 新規」(L380, L517) | **ディレクトリ `src/lib/shogi/ai/cards/` 自体が未存在** | PR1d-1 で新規ディレクトリ作成 + 2 ファイル新設 (digest.ts + heuristics.ts) |
| 2 | 「`FindBestMoveOptions.useBook?`」相当の記述なし | **PR1c-2 残課題で openingBook 非決定性 5/360 件 (1.4%) 検出済** ([#4428841412](https://github.com/ryuichiTtb/Shogi/issues/193#issuecomment-4428841412)) | PR1d-1 冒頭コミットで `useBook?` 追加 + fixture 再生成 (`useBook: false` 指定) |
| 3 | 「TurnRules.getLegalActions に DrawAction / PlayCardAction 候補追加」(L406, L417) | 実態は **`getLegalActions` が move-only を返す** ([turn/current-rules.ts:26](../../src/lib/shogi/ai/turn/current-rules.ts#L26)) | PR1d-1 で DrawAction、PR1d-2 で PlayCardAction (通常カード 3 種)、PR1d-3 で double_move、PR1d-4 でトラップ系を順次追加 |
| 4 | 「`enumerateTargets` 責務具体化 (L453-477)」 | 実態は **既存ヘルパ `isValidCardTargetSquare` ([effects.ts:274](../../src/lib/shogi/cards/effects.ts#L274))** が流用元として存在 | PR1d-2 で `enumerateValidSquaresForCard` を `isValidCardTargetSquare` 経由で実装 (進行中チェックリスト C-5 対応) |
| 5 | `reducer.ts BEGIN_PLAY_CARD` 引用が **L1086-1135** | 実態は **L1124 始まり** (`5badcab` 時点) | PR1d 計画 md 本体では `[reducer.ts:1124](src/hooks/card-shogi/reducer.ts#L1124)` で引用 (本セッション中 grep -n で確定済) |
| 6 | `evaluateCardDigest` の cp スケール基準が記述なし | 第 5 次レビュー F-5 で「`HAND_VALUE_BASE = 20` (= 歩 1/4) / `MANA_DELTA_COEFFICIENT = 10` (= マナ 1 ≒ 10 cp ≒ 歩 1/9) を仮基準として heuristics.ts で名前付き定数化、bench で調整」が決定済 | PR1d-1 cardDigest 設計セクションに反映 |

---

## Phase 2 批判的レビューで発見した重大論点

### 論点 1 (Must-fix M-1): cardDigest 加算が evaluate.ts の byte-level equality に与える影響

**問題**: PR1c で確立した 1000 局面 evaluate fixture (`evaluate-equivalence.test.ts`) は `evaluate(state, variant) === legacyEvaluate(state, variant)` の byte-level equality を強制している。cardDigest 加算でこの equality が破綻すると、PR1d-1 段階で 1000 局面すべて fixture green を取れない。

**対策**: `evaluate(state, variant, cardState?)` シグネチャを拡張し、`cardState` を **optional 引数** にする。`cardState` 未渡時は cardDigest 加算をスキップ (= 既存挙動完全保持)、`cardState` 渡時のみ root で `computeCardDigest` → `evaluateCardDigest` を加算。

これにより:
- **PR1c の 1000 局面 evaluate fixture は cardState 未渡で実行 → byte-level equality 保持** (PR1d-1 以降も継続 green)
- 観戦モード / card-shogi の探索ホットパスは `cardState` を渡して cardDigest 加算を有効化
- standard variant の探索は cardState 不要 (シグネチャ後方互換)

### 論点 2 (Must-fix M-2): post-search blunder guard と pawn_return / piece_return の機能重複

**問題**: 既存の `findBestMoveWithStats` ([engine.ts:152](../../src/lib/shogi/ai/engine.ts#L152)) は探索完了後に `hasHangingPiece` ([engine.ts:79](../../src/lib/shogi/ai/engine.ts#L79)) で「タダ取り発生する手は除外」する post-search blunder guard を実装 ([engine.ts:255-259](../../src/lib/shogi/ai/engine.ts#L255-L259))。一方、PR1d-2 で追加する pawn_return / piece_return も「タダ取り回避」役を果たすため、二重発動の懸念がある。

**対策** (N-7 詳細化): `findBestMoveWithStats` 内で `usingCardAction: boolean` フラグを Strategy インスタンスに保持し、`usingCardAction === true` のとき engine.ts の blunder guard 経路を skip。pawn_return / piece_return が選択されたら blunder guard を回避する構造的排他制御を実装。

擬似コード:

```ts
// findBestMoveWithStats 内 (PR1d-2 で追加)
const strategy = createStrategy(difficulty, { spectator });
const bestAction = await searchWithTurnRules(...);
strategy.usingCardAction = (bestAction.kind === "playCard");

// blunder guard 適用判定 (engine.ts L255-259 周辺)
if (!strategy.usingCardAction && hasHangingPiece(nextState, player, variant)) {
  // 通常の blunder guard 処理
  const alternative = findNonHangingAlternative(...);
  return alternative;
}
```

### 論点 3 (Must-fix M-3): double_move super-action 内部探索での player 反転禁止

**問題**: 二手指し (double_move) は **同一プレイヤーが 2 ply 連続で指す** ため、super-action 内部探索で通常の negamax (player 反転 + 評価値符号反転 + depth 減算) を適用すると 1 手目と 2 手目で player が誤って反転する。

**対策** (B-2 既反映): 親計画 md L491-493 + Issue #193 comment #4414636364 (B-2) で確定済の方針:
- `applyTurnAction` の戻り値に `turnEnded: boolean` を追加
- super-action 内部探索では **1 手目 `applyTurnAction` の戻り値 `turnEnded === false` を保証** (= player 反転禁止、評価値符号反転禁止、depth 減算なし)
- super-action 終了後 (= 2 手目 `applyTurnAction` 完了時点) に `turnEnded === true` で外側 negamax に戻り、通常の制御が発生
- 二手指し中の判定: `state.doubleMove !== null`

### 論点 4 (Must-fix M-4): TT (Transposition Table) と cardDigest の整合性

**問題**: TT は board hash のみで keying しており、cardState を無視する。cardDigest が探索中に変化する局面 (= playCard / draw が選ばれた子ノード) では、同じ board hash でも cardDigest が異なる可能性があり、TT 誤キャッシュのリスク。

**対策** (G-2 で確定済): cardDigest を **root スカラー** として扱う設計を採用 (親計画 md L350-356)。
- 探索開始時に root で 1 回だけ `computeCardDigest` を呼ぶ
- 探索中は cardDigest は変化しない (= 子ノードでも root スカラーを引き継ぐ)
- TT は board hash のみで keying して OK (cardDigest は root スカラーなので TT ヒット時も整合)
- PR1d-1 段階では root のみカードアクション → 再計算は root レベルのみ (稀)
- PR3 で深い探索にカードアクションを広げる際は `updateCardDigest(prevDigest, cardOp)` 増分更新型 API に切替検討

### 論点 5 (Should-fix S-1): bench fixture の CI 実行時間爆発

**問題**: 親計画 md L646-650 で「bench fixture を 2 系統運用 (perf-bench + perf-bench-spectator)」と決定。50 局面 × 4 難易度 × 2 系統 = 400 ベンチケースを test:ci に含めると **数分 〜 数十分の追加実行時間** が発生し、CI 時間爆発のリスク。

**対策** (G-4 既反映): bench 系 fixture (`perf-bench*.test.ts`) を **CI 対象外として分離**。
- `npm run test:perf-bench` 等の手動実行に分離 (`test:ci` には含めない)
- vitest の `test.skip(process.env.CI === "true")` パターンで自動 skip 制御
- PR1d-4 段階で `package.json` に専用 npm script を追加

---

## Phase 3 ユーザー意思決定 (本 plan で確定済)

メタ計画 md (`~/.claude/plans/issue-193-issue-pr-calm-hammock.md`、本セッション 3 サイクルレビュー反映済) で以下を確定:

| 論点 | 確定方針 |
|------|---------|
| **PR1d 内部 4 段階構成** | **C 案 (統合推奨案)** を採用: 親計画 md の機能スコープ分割を主軸に、PR1d-1 冒頭で PR1c-2 残課題 (`useBook?` 追加 + fixture 再生成) を吸収、bench fixture は PR1d-4 で集約 |
| **Worktree 使用** | **使用しない** (メインディレクトリでブランチ切替、PR1c-2 と同じ運用)。実装フェーズは 5-8 週間の長期間だが、内部 4 段階は順次マージ前提のため並行進行リスクは限定的 |
| **計画 md 章立て構造** | PR1c-2 計画 md (`docs/plans/issue-193-pr1c-2.md`、最終 982 行) を踏襲 (Phase 1 ギャップ / Phase 2 批判的レビュー / Phase 3 ユーザー意思決定 + 各 sub PR 詳細 + リスク + 検証計画) |
| **cardDigest 加算方式** | **root スカラー方式** (Plan エージェント代替案 G-2): 探索開始時に root で 1 回計算 → `evaluate` 内で加算、TT は board hash のみで OK |
| **evaluate シグネチャ拡張** | **`cardState?` optional 引数を新規追加** (後方互換、未渡時は cardDigest 加算 skip、byte-level equality 保持) |
| **blunder guard 排他制御** | **`usingCardAction: boolean` フラグを Strategy インスタンスに保持** (N-7 詳細化、PR1d-2 で実装) |
| **double_move super-action** | **player 反転禁止** (B-2 既反映、`turnEnded: boolean` 戻り値で制御)、+30% 超過時は `DOUBLE_MOVE_TOP_K=10` フォールバック |
| **bench fixture CI 分離** | **CI 対象外** (`npm run test:perf-bench` で手動実行、G-4 既反映) |

### C 案採用の経緯

引き継ぎメモは「横断的フェーズ分割」(PR1d-1: useBook? のみ / PR1d-2: digest interface のみ / PR1d-3: 全カード一括 / PR1d-4: bench のみ) を提案していたが、PR1d-3 で全 6 カード一括追加はデグレ切り分け困難。親計画 md は「機能スコープ分割」(PR1d-1: digest+ドロー / PR1d-2: 通常 3 カード / PR1d-3: double_move / PR1d-4: トラップ系) を採用、これに従って:

- PR1c-2 残課題 (useBook? + fixture 再生成) → **PR1d-1 の冒頭コミット** で先に解消 (機能追加に入る前のクリーンな状態を作る)
- perf-bench.test.ts → **PR1d-4 で集約** (PR1d-1〜3 の機能追加が完了した最終段階で棋力測定、途中段階で測ると意味が薄い)

これにより親計画 md の機能スコープ分割を維持しつつ、引き継ぎメモの「残課題解消を先頭で」「bench を最終で」の意図も反映。

---

## 着手方針 (確定事項)

| 項目 | 確定内容 |
|------|---------|
| 全体構成 | **4 sub PR 構成** (PR1d-1 / PR1d-2 / PR1d-3 / PR1d-4)、それぞれ独立 PR |
| **マージ順序** | **PR1d-1 → PR1d-2 → PR1d-3 → PR1d-4** (順次マージ前提、各 sub PR は前の sub PR マージ後にブランチ作成) |
| デグレ切り分け | 各 sub PR が機能単位で fixture green を確認可能 (進行中は緑、退化検出時は該当 sub PR 内で解消) |
| 振る舞いキープ vs 機能追加 | 各 sub PR で **明示的に区別**: PR1d-1 冒頭コミット (useBook? + fixture 再生成) は振る舞いキープ refactor、それ以外は機能追加 |
| evaluate シグネチャ | `evaluate(state, variant, cardState?)` で `cardState?` optional 追加 (後方互換、PR1c の 1000 局面 fixture を継続 green) |
| ブランチ運用 | 4 ブランチを順次 `origin/main` 起点で作成 (PR1d-2 は PR1d-1 マージ後、PR1d-3 は PR1d-2 マージ後...) |
| Worktree | 使用しない (本ディレクトリでブランチ切替、PR1c-2 と一貫) |
| マージ | **明示指示まで実施しない** (AGENTS.md ルール 1)。各 sub PR push まで完了で止まる |
| 命名規則 | `feature/#193-pr1d-1` / `feature/#193-pr1d-2` / `feature/#193-pr1d-3` / `feature/#193-pr1d-4` (AGENTS.md ルール 3、機能追加カテゴリのため `feature/`) |

---

## Issue #193 リオープン後の運用方針 (継承)

PR1a/PR1b/PR1c/PR1c-2 計画 md と同じ運用ルール:

1. **PR1d 以降の PR description で `Closes #193` は記述しない** (記述すると GitHub の自動クローズで Issue #193 がクローズされてしまう。本 Issue は PR6 完了後にユーザー明示指示でクローズ予定)
   - **バッククォート引用も検知される** (PR #207 事例): `` `Closes #193` `` も auto-close を発動した実例あり、計画 md / PR description / Issue コメント本文すべてで `Closes` / `Fixes` / `Resolves` キーワード 0 件確認
2. 集約 Issue (#190 / #76) も同様に、本 Issue 全 PR 完了時のユーザー明示指示でのみクローズ
3. **本フェーズ着手時点 (2026-05-12) で Issue #190 / #76 は両方とも `state: "open"` を継続保持**

---

## 共通設計指針 (PR1b/PR1c/PR1c-2 から継承)

PR1b の `gen-fixture-legal-moves.ts` / PR1c の `gen-fixture-evaluate.ts` / PR1c-2 の `gen-fixture-strategy.ts` で確立した設計指針を、PR1d の各 sub PR で踏襲する。詳細は PR1b/PR1c 計画 md ([docs/plans/issue-193-pr1b-pr1c.md](issue-193-pr1b-pr1c.md)) / PR1c-2 計画 md ([docs/plans/issue-193-pr1c-2.md](issue-193-pr1c-2.md)) の「共通設計指針」セクション参照。

要約:

1. **局面の合法性保証 (二段ガード)**: random walk で初期局面から合法手 walk + `state.status === "active"` filter
2. **fixture JSON serialize 方針**: `serializeGameState` / `deserializeGameState` ([board.ts:249, 259](../../src/lib/shogi/board.ts)) を流用、型アサーション `as GameState` で復元
3. **fixture JSON 形式の統一**: `{ version: "1.0", entries: [{ id, state, ..., expected }] }` + `*-baseline.meta.json` で `generatedAt` 分離
4. **Mulberry32 seed 管理**: 共通 `scripts/utils/prng.ts` を import、デフォルト seed=42、`--seed=N` フラグでオーバーライド可
5. **CPU 速度非依存性**: `maxDepth` 固定方式 (PR1c-2 で確立、`STRATEGY_FIXTURE_MAX_DEPTH = 6`) または bench は `timeLimitMs` 元値で実行 (PR1d-4)

---

## cardDigest 設計の核

### 全体方針

cardDigest を root で 1 回計算 → evaluate に加算する形で CardGameState を評価関数に組み込む (親計画 md L350-356、Plan エージェント代替案 G-2 の流用)。

- **計算タイミング**: 探索開始時に **root で 1 回だけ** `computeCardDigest(cardState)` を呼ぶ (W-2 反映: sente 絶対視点で固定、player 引数なし)
- **加算経路** (W-1 反映): `computeCardDigest` で得た **`CardDigest` を `evaluate` の引数として伝播** し、evaluate 内では `evaluateCardDigest(cardDigest, variant)` (加算 1 op のみ) を実行。**evaluate 内では `computeCardDigest` を呼び直さない** (= ホットパスでの再計算を構造的に禁止、`computeHandValue` の超越関数計算 / `Math.exp` を子ノードで実行しない)
- **TT 整合性**: TT は board hash のみで keying (cardDigest は root スカラーなので TT ヒット時も整合、論点 4 で詳述)
- **評価視点の統一** (W-2 反映): `CardDigest` は **sente 絶対視点** (sente +、gote -) で計算。`evaluate` 既存実装が sente 絶対視点 ([evaluate.ts:737-738](../../src/lib/shogi/ai/evaluate.ts#L737-L738) `sign = piece.owner === "sente" ? 1 : -1` 形式) のため、cardDigest も同じ視点に統一して符号矛盾を回避。観戦モードでも同じ digest を両プレイヤーで共有
- **増分更新**: PR1d 段階では root のみカードアクション → 再計算は root レベルのみ。PR3 で深い探索にカードアクションを広げる際は `updateCardDigest(prevDigest, cardOp)` 増分更新型 API に切替検討 (関数名は `updateCardDigest` で統一、親計画 md L356)

### cardDigest フィールド段階拡張ロードマップ

各 sub PR で必要になったフィールドだけを追加する。最初から全部入れない (使わないフィールドの維持コストを避けるため、親計画 md L358-368)。

| sub PR | 追加するフィールド | 用途 |
|--------|---------------------|------|
| **PR1d-1** | `manaDelta` / `manaCap` / `handValueDelta` / `drawProgressDelta` | ドロー判定とマナ価値評価。`manaCap` は将来動的化想定 (メモリ参照: `MANA_CAP = 20` [definitions.ts:228](../../src/lib/shogi/cards/definitions.ts#L228)、ただしカード効果で増減可能性あり) のため枠だけ確保 |
| **PR1d-2** | (PR1d-1 と同じ、追加なし) | カード使用判定は root 列挙時のヒューリスティクスで完結し、digest フィールドは増えない |
| **PR1d-3** | `doubleMoveActive: Player \| null` | 二手指し継続中かを digest に持って、評価値の符号反転制御に使う。super-action 内部探索の player 反転禁止と整合 |
| **PR1d-4** | `trapPresence: { player: CardId \| null; opponent: CardId \| null }` / `noPromoteMarksPositions` | トラップ価値計算と成り無効化マークの位置情報 |

### 将来追加検討フィールド (PR3 以降)

PR1d 段階では含めないが、将来の拡張で必要になる可能性のあるフィールドを記録 (親計画 md L370-377):

| フィールド | 必要になるタイミング | 理由 |
|-----------|---------------------|------|
| `lastTurnStartedAt` | PR3 マナ供給予測 | 早指しボーナス影響を多手先で評価するため。PR1d 段階では root スカラーで局所捕捉 |
| `graveyard` | 将来カード再利用機能追加時 | 墓地からのカード復活カード等が新規追加された場合に必要 |
| `manaChargeEvent.reason` | PR3 マナ供給予測 | turn 由来 / card 由来のマナ供給を区別して期待値を算出するため |

### TypeScript シグネチャ (PR1d-1 時点)

```ts
// src/lib/shogi/ai/cards/digest.ts (PR1d-1 で新規作成)
export interface CardDigest {
  manaDelta: number;            // mana.sente - mana.gote (W-2 反映: sente 絶対視点)
  manaCap: number;              // 将来動的化想定 (現状静的だが枠は確保)
  handValueDelta: number;       // handValue(sente hand) - handValue(gote hand) (W-2 反映: sente 絶対視点、単調減衰関数で算出)
  drawProgressDelta: number;    // drawProgress.sente - drawProgress.gote (W-2 反映: sente 絶対視点)
  // PR1d-3 で doubleMoveActive 追加
  // PR1d-4 で trapPresence, noPromoteMarksPositions 追加
}

/**
 * 探索開始時に root で 1 回だけ呼ぶ (W-1 反映: 子ノードでは引数として伝播、再計算しない)。
 *
 * W-2 反映: sente 絶対視点で固定 (player 引数なし)。これにより evaluate 既存実装
 * (sente +、gote - の絶対視点) と符号整合し、観戦モードでも両プレイヤーで同じ digest を共有可能。
 */
export function computeCardDigest(cardState: CardGameState): CardDigest;

/**
 * digest を cp 単位の評価値に変換。evaluate に引数として渡された cardDigest を加算するときに使う。
 * 単調減衰関数: handValue(handSize) = HAND_VALUE_BASE × (1 - exp(-handSize / HAND_VALUE_DECAY))
 * 単位: cp (PIECE_VALUES と整合、歩 = 90 cp 基準)、sente 絶対視点 (sente 有利で正)
 */
export function evaluateCardDigest(digest: CardDigest, variant: RuleVariant): number;
```

### cp スケール基準 (F-5 反映)

第 5 次レビュー F-5 で確定済の仮基準値:

- `MANA_DELTA_COEFFICIENT = 10` (= マナ 1 ≒ 10 cp ≒ 歩 1/9)
- `HAND_VALUE_BASE = 20` (= 歩 1/4、手札 1 枚目の最大価値)
- `HAND_VALUE_DECAY = 3.0` (手札増加に対する減衰係数、bench で調整)

これらは `src/lib/shogi/ai/cards/heuristics.ts` (PR1d-1 で新規作成) で名前付き定数として一元管理。`HAND_LIMIT` は **導入しない** (単調減衰関数で滑らかに価値が下がるため、しきい値方式は不要、親計画 md L412-413)。

### 加算経路の擬似コード (W-1 / W-3 / W-6 反映済)

```ts
// src/lib/shogi/ai/engine.ts findBestMoveWithStats 内 (PR1d-1 で拡張)
// W-6 反映: cardState? は FindBestMoveOptions に集約し、PR1c-2 で確立した options 拡張パターンに統一
export interface FindBestMoveOptions {
  timeLimitMs?: number;
  signal?: AbortSignal;
  spectator?: boolean;
  maxDepth?: number;
  useBook?: boolean;             // PR1d-1 で追加 (PR1c-2 残課題解消)
  cardState?: CardGameState;     // PR1d-1 で追加 (W-6 反映: 旧 第 6 引数 → options 内に集約)
}

export function findBestMoveWithStats(
  state: GameState,
  player: Player,
  difficulty: Difficulty,
  variant: RuleVariant,
  options: FindBestMoveOptions = {},
): FindBestMoveResult {
  // ... 既存処理 ...

  // PR1d-1: cardDigest を root で 1 回だけ計算 (W-1 反映: 子ノードでは引数として伝播)
  // W-3 反映: variant ガードをここで適用し、evaluate 内のガード (variant.id === "card-shogi") と統一
  let cardDigest: CardDigest | undefined = undefined;
  if (options.cardState !== undefined && variant.id === "card-shogi") {
    cardDigest = computeCardDigest(options.cardState);  // W-2 反映: player 引数なし
  }

  // 探索ホットパス (search.ts negamax 内) で evaluate を呼ぶ際に cardDigest を伝播
  // (= 子ノードでは computeCardDigest を呼び直さない、加算 1 op のみ)
  const score = evaluate(state, variant, cardDigest);
  // ...
}

// src/lib/shogi/ai/evaluate.ts (PR1d-1 で拡張)
// W-1 反映: cardState ではなく事前計算済 cardDigest を受領
export function evaluate(
  state: GameState,
  variant: RuleVariant,
  cardDigest?: CardDigest,  // PR1d-1 で追加 (optional、未渡時は cardDigest 加算 skip)
): number {
  let total = /* 既存評価ロジック (sente 絶対視点) */;

  // PR1d-1: cardDigest 渡時のみ加算 (加算 1 op のみ、computeCardDigest はここでは呼ばない)
  // W-3 反映: variant ガードはここでも残し、二重ガードで安全性確保
  if (cardDigest !== undefined && variant.id === "card-shogi") {
    total += evaluateCardDigest(cardDigest, variant);
  }

  return total;
}
```

`cardDigest` 未渡時は加算 skip → PR1c の 1000 局面 evaluate fixture (cardDigest 未渡) は **byte-level equality を継続保持** (論点 1 M-1 対策)。

**W-1 反映の効果**: 子ノードでの `computeCardDigest` 再計算 (`mana.sente - mana.gote` 差分 + `Math.exp(-handSize / HAND_VALUE_DECAY)` 超越関数計算等) を **構造的に禁止**。expert 探索 depth 16-24 の数百万回ノード呼出でも、cardDigest 由来の追加コストは「root で 1 回の `computeCardDigest` + 各ノードでの加算 1 op」のみ (= 親計画 md L350-356 「1 op、ホットパスへの影響は無視できる」の本来の意図と一致)。

---

## PR1d-1 詳細 — PR1c-2 残課題解消 + digest 加算 + ドロー判定 (約 1 週間)

### 目的

PR1c-2 で確立した Strategy 経由参照基盤の上に、cardDigest 評価の足場を構築する。冒頭コミットで PR1c-2 残課題 (openingBook 非決定性) を解消した上で、cardDigest interface を新規作成し、ドロー判定 (root のみ) を AI 側に組み込む。

**振る舞いキープ vs 機能追加の区別** (PR1d-2 以降の sub PR でも継承):
- **冒頭 1-2 コミット (振る舞いキープ refactor)**: `FindBestMoveOptions.useBook?` 追加 + fixture 再生成。これは PR1c-2 残課題解消であり機能追加ではない (= `useBook: true` 既定で既存挙動完全保持)
- **3 コミット目以降 (機能追加)**: cardDigest interface 新規 + `evaluateCardDigest` 実装 + DrawAction 候補生成 + reducer 連動なし (探索内のみ)

### ブランチ作成

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
git checkout -b feature/#193-pr1d-1 origin/main
```

### 影響ファイル

**新規 (4 ファイル)**:
- `src/lib/shogi/ai/cards/digest.ts` — `CardDigest` interface + `computeCardDigest` + `evaluateCardDigest`
- `src/lib/shogi/ai/cards/heuristics.ts` — 名前付き定数 (`MIN_MANA_RESERVE` / `DRAW_VALUE_BONUS` / `HAND_VALUE_BASE` / `HAND_VALUE_DECAY` / `MANA_DELTA_COEFFICIENT` / `SPECTATOR_TIME_LIMIT_MS` / `SPECTATOR_MAX_MOVES` / `SPECTATOR_MAX_CARD_OPS_PER_TURN` 等)
- `src/lib/shogi/ai/__tests__/card-digest.test.ts` — digest 計算・評価の data integrity 検証 (新規テスト)
- `src/lib/shogi/ai/__tests__/fixtures/card-digest-baseline.json` (オプション、card-digest.test.ts で参照する局面 fixture)

**編集 (5 ファイル)**:
- `src/lib/shogi/ai/engine.ts` — `FindBestMoveOptions.useBook?: boolean` 追加 + `cardState?: CardGameState` 受領 + 探索開始時に `computeCardDigest` 呼出 + evaluate に cardState 渡す経路
- `src/lib/shogi/ai/evaluate.ts` — `evaluate(state, variant, cardState?)` シグネチャ拡張 (cardState? optional) + cardDigest 加算ロジック
- `src/lib/shogi/ai/turn/current-rules.ts` — `getLegalActions` で root のみ DrawAction 候補生成
- `scripts/gen-fixture-strategy.ts` — fixture 生成時に `useBook: false` 指定 (openingBook 非決定性 bypass)
- `src/app/api/ai-move/route.ts` — `cardState` 経路を `findBestMoveWithStats` に正式に渡す (PR1a 時点では silent ignore、PR1d-1 で有効化、ただし zod-like 検証は PR1d-2/3/4 のいずれかで追加)

**再生成 (2 ファイル)**:
- `src/lib/shogi/ai/__tests__/fixtures/strategy-baseline.json` — `useBook: false` で再生成、360 entries
- `src/lib/shogi/ai/__tests__/fixtures/strategy-baseline.meta.json` — `knownLimitation` フィールド更新 (= openingBook 非決定性解消済を明示)

### 主な変更

#### 1. PR1c-2 残課題解消 (冒頭 1-2 コミット)

**問題** ([Issue #193 comment #4428841412](https://github.com/ryuichiTtb/Shogi/issues/193#issuecomment-4428841412)): PR1c-2 Phase B 動的検証で 360 entries 中 5 件 (1.4%) 不一致を検出。原因は [openingBook.ts:353](../../src/lib/shogi/ai/openingBook.ts#L353) の `Math.random()` による重み付きランダム選択。Phase B refactor のバグではない (= openingBook 範囲外の 300/300 件は完全一致で実証済) が、fixture の動的検証 100% 一致のために対応が必要。

**対策**:

1. **`FindBestMoveOptions.useBook?: boolean` 新規追加**:
   ```ts
   // src/lib/shogi/ai/engine.ts (L125-)
   export interface FindBestMoveOptions {
     timeLimitMs?: number;
     signal?: AbortSignal;
     spectator?: boolean;
     maxDepth?: number;
     useBook?: boolean;  // ← PR1d-1 で追加 (false で openingBook 完全 bypass)
   }
   ```
   既定値は `undefined` (= DIFFICULTY_PARAMS の `useBook` をそのまま使用、既存挙動完全保持)。`false` を明示渡しした場合のみ openingBook lookup を skip。

2. **engine.ts での lookup 判定経路追加**:
   ```ts
   // findBestMoveWithStats 内 (現状 L188-200 周辺の openingBook 呼出ロジック)
   const effectiveUseBook = options.useBook !== undefined
     ? options.useBook
     : strategy.useBook;  // Strategy 経由参照 (PR1c-2 で確立)
   if (effectiveUseBook && variant.id === "standard" && state.moveCount < MAX_BOOK_MOVES * 2) {
     const candidate = getBookMove(state, player);
     if (candidate) return candidate;
   }
   ```

3. **scripts/gen-fixture-strategy.ts で `useBook: false` 指定**:
   ```ts
   // scripts/gen-fixture-strategy.ts 内 (findBestMoveWithStats 呼出箇所)
   const result = findBestMoveWithStats(state, player, difficulty, variant, {
     spectator: false,
     maxDepth: STRATEGY_FIXTURE_MAX_DEPTH,
     timeLimitMs: Number.MAX_SAFE_INTEGER,
     useBook: false,  // ← PR1d-1 で追加 (openingBook 非決定性 bypass)
   });
   ```

4. **fixture 再生成 + verify 実行**:
   ```bash
   npm run gen:fixture:strategy   # 360 entries + 4 観戦シナリオ再生成 (約 60 分、maxDepth=6 固定)
   npm run verify:strategy-fixture  # 動的検証 (約 50 分)、360/360 件完全一致を確認
   ```

5. **`strategy-baseline.meta.json` の `knownLimitation` フィールド更新**:
   ```json
   "knownLimitation": "openingBook 非決定性は PR1d-1 で FindBestMoveOptions.useBook? 追加 + fixture 再生成 (useBook: false 指定) により解消済 (2026-XX-XX、PR #XXX)。verify:strategy-fixture で 360/360 件完全一致達成。"
   ```

#### 2. cardDigest interface 新規 (3 コミット目以降)

`src/lib/shogi/ai/cards/digest.ts` を新規作成:

```ts
// src/lib/shogi/ai/cards/digest.ts
import type { CardGameState } from "@/lib/shogi/cards/types";
import type { RuleVariant } from "@/lib/shogi/variants";
import { MANA_CAP } from "@/lib/shogi/cards/definitions";
import {
  MANA_DELTA_COEFFICIENT,
  HAND_VALUE_BASE,
  HAND_VALUE_DECAY,
  DRAW_PROGRESS_COEFFICIENT,
} from "./heuristics";

export interface CardDigest {
  manaDelta: number;            // sente 絶対視点 (W-2 反映)
  manaCap: number;
  handValueDelta: number;       // sente 絶対視点 (W-2 反映)
  drawProgressDelta: number;    // sente 絶対視点 (W-2 反映)
}

/**
 * sente 絶対視点で cardDigest を計算 (W-2 反映: player 引数なし、evaluate 既存実装と符号整合)。
 * 観戦モードでも 1 回だけ呼べば両プレイヤーで同じ digest を共有可能。
 */
export function computeCardDigest(cardState: CardGameState): CardDigest {
  const manaDelta = cardState.mana.sente - cardState.mana.gote;
  const handValueDelta =
    computeHandValue(cardState.hand.sente.length) -
    computeHandValue(cardState.hand.gote.length);
  const drawProgressDelta = cardState.drawProgress.sente - cardState.drawProgress.gote;
  return {
    manaDelta,
    manaCap: MANA_CAP,
    handValueDelta,
    drawProgressDelta,
  };
}

function computeHandValue(handSize: number): number {
  return HAND_VALUE_BASE * (1 - Math.exp(-handSize / HAND_VALUE_DECAY));
}

/**
 * digest を cp 単位の評価値に変換。sente 絶対視点 (sente 有利で正)。
 * W-3 反映: variant ガードを変数で受領 (呼出側でも variant ガードしているため、ここでは安全ガード)。
 */
export function evaluateCardDigest(digest: CardDigest, variant: RuleVariant): number {
  if (variant.id !== "card-shogi") return 0;  // W-3 反映: card-shogi 以外は影響なし
  return (
    digest.manaDelta * MANA_DELTA_COEFFICIENT +
    digest.handValueDelta +
    digest.drawProgressDelta * DRAW_PROGRESS_COEFFICIENT
  );
}
```

#### 3. heuristics.ts 名前付き定数集約

`src/lib/shogi/ai/cards/heuristics.ts` を新規作成 (マジックナンバー禁止、親計画 md L411-413):

```ts
// src/lib/shogi/ai/cards/heuristics.ts
export const MIN_MANA_RESERVE = 2;          // ドロー判定: マナ余裕しきい値 (DRAW_COST + 1)
export const DRAW_VALUE_BONUS = 30;          // ドローアクションの追加価値 (cp)
export const HAND_VALUE_BASE = 20;           // 手札 1 枚目の最大価値 (cp、歩 1/4 ≒ 22.5 cp)
export const HAND_VALUE_DECAY = 3.0;          // 手札増加に対する減衰係数 (= 3 枚で 95% 価値)
export const MANA_DELTA_COEFFICIENT = 10;     // マナ 1 差 = 10 cp (歩 1/9 ≒ 10 cp)
export const DRAW_PROGRESS_COEFFICIENT = 3;   // drawProgress 1 差 = 3 cp (小さく見積もる)

// PR1a で導入済の観戦モード関連 (移行先として heuristics.ts に集約)
export const SPECTATOR_TIME_LIMIT_MS = 1500;
export const SPECTATOR_MAX_MOVES = 200;
export const SPECTATOR_MAX_CARD_OPS_PER_TURN = 5;

// PR1d-3 で追加予定 (Phase 0 で枠だけ確保)
// export const DOUBLE_MOVE_TOP_K = 10;
```

**注: `HAND_LIMIT` は導入しない** (単調減衰関数で滑らかに価値が下がるため、しきい値方式は不要、親計画 md L412-413)。

#### 4. evaluate.ts への加算 (W-1 反映: cardDigest を引数として受領)

`src/lib/shogi/ai/evaluate.ts` を拡張:

```ts
// evaluate.ts (PR1d-1 で拡張、cardDigest? optional 追加)
// W-1 反映: cardState ではなく事前計算済 cardDigest を受領 (子ノードで computeCardDigest 再計算しない)
import { evaluateCardDigest, type CardDigest } from "./cards/digest";

export function evaluate(
  state: GameState,
  variant: RuleVariant,
  cardDigest?: CardDigest,  // ← PR1d-1 で追加 (optional、未渡時は加算 skip = byte-level equality 保持)
): number {
  let total = /* 既存評価ロジック (material + PST + king safety + ...、sente 絶対視点) */;

  // PR1d-1: cardDigest 渡時のみ加算 (加算 1 op のみ、ホットパス影響 = 0)
  // W-3 反映: variant ガードを呼出側 (findBestMoveWithStats) と evaluate 双方で二重化
  if (cardDigest !== undefined && variant.id === "card-shogi") {
    total += evaluateCardDigest(cardDigest, variant);
  }

  return total;
}
```

**重要 (W-1 反映)**: `computeCardDigest` は `findBestMoveWithStats` 内で root で 1 回だけ呼ぶ ([前述「加算経路の擬似コード」セクション](#加算経路の擬似コード-w-1--w-3--w-6-反映済) 参照)。evaluate 内では呼ばない (= ホットパスでの超越関数計算を構造的に禁止)。

#### 5. TurnRules.getLegalActions に DrawAction 候補追加

`src/lib/shogi/ai/turn/current-rules.ts` を拡張:

```ts
// turn/current-rules.ts (PR1d-1 で拡張)
import { DRAW_COST, AUTO_DRAW_INTERVAL } from "@/lib/shogi/cards/definitions";

export const CurrentRules: TurnRules = {
  getLegalActions(state: AiTurnState, player: Player): TurnAction[] {
    const actions: TurnAction[] = [];

    // 既存: move 候補
    const moves = getSearchLegalMoves(state.gameState, player, state.variant);
    for (const move of moves) {
      actions.push({ kind: "move", move });
    }

    // PR1d-1: root のみ DrawAction 候補追加 (depth 引数を受領するか、root 判定経路を追加)
    // 注: 現状の getLegalActions は depth 引数を持たないため、root 判定を経路として追加する設計を採用:
    // - findBestMoveWithStats から「root 列挙時のみ DrawAction を含める」フラグを TurnRules に渡す
    // - または getLegalActions(state, player, { rootOnly: boolean }) のように oneShot オプションを追加
    if (state.isRoot /* または options.rootOnly === true */) {
      if (canDraw(state.cardState, player)) {
        actions.push({ kind: "draw" });
      }
    }

    return actions;
  },
  // ...
};

function canDraw(cardState: CardGameState, player: Player): boolean {
  return (
    cardState.mana[player] >= DRAW_COST &&
    cardState.deck[player].length > 0 &&
    cardState.drawProgress[player] < AUTO_DRAW_INTERVAL - 1
  );
}
```

**ドロー判定 `< AUTO_DRAW_INTERVAL - 1` の意図** (進行中チェックリスト F-4 反映): `drawProgress = AUTO_DRAW_INTERVAL - 1 = 4` の局面では、次手番開始時に自動ドローが発火する。この局面で手動ドローを使うと **「マナ -2 + 既に出る自動ドローを 1 ターン分前倒し」** にしかならず ROI が低い。手動ドローを使うべきは `drawProgress < 4` の局面で、自動ドローを 5 ターン後に持ち越しつつマナ -2 を即時投資する場合に限る。

### 進行中チェックリスト反映 (PR1d-1 着手時、4 件)

PR1d-1 でこれら 4 項目を計画 md 本体 / 実装に反映:

| # | 指摘 | 反映内容 |
|---|------|---------|
| **第 4 次 B-1** | PR1d DoD 比較対象「PR1c-2 完了時点比」に統一 | 本計画 md の各 sub PR DoD で「PR1c-2 完了時点比」に統一済 (PR1d-1 / PR1d-2 / PR1d-3 / PR1d-4 すべて) |
| **第 4 次 C-4** | PR1d-1 Strategy 別ロジック分岐 API 例 | `Strategy.shouldDraw(state, digest): boolean` / `Strategy.cardActionPriority(action, digest): number` を Strategy interface 拡張案として PR1d-1 で擬似コード化 (詳細は PR1d-1 実装時に確定、PR1c-2 で確立した Strategy 経由参照構造を活用) |
| **第 5 次 F-4** | PR1d-1 ドロー判定 `< AUTO_DRAW_INTERVAL - 1` の意図 | 上記「ドロー判定の意図」で明示済、`canDraw` 関数の擬似コード直後に追記済 |
| **第 5 次 F-5** | `evaluateCardDigest` 戻り値 cp スケール基準 | 「cp スケール基準 (F-5 反映)」セクションで `MANA_DELTA_COEFFICIENT = 10` / `HAND_VALUE_BASE = 20` / `HAND_VALUE_DECAY = 3.0` を heuristics.ts で名前付き定数化、bench で調整と明示済 |

### Strategy 別ロジック分岐 API 例 (C-4 反映)

PR1c-2 で確立した Strategy 経由参照構造の上に、PR1d-1 で「キャラ別カード使用判断」の API を追加できる土台を整備:

```ts
// src/lib/shogi/ai/strategy/types.ts に追加する候補 API
export interface SearchStrategy {
  // 既存 (PR1c-2 で確立済)
  difficulty: Difficulty;
  maxSearchDepth: number;
  timeLimitMs: number;
  addNoise: number;
  nearEqualThreshold: number;
  useBook: boolean;
  targetReadingPly: number;

  // PR1d-1 で追加候補 (詳細は実装時に確定)
  shouldDraw?(state: AiTurnState, digest: CardDigest): boolean;
  cardActionPriority?(action: TurnAction, digest: CardDigest): number;
  // ... PR3 以降でキャラ別ロジックを充填
}
```

PR1d-1 段階では各 Strategy は **デフォルト実装** (=「全 Strategy で同一」) のままにしておき、PR3 でキャラ別差別化を導入する設計。PR1d-1 では interface 拡張のみ行い、実装は default 共通版を提供。

### 検証計画

#### 振る舞いキープ検証 (冒頭コミット分)

```bash
# Step 1: useBook? 追加コミット後、fixture 再生成
npm run gen:fixture:strategy   # 360 entries + 4 観戦シナリオ再生成 (約 60 分、useBook: false 指定)

# Step 2: 動的検証で完全一致確認
npm run verify:strategy-fixture  # 360/360 件完全一致を確認 (約 50 分)

# Step 3: 1000 局面 evaluate fixture が PR1c 時点と一致
npm run test:ci -- src/lib/shogi/ai/__tests__/evaluate-equivalence.test.ts
```

#### 機能追加検証 (cardDigest + ドロー判定)

```bash
# 必須チェック
npm run lint
npm run typecheck
npm run test:ci  # 既存テスト + 新規 card-digest.test.ts

# Vercel preview で実機検証
# - CPU が「マナ余裕 + drawProgress 進行 + 手札が乏しい」のときにドローする観察 (5 局以上、80% 以上)
# - PR1c-2 時点比で expert 棋力退化なし (Vercel preview で 5 局以上の体感検証)
```

### コミット粒度 (4 コミット分割)

PR1d-1 内部を以下のコミット粒度で分割 (AGENTS.md ルール 7「意味のある単位で分割」):

| # | コミット | 内容 |
|---|---------|------|
| 1 | `refactor: #193-PR1d-1 FindBestMoveOptions.useBook? 追加 + engine.ts lookup 経路` | useBook? 受領 + 既定値処理 (振る舞いキープ refactor) |
| 2 | `chore: #193-PR1d-1 gen-fixture-strategy.ts に useBook: false 指定 + fixture 再生成` | scripts 修正 + fixture 再生成 + meta.json 更新 |
| 3 | `feat: #193-PR1d-1 cardDigest interface + heuristics.ts + evaluateCardDigest 実装` | cards/digest.ts + cards/heuristics.ts 新規 |
| 4 | `feat: #193-PR1d-1 evaluate.ts に cardState? optional 追加 + cardDigest 加算経路` | evaluate.ts 拡張 + findBestMoveWithStats での root スカラー計算 |
| 5 | `feat: #193-PR1d-1 TurnRules.getLegalActions に root のみ DrawAction 候補追加` | turn/current-rules.ts 拡張 + canDraw ヘルパ |
| 6 | `test: #193-PR1d-1 card-digest.test.ts 新規 (digest 計算・評価の data integrity 検証)` | テスト追加 |
| 7 | (オプション) `feat: #193-PR1d-1 SearchStrategy interface に shouldDraw / cardActionPriority 候補追加` | C-4 反映、PR3 まで default 共通版 |

### DoD

- [ ] **strategy fixture 360/360 件完全一致** (`npm run verify:strategy-fixture` で 0 件不一致達成、PR1c-2 完了時点比で改善)
- [ ] **PR1c の 1000 局面 evaluate fixture が継続 green** (`evaluate(state, variant)` cardState 未渡時の byte-level equality 保持、論点 1 対策)
- [ ] **standard variant 100 局面 / card-shogi 中盤・終盤 80 局面 fixture 完全一致** (PR1c-2 完了時点比で振る舞いキープ)
- [ ] CPU が「マナ余裕 + drawProgress 進行 + 手札が乏しい」のときにドローする観察 (Vercel preview で 5 局以上、80% 以上)
- [ ] card-digest.test.ts 全 test green (新規 test、初版 5-10 ケース想定)
- [ ] **棋力退化なし** (PR1c-2 完了時点比): Vercel preview で expert vs advanced を 5 局以上対戦、勝率に有意差なし
- [ ] AGENTS.md カード追加チェックリスト「5. AI / 探索側の更新」(PR1a で追加済) の項目をすべて確認

---

## PR1d-2 詳細 — pawn_return / piece_return / double_pawn 判定 (約 1 週間)

### 目的

通常カード 3 種 (pawn_return / piece_return / double_pawn) を AI 側で判定可能にする。BEGIN_PLAY_CARD 7 項目を AI 側で再現し、enumerateTargets で対象マスを列挙、simulateCardEffect で仮想 GameState 遷移を計算して評価値を取得。

**double_move とトラップ系は別 sub PR** (PR1d-3 / PR1d-4)。本 sub PR では通常 3 カードのみ対応。

### ブランチ作成 (PR1d-1 マージ後)

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
git checkout -b feature/#193-pr1d-2 origin/main
```

### 影響ファイル

**新規 (2 ファイル)**:
- `src/lib/shogi/ai/turn/action-generator.ts` — `getCardActions` + `enumerateValidSquaresForCard` 実装
- `src/lib/shogi/ai/__tests__/action-generator.test.ts` — 3 カード × 典型局面 のテストケース (新規テスト)

**編集 (4 ファイル)**:
- `src/lib/shogi/ai/turn/current-rules.ts` — `getLegalActions` に PlayCardAction 候補を統合 (`action-generator.ts` の `getCardActions` を呼出)
- `src/lib/shogi/ai/engine.ts` — post-search blunder guard 経路に `usingCardAction` フラグ排他制御を追加 (M-2 / N-7 対応)
- `src/lib/shogi/ai/search.ts` — `TurnAction.kind === "playCard"` 分岐の評価値計算経路 (simulateCardEffect 経由)
- `src/lib/shogi/ai/strategy/types.ts` — `SearchStrategy` interface に `usingCardAction: boolean` フィールド追加 (mutable、findBestMoveWithStats 内で設定)

**参照のみ (本 sub PR では編集しない)**:
- `src/lib/shogi/cards/effects.ts` (`simulateCardEffect` L243 / `isValidCardTargetSquare` L274 / `getCheckEscapingSquares` L309 / `canEscapeCheckWithCard` L337 / `hasSameKindTrapPlaced` L400)
- `src/lib/shogi/cards/definitions.ts` (`CARD_USE_CONDITIONS` L204)
- `src/hooks/card-shogi/reducer.ts` (`BEGIN_PLAY_CARD` L1124、参照のみ、AI 側は同じ純粋関数を呼ぶ)

### 主な変更

#### 1. action-generator.ts 新規 (BEGIN_PLAY_CARD 7 項目を AI 側で再現)

`src/lib/shogi/ai/turn/action-generator.ts` を新規作成 (親計画 md L422-451 の擬似コードを準拠):

```ts
// src/lib/shogi/ai/turn/action-generator.ts
import { CARD_DEFS, CARD_USE_CONDITIONS } from "@/lib/shogi/cards/definitions";
import {
  hasSameKindTrapPlaced,
  isValidCardTargetSquare,
  getCheckEscapingSquares,
} from "@/lib/shogi/cards/effects";
import { isInCheck } from "@/lib/shogi/check";
import type { AiTurnState, TurnAction } from "./types";

/**
 * BEGIN_PLAY_CARD (reducer.ts:1124) の 7 項目を AI 側で再現。
 * 既存純粋関数 (hasSameKindTrapPlaced / isInCheck / getCheckEscapingSquares / CARD_USE_CONDITIONS) を共用し、
 * 二重実装による不一致リスクを構造的に回避。
 */
export function* getCardActions(state: AiTurnState, player: Player): Iterable<TurnAction> {
  // (1) 二手指し中は他カード禁止
  if (state.doubleMove) return;

  // (2) 自分の手番でなければ使用禁止
  if (state.gameState.currentPlayer !== player) return;

  for (const card of state.cardState.hand[player]) {
    const def = CARD_DEFS[card.defId];

    // (3) 手札にないカードは for...of で自然にスキップ (既に絞り込み済)

    // (4) マナ不足は使用不可
    if (state.cardState.mana[player] < def.cost) continue;

    // (5) 同種トラップ重複は使用不可
    if (def.kind === "trap" && hasSameKindTrapPlaced(state.cardState, player, card.defId)) continue;

    // (6) CARD_USE_CONDITIONS 個別判定 (3 枚のみ登録: pawn_return / double_pawn / piece_return)
    const useCondition = CARD_USE_CONDITIONS[card.defId];
    if (useCondition && !useCondition(state.gameState, player, state.cardState)) continue;

    // (7) 王手中: checkUsage フラグで二段ゲート
    if (isInCheck(state.gameState, player, state.variant)) {
      if (def.checkUsage === "forbidden") continue;
      if (def.checkUsage === "conditional" && def.targeting !== "none") {
        const escapingSquares = getCheckEscapingSquares(state.gameState, player, card.defId);
        if (escapingSquares.length === 0) continue;
      }
    }

    // 7 項目通過後、target 列挙して PlayCardAction を yield
    for (const target of enumerateTargets(state, def, player)) {
      yield {
        kind: "playCard",
        cardInstanceId: card.instanceId,
        defId: card.defId,
        target,
      };
    }
  }
}

/**
 * カード定義の targeting に応じて対象 target を列挙。
 * (C-5 反映、enumerateValidSquaresForCard を新規実装)
 */
function* enumerateTargets(
  state: AiTurnState,
  def: CardDefinition,
  player: Player,
): Iterable<CardTarget | null> {
  switch (def.targeting) {
    case "none":
      yield null;
      return;
    case "square": {
      for (const pos of enumerateValidSquaresForCard(state.gameState, def, player, state.cardState)) {
        yield { kind: "square", row: pos.row, col: pos.col };
      }
      return;
    }
    case "piece":
      // 将来カードで使用想定、PR1d 範囲では空ジェネレータでも可
      return;
  }
}

/**
 * targeting: "square" カード (pawn_return / piece_return / double_pawn) の対象マス列挙。
 * isValidCardTargetSquare (effects.ts:274) を 9×9 ループで呼ぶシン実装。
 */
function* enumerateValidSquaresForCard(
  gameState: GameState,
  def: CardDefinition,
  player: Player,
  cardState: CardGameState,
): Iterable<{ row: number; col: number }> {
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      if (isValidCardTargetSquare(gameState, def, player, { row, col }, cardState)) {
        yield { row, col };
      }
    }
  }
}
```

#### 2. TurnRules.getLegalActions に統合

`src/lib/shogi/ai/turn/current-rules.ts` の `getLegalActions` で root のみ playCard 候補を追加:

```ts
// turn/current-rules.ts (PR1d-2 で拡張)
import { getCardActions } from "./action-generator";

export const CurrentRules: TurnRules = {
  getLegalActions(state: AiTurnState, player: Player): TurnAction[] {
    const actions: TurnAction[] = [];

    // move 候補 (既存)
    const moves = getSearchLegalMoves(state.gameState, player, state.variant);
    for (const move of moves) actions.push({ kind: "move", move });

    // PR1d-1: root のみ DrawAction
    if (state.isRoot && canDraw(state.cardState, player)) {
      actions.push({ kind: "draw" });
    }

    // PR1d-2: root のみ PlayCardAction (通常 3 カード)
    if (state.isRoot) {
      for (const cardAction of getCardActions(state, player)) {
        actions.push(cardAction);
      }
    }

    return actions;
  },
  // ...
};
```

#### 3. simulateCardEffect 経由の仮想 GameState 遷移

`src/lib/shogi/ai/search.ts` 内で `TurnAction.kind === "playCard"` の評価値計算経路を追加:

```ts
// search.ts (PR1d-2 で拡張)
import { simulateCardEffect } from "@/lib/shogi/cards/effects";

function evaluateAction(
  state: AiTurnState,
  action: TurnAction,
  player: Player,
  variant: RuleVariant,
): number {
  switch (action.kind) {
    case "move":
      // 既存: move 適用 → 評価
      return /* existing logic */;

    case "draw":
      // PR1d-1: ドロー後の cardDigest 増分価値 + 評価関数値
      return /* draw value */;

    case "playCard": {
      // PR1d-2: simulateCardEffect で仮想 GameState 遷移
      const { nextGameState, nextCardState } = simulateCardEffect(
        state.gameState,
        state.cardState,
        action.defId,
        action.target,
        player,
      );
      // カード使用後の局面で 1 手相当の評価値を取得
      return evaluate(nextGameState, variant, nextCardState);
    }
  }
}
```

#### 4. post-search blunder guard 排他制御 (M-2 / N-7 対応)

`src/lib/shogi/ai/strategy/types.ts` に `usingCardAction: boolean` フィールドを追加し、`findBestMoveWithStats` 内で blunder guard を skip 制御:

```ts
// strategy/types.ts に追加
export interface SearchStrategy {
  // ... 既存フィールド
  usingCardAction: boolean;  // PR1d-2 で追加 (mutable、findBestMoveWithStats 内で設定)
}

// engine.ts findBestMoveWithStats 内 (L255 周辺の blunder guard 経路を改修)
const bestAction = await searchWithTurnRules(...);
strategy.usingCardAction = bestAction.kind === "playCard";

if (!strategy.usingCardAction) {
  // 通常の blunder guard 処理 (PR1c-2 時点のロジック)
  if (hasHangingPiece(nextState, player, variant)) {
    const alternatives = candidates.filter((c) => !hasHangingPiece(applyMove(c), player, variant));
    if (alternatives.length > 0) bestMove = alternatives[0];
  }
}
// playCard 使用時は blunder guard を skip (pawn_return / piece_return が「タダ取り回避」役を担う)
```

これにより:
- pawn_return / piece_return が選ばれたら blunder guard を skip (構造的排他制御)
- 通常 move が選ばれた場合は既存の blunder guard が機能 (= 振る舞いキープ)
- double_pawn は「タダ取り回避」役ではないが、blunder guard skip 経路は二重発動防止のため統一的に適用

### 進行中チェックリスト反映 (PR1d-2 着手時、1 件)

| # | 指摘 | 反映内容 |
|---|------|---------|
| **第 4 次 C-5** | `enumerateValidSquaresForCard` 擬似コードの具体化 | 上記「action-generator.ts 新規」の `enumerateValidSquaresForCard` 擬似コードで具体化済 (9×9 走査ループ + `isValidCardTargetSquare` 呼出) |

### 検証計画

#### 振る舞いキープ検証

```bash
# Step 1: 既存 fixture が継続 green (PR1d-2 で追加した PlayCardAction 経路が move-only 経路に影響しないこと)
npm run test:ci -- src/lib/shogi/ai/__tests__/strategy-equivalence.test.ts
npm run test:ci -- src/lib/shogi/ai/__tests__/evaluate-equivalence.test.ts
npm run test:ci -- src/lib/shogi/ai/__tests__/legal-moves.test.ts
```

#### 機能追加検証

```bash
# 必須チェック
npm run lint
npm run typecheck
npm run test:ci  # 既存 + 新規 action-generator.test.ts

# Vercel preview で実機検証
# - CPU が「自駒タダ取り回避」のときに pawn_return / piece_return を使う観察 (5 局以上)
# - CPU が「二歩禁則局面で歩交換」のときに double_pawn を使う観察 (3-5 局)
# - 棋力退化なし: PR1d-1 完了時点比で advanced vs expert 勝率に有意差なし
```

### コミット粒度 (3 コミット分割)

| # | コミット | 内容 |
|---|---------|------|
| 1 | `feat: #193-PR1d-2 action-generator.ts 新規 (BEGIN_PLAY_CARD 7 項目 + enumerateValidSquaresForCard)` | action-generator.ts 新規 + ユニットテスト追加 |
| 2 | `feat: #193-PR1d-2 TurnRules.getLegalActions に PlayCardAction 統合 + simulateCardEffect 経由評価` | turn/current-rules.ts + search.ts 拡張 |
| 3 | `feat: #193-PR1d-2 post-search blunder guard 排他制御 (usingCardAction フラグ)` | strategy/types.ts + engine.ts 改修 |

### DoD

- [ ] action-generator.test.ts 全 test green (3 カード × 各典型局面、初版 10-15 ケース想定)
- [ ] CPU が「自駒タダ取り回避」のときに pawn_return / piece_return を使う観察 (Vercel preview で 5 局以上)
- [ ] CPU が「二歩禁則局面で歩交換」のときに double_pawn を使う観察 (Vercel preview で 3-5 局)
- [ ] **棋力退化なし** (PR1d-1 完了時点比): Vercel preview で advanced vs expert を 5 局以上対戦、勝率に有意差なし
- [ ] blunder guard 排他制御: pawn_return 選択時に blunder guard が skip されることをログ等で確認
- [ ] strategy fixture / evaluate fixture / legal-moves fixture すべて継続 green (PR1d-2 で追加した経路が既存 fixture に影響しないこと)

---

## PR1d-3 詳細 — double_move super-action 探索 (約 1 週間、独立 sub PR)

### 目的

二手指し (double_move) は **同一プレイヤーが 2 ply 連続で指す** 特殊機構。親計画 md L484-498 で確定済の方針「root のみで 1 つの super-action として扱い、子探索を独立に走らせる」を実装。探索仕様が他カードと大きく異なるため独立 sub PR に昇格 (親計画 md L482)。

### ブランチ作成 (PR1d-2 マージ後)

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
git checkout -b feature/#193-pr1d-3 origin/main
```

### 影響ファイル

**新規 (1 ファイル)**:
- `src/lib/shogi/ai/__tests__/double-move-search.test.ts` — super-action 内部探索の動作検証 + DOUBLE_MOVE_TOP_K フォールバック動作確認 (新規テスト)

**編集 (5 ファイル)**:
- `src/lib/shogi/ai/turn/types.ts` — `ApplyActionResult` interface に `turnEnded: boolean` 追加
- `src/lib/shogi/ai/turn/current-rules.ts` — `applyAction` 戻り値に `turnEnded` を含める + `state.doubleMove` 管理ロジック追加
- `src/lib/shogi/ai/turn/action-generator.ts` — `getCardActions` に double_move 候補追加
- `src/lib/shogi/ai/search.ts` — super-action 内部探索ロジック (local αβ + α/β 値継承)
- `src/lib/shogi/ai/cards/digest.ts` — `CardDigest` に `doubleMoveActive: Player | null` 追加 + computeCardDigest で算出
- `src/lib/shogi/ai/cards/heuristics.ts` — `DOUBLE_MOVE_TOP_K = 10` 追加

### 主な変更

#### 1. applyTurnAction 戻り値拡張 (B-2 既反映)

`src/lib/shogi/ai/turn/types.ts` の `ApplyActionResult` interface を拡張:

```ts
// turn/types.ts (PR1d-3 で拡張)
export interface ApplyActionResult {
  next: AiTurnState;
  events: GameEvent[];
  turnEnded: boolean;  // ← PR1d-3 で追加 (二手指し中は false、通常駒指し / 1 アクション完結カードは true)
}
```

`turn/current-rules.ts` の `applyAction` で戻り値を埋める:

```ts
// turn/current-rules.ts (PR1d-3 で拡張)
export const CurrentRules: TurnRules = {
  applyAction(state: AiTurnState, action: TurnAction): ApplyActionResult {
    switch (action.kind) {
      case "move": {
        // 二手指し中の 1 手目 → turnEnded = false
        // 二手指し中の 2 手目 → turnEnded = true (doubleMove リセット)
        // 通常 → turnEnded = true
        const isDoubleMoveFirstMove = state.doubleMove !== null && state.doubleMove.movesLeft === 2;
        const isDoubleMoveSecondMove = state.doubleMove !== null && state.doubleMove.movesLeft === 1;

        let nextDoubleMove = state.doubleMove;
        if (isDoubleMoveFirstMove) {
          nextDoubleMove = { ...state.doubleMove, movesLeft: 1 };
        } else if (isDoubleMoveSecondMove) {
          nextDoubleMove = null;  // 二手指し終了
        }

        const turnEnded = !isDoubleMoveFirstMove;
        return { next: { ..., doubleMove: nextDoubleMove }, events: [...], turnEnded };
      }
      case "draw":
        return { ..., turnEnded: true };
      case "playCard": {
        if (action.defId === "double_move") {
          // double_move 使用直後: doubleMove フラグセット、まだターン継続
          return {
            next: { ..., doubleMove: { player, movesLeft: 2, preCardState, ... } },
            events: [/* cardPlayEvent */],
            turnEnded: false,  // ← 二手指しはターン継続
          };
        }
        // その他のカード使用: ターン終了
        return { ..., turnEnded: true };
      }
    }
  },
  // ...
};
```

#### 2. super-action 内部探索 (search.ts 拡張)

`src/lib/shogi/ai/search.ts` で double_move を super-action として扱う local αβ ロジックを実装:

```ts
// search.ts (PR1d-3 で拡張)
import { DOUBLE_MOVE_TOP_K } from "./cards/heuristics";

function searchAction(
  state: AiTurnState,
  action: TurnAction,
  alpha: number,
  beta: number,
  depth: number,
  player: Player,
  variant: RuleVariant,
): number {
  if (action.kind === "playCard" && action.defId === "double_move") {
    // PR1d-3: super-action 内部探索
    return searchDoubleMoveSuperAction(state, action, alpha, beta, depth, player, variant);
  }
  // 既存処理
  return /* negamax */;
}

function searchDoubleMoveSuperAction(
  state: AiTurnState,
  action: TurnAction,
  alpha: number,
  beta: number,
  depth: number,
  player: Player,
  variant: RuleVariant,
): number {
  // Step 1: double_move カード適用 (doubleMove フラグ ON、turnEnded = false)
  const { next: afterCard } = applyTurnAction(state, action);

  // Step 2: 1 手目候補生成 (move-only)
  const firstMoves = getSearchLegalMoves(afterCard.gameState, player, variant);
  if (firstMoves.length === 0) return -INFINITY;  // 1 手目なしは負

  let bestScore = -INFINITY;
  let firstMovesToSearch = firstMoves;

  // フォールバック: bench で +30% 超過時のみ上位 K 手に絞る (DOUBLE_MOVE_TOP_K=10)
  if (state.benchFallbackEnabled && firstMoves.length > DOUBLE_MOVE_TOP_K) {
    firstMovesToSearch = orderMovesByHeuristic(firstMoves).slice(0, DOUBLE_MOVE_TOP_K);
  }

  // Step 3: 各 1 手目について 2 手目を local αβ で探索
  for (const firstMove of firstMovesToSearch) {
    const { next: afterFirst, turnEnded: firstTurnEnded } = applyTurnAction(afterCard, {
      kind: "move",
      move: firstMove,
    });

    // turnEnded === false を保証 (= player 反転禁止、評価値符号反転禁止、depth 減算なし)
    if (firstTurnEnded) {
      throw new Error("Invariant violation: double_move 1 手目で turnEnded が true");
    }

    // 2 手目候補生成 (同一プレイヤー、player 維持)
    const secondMoves = getSearchLegalMoves(afterFirst.gameState, player, variant);
    if (secondMoves.length === 0) continue;

    for (const secondMove of secondMoves) {
      const { next: afterSecond, turnEnded: secondTurnEnded } = applyTurnAction(afterFirst, {
        kind: "move",
        move: secondMove,
      });

      // 2 手目完了で turnEnded = true → 通常の negamax に戻る
      if (!secondTurnEnded) {
        throw new Error("Invariant violation: double_move 2 手目で turnEnded が false");
      }

      // 上位探索の α/β を継承して通常 negamax で残り depth を探索
      const score = -negamax(afterSecond, -beta, -alpha, depth - 1, opponent(player), variant);

      if (score > bestScore) bestScore = score;
      if (bestScore > alpha) alpha = bestScore;
      if (alpha >= beta) return bestScore;  // αβ pruning
    }
  }

  return bestScore;
}
```

#### 3. CardDigest 拡張 (doubleMoveActive)

`src/lib/shogi/ai/cards/digest.ts` を拡張:

```ts
// cards/digest.ts (PR1d-3 で拡張)
export interface CardDigest {
  manaDelta: number;
  manaCap: number;
  handValueDelta: number;
  drawProgressDelta: number;
  doubleMoveActive: Player | null;  // ← PR1d-3 で追加 (二手指し中のプレイヤー、null=非活性)
}

export function computeCardDigest(cardState: CardGameState, player: Player): CardDigest {
  // ... 既存フィールド
  const doubleMoveActive = cardState.doubleMove?.player ?? null;
  return { ..., doubleMoveActive };
}
```

`evaluateCardDigest` で `doubleMoveActive` の評価値を加算:
- `doubleMoveActive === player`: 自分が二手指し中 → 通常 1 手の +α 価値 (cost 5 マナ消費済みなのでネット価値)
- `doubleMoveActive === opponent`: 相手が二手指し中 → 大きなマイナス (= 相手が連続で攻める)
- `doubleMoveActive === null`: 影響なし (0)

#### 4. double_move 中マナ供給差を cardDigest に反映 (G-3 反映、W-5 で MANA_FAST_BONUS vs MANA_PER_TURN を明示)

進行中チェックリスト G-3 元指摘は `MANA_FAST_BONUS` ([definitions.ts:242](../../src/lib/shogi/cards/definitions.ts#L242)、早指し時の追加分、値 = 1) の double_move 中マナ供給差を cardDigest に反映するもの。

**W-5 反映 (重要)**: G-3 元指摘の `MANA_FAST_BONUS` (早指し時の追加分) と、二手指し中の「相手ターンスキップ」由来の `MANA_PER_TURN` ([definitions.ts:241](../../src/lib/shogi/cards/definitions.ts#L241)、ターン毎の通常供給、値 = 1) は **異なる文脈の供給差**。値はどちらも `1` で偶然一致するが、意味が異なるため取り違えると将来定数値変更時にバグの温床になる。

両者の役割を整理:

| 供給差源 | 定数 | 値 | 発火条件 |
|---------|------|----|---------|
| **相手ターンスキップ** | `MANA_PER_TURN` | 1 | 自分が二手指し中 (= 2 ply 連続)、相手のターンが 1 つスキップされる → 相手のマナ供給 1 ターン分が発生しない |
| **早指しボーナス** | `MANA_FAST_BONUS` | 1 | 自分が二手指し中 + 自分の 2 手目を `FAST_THRESHOLD_MS` ([definitions.ts:243](../../src/lib/shogi/cards/definitions.ts#L243)) 以内に決定 → 早指しボーナス +1 |

`computeCardDigest` (sente 絶対視点、W-2 反映) で **両方を加算**することで完全な供給差を反映 (案 3 採用):

```ts
// digest.ts 拡張 (G-3 + W-5 反映、sente 絶対視点)
function computeManaDelta(cardState: CardGameState): number {
  let manaDelta = cardState.mana.sente - cardState.mana.gote;

  // G-3 + W-5: 二手指し中は (1) 相手ターンスキップ + (2) 早指しボーナス の両者由来の供給差を考慮
  if (cardState.doubleMove?.player === "sente") {
    // sente が二手指し中: 相手 (gote) のターンスキップ + sente 自身の早指しボーナス予想値
    manaDelta += MANA_PER_TURN + MANA_FAST_BONUS;  // = +2 (sente 視点で有利)
  } else if (cardState.doubleMove?.player === "gote") {
    // gote が二手指し中: sente 視点では -2
    manaDelta -= MANA_PER_TURN + MANA_FAST_BONUS;
  }
  return manaDelta;
}
```

**注**: 早指しボーナス (`MANA_FAST_BONUS`) は「2 手目決定までの時間が `FAST_THRESHOLD_MS` 以内」が条件。AI 探索ではボーナス獲得を **悲観的見積もり** (=確実な分のみ加算、`MANA_PER_TURN` のみ) と **楽観的見積もり** (=ボーナスも加算、`MANA_PER_TURN + MANA_FAST_BONUS`) の両極端のどちらを採るかは bench 結果で調整。PR1d-3 初版では楽観的見積もり (+2) を採用し、PR1d-4 bench で過大評価が観測された場合は悲観的見積もり (+1) に縮小する設計。

### 進行中チェックリスト反映 (PR1d-3 着手時、1 件)

| # | 指摘 | 反映内容 |
|---|------|---------|
| **第 5 次 G-3** | `MANA_FAST_BONUS` の double_move 中マナ供給差 | 上記「double_move 中マナ供給差を cardDigest に反映 (G-3 反映、W-5 で MANA_FAST_BONUS vs MANA_PER_TURN を明示)」セクションで反映済 (W-5 反映)。`computeManaDelta` 拡張で **両方の定数** (`MANA_PER_TURN` 相手ターンスキップ由来 + `MANA_FAST_BONUS` 早指しボーナス由来) を加算、楽観的見積もり (+2) を初版採用 |

### 性能影響評価と +30% フォールバック

**性能予測** (親計画 md L495):
- 1 手目候補 ~80 手 × 2 手目候補 ~80 手 = 6400 通り
- αβ pruning + α/β 値継承 + 同一プレイヤー連続探索で実効ノード ≒ 1/30 = 213 ノード分
- 通常駒指し 1 ノード比で **+30% に収まる試算**

**達成不可時のフォールバック**:
- bench で +30% 超過が観測された場合、`root のみで double_move 候補数を上位 K 手 (K=10) に絞る`
- `heuristics.ts` の名前付き定数 `DOUBLE_MOVE_TOP_K = 10`
- 1 手目を heuristic (MVV-LVA + 王手寄与スコア等) で並べ替えて上位 K 手のみ探索

### 検証計画

```bash
# 振る舞いキープ検証
npm run test:ci -- src/lib/shogi/ai/__tests__/strategy-equivalence.test.ts
npm run test:ci -- src/lib/shogi/ai/__tests__/evaluate-equivalence.test.ts

# 機能追加検証
npm run lint
npm run typecheck
npm run test:ci  # 既存 + 新規 double-move-search.test.ts

# Vercel preview で実機検証
# - CPU が「一手詰回避」のときに double_move を使う観察 (3-5 局)
# - super-action 内部探索の player 反転禁止が機能していることをログ等で確認
# - double_move 使用時の探索時間が通常駒指し +30% 以下に収まる観察 (bench fixture は PR1d-4 で整備)
```

### コミット粒度 (3 コミット分割)

| # | コミット | 内容 |
|---|---------|------|
| 1 | `feat: #193-PR1d-3 ApplyActionResult.turnEnded 追加 + applyAction での turnEnded 制御` | turn/types.ts + turn/current-rules.ts 拡張 (B-2 反映) |
| 2 | `feat: #193-PR1d-3 super-action 内部探索 (local αβ + α/β 継承 + DOUBLE_MOVE_TOP_K フォールバック)` | search.ts + heuristics.ts 拡張 + action-generator.ts に double_move 候補追加 |
| 3 | `feat: #193-PR1d-3 CardDigest に doubleMoveActive + MANA_FAST_BONUS マナ供給差反映 (G-3)` | cards/digest.ts 拡張 + evaluateCardDigest で doubleMoveActive 加算 |

### DoD

- [ ] CPU が「一手詰回避」のときに double_move を使う観察 (Vercel preview で 3-5 局)
- [ ] `double_move` 使用時の探索コストが通常駒指しの **+30% 以下** (PR1d-4 で導入する `perf-bench.test.ts` で計測、本 sub PR では暫定計測)
- [ ] +30% 超過時は `DOUBLE_MOVE_TOP_K=10` フォールバックで吸収 (該当時のみ発動、デフォルト無効)
- [ ] double-move-search.test.ts 全 test green (player 反転禁止 / α/β 継承 / フォールバック動作確認、初版 8-12 ケース想定)
- [ ] **棋力退化なし** (PR1d-2 完了時点比): Vercel preview で expert の depthCompleted 同等以上 (**-10% 以内、退化許容範囲**、W-8 反映、bench fixture は PR1d-4 で正式計測)
- [ ] strategy fixture / evaluate fixture すべて継続 green

---

## PR1d-4 詳細 — トラップ系 + cardDigest 拡張 + perf-bench.test.ts 整備 (約 1 週間)

### 目的

トラップ系カード (no_promote / check_break) を AI 側で判定可能にし、cardDigest を最終形に拡張 (`trapPresence` / `noPromoteMarksPositions`)。本 sub PR では PR1d 全体の主棋力 DoD を測定する `perf-bench.test.ts` を整備し、棋力退化なしを定量的に確認。

**親計画 md L499-505 の警告**: トラップ系は他カードよりリスクが高い (発動タイミング予測が評価関数に高い精度を要求するため)。単独で fixture green が取れない場合は PR3 (カード深読み探索) に送る判断もあり。

### ブランチ作成 (PR1d-3 マージ後)

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
git checkout -b feature/#193-pr1d-4 origin/main
```

### 影響ファイル

**新規 (2-3 ファイル)**:
- `src/lib/shogi/ai/__tests__/perf-bench.test.ts` — 人間 vs AI bench (50 局面 × 4 難易度、`depthCompleted` **-10% 以内 (退化許容範囲)** を測定、W-8 反映)
- `src/lib/shogi/ai/__tests__/perf-bench-spectator.test.ts` — 観戦モード bench (デバッグ目的、両者対称性確認)
- (オプション) `src/lib/shogi/ai/__tests__/fixtures/perf-bench-positions.json` — bench 用 50 局面 fixture

**編集 (5 ファイル)**:
- `src/lib/shogi/ai/cards/digest.ts` — `trapPresence` / `noPromoteMarksPositions` 追加
- `src/lib/shogi/ai/cards/heuristics.ts` — トラップ系名前付き定数 (`TRAP_VALUE_NO_PROMOTE` / `TRAP_VALUE_CHECK_BREAK` 等)
- `src/lib/shogi/ai/turn/action-generator.ts` — no_promote / check_break 候補追加
- `src/lib/shogi/ai/evaluate.ts` (`evaluateCardDigest` でトラップ価値計算)
- `package.json` — `test:perf-bench` script 追加 (CI 対象外、手動実行用、G-4 反映)

### 主な変更

#### 1. CardDigest 拡張 (trapPresence / noPromoteMarksPositions、W-7 反映: 実態構造から抽出経路を明示)

`src/lib/shogi/ai/cards/digest.ts` を拡張:

```ts
// cards/digest.ts (PR1d-4 で最終拡張、W-2 整合で sente 絶対視点固定)
export interface CardDigest {
  manaDelta: number;
  manaCap: number;
  handValueDelta: number;
  drawProgressDelta: number;
  doubleMoveActive: Player | null;     // PR1d-3 (= cardState.doubleMove?.player、両プレイヤーで意味が変わる例外)
  trapPresence: {                       // ← PR1d-4 で追加 (W-2 整合: sente/gote 絶対視点で両者保持)
    sente: CardId | null;               // sente の盤上トラップ defId (なければ null)
    gote: CardId | null;                // gote の盤上トラップ defId
  };
  noPromoteMarksPositions: ReadonlyArray<{ row: number; col: number; player: Player }>;  // ← PR1d-4 で追加 (W-7 反映: PieceMark に owner 情報を付加)
}
```

**W-7 反映: 実態構造からの抽出経路を擬似コードで明示**:

[`cards/types.ts:92`](../../src/lib/shogi/cards/types.ts#L92) の `TrapInstance` は `{ instanceId, defId, owner }` 構造、[`cards/types.ts:112`](../../src/lib/shogi/cards/types.ts#L112) の `PieceMark` は `{ row, col }` のみ (owner は配列が属するキーで決定)。`computeCardDigest` 拡張時の抽出経路:

```ts
// computeCardDigest 拡張 (PR1d-4、W-7 反映、sente 絶対視点)
export function computeCardDigest(cardState: CardGameState): CardDigest {
  // ... 既存フィールド (manaDelta / handValueDelta / drawProgressDelta / doubleMoveActive) ...

  // W-7 反映: TrapInstance から defId を抽出 (cardState.trap は Record<Player, TrapInstance | null>)
  const trapPresence = {
    sente: cardState.trap.sente?.defId ?? null,
    gote: cardState.trap.gote?.defId ?? null,
  };

  // W-7 反映: PieceMark[] を平坦化 + owner 情報を付加
  // (cardState.noPromoteMarks は Record<Player, PieceMark[]>、PieceMark = { row, col })
  const noPromoteMarksPositions = [
    ...cardState.noPromoteMarks.sente.map((m) => ({ row: m.row, col: m.col, player: "sente" as Player })),
    ...cardState.noPromoteMarks.gote.map((m) => ({ row: m.row, col: m.col, player: "gote" as Player })),
  ];

  return { ..., trapPresence, noPromoteMarksPositions };
}
```

#### 2. evaluateCardDigest でトラップ価値計算

```ts
// cards/digest.ts evaluateCardDigest 拡張 (PR1d-4、W-2/W-3/W-7 反映: sente 絶対視点 + variant ガード統一)
export function evaluateCardDigest(digest: CardDigest, variant: RuleVariant): number {
  if (variant.id !== "card-shogi") return 0;  // W-3 反映: card-shogi 以外は影響なし

  let value = 0;
  // sente 絶対視点 (sente 有利で正)
  value += digest.manaDelta * MANA_DELTA_COEFFICIENT;
  value += digest.handValueDelta;
  value += digest.drawProgressDelta * DRAW_PROGRESS_COEFFICIENT;
  value += evaluateDoubleMoveActive(digest.doubleMoveActive);

  // PR1d-4 + W-2 整合: トラップ価値 (sente 視点で「sente 盤上トラップ = +、gote 盤上トラップ = -」)
  if (digest.trapPresence.sente === "no_promote") {
    value += TRAP_VALUE_NO_PROMOTE;
  } else if (digest.trapPresence.sente === "check_break") {
    value += TRAP_VALUE_CHECK_BREAK;
  }
  if (digest.trapPresence.gote === "no_promote") {
    value -= TRAP_VALUE_NO_PROMOTE;
  } else if (digest.trapPresence.gote === "check_break") {
    value -= TRAP_VALUE_CHECK_BREAK;
  }

  // noPromoteMarksPositions: 各プレイヤーの自玉周辺の no_promote マークは敵成り脅威減 → sente の no_promote は +、gote の no_promote は -
  // (PieceMark に W-7 反映で付加した owner 情報を使って sente/gote 別に評価)
  value += evaluateNoPromoteMarksProximity(digest.noPromoteMarksPositions, /* sente 玉位置 + gote 玉位置を state から取得 */);

  return value;
}
```

#### 3. action-generator.ts にトラップ系候補追加

`src/lib/shogi/ai/turn/action-generator.ts` の `getCardActions` でトラップ系 (no_promote / check_break) 判定を追加。これらは `targeting: "none"` のため `enumerateTargets` は `null` を yield。

**no_promote 使用判定**:
- 序盤かつ自玉周辺の成り脅威が顕在化する前に 1 回セット (盤面 PST と整合)
- ヒューリスティクス: `state.moveCount < EARLY_GAME_THRESHOLD` && `自玉周辺の敵成り駒数 == 0`

**check_break 使用判定**:
- マナ余裕 + 玉の安全度 (king safety) が低下傾向のときにプリエンプティブセット
- ヒューリスティクス: `cardState.mana[player] >= MIN_MANA_RESERVE_FOR_TRAP` && `kingSafetyScore < CHECK_BREAK_TRIGGER_THRESHOLD`

これらしきい値は `heuristics.ts` で名前付き定数化:

```ts
// cards/heuristics.ts (PR1d-4 追加分)
export const TRAP_VALUE_NO_PROMOTE = 50;          // no_promote セット価値 (cp)
export const TRAP_VALUE_CHECK_BREAK = 80;          // check_break セット価値 (cp)
export const EARLY_GAME_THRESHOLD = 40;            // 序盤しきい値 (両者合計 ply)
export const MIN_MANA_RESERVE_FOR_TRAP = 6;        // トラップセット時のマナ余裕しきい値
export const CHECK_BREAK_TRIGGER_THRESHOLD = -200; // 玉の安全度悪化しきい値 (cp)
export const NO_PROMOTE_PROXIMITY_BONUS = 30;       // 自玉周辺 no_promote マークの追加価値 (cp/マーク)
```

#### 4. perf-bench.test.ts 整備

`src/lib/shogi/ai/__tests__/perf-bench.test.ts` を新規作成。50 局面 × 4 難易度 (beginner / intermediate / advanced / expert) で `depthCompleted` と `nodes/sec` を測定:

```ts
// perf-bench.test.ts (新規)
import { describe, test, expect, skip } from "vitest";
import { findBestMoveWithStats } from "../engine";
import benchPositions from "./fixtures/perf-bench-positions.json";

const SKIP_IN_CI = process.env.CI === "true" || process.env.SKIP_PERF_BENCH === "true";

describe.skipIf(SKIP_IN_CI)("perf-bench (人間 vs AI bench)", () => {
  const difficulties = ["beginner", "intermediate", "advanced", "expert"] as const;

  for (const difficulty of difficulties) {
    test(`${difficulty}: 50 局面で depthCompleted を測定`, async () => {
      const results = [];
      for (const position of benchPositions.entries) {
        const result = await findBestMoveWithStats(
          deserializeGameState(position.state),
          position.player,
          difficulty,
          CARD_SHOGI_VARIANT,
          { spectator: false, timeLimitMs: 3500 /* expert 既定 */ },
          position.cardState,
        );
        results.push(result);
      }
      const avgDepthCompleted = results.reduce((s, r) => s + r.depthCompleted, 0) / results.length;
      const avgNodesPerSec = results.reduce((s, r) => s + r.nodesPerSec, 0) / results.length;
      console.log(`${difficulty}: avgDepth=${avgDepthCompleted.toFixed(2)}, avgNodes/s=${avgNodesPerSec.toFixed(0)}`);
      // PR1c-2 完了時点 baseline と比較 (PR1d-4 で baseline 値を fixtures/perf-bench-baseline.json に保存)
      // expect(avgDepthCompleted).toBeGreaterThan(baseline.depthCompleted * 0.9);
    });
  }
});
```

**bench fixture 2 系統運用** (親計画 md L646-650):

| ファイル | 用途 | 設定 | DoD 役割 |
|---------|------|------|---------|
| `perf-bench.test.ts` | 人間 vs AI 想定 | 早指しボーナスあり、`timeLimitMs` 元値 (3500ms expert / 2200ms advanced 等) | **PR1d 主棋力 DoD 基準** |
| `perf-bench-spectator.test.ts` | 観戦モード | 早指しボーナスなし、`timeLimitMs` 1500ms 短縮 | **両者対称振る舞い確認 (デバッグ目的)** |

**CI 対象外として分離** (G-4 反映):

```json
// package.json scripts 追加
{
  "scripts": {
    "test:perf-bench": "vitest run src/lib/shogi/ai/__tests__/perf-bench.test.ts src/lib/shogi/ai/__tests__/perf-bench-spectator.test.ts",
    "test:perf-bench:human": "vitest run src/lib/shogi/ai/__tests__/perf-bench.test.ts",
    "test:perf-bench:spectator": "vitest run src/lib/shogi/ai/__tests__/perf-bench-spectator.test.ts"
  }
}
```

`describe.skipIf(SKIP_IN_CI)` パターンで CI 環境では自動 skip。リリース前手動実行で棋力指標を継続観測。

### 進行中チェックリスト反映 (PR1d-4 / PR1d 全体で対応、3 件)

| # | 指摘 | 反映内容 |
|---|------|---------|
| **第 4 次 A-2** | 観戦両者対称性の定量定義 (W-4 反映: 2 層検証で `addNoise` 値別の論理整合を確保) | **2 層検証**を PR1d-4 DoD に組み込む: (1) **advanced/expert (`addNoise=0`、deterministic)**: `perf-bench-spectator.test.ts` で同一難易度同士の観戦 1 局を実行 → 両者対称的な手系列が成立 (= data integrity 検証、deterministic AI 同士のため 50 局は同一結果のため不要) (2) **beginner/intermediate (`addNoise > 0`、非決定的)**: 同一難易度同士の観戦 50 局を実行 → 勝率 40-60% (= 完全対称想定で 50%、揺らぎ ±10%) を満たす (= 統計検証) — PR1c-2 計画 md で確立した「2 層構造の検証」(advanced/expert 完全一致 DoD + beginner/intermediate フィールド値検証) を踏襲 |
| **第 4 次 C-3** | PR1d 完成時の観戦モード fixture 再生成判断 | PR1d-4 段階で観戦モード基準 fixture (`spectator-baseline.json`) を **新基準として再生成** (PR1d-1〜3 で cardDigest 導入により振る舞いが意図的に変わるため)。PR1d-1 で当該 fixture を一旦 deprecate コメント化し、PR1d-4 完了時に再生成 + meta.json 更新 |
| **第 5 次 G-4** | bench fixture の CI 対象外分離 | 上記「CI 対象外として分離」セクションで `describe.skipIf(SKIP_IN_CI)` パターン + `test:perf-bench` script 分離を反映済 |

### 検証計画

```bash
# 振る舞いキープ検証 (cardDigest 拡張後も byte-level equality 維持)
npm run test:ci -- src/lib/shogi/ai/__tests__/evaluate-equivalence.test.ts   # cardState 未渡時の byte-level equality
npm run test:ci -- src/lib/shogi/ai/__tests__/strategy-equivalence.test.ts   # standard variant fixture

# 機能追加検証
npm run lint
npm run typecheck
npm run test:ci  # 通常 CI tests (perf-bench は skip)

# bench 実行 (リリース前手動)
npm run test:perf-bench:human      # depthCompleted -10% 以内 (退化許容範囲) を確認 (W-8 反映、約 30-60 分)
npm run test:perf-bench:spectator  # 両者対称性確認 (約 30-60 分)

# Vercel preview で実機検証
# - CPU が「序盤に 1 回」no_promote をセットする観察 (1 局あたり 0 or 1 回、3-5 局)
# - CPU が「玉の安全度低下」のときに check_break をプリエンプティブセットする観察 (3-5 局)
# - 棋力退化なし: PR1c-2 完了時点比で expert vs advanced 勝率が同等以上 (人間 vs AI bench で 10 局以上)
```

### コミット粒度 (4 コミット分割)

| # | コミット | 内容 |
|---|---------|------|
| 1 | `feat: #193-PR1d-4 CardDigest に trapPresence + noPromoteMarksPositions 追加` | cards/digest.ts 拡張 + heuristics.ts 追加定数 |
| 2 | `feat: #193-PR1d-4 evaluateCardDigest でトラップ価値計算 + 自玉周辺 no_promote 追加価値` | cards/digest.ts evaluateCardDigest 拡張 |
| 3 | `feat: #193-PR1d-4 action-generator.ts にトラップ系候補追加 (no_promote / check_break)` | turn/action-generator.ts 拡張 + getCardActions 7 項目判定 |
| 4 | `test: #193-PR1d-4 perf-bench.test.ts 新規 + bench fixture 2 系統 + CI 対象外分離 (G-4)` | perf-bench.test.ts + perf-bench-spectator.test.ts 新規 + package.json scripts + skipIf 制御 |
| 5 | (オプション) `chore: #193-PR1d-4 観戦モード基準 fixture (spectator-baseline.json) 再生成 (C-3)` | scripts/gen-fixture-strategy.ts 観戦モード再生成 + meta.json 更新 |

### DoD (PR1d 全体の最終 DoD を本 sub PR で確認)

#### PR1d-4 個別 DoD

- [ ] CPU が「序盤に 1 回」no_promote をセットする観察 (Vercel preview で 1 局あたり 0 or 1 回、3-5 局)
- [ ] CPU が「玉の安全度低下」のときに check_break をプリエンプティブセットする観察 (Vercel preview で 3-5 局)
- [ ] cardDigest 拡張後も **byte-level equality 維持** (cardState 未渡時、PR1c の 1000 局面 evaluate fixture 継続 green)
- [ ] perf-bench.test.ts: expert / advanced の `depthCompleted` が PR1c-2 完了時点比で **-10% 以内 (退化許容範囲)** (W-8 反映)
- [ ] observation: 観戦モード両者対称性 (W-4 反映の 2 層検証): (1) advanced/expert (`addNoise=0`、deterministic): 観戦 1 局で両者対称的な手系列成立 (data integrity)、(2) beginner/intermediate (`addNoise > 0`): 観戦 50 局で勝率 40-60% (統計検証、揺らぎ ±10%)

#### PR1d 全体の主棋力 DoD (本 sub PR で測定)

- [ ] **主棋力 DoD**: 人間 vs AI bench (元 timeLimitMs) で expert vs advanced の勝率が **PR1c-2 完了時点比で退化なし** (= 同等以上、人間 vs AI bench で 10 局以上)
- [ ] cardDigest 加算で expert の `depthCompleted` が **PR1c-2 完了時点比で -10% 以内 (退化許容範囲、+10% 改善は通常あり得ないため許容方向のみ)** (B-1 / W-8 反映、比較対象明示)
- [ ] CPU が「マナ余裕 + drawProgress 進行 + 手札が乏しい」のときにドローする観察 (10 局以上で 80% 以上、PR1d-1 で達成、本 sub PR で再確認)
- [ ] CPU が「自駒タダ取り回避」のときに pawn_return / piece_return を使う観察 (PR1d-2 で達成、本 sub PR で再確認)
- [ ] CPU が「一手詰回避」のときに double_move を使う観察 (PR1d-3 で達成、本 sub PR で再確認)
- [ ] PR1d-3 の `double_move` 使用時の探索コスト測定: 通常駒指しの **+30% 以下**、超過時は `DOUBLE_MOVE_TOP_K=10` フォールバックで吸収
- [ ] 観戦モード bench (デバッグ目的): expert 自己対戦で両者対称的な振る舞い、200 手以内に終局
- [ ] CI 実行時間は perf-bench を skip したまま PR1c-2 時点比で増分 ±5% 以内 (G-4 反映の CI 対象外分離が機能していること)

---

## ブランチ運用と push 手順

### 全体構成 (4 sub PR 順次マージ)

```
main (5badcab、PR1c-2 完了時点)
 └─ feature/#193-pr1d-1 (= 本計画 md レビュー完了後に着手)
     └─ マージ後 → feature/#193-pr1d-2 を origin/main 起点で作成
         └─ マージ後 → feature/#193-pr1d-3 を origin/main 起点で作成
             └─ マージ後 → feature/#193-pr1d-4 を origin/main 起点で作成
                 └─ マージ後 → PR1d 完了 (Issue #193 4/11 PR → 5/11 PR)
```

### 各 sub PR の push 手順 (PR1c-2 と同じ運用、AGENTS.md ルール 4 / 6)

```bash
# 着手前: origin/main 最新化
git fetch origin
git checkout main
git pull --ff-only origin main

# ブランチ作成
git checkout -b feature/#193-pr1d-X origin/main

# 実装 → コミット (意味のある単位、AGENTS.md ルール 7)
# ...

# 必須チェック (AGENTS.md 実装ガイドライン 6)
npm run lint
npm run typecheck
npm run test:ci
npm run build

# Vercel preview 検証 (push 後)
git push -u origin feature/#193-pr1d-X

# レビュー依頼コメント投稿 (Issue #193)
# PR 作成・マージは別途指示まで実施しない (AGENTS.md ルール 1)
```

### 本計画 md PR の push 手順 (本セッション固有)

```bash
# ブランチ: chore/#193-pr1d-plan (本計画 md 作成のみ、コード変更なし)
# 必須チェック: lint / typecheck (build / test:ci は docs-only のため省略可)
npm run lint
npm run typecheck

# コミット (日本語、AGENTS.md ルール 7)
git add docs/plans/issue-193-pr1d.md
git commit -m "docs: #193 PR1d 計画 md を追加"

# push
git push -u origin chore/#193-pr1d-plan
```

---

## コミットメッセージ規約 (AGENTS.md ルール 7 準拠)

### 命名規則

```
{prefix}: #193-PR1d-N {作業内容}

{詳細本文}
```

| prefix | 用途 |
|--------|------|
| `feat:` | 新機能追加 (cardDigest 加算、ドロー判定、playCard 候補生成、トラップ系等) |
| `refactor:` | 振る舞いキープのコード整理 (useBook? 追加、評価関数シグネチャ拡張等) |
| `chore:` | 依存関係更新、設定変更、fixture 再生成、scripts 修正 |
| `test:` | テスト追加 (card-digest.test.ts、action-generator.test.ts、perf-bench.test.ts 等) |
| `docs:` | ドキュメント追加・修正 (本計画 md、AGENTS.md 等) |

### 例

```
feat: #193-PR1d-1 cardDigest interface + heuristics.ts + evaluateCardDigest 実装

src/lib/shogi/ai/cards/digest.ts (新規) で CardDigest interface を定義
(manaDelta / manaCap / handValueDelta / drawProgressDelta フィールド)。
src/lib/shogi/ai/cards/heuristics.ts (新規) で名前付き定数 (HAND_VALUE_BASE = 20 等)
を一元管理。evaluateCardDigest は cp 単位で評価値を返し、variant.id === "standard"
時は 0 を返すことで standard variant への影響を排除。
```

---

## 重要マイルストーン (AGENTS.md ルール 8 = Issue #109 観点レビュー)

各 sub PR で 3 段階レビュー:

1. **計画策定後** (本計画 md = Phase 0) → **進行中、本 chore PR でレビュー実施**
2. **実装完了後** (push 前) → lint / typecheck / test:ci / build を実行 + 親計画 md / 進行中チェックリスト 19 件と照合
3. **マージ前** (ユーザーレビュー) → Vercel preview で実機検証 + ユーザー確認

レビュー観点は **常に Issue #109 を参照** (本計画 md に転記しない、AGENTS.md ルール 8)。各マイルストーン到達時、`gh issue view 109` 等で最新の Issue #109 内容を取得してから観点に沿ってレビュー。

---

## 進行中チェックリスト 19 件 + 第 N 次レビュー対応

### A. 進行中チェックリスト 19 件由来 ([Issue #193 comment #4414636364](https://github.com/ryuichiTtb/Shogi/issues/193#issuecomment-4414636364))

PR1d で対応する 9 項目を抽出:

| # | 指摘 | 対応 sub PR |
|---|------|-------------|
| **第 4 次 A-2** | 観戦両者対称性の定量定義 | PR1d-4 (perf-bench-spectator.test.ts で勝率 40-60% を DoD に組み込み) |
| **第 4 次 B-1** | PR1d DoD 比較対象「PR1c-2 完了時点比」に統一 | PR1d-1 (各 sub PR DoD で「PR1c-2 完了時点比」に統一済) |
| **第 4 次 C-3** | PR1d 完成時の観戦モード fixture 再生成判断 | PR1d-4 (`spectator-baseline.json` を新基準として再生成、`scripts/gen-fixture-strategy.ts` 観戦モード再実行) |
| **第 4 次 C-4** | PR1d-1 Strategy 別ロジック分岐 API 例 | PR1d-1 (`Strategy.shouldDraw(state, digest)` / `Strategy.cardActionPriority(action, digest)` を interface 拡張候補として明示、default 共通実装) |
| **第 4 次 C-5** | `enumerateValidSquaresForCard` 擬似コードの具体化 | PR1d-2 (9×9 走査ループ + `isValidCardTargetSquare` 呼出の擬似コードを明示済) |
| **第 5 次 F-4** | PR1d-1 ドロー判定 `< AUTO_DRAW_INTERVAL - 1` の意図 | PR1d-1 (`drawProgress = 4` 局面では手動ドロー ROI 低の意図説明を明示済) |
| **第 5 次 F-5** | `evaluateCardDigest` 戻り値 cp スケール基準 | PR1d-1 (`MANA_DELTA_COEFFICIENT = 10` / `HAND_VALUE_BASE = 20` / `HAND_VALUE_DECAY = 3.0` を heuristics.ts で named constant 化、bench で調整) |
| **第 5 次 G-3** | `MANA_FAST_BONUS` の double_move 中マナ供給差を cardDigest に反映 | PR1d-3 (W-5 反映: `computeManaDelta` で `cardState.doubleMove?.player === "sente"/"gote"` のとき **`MANA_PER_TURN + MANA_FAST_BONUS`** の両方加算 (相手ターンスキップ由来 + 早指しボーナス由来)、楽観的見積もり +2 を初版採用、bench で過大評価観測時に縮小) |
| **第 5 次 G-4** | bench fixture の CI 対象外分離 | PR1d-4 (`describe.skipIf(SKIP_IN_CI)` パターン + `test:perf-bench` script 分離) |

### B. PR1d スコープ外 10 項目 (PR1a/PR1c-2 着手時に対応済)

PR1d 計画 md / 実装には反映しない:

- **第 4 次 A-3** (PR1c-2 観戦モード fixture 検証意義) — PR1c-2 着手時対応済 (`addNoise=0` 主要検証は standard variant 100 局面と明記)
- **第 4 次 C-1** (ロードマップ表 PR1a 可読性) — PR1a 着手時対応済 or 任意 (改行で項目分割)
- **第 4 次 C-2** (PR1c-2 独立化理由 + リスク #16 冗長性) — PR1c-2 計画 md でリンク化済
- **第 4 次 C-6** (用語定義新規概念追加) — PR1a/PR1c-2 で `super-action` / `strategy-equivalence fixture` / `観戦モード基準 fixture` を用語定義に追加済
- **第 5 次 F-1** (SpectatorOverride ファイル分離と擬似コードの不整合) — PR1a 着手時対応済 (`spectator-override.ts` は定数集約のみ)
- **第 5 次 F-2** (`useDbPersistenceGuard` を `canPersist()` ヘルパ関数化) — PR1a 着手時対応済 or 任意
- **第 5 次 F-3** (`isAiThinking` ⇔ `isPaused` 相互作用 + cancel API 経路) — PR1a 着手時対応済
- **第 5 次 G-1** (`undoSnapshots` リングバッファと観戦モード関係) — PR1a 着手時対応済
- **第 5 次 G-2** (リロード時の観戦モード UX) — PR1a 着手時対応済
- **第 5 次 G-5** (AI が `move: null` を返した場合の終局フロー) — PR1a 着手時対応済 (観戦モード終局判定に追加済)

---

## 運用注意書き — Issue / PR コメント参照時の comment_id 取得ルール (Z-1 継承)

**背景**: PR1a/PR1b/PR1c 計画 md レビューサイクルで `comment_id` の誤記が **3 サイクル連続で再発** した。原因は AI が 10 桁の数字 id を短期記憶でタイプしていたため。本セッションでも引き継ぎメモで「PR1c-2 完了報告: #4421178284」と誤参照があったが、第 1 次レビュー指摘 (N-2) で訂正済 (= 実態は `#4428841412`)。

**運用ルール** (本計画 md 以降の全 sub PR で継承):

1. **正しい comment_id は `gh api` コマンドで取得し、推測タイプは禁止**:
   ```bash
   gh api repos/ryuichiTtb/Shogi/issues/193/comments \
     --jq '.[] | {id, created_at, body_start: (.body[:80])}'
   ```
   出力の `id` フィールドを **コピペ** で使用 (タイプし直さない)
2. **代替手段**: GitHub UI でコメントの「...」メニュー → 「Copy link」で URL 全体をコピペ
3. **参照前のセルフチェック**: コメント参照前に `gh api repos/ryuichiTtb/Shogi/issues/comments/<id>` で 200 が返ることを確認 (404 なら誤り)
4. **同じ id を複数回参照する場合**: 最初の 1 回だけ手作業、以降はファイル内 grep / Edit replace_all で複製 (タイプを増やさない)

**PR description 更新時の追加運用** (PR1b/PR1c で確立):

- `gh pr edit --body` は GraphQL Projects (classic) のエラーで失敗する可能性がある
- 確実な方法: **REST API 直接呼び出し** `gh api --method PATCH /repos/ryuichiTtb/Shogi/pulls/<N> -f body="..."`
- 検証は Summary セクションだけでなく、**問題箇所 (= 訂正対象の旧記述があった箇所) を grep で 0 件確認** することで担保

**過去の誤記履歴** (再発防止のための記録):

| サイクル | 誤った id | 正しい id | 検知 |
|---------|----------|----------|------|
| PR1a 第 1 次 M-3 | `4415459081` | `4415458652` | レビューで指摘 |
| PR1a 第 2 次 X-1 | `4415512049` | `4415518533` | レビューで指摘 |
| PR1a 第 3 次 Z-1 | `4415540843` | `4415542513` | レビューで指摘、運用ルール導入で再発防止 |
| PR1d 引き継ぎ N-2 | `4421178284` | `4428841412` | 本計画 md セッション第 1 次レビュー (N-2) で訂正 |

**PR description で Closes キーワード混入禁止** (PR #207 事例):

- ❌ NG: `` `Closes #193` `` (バッククォート引用も GitHub パーサーに検知される)
- ❌ NG: `Closes #193`、`Fixes #193`、`Resolves #193` (全て検知)
- ✅ OK: 「Issue #193 の PR1d-N に対応」「関連: Issue #193」
- コメント / PR description 投稿前に `grep -E "Closes|Fixes|Resolves" body.md` で **0 件確認** を徹底

---

## 想定リスクと対策

| # | リスク | 対策 |
|---|--------|------|
| **R1** | cardDigest 加算による評価関数 byte-level equality 破綻 | `evaluate(state, variant, cardState?)` で `cardState?` optional 追加 → `cardState` 未渡時は cardDigest 加算 skip、PR1c の 1000 局面 evaluate fixture が継続 green (論点 1 M-1 対策、PR1d-1 で構造的に解消) |
| **R2** | TT (Transposition Table) の board hash + cardDigest 整合性 | cardDigest を root スカラー化することで TT 誤キャッシュを構造的に回避 (論点 4 M-4 対策、親計画 md L354 / リスク #9) |
| **R3** | post-search blunder guard と pawn_return / piece_return 機能重複 | Strategy 内で `usingCardAction: boolean` フラグを保持、`findBestMoveWithStats` 内 blunder guard を skip (論点 2 M-2 / N-7 対策、PR1d-2 で実装) |
| **R4** | double_move super-action 探索の +30% 性能超過 | `DOUBLE_MOVE_TOP_K=10` フォールバック (1 手目を heuristic でソートして上位 K 手のみ探索、親計画 md L495、PR1d-3 で実装) |
| **R5** | 二手指し中の player 反転バグ | `applyTurnAction` の `turnEnded === false` で同一プレイヤー継続を保証 (論点 3 M-3 / B-2 対策、PR1d-3 で実装、検証側で fixture green) |
| **R6** | route.ts cardState 受領経路の silent ignore vs 400 返却 | PR1a は silent ignore (E-2 既反映)、PR1d-1 で route.ts に正式渡し、PR1d-2/3/4 のいずれかで `src/lib/shogi/cards/validate.ts` 新規 + 400 返却に格上げ (PR1d-1 では型不一致は引き続き silent ignore で振る舞いキープ優先) |
| **R7** | openingBook 非決定性 (#4428841412 発見、5/360 件 1.4% 不一致) | PR1d-1 冒頭コミットで `FindBestMoveOptions.useBook?` 追加 + fixture 再生成 (`useBook: false` 指定) で解消、`knownLimitation` フィールドも更新 |
| **R8** | handValue 単調減衰関数の係数チューニング | 仮基準 (`HAND_VALUE_BASE = 20` / `HAND_VALUE_DECAY = 3.0`) で実装 → PR1d-4 bench で調整 → 必要に応じて PR3 で再調整 (F-5 反映) |
| **R9** | cardDigest 拡張時 (PR1d-3 `doubleMoveActive` / PR1d-4 `trapPresence`) の byte-level equality 維持 | cardState 未渡時の振る舞いキープ、各 sub PR で fixture green を確認 (PR1d-3/4 で新規フィールド追加時も `cardState === undefined` 経路は影響なし) |
| **R10** | bench fixture 2 系統 (perf-bench + perf-bench-spectator) の CI 実行時間爆発 | `npm run test:perf-bench` 等の手動実行に分離、`describe.skipIf(SKIP_IN_CI)` パターン (G-4 反映、PR1d-4 で実装) |
| **R11** | cardDigest による評価値スケール調整 | `MANA_DELTA_COEFFICIENT = 10` (マナ 1 ≒ 10 cp ≒ 歩 1/9)、PIECE_VALUES と整合する単位 cp で表現、PR1d-4 bench で調整 (F-5 反映) |
| **R12** | super-action 内部探索の α・β 値継承バグ | 上位探索の α/β を子探索に渡す際の符号反転・継承順序の整合性確保 (PR1d-3、一般的な super-action パターン、null-move pruning と類似、double-move-search.test.ts で検証) |
| **R13** | トラップ系 (no_promote / check_break) 発動タイミング予測の評価関数精度不足 | 単独で fixture green が取れない場合は **PR3 (カード深読み探索) に送る判断** もあり (親計画 md L505、PR1d-4 段階で観察) |
| **R14** | comment_id 誤記の 5 サイクル目再発 | Z-1 継承、`gh api` で取得した id を grep で複製、推測タイプ禁止 (本計画 md セッションで `#4421178284` ⇔ `#4428841412` 取り違えを N-2 で防止済) |
| **R15** | PR description Closes キーワード混入 (PR #207 事例) | バッククォート引用も検知される、`Closes` / `Fixes` / `Resolves` 0 件確認、PR1c-2 と同じ運用、レビュー依頼コメント投稿前に grep で 0 件確認 |

---

## 検証計画

### 各 sub PR 共通必須チェック (AGENTS.md 実装ガイドライン 6)

各 sub PR で以下を順次実行 (PR1c-2 と同じ運用):

1. `npm run lint`
2. `npm run typecheck`
3. `npm run test:ci`
4. `npm run build`

失敗時は通るまで修正してから push (`--no-verify` 禁止、AGENTS.md ルール 7)。

### fixture-driven 検証の役割分担方式 (PR1c-2 で確立、PR1d で継承)

PR1c-2 で確立した方式 (役割分担):

| 検証層 | 実行タイミング | カバー範囲 | 実行時間目安 |
|--------|--------------|----------|---------------|
| **test:ci 内 (data integrity のみ)** | 各 sub PR push 前 + CI | fixture 構造妥当性 22 tests (PR1c-2 時点) + 各 sub PR の新規 test | 3.76s (PR1c-2 時点) → PR1d-1 で +0.5-1s 想定 |
| **CI 外 (動的検証)** | リリース前手動 | `npm run verify:strategy-fixture` で 360 entries 再実行 + 完全一致確認 | 約 50 分 |
| **CI 外 (bench)** | リリース前手動 (PR1d-4 で新設) | `npm run test:perf-bench` で 50 局面 × 4 難易度 × 2 系統 | 約 30-60 分 |
| **Vercel preview** | push 後 | 実機 UX 確認、CPU 行動観察、棋力体感 | 5-10 局/sub PR |

### fixture 生成・更新ワークフロー (PR1d で追加分)

| スクリプト | 用途 | 再生成すべきタイミング |
|-----------|------|-----------------------|
| `npm run gen:fixture:strategy` | PR1c-2 で確立済 (180 局面 × 2 difficulty + 4 観戦シナリオ) | PR1d-1 冒頭で `useBook: false` 指定で再生成 + PR1d-4 で観戦モード再生成 (C-3 反映) |
| `npm run verify:strategy-fixture` | PR1c-2 で確立済 (動的検証) | PR1d-1 で `useBook: false` fixture 確立後、360/360 件完全一致確認 |
| `npm run gen:fixture:legal-moves` | PR1b で確立済 (200-300 局面) | PR1d では再生成不要 (legal moves 実装に変更なし) |
| `npm run gen:fixture:evaluate` | PR1c で確立済 (1000 局面) | PR1d では再生成不要 (cardState 未渡時は byte-level equality 保持、cardState 渡時は別 fixture で扱う) |
| `npm run test:perf-bench` | PR1d-4 で新設 (50 局面 × 4 難易度 × 2 系統) | PR1d-4 完了時、PR1d 全体の主棋力 DoD を測定 |

### 観戦モード基準 fixture の扱い (C-3 反映)

PR1a で `spectator-baseline.json` を保存、各 PR で扱いが変わる:

- **PR1c-2 マージ時点 (5badcab)**: 4 シナリオ × 50 ply、`addNoise=0` で deterministic AI 同士 → ply 25 で同一展開が繰り返される (data integrity 検証としては問題なし)
- **PR1d-1〜3 進行中**: 振る舞いが意図的に変わるため、観戦モード基準 fixture は **deprecated 扱い** (CI 外検証)
- **PR1d-4 完了時**: 観戦モード基準 fixture を **新基準として再生成** (C-3 反映)、`spectator-baseline.meta.json` 更新

---

## 想定スケジュール (目安)

| 段階 | 内容 | 期間目安 |
|------|------|---------|
| 本フェーズ (Phase 0) | 計画 md レビュー 1-4 サイクル | 1-2 週間 |
| PR1d-1 実装 | useBook? + fixture 再生成 + digest 加算 + ドロー判定 | 1 週間 (実装 4-5 日 + レビュー 2-3 日) |
| PR1d-2 実装 | pawn_return / piece_return / double_pawn + blunder guard 排他制御 | 1 週間 |
| PR1d-3 実装 | double_move super-action 探索 | 1 週間 (探索仕様が複雑なため最長想定) |
| PR1d-4 実装 | トラップ系 + cardDigest 拡張 + perf-bench 整備 + 主棋力 DoD 測定 | 1 週間 |
| **PR1d 全体合計** | 計画 md レビュー + 4 sub PR | **5-8 週間** (順次マージ前提) |

### 各 sub PR のレビューサイクル想定

- 計画 md レビュー: 1-4 サイクル (PR1a 4 / PR1c-2 4 サイクル実績、本計画 md も継承)
- 各 sub PR 実装レビュー: 1-3 サイクル (機能スコープ分割で粒度を抑える、合計 5-16 サイクル)

---

## AGENTS.md 規約準拠の確認

- [x] 絶対ルール 1: PR 作成・マージ・Issue クローズは指示まで禁止 → 各 sub PR push 後に止まる、PR 作成は別途指示で実施
- [x] 絶対ルール 2: 専用ブランチで作業、軽微派生は同居 → `feature/#193-pr1d-N` で進める、軽微派生は同ブランチに同居 + Issue #193 にコメント記録
- [x] 絶対ルール 3: ブランチ命名規則 → `chore/#193-pr1d-plan` (本計画 md)、`feature/#193-pr1d-1` 〜 `feature/#193-pr1d-4` (各 sub PR、機能追加カテゴリ)
- [x] 絶対ルール 4: 新規ブランチは `origin/main` 起点 → 各 sub PR で `git fetch origin && git checkout -b feature/#193-pr1d-N origin/main`
- [x] 絶対ルール 5: 破壊的操作は事前確認 → PR1d 全体で破壊的操作は基本なし、fixture 再生成 (gen:fixture:strategy で既存ファイル上書き) は実質再生成だが事前確認推奨
- [x] 絶対ルール 6: Vercel デプロイ確認のため push まで → 各 sub PR で push まで完了、Vercel preview で実機検証
- [x] 絶対ルール 7: コミット意味単位、PR タイトル簡潔、Issue タイトル簡潔 → 各 sub PR 内部で 3-7 コミット分割 (本計画 md「コミット粒度」セクション参照)、PR タイトル例「AI: cardDigest 加算 + ドロー判定 (#193-PR1d-1)」
- [x] 絶対ルール 8: 重要マイルストーンレビュー → 計画策定後・実装完了後・マージ前の 3 段階で Issue #109 観点レビュー
- [x] 絶対ルール 9: Worktree 推奨 → 本フェーズ Worktree 使用しない (本計画 md セッションでユーザー確定済)。実装フェーズ (PR1d-1〜PR1d-4) で並行作業発生時は別途 Worktree 化を検討
- [x] 実装ガイドライン: パフォーマンス >= 保守性 > 可読性 → cardDigest を root スカラー化してホットパス影響を排除、blunder guard 排他制御で重複計算回避
- [x] UI/UX: PR1d は AI 内部実装が中心、UI 変更なし (= UI レイヤーへの影響なし、観戦モード基準 fixture は data integrity 検証のみ)
- [x] マジックナンバー禁止 → `src/lib/shogi/ai/cards/heuristics.ts` で named constants 一元管理 (`HAND_LIMIT` は導入しない、単調減衰関数で滑らかに価値が下がるため)
- [x] 必須チェック: lint → typecheck → test:ci → build → 各 sub PR で実施
- [x] 機密情報: `.env*` は読まない、Neon URL を出力しない
- [x] カード追加チェックリスト (AGENTS.md 「カード将棋: 新規カード追加時のチェックリスト」) → PR1d の各 sub PR で「5. AI / 探索側の更新」項目を確認、特に PR1d-4 で全カード対応完了時に最終確認

---

## 主要参照ファイル

### 既存計画 md (踏襲対象)

- [docs/plans/issue-193.md](issue-193.md) (親計画、L344-523 が PR1d 詳細スコープ)
- [docs/plans/issue-193-pr1b-pr1c.md](issue-193-pr1b-pr1c.md) (PR1b/PR1c 計画 md、運用継承の参考)
- [docs/plans/issue-193-pr1c-2.md](issue-193-pr1c-2.md) (PR1c-2 計画 md、**最重要踏襲対象**、最終 982 行)

### Issue / PR (引き継ぎ情報源)

- Issue #193: https://github.com/ryuichiTtb/Shogi/issues/193
  - **進行中チェックリスト 19 件**: comment #4414636364 (2026-05-10、`gh api repos/ryuichiTtb/Shogi/issues/comments/4414636364` で取得確認済)
  - **PR1c-2 関連の最新引き継ぎ情報** (PR1d-1 冒頭コミットで useBook? 追加 + fixture 再生成する根拠): comment #4428841412 (2026-05-12「Phase B 動的検証で 5 件不一致発見 → openingBook 非決定性起因と特定 (Phase B refactor は正しい)」)
  - **混同注意**: comment #4421178284 (2026-05-11「第 5 次レビュー指摘反映後の最終確認結果」) は **PR1b/PR1c 関連で PR1c-2 完了報告ではない**。引き継ぎメモには事実誤認の記述があるが、本計画 md には引用しない
- PR #209 (PR1c-2 Phase B refactor、`5badcab` でマージ済): 動的検証不一致経緯記載
- PR #207 (PR1c-2 計画 md): バッククォート引用 auto-close 事例 (Closes キーワード混入注意の根拠)

### AI 関連実装 (PR1d で編集・参照、`5badcab` 時点で grep 検証済)

- `src/lib/shogi/ai/engine.ts` ([L125](../../src/lib/shogi/ai/engine.ts#L125) `FindBestMoveOptions`、[L152](../../src/lib/shogi/ai/engine.ts#L152) `findBestMoveWithStats`、[L79](../../src/lib/shogi/ai/engine.ts#L79) `hasHangingPiece`、[L255-259](../../src/lib/shogi/ai/engine.ts#L255-L259) blunder guard 経路)
- `src/lib/shogi/ai/openingBook.ts` ([L306](../../src/lib/shogi/ai/openingBook.ts#L306) `getBookMove`、[L353](../../src/lib/shogi/ai/openingBook.ts#L353) `Math.random` 非決定性、[L387](../../src/lib/shogi/ai/openingBook.ts#L387) `MAX_BOOK_MOVES = 15`)
- `src/lib/shogi/ai/turn/types.ts` ([L19](../../src/lib/shogi/ai/turn/types.ts#L19) `TurnAction`、[L44](../../src/lib/shogi/ai/turn/types.ts#L44) `ApplyActionResult`、[L53](../../src/lib/shogi/ai/turn/types.ts#L53) `TurnRules`)
- `src/lib/shogi/ai/turn/current-rules.ts` ([L26](../../src/lib/shogi/ai/turn/current-rules.ts#L26) `getLegalActions`)
- `src/lib/shogi/ai/strategy/*.ts` (PR1c-2 で完成済、PR1d-1 で `usingCardAction` フィールド追加)
- `src/lib/shogi/ai/evaluate.ts` (PR1c で関数 export + breakdown ヘルパ整備済、PR1d-1 で cardState? optional 追加)
- `src/lib/shogi/ai/search.ts` (PR1b/PR1c で legal-moves 分離済、PR1d-3 で super-action 内部探索追加)

### カード将棋 reducer/effects (PR1d で参照、編集しない)

- `src/lib/shogi/cards/types.ts` ([L57](../../src/lib/shogi/cards/types.ts#L57) `CardDefinition`、[L117](../../src/lib/shogi/cards/types.ts#L117) `CardGameState`、[L141](../../src/lib/shogi/cards/types.ts#L141) `CardAction`、[L177](../../src/lib/shogi/cards/types.ts#L177) `GameEvent`)
- `src/lib/shogi/cards/definitions.ts` ([L47](../../src/lib/shogi/cards/definitions.ts#L47) `CARD_DEFS`、[L204](../../src/lib/shogi/cards/definitions.ts#L204) `CARD_USE_CONDITIONS`、[L228](../../src/lib/shogi/cards/definitions.ts#L228) `MANA_CAP`、[L233](../../src/lib/shogi/cards/definitions.ts#L233) `DRAW_COST`、[L238](../../src/lib/shogi/cards/definitions.ts#L238) `AUTO_DRAW_INTERVAL`、[L242](../../src/lib/shogi/cards/definitions.ts#L242) `MANA_FAST_BONUS`)
- `src/lib/shogi/cards/effects.ts` ([L243](../../src/lib/shogi/cards/effects.ts#L243) `simulateCardEffect`、[L274](../../src/lib/shogi/cards/effects.ts#L274) `isValidCardTargetSquare`、[L309](../../src/lib/shogi/cards/effects.ts#L309) `getCheckEscapingSquares`、[L337](../../src/lib/shogi/cards/effects.ts#L337) `canEscapeCheckWithCard`、[L400](../../src/lib/shogi/cards/effects.ts#L400) `hasSameKindTrapPlaced`、[L443](../../src/lib/shogi/cards/effects.ts#L443) `consumeNormalCard`)
- `src/hooks/card-shogi/reducer.ts` ([L1124](../../src/hooks/card-shogi/reducer.ts#L1124) `BEGIN_PLAY_CARD` 7 項目、[L1191](../../src/hooks/card-shogi/reducer.ts#L1191) `CONFIRM_PLAY_CARD`、[L431](../../src/hooks/card-shogi/reducer.ts#L431) `applyTurnEndEffects`) — **AI 側からは同じ純粋関数 (`hasSameKindTrapPlaced` / `isInCheck` / `getCheckEscapingSquares` / `CARD_USE_CONDITIONS`) を呼んで実装、reducer 振る舞いは変更しない**

### ガバナンス

- `AGENTS.md` (絶対ルール 1-9 / 実装ガイドライン / カード追加チェックリスト)
- Issue #109 (共通レビュールール、AGENTS.md ルール 8 で参照)

---

## レビュー観点

本計画 md レビュー時の主要観点 (Issue #109 から抜粋):

1. **PR1d 内部 4 段階構成の妥当性**: C 案 (統合推奨案) で機能スコープ分割を採用、PR1c-2 残課題は PR1d-1 冒頭で吸収、bench は PR1d-4 で集約。引き継ぎメモ案 (B) や親計画 md 案 (A) との比較で正当化されているか
2. **cardDigest 設計の妥当性**: root スカラー方式 (G-2 流用)、TT 整合性 (board hash のみ keying)、cardState? optional でのシグネチャ拡張、後方互換性
3. **blunder guard 排他制御の妥当性**: `usingCardAction: boolean` フラグ + Strategy 経由参照 (PR1c-2 基盤を活用)、二重発動防止の構造的解消
4. **double_move super-action 探索の妥当性**: `turnEnded === false` で player 反転禁止、α/β 値継承、`DOUBLE_MOVE_TOP_K=10` フォールバック設計
5. **進行中チェックリスト 19 件の扱い**: PR1d 対応 9 件 (A-2 / B-1 / C-3 / C-4 / C-5 / F-4 / F-5 / G-3 / G-4) の抽出が正確か、スコープ外 10 件の対応済明示が一目で把握可能か
6. **想定リスク R1-R15 の網羅性**: cardDigest 系・性能系・blunder guard 重複・TT 誤キャッシュ・openingBook 非決定性・comment_id 誤記・Closes キーワード混入 を網羅
7. **検証計画の役割分担方式**: test:ci 内 (data integrity) vs CI 外 (動的検証・bench) の分離が PR1c-2 で確立した方式を踏襲しているか、CI 実行時間爆発を回避しているか (G-4)
8. **AGENTS.md 規約準拠**: 9 つの絶対ルールすべての対応状況、特にルール 1 (PR 作成・マージ・Issue クローズは指示まで禁止) / ルール 4 (origin/main 起点) / ルール 7 (コミット規約) / ルール 8 (3 段階レビュー)
9. **comment_id 誤記再発防止 (Z-1 継承)**: `gh api` で取得 + grep 複製の運用ルールが計画 md に明示されているか、`#4421178284` ⇔ `#4428841412` の混同注意が記録されているか
10. **PR description Closes キーワード混入禁止 (PR #207 事例)**: バッククォート引用も含めた 0 件確認の運用が記録されているか

---

## 第 N 次レビュー指摘反映履歴

### 第 1 次レビュー指摘反映 (8 件)

第 1 次レビュー結果 ([Issue #193 上のレビュアーコメント](https://github.com/ryuichiTtb/Shogi/issues/193)) に対し、Must-fix 2 件・Should-fix 3 件・Nice-to-have 3 件の全 8 件を反映。

| # | 指摘 | 反映内容 | 反映箇所 |
|---|------|---------|---------|
| **W-1 (Must-fix)** | cardDigest 加算経路が root スカラー方式の主旨と矛盾 (毎ノード再計算) | evaluate のシグネチャを `(state, variant, cardDigest?: CardDigest)` に変更、`findBestMoveWithStats` で root 1 回計算 → 引数として伝播する設計に修正。`computeCardDigest` 内の超越関数計算をホットパスで再計算しない構造的禁止 | 「cardDigest 設計の核 / 加算経路の擬似コード」「PR1d-1 / 4. evaluate.ts への加算」 |
| **W-2 (Must-fix)** | cardDigest の player 視点と evaluate の sente 絶対視点の符号矛盾 | `computeCardDigest(cardState): CardDigest` で **player 引数を削除し sente 絶対視点固定**。`manaDelta = mana.sente - mana.gote` 等で常に sente 絶対視点に統一。観戦モードでも同じ digest を共有可能 | 「cardDigest 設計の核」全体、digest.ts 実装擬似コード、trapPresence 構造 (`sente`/`gote` フィールド)、`computeManaDelta` (G-3 反映) |
| **W-3 (Should-fix)** | variant ガード不整合 (engine.ts L262 ガードなし vs evaluate L479 `variant.id === "card-shogi"` ガードあり) | `findBestMoveWithStats` 内の cardDigest 計算経路にも `variant.id === "card-shogi"` ガード追加、evaluate 側のガードを `!== "card-shogi"` 形式に統一、二重ガードで安全性確保 | 「cardDigest 設計の核 / 加算経路の擬似コード」「PR1d-1 / 4. evaluate.ts への加算」「digest.ts 実装擬似コード」 |
| **W-4 (Should-fix)** | A-2 反映で `addNoise=0` deterministic と勝率 40-60% の論理矛盾 | **2 層検証**を PR1d-4 DoD に組み込み: advanced/expert (`addNoise=0`) は観戦 1 局で data integrity 検証、beginner/intermediate (`addNoise > 0`) は観戦 50 局で勝率 40-60% 統計検証。PR1c-2 計画 md の「2 層構造の検証」を踏襲 | 「進行中チェックリスト反映 / 第 4 次 A-2」「PR1d-4 個別 DoD / observation 行」 |
| **W-5 (Should-fix)** | G-3 反映で `MANA_FAST_BONUS` vs `MANA_PER_TURN` の定数名取り違え (値はどちらも 1 で偶然一致) | 両定数の役割を表で整理: `MANA_PER_TURN` = 相手ターンスキップ由来、`MANA_FAST_BONUS` = 早指しボーナス由来。`computeManaDelta` で **両方を加算** (`+MANA_PER_TURN + MANA_FAST_BONUS = +2`、楽観的見積もり) を採用、bench で過大評価観測時に縮小する設計 | 「PR1d-3 / 4. double_move 中マナ供給差を cardDigest に反映」「進行中チェックリスト反映 / 第 5 次 G-3」 |
| **W-6 (Nice-to-have)** | `findBestMoveWithStats` 第 6 引数 `cardState?` の API 一貫性 | `FindBestMoveOptions` に `cardState?: CardGameState` を追加し、PR1c-2 で確立した options 拡張パターン (`spectator?` / `maxDepth?` / `useBook?`) に統一。第 6 引数廃止 | 「cardDigest 設計の核 / 加算経路の擬似コード」 |
| **W-7 (Nice-to-have)** | `trapPresence` の型表現と `TrapInstance` 構造の不整合 | `cardState.trap[player]?.defId ?? null` の抽出経路を `computeCardDigest` 拡張擬似コードで明示。`noPromoteMarksPositions` も `cardState.noPromoteMarks[player]` を平坦化 + owner 情報付加で生成。trapPresence のフィールド名を `player`/`opponent` → `sente`/`gote` に変更 (W-2 整合) | 「PR1d-4 / 1. CardDigest 拡張 (trapPresence / noPromoteMarksPositions)」「PR1d-4 / 2. evaluateCardDigest でトラップ価値計算」 |
| **W-8 (Nice-to-have)** | `depthCompleted ±10%` 表記の方向性誤解 (+10% 改善は通常あり得ない) | 全 6 箇所 (Context / PR1d-2 DoD / PR1d-4 影響ファイル / 検証計画 bench / PR1d-4 個別 DoD / PR1d 全体主棋力 DoD) で `-10% 以内 (退化許容範囲、+10% 改善は通常あり得ないため許容方向のみ)` に統一 | 「Context 4」「PR1d-2 DoD」「PR1d-4 影響ファイル」「検証計画」「PR1d-4 個別 DoD」「PR1d 全体主棋力 DoD」 |

**累計反映実績 (3 サイクル運用継承)**:

| サイクル | Must | Should | Nice | 計 |
|---------|------|--------|------|-----|
| PR1a 4 サイクル | - | - | - | 43 |
| PR1b/PR1c 5 サイクル | - | - | - | 26 |
| PR1c-2 4 サイクル | - | - | - | 25 |
| 本セッションメタ計画 3 サイクル | 3 | 4 | 7 | 14 |
| **PR1d 計画 md 第 1 次 (本反映)** | **2** | **3** | **3** | **8** |
| **累計** | - | - | - | **116** |

「**指摘全件反映してから次サイクル**」の品質基盤を継承。本反映後、第 2 次レビューに進む。

---

## 補足: メタ計画 md (本セッションの作業計画) との関係

本計画 md (`docs/plans/issue-193-pr1d.md`) は、Claude Code ローカル plan ディレクトリ (`~/.claude/plans/issue-193-issue-pr-calm-hammock.md`) に保存されたメタ計画 md に基づいて作成された。メタ計画 md はリポジトリ外で保存され、本リポジトリにはコミットされない (= 引き継ぎ・記録用のみ)。

メタ計画 md は本セッション開始時から 3 サイクルのレビュー (第 1 次 11 件 / 第 2 次 3 件 / 第 3 次 0 件) を経て確定。累計反映実績 14 件 (Must 3 + Should 4 + Nice 7)。詳細はメタ計画 md を参照 (本リポジトリには未コミット)。
