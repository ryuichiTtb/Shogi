# Issue #176 Timeout Fix 対応計画 第 3 版 (レビュー指摘・ユーザー回答 全反映)

| 項目 | 内容 |
|---|---|
| 作成日 | 2026-05-09 (第 1 版 2026-05-08、第 2 版 2026-05-09) |
| 対象 PR | PR #185 (Issue #176 PR 1) のフォローアップ |
| ブランチ | `fix/#176-timeout` (origin/main 起点) |
| 関連 Issue | #176 (本対応の親) / #190 (Pro 前提の AI 性能強化、本対応 + Phase 3+4 完了 + Pro upgrade 後に着手) |
| 関連 PR | [PR #185 (Issue #176 PR 1、マージ済)](https://github.com/ryuichiTtb/Shogi/pull/185) |

---

## 用語定義 (N7 反映)

本書では以下の用語を統一して使用する:

| 略称 | 指す対象 |
|---|---|
| **fix-PR1** | 本 timeout-fix の最初の PR (致命修正先行: F5 + F1 + F2 + F4 + F6) |
| **fix-PR2** | 本 timeout-fix の 2 番目の PR (再発予防 + 副次最適化: F3 + 追加 2 + 追加 3 + F6) |
| **shogi-PR2 (= 本来 PR 2)** | 既存 [docs/plans/issue-176.md](docs/plans/issue-176.md) の Phase 3+4+5 を扱う PR (本書範囲外、Issue #176 の本来スコープ) |

`issue-176.md` の PR1 (= Phase 0+1+2、PR #185 でマージ済) は混乱を避けるため本書では参照しない。

---

## 第 3 版での変更点 (レビュー全 18 件 + ユーザー回答 2 件 反映)

### 致命級 (2 件、ユーザー判断確定で計画書反映)

| # | 内容 | ユーザー回答 |
|---|---|---|
| **C-1** | `bench-results/.gitignore` の現状 (`*` 全件 ignore) と計画書 L579 (git 管理対象) の矛盾 | **案 A 採用**: bench は git 管理しない、PR 本文に表で貼付 |
| **C-2** | rate-limit 完全未実装 (middleware.ts なし、ratelimit/Upstash/throttle 0 件) → 追加 1 採用後の DDoS リスク | **案 A 採用**: **追加 1 (Promise.all 並列化) を fix-PR2 から削除** |

### 高優先度 (3 件)

| # | 内容 | 反映 |
|---|---|---|
| F5 を fix-PR1 に移動 | F5 (maxDuration 5→10) は 1 行変更で副作用なく 504 頻度の **劇的低減**に効く。fix-PR1 単独で 504 低減効果を出すため | **fix-PR1 順序: F5 → F1 → F2 → F4 → F6** に変更 |
| H-1 | F1 修正対象に **unmount cleanup** / **cancel()** / **新 request 上書き** / **overall timer** の abort をすべて明示 | F1 修正対象リストを詳細化、行番号併記 |
| H-2 | bench commit 指定をタグ (`bench-baseline` / `bench-pr1` / `bench-pr2`) で固定 | bench 検証セクションでタグ固定運用に書き換え |

### 中優先度 (7 件)

| # | 内容 | 反映 |
|---|---|---|
| M-1 | F1 本文冒頭で「Q3 通り `ABORT_REASONS` 定数化」を明記 | F1 設計セクション冒頭で明記 |
| M-2 | search.ts:534 の `options.timeLimitMs * 0.55` ロジックと二段 deadline の関係を注記 | F3 セクションで整合性 (3500×0.55=1925 < searchDeadlineAt 3300) を注記 |
| M-3 | F1 修正範囲に shogi-game.tsx:386-390 / card-shogi-game.tsx:2075-2079 の行番号併記 | F1 修正対象に行番号反映 |
| M-4 | AiErrorModal 文言分岐テストを F6 fix-PR1 範囲に追加 | F6 fix-PR1 範囲に `ai-error-modal.test.tsx` 追加 |
| N1 補強 | F4 retry の効果は 504 原因別に変わる (A: maxDuration 超過 → 不能、B: cold start → 復旧可、C: Neon DB 一時遅延 → 復旧可) | F4 セクションで 504 原因別 retry 効果見積もり追記 |
| N2 補強 | bench Group 2 (= F2+F5 適用後) で 504 頻度低減を**実測判断** | 検証セクションで「Group 2 bench 結果で fix-PR1 マージ可否を最終判断」追記 |
| fix-PR1 期待値精確化 | F5 を含めることで「永久停止根治 + 504 頻度の **劇的低減** + retry 戦略最適化」が fix-PR1 単独で成立 | 冒頭・実装順序・完了条件の表記を更新 |

### 低優先度 (6 件)

| # | 内容 | 反映 |
|---|---|---|
| L-1 | 既存テスト影響評価をリスク表に追記 (`grep` 検証済 = 0 件) | リスク・トレードオフ表に項目追加 |
| L-2 | AiErrorModal dismiss 抑制が既存実装 ([ai-error-modal.tsx:29](src/components/game/ai-error-modal.tsx#L29) `onOpenChange={() => {}}`) で完結 | 受け入れ基準に注記追加 |
| L-3 | fix-PR1 単独段階 (maxDuration=5 のまま F4 適用) でも累積整合 (10.3s ≪ 12s) は維持 | F4 累積整合表に段階別行追加 (が、F5 を fix-PR1 に含めるためこの観点は補強として残す) |
| L-4 | fix-PR2 のテスト/bench は fix-PR1 マージ後に着手と明記 | 実装順序セクションで明示 |
| N5 | bench Group 2 説明を「F2+F5 のサーバ側 504 防御効果測定」に精緻化 (F1/F4 はクライアント側、bench に直接影響しない) | 検証セクションで Group 2 の役割を精緻化 |
| N7 | fix-PR1 / fix-PR2 / shogi-PR2 用語衝突解消 | 本書冒頭に用語定義セクション追加 (上記) |

### ユーザー回答 (4 件、第 2 版から継続)

- Vercel **Hobby 維持** (本 fix は Hobby で実現可能、AI 強化前 = Issue #190 着手前に Pro 検討)
- F4+F5 案 C: maxRetries=1、backoff=300ms、overallTimeoutMs=12000ms
- **2 PR 分割** (fix-PR1 致命修正先行、fix-PR2 再発予防 + 副次最適化)
- F1: signal.reason 採用 (Web 標準、既存コード整合、race 安全)

---

## Context

PR #185 (Issue #176 PR 1) を main にマージ後、本番環境 (Vercel) で `POST /api/ai-move` が 504 Gateway Timeout を返し、3 件目の 504 以降 CPU が手を指さなくなる致命的 UX 障害が発生。

ユーザー提供のコンソールログ 3 件、別調査者の精読、Vercel 公式 docs 調査 (Hobby/Pro plan の maxDuration 上限・wall-clock 計測等) を統合した結果、原因は以下 2 つの **連鎖** と確定:

1. **サーバ側**: `expert.timeLimitMs` (4500ms) と `maxDuration` (5000ms) の余白不足、blunder guard が `SearchContext` 不参照で deadline 後に走る、cold start + DB + TT alloc が 5s 踏み超す
2. **クライアント側**: [`use-ai-request.ts`](src/hooks/ai/use-ai-request.ts) で `AbortError` 4 経路 (cancel / unmount / overall timeout / 別 request 上書き) を区別せず silent stale で破棄 → `onError` 不発 → AI 永久停止

main 進行 (PR #186 / #188) は AI 関連ファイルに 0 行も触れておらず、競合は無し。

本計画は `fix/#176-timeout` ブランチで **2 PR 分割** で進める:

- **fix-PR1 (致命修正 + 504 頻度劇的低減)**: **F5 → F1 → F2 → F4 → F6** (5 commit + 関連テスト)
- **fix-PR2 (再発予防 + 副次最適化)**: F3 → 追加 2 → 追加 3 → F6 (4 commit + テスト) ※ 追加 1 は **C-2 案 A で削除**

fix-PR1 完了時点で「永久停止根治 + 504 頻度劇的低減 + retry 戦略最適化」が成立し production に即時リリース可能 (N2 / N3 反映で F5 含める方針確定)。

---

## 関連ソース読了確認 (レビュー指摘 #12 / B-4 / 第 2 版で既反映)

第 3 版作成時点で以下を読了し、F1/F2/F3/F4/F5/追加 2/追加 3 の設計に反映済:

| ファイル | 確認内容 |
|---|---|
| [src/lib/auth/current-user.ts](src/lib/auth/current-user.ts) | `getCurrentAppUser` は account なら [L128-133](src/lib/auth/current-user.ts#L128-L133) の `prisma.user.findUnique`、guest なら [L164-185](src/lib/auth/current-user.ts#L164-L185) で 2 DB calls。**確実に DB ヒットする**が、追加 1 (Promise.all 並列化) は **C-2 案 A で削除済** |
| [src/hooks/use-shogi-game.ts](src/hooks/use-shogi-game.ts) | AI useEffect deps `[currentPlayer, status, aiRetryCounter]` ([L333](src/hooks/use-shogi-game.ts#L333))。F1 retry → `aiRetryCounter++` で再 fire 経路は機能する。silent stale 経路は [L306-310](src/hooks/use-shogi-game.ts#L306-L310) |
| [src/hooks/use-card-shogi-game.ts](src/hooks/use-card-shogi-game.ts) | AI useEffect deps `[currentPlayer, status, pendingCard, isDrawing, isPlayingCard, isCheckBreakAnimating, disableAi, aiRetryCounter]` ([L144-152](src/hooks/use-card-shogi-game.ts#L144-L152))。silent stale は [L118-122](src/hooks/use-card-shogi-game.ts#L118-L122) で **同根**。F1 修正で両 hook 同時復旧 |
| [src/hooks/card-shogi/reducer.ts](src/hooks/card-shogi/reducer.ts) | `pendingCard` / `isDrawing` / `isPlayingCard` / `isCheckBreakAnimating` / `doubleMove` の演出フラグ。AI 思考中の演出割込みは F1 (cancel reason) で安全に処理可能 |
| [src/components/game/ai-error-modal.tsx](src/components/game/ai-error-modal.tsx) | 文言「通信や一時的なエラーで AI 思考が完了しませんでした」は timeout 経路を含意しない → F1 内で `kind` 別文言分岐。**Esc/外クリック dismiss は既に [L29](src/components/game/ai-error-modal.tsx#L29) `onOpenChange={() => {}}` で無効化済 (L-2 反映)** |
| `bench-results/.gitignore` | **現状 `*` 全件 ignore + `!.gitignore` のみ例外** で bench 結果は git 非管理。本対応でも **C-1 案 A 採用 = 現状維持**、PR 本文に表貼付の運用に揃える |
| `middleware.ts` および `rate-limit` 系コード | **未実装 (0 件)**。本対応では rate-limit 実装を要する追加 1 を **C-2 案 A で削除** |

---

## 現状認識 — 504 と永久停止の発生メカニズム (第 1〜2 版から継続)

### 1. サーバ側 (504 の直接原因)

#### 1-A. expert timeLimitMs が maxDuration に近すぎる

[engine.ts:38-44](src/lib/shogi/ai/engine.ts#L38-L44) の `expert.timeLimitMs = 4500` と [route.ts:26](src/app/api/ai-move/route.ts#L26) の `maxDuration = 5` で **余白 500ms**。計画書 [docs/plans/issue-176.md:67](docs/plans/issue-176.md#L67) の「hard stop 4.0 秒以内」を expert で踏み超している。

#### 1-B. blunder guard が deadline を完全に無視

[engine.ts:198-225](src/lib/shogi/ai/engine.ts#L198-L225) の hanging piece チェックは `findBestMove` が deadline 厳守で 4500ms 使い切った後にさらに **100〜500ms 余分に走る**。`SearchContext` を一切参照していない。

#### 1-C. 探索開始前のオーバーヘッド

[route.ts:118-134](src/app/api/ai-move/route.ts#L118-L134) で `getCurrentAppUser` → `prisma.game.findUnique` が **直列実行**。さらに [search-context.ts:62](src/lib/shogi/ai/search-context.ts#L62) で `new TranspositionTable()` が **毎 request** 走る。

(注: 直列実行の並列化 = 追加 1 は C-2 案 A で削除。F5 で maxDuration 拡大により cold start spike 吸収を確保)

### 2. クライアント側 (永久停止の真因 ─ 真のバグ)

[use-ai-request.ts:168-172](src/hooks/ai/use-ai-request.ts#L168-L172) で `AbortError` を 4 経路 (cancel / unmount / overall timeout / 別 request 上書き) 区別せず silent stale で破棄。

最悪ケース (504 が 3 回連続) のタイムライン:

```
t=0       attempt1 開始
t=5.0s    attempt1 が 504 → continue (5xx でリトライ対象)
t=5.0s    backoff(600ms) 開始
t=5.6s    attempt2 開始
t=10.6s   attempt2 が 504 → continue
t=10.6s   backoff(1500ms) 開始
t=12.1s   attempt3 開始
t=15.0s ★ overall timeout fires → controller.abort() ★
          → AbortError → silent stale return → onError 不発
```

→ `setAiError` が呼ばれない → モーダル出ず → AI useEffect deps 変化なしで再 fire しない → **AI 永久停止**。

3 件目の 504 console stack に `await in (anonymous)` が含まれていたのもこれと整合。

同様の silent stale パターンが [use-ai-request.ts:138-142](src/hooks/ai/use-ai-request.ts#L138-L142) の `delay()` 経路にもある (backoff 待機中の overall timeout)。

---

## 修正方針 (第 3 版確定)

### 致命級・高優先度の確定設計

| # | 内容 | 第 3 版での確定 |
|---|---|---|
| **F5** 🟡→🟠 | maxDuration 拡大 | **5 → 10** (Hobby 上限 60s 内、第 3 版では **fix-PR1 に移動**して 504 頻度劇的低減に寄与) |
| **F1** 🔴 | AbortError silent stale バグ修正 | **`signal.reason` 採用 + `ABORT_REASONS` 定数化** (Web 標準、既存 [L125](src/hooks/ai/use-ai-request.ts#L125) と整合、race 完全安全) |
| **F2** 🔴 | DIFFICULTY_PARAMS 削減 | **beginner 800 / intermediate 1800 / advanced 3000 / expert 3500** ms |
| **F3** 🟠 | blunder guard deadline 配下 | **二段 deadline (`searchDeadlineAt` / `hardDeadlineAt`、200ms 専用 budget) + `!ctx.stopped` で signal abort も同時吸収** |
| **F4** 🟠 | retry 予算整備 | **maxRetries=1、backoff=300ms、overallTimeoutMs=12000ms** (案 C) + **504 原因別 retry 効果見積もり明記** (N1 補強) |
| **追加 2** 🟢 | TT サイズ削減 | 4M → 1M、効果は**アロケーションコスト 1/4** (V8 sparse array で実消費はほぼ 0) |
| **追加 3** 🟢 | deadline check 間隔短縮 | 1024 → 256 node |
| **F6** 🟢 | 単体テスト追加 | F1 race/並走系 + F1 文言分岐 (M-4) + F3 deadline テスト |
| ~~追加 1~~ | ~~auth + DB read 並列化~~ | **C-2 案 A で削除** (rate-limit 未実装による DDoS リスク回避、F5 で cold start spike 吸収可) |

### 実装順序 (第 3 版確定 = F5 含む 2 PR 分割)

#### **fix-PR1 (致命修正 + 504 頻度劇的低減)** ─ `fix/#176-timeout`

| 順 | コミット | 効果 | ファイル |
|---:|---|---|---|
| **1** | **F5**: maxDuration 5 → 10 + 根拠コメント更新 | Vercel 余白拡大 (cold start + auth/DB + TT alloc を吸収) | route.ts |
| **2** | **F1**: AbortError signal.reason 区別 + ABORT_REASONS 定数化 + AiErrorModal 文言 `kind` 別分岐 | 永久停止根治 (silent stale バグ修正、UX 復旧) | use-ai-request.ts、ai-error-modal.tsx、shogi-game.tsx、card-shogi-game.tsx、use-shogi-game.ts、use-card-shogi-game.ts |
| **3** | **F2**: DIFFICULTY_PARAMS timeLimitMs 削減 + 根拠コメント更新 | 504 頻度低減 (max 4500→3500ms、F5 と組合わせて余白大幅増) | engine.ts |
| **4** | **F4**: retry 予算整備 (maxRetries=1、backoff=300ms、overall=12000ms) | overall overflow 回避、retry 戦略最適化 | use-ai-request.ts |
| **5** | **F6 (fix-PR1 範囲)**: F1+F2+F4+F5 のテスト網羅 (race + 文言分岐含む) | 回帰防止 | __tests__/ |

fix-PR1 で「**永久停止根治 + 504 頻度劇的低減 + retry 戦略最適化 + 回帰テスト**」が成立。Vercel preview 動作確認後、ユーザー指示でマージ → production 即時リリース。

#### **fix-PR2 (再発予防 + 副次最適化)** ─ `fix/#176-timeout-followup` (fix-PR1 マージ後に origin/main 起点で新規)

| 順 | コミット | 効果 | ファイル |
|---:|---|---|---|
| **6** | **F3**: blunder guard を二段 deadline 配下に + `!ctx.stopped` 統合 | 棋力デグレ最小化、deadline 厳格化 | engine.ts、search-context.ts |
| **7** | **追加 2**: TT サイズ 4M → 1M + コメント更新 | アロケーションコスト 1/4、GC pressure 軽減 | transpositionTable.ts |
| **8** | **追加 3**: deadline check 1024 → 256 node + コメント更新 | 検知遅延 1/4 | search-context.ts |
| **9** | **F6 (fix-PR2 範囲)**: F3 deadline テスト追加 | 回帰防止 | __tests__/ |

fix-PR2 完了後、Vercel preview で龍王 5 局以上対局 + bench 3 群比較を確認 → ユーザー指示でマージ。

**fix-PR2 のテスト/bench は fix-PR1 マージ後に着手** (L-4 反映)。fix-PR1 が長期化する場合は `fix/#176-timeout-followup` ブランチで F3 のスケッチ実装まで進めて待機可、ただし bench (Group 3) は fix-PR1 マージ後の origin/main + fix-PR2 commit で測る。

---

## F5: maxDuration を 5 → 10 に拡大 (🟠 fix-PR1 先頭) ─ Hobby 上限 60s 内

### 採用根拠 (Vercel 公式 docs より、第 2 版から継続)

- **本リポジトリの契約プラン: Hobby**
- **Hobby Function maximum duration: 10s default / 60s max** (Vercel 公式 docs [docs/plans/hobby](https://vercel.com/docs/plans/hobby) より)
- **採用値: 10s** (Hobby 上限 60s の 1/6、cold start spike 5s 込みでも余裕)

### fix-PR1 先頭に移動した根拠 (N2 / N3 反映)

第 2 版では fix-PR2 に置いていたが、以下の理由で **fix-PR1 先頭に移動**:

- F5 は **1 行変更 + 副作用ゼロ + 効果絶大** (cold start 1〜2s + auth/DB 200〜500ms + TT alloc 100ms + 探索 3500ms + blunder guard +500ms = 6000〜6500ms ≪ 10000ms で **504 完全消滅に近い**)
- F5 を fix-PR1 に含めることで、N2 で別レビュアー指摘の「fix-PR1 単独では 504 残存リスク」が解消
- F5 を fix-PR1 から外す合理的理由がない (副作用ゼロ + 影響範囲 1 行)

### 修正

[src/app/api/ai-move/route.ts:26](src/app/api/ai-move/route.ts#L26): `export const maxDuration = 5;` → `10`

ファイル冒頭コメントも更新:

```ts
// - runtime: nodejs (重い CPU 計算 + Prisma 利用のため Node 必須)
// - maxDuration: 10 秒 (Vercel Hobby 上限 60s に対する余裕大)。
//   Issue #176 timeout-fix で 5→10 に拡大し、cold start + Neon DB resume +
//   Prisma init + TT alloc の累積を 5s 以内に詰め込めない問題を解消。
//   内部探索 deadline (engine.ts の timeLimitMs) は最大 3500ms (expert) で、
//   blunder guard 200ms budget と合わせても hard stop 4.0 秒以内に収まる。
//   Vercel Pro upgrade 後 (Issue #190) は 15〜30s に再調整可。
```

### 課金影響

- Hobby Function Duration: 100 GB-Hours included
- 1 invocation 平均 4s × 1 GB memory = 0.000972 GB-Hour
- 100 GB-Hours = 約 102,857 invocations/月 → 個人利用想定で十分余裕
- maxDuration を上げても **実 billed time は探索完了まで** で増えない

### Pro 検討タイミング (Issue #190 連携)

本対応は Hobby のままで実現。AI 性能強化 (カード戦略 / 読み合い / NNUE) を Pro 前提で進める計画は [Issue #190](https://github.com/ryuichiTtb/Shogi/issues/190) に切り出し済。

---

## F1: AbortError silent stale バグ修正 (🔴 致命) ─ `signal.reason` 採用 + `ABORT_REASONS` 定数化

### 設計方針 (M-1 反映、本セクション冒頭で明記)

**実装は `ABORT_REASONS` 定数化を採用** (Q3 仕様)。本セクションのサンプルコードは説明の簡潔さのため raw 文字列で記述しているが、**実装ファイルでは const 化必須** (typo 検知 + 単体テストでの集中管理のため)。

```ts
// use-ai-request.ts 冒頭
export const ABORT_REASONS = {
  CANCEL: "cancel",
  SUPERSEDE: "supersede",
  TIMEOUT: "overall timeout",
  UNMOUNT: "unmount",
} as const;
```

### コア修正

`AbortController.abort(reason)` + `signal.reason` を使い、abort 経路を 4 種に区別:

```ts
// AiRequestError 型に "timeout" を追加
export interface AiRequestError {
  kind: "network" | "http" | "timeout" | "invalid";
  status?: number;
  message: string;
}

// abort 呼び出し時に reason を埋め込む (ABORT_REASONS 定数で typo 防止)
inFlightRef.current?.abort(new DOMException(ABORT_REASONS.SUPERSEDE, "AbortError"));
controller.abort(new DOMException(ABORT_REASONS.CANCEL, "AbortError"));
controller.abort(new DOMException(ABORT_REASONS.TIMEOUT, "AbortError"));
controller.abort(new DOMException(ABORT_REASONS.UNMOUNT, "AbortError"));

// catch 内で signal.reason を見て分岐
} catch (err) {
  if ((err as { name?: string }).name === "AbortError") {
    const reason = controller.signal.reason as DOMException | undefined;
    if (reason?.message === ABORT_REASONS.TIMEOUT) {
      onError?.({
        kind: "timeout",
        message: "AI 思考が時間内に完了しませんでした",
      });
    }
    // cancel / supersede / unmount は従来通り silent stale (UI 側で別経路により処理)
    return { stale: true, requestId };
  }
  // ... 通常 network エラー処理
}
```

### `delay()` 経路 (backoff 待機中) も同様の区別

```ts
// use-ai-request.ts:138-142 周辺
} catch (err) {
  if ((err as { name?: string }).name === "AbortError") {
    const reason = controller.signal.reason as DOMException | undefined;
    if (reason?.message === ABORT_REASONS.TIMEOUT) {
      onError?.({
        kind: "timeout",
        message: "AI 思考が時間内に完了しませんでした",
      });
    }
    return { stale: true, requestId };
  }
}
```

### 採用根拠 (closure 案との比較、レビュー 2 A-1)

| 観点 | closure local `let` (案 B) | **`signal.reason` (案 A、本採用)** |
|---|---|---|
| controller↔reason 紐付け | 1:1 (closure 内のみ) | 1:1 (Web 標準が物理的に保証) |
| 並走時 race | 安全 (closure ごと独立) | 安全 (signal が物理的に紐づく) |
| supersede ケース | 別 closure からの abort で WeakMap 必要 | 直接 reason 渡せる |
| 既存コードとの統一 | 中 | 高 ([line 125](src/hooks/ai/use-ai-request.ts#L125) と同形式) |
| ブラウザ要件 | なし | Chrome 98+ / Firefox 97+ / Safari 15.4+ (Vercel ターゲット環境で全カバー) |

### modal 文言調整 (中指摘 #8)

[`ai-error-modal.tsx`](src/components/game/ai-error-modal.tsx) で `AiRequestError.kind` ごとに文言分岐:

```tsx
const description = (() => {
  switch (error?.kind) {
    case "timeout":
      return "AI が時間内に手を返せませんでした。もう一度試すか、投了するかを選んでください。";
    case "http":
      return `サーバ側でエラーが発生しました (${error.status})。もう一度試すか、投了するかを選んでください。`;
    case "network":
      return "通信エラーで AI 思考が中断されました。もう一度試すか、投了するかを選んでください。";
    default:
      return "AI 思考が完了しませんでした。もう一度試すか、投了するかを選んでください。";
  }
})();
```

`AiErrorModalProps` に `error: AiRequestError | null` を追加 (現状 `open: boolean` のみ)。

### 修正対象 (H-1 / M-3 反映 ─ 行番号併記、unmount cleanup 等を全て明示)

#### use-ai-request.ts (4 箇所すべての abort 呼び出しに reason を渡す)

- [src/hooks/ai/use-ai-request.ts:92-96](src/hooks/ai/use-ai-request.ts#L92-L96) **useEffect cleanup**: `inFlightRef.current?.abort(new DOMException(ABORT_REASONS.UNMOUNT, "AbortError"))`
- [src/hooks/ai/use-ai-request.ts:99-103](src/hooks/ai/use-ai-request.ts#L99-L103) **`cancel()` 関数**: `inFlightRef.current?.abort(new DOMException(ABORT_REASONS.CANCEL, "AbortError"))`
- [src/hooks/ai/use-ai-request.ts:116](src/hooks/ai/use-ai-request.ts#L116) **新 request 上書き** (`requestMove` 冒頭): `inFlightRef.current?.abort(new DOMException(ABORT_REASONS.SUPERSEDE, "AbortError"))`
- [src/hooks/ai/use-ai-request.ts:124-126](src/hooks/ai/use-ai-request.ts#L124-L126) **overall timer**: `controller.abort(new DOMException(ABORT_REASONS.TIMEOUT, "AbortError"))` (現状の "overall timeout" 文字列を `ABORT_REASONS.TIMEOUT` 定数化)

加えて:

- 冒頭に `ABORT_REASONS` 定数 export を追加
- `AiRequestError` の `kind` に `"timeout"` 追加
- catch 内 ([L168-172](src/hooks/ai/use-ai-request.ts#L168-L172) と [L138-142](src/hooks/ai/use-ai-request.ts#L138-L142) の `delay()` 経路) で `signal.reason` を見て `kind: "timeout"` のみ `onError` 発火

#### ai-error-modal.tsx (文言を kind 別に分岐)

- [src/components/game/ai-error-modal.tsx](src/components/game/ai-error-modal.tsx):
  - `AiErrorModalProps` に `error: AiRequestError | null` を追加 (現状 `open: boolean` のみ)
  - 文言を `kind` 別 (`timeout` / `http` / `network` / `default`) に分岐
  - dismiss 抑制 ([L29](src/components/game/ai-error-modal.tsx#L29) `onOpenChange={() => {}}`) は **既に実装済 (L-2)** で破壊しないことを確認

#### hooks (aiError 型を AiRequestError に変更)

- [src/hooks/use-shogi-game.ts](src/hooks/use-shogi-game.ts):
  - `aiError` state を `AiRequestError | null` 型化
- [src/hooks/use-card-shogi-game.ts](src/hooks/use-card-shogi-game.ts):
  - 同様に `AiRequestError | null` 型化

#### game コンポーネント (M-3 反映 ─ 行番号併記)

- [src/components/game/shogi-game.tsx:386-390](src/components/game/shogi-game.tsx#L386-L390) `<AiErrorModal>` に `error={aiError}` を追加
- [src/components/game/card-shogi/card-shogi-game.tsx:2075-2079](src/components/game/card-shogi/card-shogi-game.tsx#L2075-L2079) `<AiErrorModal>` に `error={aiError}` を追加

### F1 単体テスト (F6 fix-PR1 範囲、M-4 反映)

`src/hooks/ai/__tests__/use-ai-request.test.ts` (新規):

1. **意図的 cancel** (`cancel()`) → `onError` 不発、stale return
2. **unmount cleanup** → `onError` 不発、stale return
3. **別 request 上書き** (連続 `requestMove`) → 前 request の `onError` 不発
4. **HTTP 504 が maxRetries 回連続** (本ケースは `maxRetries=1`) → `onError({ kind: "http", status: 504 })` が **1 回だけ** 発火
5. **overall timeout fire** (短い `overallTimeoutMs` で意図的に発火) → `onError({ kind: "timeout" })` 発火 ← **F1 の核心**
6. **HTTP 503 が 1 回 → 200 で成功** → retry で復旧、`onError` 不発
7. **race: supersede 中に前 request の overall timer が遅れて発火** → 新 request 側に reason 混線しない (signal.reason が物理的に分離)
8. **race: backoff `delay()` 中に overall timeout 発火** → onError({ kind: "timeout" }) 発火
9. **race: 既に aborted な signal で fetch 起動** → 同期 AbortError → silent stale (cancel 扱い)

`src/components/game/__tests__/ai-error-modal.test.tsx` (M-4 新規):

10. `error.kind === "timeout"` で「AI が時間内に手を返せませんでした」表示
11. `error.kind === "http"` で `status` を含む文言表示
12. `error.kind === "network"` で「通信エラー」表示
13. `error === null` の場合 `open=false` で非表示
14. retry/resign ボタンクリックで `onRetry`/`onResign` が発火
15. dismiss (Esc / 外クリック) で modal が閉じない (`onOpenChange={() => {}}` の挙動確認、L-2)

テスト技術:
- `vi.mock("global.fetch")` で 503/504/200/AbortError を制御
- `vi.useFakeTimers()` で `setTimeout` を制御
- `act` / `renderHook` で React hook 駆動

---

## F2: DIFFICULTY_PARAMS の timeLimitMs 削減 (🔴 致命)

### 修正値

[`engine.ts:DIFFICULTY_PARAMS`](src/lib/shogi/ai/engine.ts#L26-L56):

| difficulty | 現行 | 第 3 版 | 根拠 |
|---|---:|---:|---|
| beginner | 1000 | **800** | 計画書 [issue-176.md:67](docs/plans/issue-176.md#L67) 目安 |
| intermediate | 2000 | **1800** | 計画書目安 |
| advanced | 4000 | **3000** | hard stop 4s 以内、余白拡大 |
| expert | 4500 | **3500** | 計画書目安、Stage C bench で max 3.8s 観測済 |

### 棋力影響 (Q5 補足)

- beginner/intermediate: ノイズ大 + 定石本ありで影響小
- advanced/expert: Stage C bench で expert/midgame_30 max 3.8s に張り付いていた = **既存実装でも 3.8s で打ち切られていた**ため、3.5s でも結果は近い
- 念のため bench で `depthCompleted` 平均が大きく劣化していないか確認
- F3 (blunder guard 200ms 専用 budget) との組合せで **「探索 3.3s + blunder guard 200ms = 計 3.5s」** という二重保護も成立

### コメント更新 (軽微指摘 #11)

`engine.ts:23-26` の根拠コメントを timeout-fix 経緯に書き換え:

```ts
// 難易度別探索パラメータ。
// Issue #176 timeout-fix: hard stop 4.0 秒以内に揃え、Vercel maxDuration=10 と
// blunder guard 200ms budget を加味して以下に確定。
// (旧 PR #185: beginner 1000 / intermediate 2000 / advanced 4000 / expert 4500、
//  expert で hard stop 4.0 秒を踏み超していた)
```

---

## F3: blunder guard を SearchContext deadline 配下に + `!ctx.stopped` 統合 (🟠 高、fix-PR2)

### 設計 (高指摘 #3 + レビュー 2 A-3 統合)

**二段 deadline** を `SearchContext` に導入し、blunder guard 専用 200ms budget を確保:

```ts
// search-context.ts
export interface SearchContext {
  startedAt: number;
  searchDeadlineAt: number;  // 探索 (findBestMove) 用
  hardDeadlineAt: number;    // blunder guard 含む全体の hard stop
  // ...
}

export function createSearchContext(opts: CreateSearchContextOptions): SearchContext {
  const startedAt = performance.now();
  const blunderGuardBudgetMs = 200;
  return {
    startedAt,
    searchDeadlineAt: startedAt + opts.timeLimitMs - blunderGuardBudgetMs,
    hardDeadlineAt: startedAt + opts.timeLimitMs,
    // ...
  };
}

// shouldStop は引き続き searchDeadlineAt を見る (findBestMove 用)
export function shouldStop(ctx: SearchContext): boolean {
  if (ctx.stopped) return true;
  if (ctx.signal?.aborted) {
    ctx.stopped = true;
    ctx.stoppedBy = "abort";
    return true;
  }
  if ((ctx.nodes & 255) === 0) {  // 追加 3 で 1024 → 256 に短縮
    if (performance.now() >= ctx.searchDeadlineAt) {
      ctx.stopped = true;
      ctx.stoppedBy = "deadline";
      return true;
    }
  }
  return false;
}
```

### blunder guard 修正

```ts
// engine.ts:198-225
if (
  !usedFallback &&
  move !== null &&
  (difficulty === "advanced" || difficulty === "expert") &&
  !ctx.stopped &&  // signal abort 経由停止なら blunder guard も skip (A-3)
  performance.now() < ctx.hardDeadlineAt  // 二段 deadline の hard 側を見る
) {
  const nextState = applyMoveForSearch(state, move);
  if (hasHangingPiece(nextState, player, variant)) {
    const legalMoves = getFullLegalMoves(state, player, variant);
    const safeMoves: Move[] = [];
    for (const m of legalMoves) {
      if (ctx.stopped || performance.now() >= ctx.hardDeadlineAt) break;
      const ns = applyMoveForSearch(state, m);
      if (!hasHangingPiece(ns, player, variant)) {
        safeMoves.push(m);
      }
    }
    if (safeMoves.length > 0 && !ctx.stopped && performance.now() < ctx.hardDeadlineAt) {
      let bestSafeScore = -Infinity;
      let bestSafeMove = safeMoves[0];
      for (const m of safeMoves) {
        if (ctx.stopped || performance.now() >= ctx.hardDeadlineAt) break;
        const ns = applyMoveForSearch(state, m);
        const rawScore = evaluate(ns, variant);
        const score = player === "sente" ? rawScore : -rawScore;
        if (score > bestSafeScore) {
          bestSafeScore = score;
          bestSafeMove = m;
        }
      }
      move = bestSafeMove;
    }
  }
}
```

### search.ts:534 の 0.55 ロジックとの整合性 (M-2 反映)

[search.ts:534](src/lib/shogi/ai/search.ts#L534) の「`elapsedFromStart > options.timeLimitMs * 0.55` で次 depth に進まない」ロジックは `options.timeLimitMs` を直接参照する。F3 で二段 deadline 化した後も値は整合 (expert: 3500 × 0.55 = **1925ms < searchDeadlineAt 3300ms**) → **F3 修正範囲外として変更不要**。

### 効果

- expert (timeLimitMs=3500ms) の場合: 探索 3300ms + blunder guard 200ms = **計 3500ms hard 内**
- signal abort (待った/終局) も `!ctx.stopped` で同時に skip → 待った直後に blunder guard が走り続ける問題も解消

### F3 単体テスト

`src/lib/shogi/ai/__tests__/engine-deadline.test.ts` (新規):

1. `searchDeadlineAt` 超過状態で blunder guard が走る (= 200ms budget が機能する)
2. `hardDeadlineAt` 超過状態で blunder guard 全 skip
3. `ctx.stopped = true` (signal abort 経由) で blunder guard skip
4. blunder guard ループ途中で `ctx.stopped` が立つと break

---

## F4: retry 予算整備 (🟠 高) ─ 案 C 採用 + 504 原因別 retry 効果見積もり (N1 補強)

### 採用案 (ユーザー判断)

**案 C**: `maxRetries=1`、backoff `300ms`、`overallTimeoutMs=12000ms`

### 累積整合確認 (高指摘 #2、L-3 補足)

| 段階 | maxDuration | 1 試行最大 | 最悪累積 (retry=1) | overall=12s | 余白 | 状態 |
|---|---:|---:|---:|---:|---:|---|
| 現行 | 5s | 5s | 5+1.5+5+1.5+5 = 17.1s | 15s | -2.1s ✗ | overflow |
| **fix-PR1 適用後 (F1+F2+F4+F5+F6)** | **10s** | **10s** | 10+0.3+10 = **10.3s** | **12s** | **1.7s** ✅ | 整合 |
| **fix-PR1 単独参考 (もし F5 を含めなかったら)** | 5s | 5s | 5+0.3+5 = **10.3s** | 12s | **1.7s** ✅ | 整合 (L-3) |
| fix-PR2 適用後 (F3 + 追加 2 + 追加 3) | 10s | 10s | 10+0.3+10 = 10.3s | 12s | 1.7s ✅ | 整合 |

→ overall timeout は累積を包含し、retry 中に発火しない。F1 の onError 経路と意味論的に整合。

### 504 原因別 retry 効果見積もり (N1 補強)

retry の効果は 504 の発生原因に依存する:

| 504 発生原因 | retry の有効性 (backoff=300ms) | 復旧経路 |
|---|---|---|
| **A: maxDuration 超過** (= function 内の探索が遅すぎ) | **効果薄**: warm function で再走しても同じ局面で同じ遅延 → 再 504 | F1 onError → modal 経由ユーザー手動再試行 |
| **B: cold start spike** (= function 起動が遅い) | **効果中**: 1 回目で起動済 → 2 回目は warm 直行で復旧 | retry で自動復旧 |
| **C: Neon DB 一時遅延** (= cold suspended → resume 待機) | **効果大**: 2 回目は warm DB 直行で復旧 | retry で自動復旧 |

→ **A は retry 不能、B/C は retry で復旧可能**。本対応の主目的 (永久停止根治) を考えると、retry は B/C 救済 + A は modal 経由の手動リトライで十分。

backoff=300ms は cold start を待つには短すぎる懸念 (N1 別レビュアー指摘) があるが、case A は retry 効果ほぼなし、case B/C は warm 状態への遷移を待てば良いので 300ms でも実用的。**504 連発時の retry 効果は限定的で、復旧は modal 経由のユーザー操作に委ねる方針** で UX 短縮 (案 A 22s より優位) を維持。

### UX 評価

- 504 が出たら 1 回 retry (backoff 300ms) → 最大 12 秒でユーザーに modal 提示
- AGENTS.md「ラグ・待ち時間最小化」原則に整合 (案 A の 22s より UX 優位)
- 案 B (retry 撤廃) より 503/network 一過性障害への耐性あり

### 修正対象

- [src/hooks/ai/use-ai-request.ts](src/hooks/ai/use-ai-request.ts):
  - `maxRetries: 2 → 1`
  - `backoffMs(attempt)`: `Math.min(600 * Math.pow(2.5, attempt - 1), 4000)` → `Math.min(300 * Math.pow(2, attempt - 1), 1500)`
  - `overallTimeoutMs: 15000 → 12000`

---

## ~~追加 1: route.ts auth + DB read を Promise.all 並列化 (削除)~~

**C-2 案 A で削除**。

### 削除根拠

- 本リポジトリには **rate-limit が未実装** (`middleware.ts` 0 件、`rate-limit`/`Upstash`/`throttle` 0 件)
- 並列化採用後は **未認証 request でも `prisma.game.findUnique` が必ず発火** → DDoS で Neon Free tier (100 接続) と Hobby Function Duration (100 GB-Hours/月) 枯渇リスク
- F5 (maxDuration 5→10) で **cold start spike 1〜2s は十分吸収可能** (auth+DB 直列実行 200〜400ms 込みで余裕)
- 200〜400ms 短縮メリット < 攻撃面拡大リスク

### 将来再検討 (Issue #190 連携)

- Issue #190 の Vercel Pro upgrade + rate-limit 実装後に再検討
- rate-limit 実装は別 Issue として独立起票推奨 (本書スコープ外)

---

## 追加 2: TT サイズ 4M → 1M entries (🟢 低、fix-PR2)

### メモリ消費見積もり修正 (中指摘 #6)

**第 1 版の誤り**: 「メモリ消費 80MB → 20MB」

**正しい認識** (第 2 版で修正済):
- V8 の `new Array(1 << 22)` は **sparse array** で確保され、未使用 slot は holes (実消費ほぼ 0)
- 実消費は「TT に書き込まれた entry 数 × entry サイズ」で、4M 全部使われるわけではない
- PR #185 commit msg の「TT 確保コスト 13〜14ms」は **配列 metadata + V8 hidden class の確保コスト**
- 「80MB → 20MB」は悲観的すぎ、実態は **アロケーションコスト 1/4 (cold start で数 ms 短縮)**

### 修正

[src/lib/shogi/ai/transpositionTable.ts:14](src/lib/shogi/ai/transpositionTable.ts#L14): `TT_SIZE = 1 << 22` → `1 << 20`

コメント更新:

```ts
// Issue #176 timeout-fix: 4M → 1M に縮小。
// V8 の new Array(1 << 22) は sparse array で実メモリ消費は holes 経由でほぼ 0
// だが、配列 metadata + V8 hidden class の確保コストが 13〜14ms かかる。
// 1M に縮小することでアロケーションコスト 1/4 + GC pressure 軽減。
// hit 率は 2〜5% 程度低下する見込みで bench で確認 (許容範囲なら採用)。
const TT_SIZE = 1 << 20; // 1M entries
```

---

## 追加 3: deadline check 1024 → 256 node (🟢 低、fix-PR2)

### 修正

[src/lib/shogi/ai/search-context.ts:79](src/lib/shogi/ai/search-context.ts#L79):

```ts
// 旧: if ((ctx.nodes & 1023) === 0) {
// 新: if ((ctx.nodes & 255) === 0) {  // 1024 → 256 で検知遅延 1/4
```

コメント更新で根拠を明記。

---

## 検証方法 (第 3 版、bench 3 群構成 + タグ固定)

### bench 結果ファイルの取扱 (B-2 / C-1 反映)

- **`bench-results/.gitignore` は `*` 全件 ignore + `!.gitignore` のみ例外** で、bench 結果は **git 管理されていない** (PR #185 で確立した運用)
- 本対応でも **bench 結果は git 管理せず、PR 本文に表として貼付**する形式を踏襲 (C-1 案 A 採用)
- bench 実行時のローカルファイル名規則: `{phase}-{group}-runs{N}.json`
- PR 本文に bench サマリ表 (max / p50 / p95 / depthCompleted) を貼付

### bench 3 群構成 + タグ固定 (B-1 + H-2 反映)

| 群 | 構成 | 目的 | タグ | bench コマンド |
|---|---|---|---|---|
| **Group 1 (baseline)** | PR #185 マージ直後の origin/main (`030ff53`) | 比較基準 | `bench-baseline` | 下記 |
| **Group 2 (fix-PR1 適用後)** | F5+F1+F2+F4+F6 適用 | **F2+F5 (サーバ側 504 防御効果) の bench 測定。F1/F4 はクライアント側で bench に直接影響しないため preview 動作確認で別途検証** (N5 反映) | `bench-pr1` | 下記 |
| **Group 3 (fix-PR2 適用後 = full)** | F5+F1+F2+F3+F4+追加 2+追加 3+F6 適用 | F3 二段 deadline 効果 + 副次最適化が累積デグレを起こさないか確認 | `bench-pr2` | 下記 |

実行コマンド:

```bash
# 各群でタグを打って bench ポイントを固定 (再現性確保)
git tag bench-baseline 030ff53
git tag bench-pr1 <fix-PR1 最終 commit のハッシュ>  # fix-PR1 マージ直前
git tag bench-pr2 <fix-PR2 最終 commit のハッシュ>  # fix-PR2 マージ直前

# Group 1 (baseline)
git checkout bench-baseline
npx tsx scripts/bench-ai.ts --runs=3 --out=bench-results/timeout-fix-baseline-runs3.json

# Group 2 (fix-PR1)
git checkout bench-pr1
npx tsx scripts/bench-ai.ts --runs=3 --out=bench-results/timeout-fix-pr1-runs3.json

# Group 3 (fix-PR2)
git checkout bench-pr2
npx tsx scripts/bench-ai.ts --runs=3 --out=bench-results/timeout-fix-pr2-runs3.json
```

bench JSON は git 管理外 (C-1)、PR 本文に max / p50 / p95 / depthCompleted 表を貼付。

### N2 補強 ─ Group 2 bench 結果で fix-PR1 マージ可否を最終判断

- 受け入れ基準: Group 2 で expert/midgame_30 max < 4000ms かつ p95 < 3500ms
- Group 2 で max が 5000ms を超えるケースが残るなら **F3 を fix-PR1 に前倒し** する判断もあり得る (= 計画再修正、ユーザー再確認)
- Group 2 が予定通りなら fix-PR1 マージ → fix-PR2 着手

### 受け入れ基準

#### 機能 (PC)

- 龍王 (expert) で 5 局以上対局し 504 が出ないこと
- 504 が出ても retry で復旧 (1 回まで)、または **モーダルが表示**されて「もう一度試す / 投了する」が機能すること
- cold start 直後 (preview deploy 直後) の 1 手目でも 504 が出ないこと
- 待った / 投了 / 終局時に AI 思考が即座にキャンセルされること
- card-shogi の各種演出 (ドロー / カード使用 / 王手崩し / 二手指し) 中に AI がブロックされ、演出後に再開されること
- **card-shogi で 504 連発 → モーダル表示 → retry / 投了 で復旧** (B-4: 標準将棋と card-shogi で同根 silent stale バグが両方直る確認)
- (※ [ai-error-modal.tsx:29](src/components/game/ai-error-modal.tsx#L29) で `onOpenChange={() => {}}` により Esc / 外クリック dismiss は **既に無効化済み** = L-2 反映。F1 の文言分岐修正で破壊しないことを確認するのみで OK)

#### 機能 (モバイル) (中指摘 #9)

- iOS Safari / Android Chrome での 504 → modal 表示 → retry/投了タップで復旧確認
- modal がモバイル小画面 (320px 縦) でボタン領域が潰れずタップ可能
- 504 中に他操作 (アバター・サイドメニュー等) で modal が消えない (= modal の dismiss 無効化が機能している、上記 L-2)
- card-shogi のモバイル端末での演出進行中 → AI 切断 → modal 表示 → 復旧の挙動

### bench 受け入れ基準

- expert/midgame_30 max < 4000ms (F2 + F5 効果、F3 を含むなら + 200ms budget で 3700ms 程度)
- advanced/midgame_30 max < 3500ms (F2 効果)
- 全難易度の `depthCompleted` が PR #185 後 (Stage C bench) と同等以上
- `stoppedBy: "deadline"` の比率が極端に増えていないこと
- TT サイズ縮小 (追加 2、fix-PR2 で適用) で `depthCompleted` が大きく劣化していないこと

### Issue #109 観点 3 段階レビュー

- [x] 計画段階レビュー: 第 1 版 → 第 2 版 → 本第 3 版 (レビュー全 18 件 + ユーザー回答 2 件 反映)
- [ ] 実装完了時レビュー: 各 commit 後 + PR push 前
- [ ] PR レビュー段階: 動作確認結果 + bench サマリ + Issue #109 観点の自己レビュー結果を提示

---

## リスク・トレードオフ (第 3 版補強)

| 項目 | リスク | 緩和策 |
|---|---|---|
| F2 timeLimitMs 削減 | expert/advanced で探索深さ低下、AI が弱くなる可能性 | bench の `depthCompleted` を比較。劣化が大きければ Issue #190 の AI 強化で補填 |
| F3 200ms 専用 budget | budget 不足で blunder guard が一部 case で走り切らない可能性 | bench で blunder guard 起動局面の hardDeadlineAt 残量を計測 |
| F5 maxDuration 拡大 | runaway 関数の検出が遅れる | Hobby 上限 60s に対して 10s なので runaway protection は十分機能 |
| 追加 2 TT 4M→1M | hit 率低下で探索 nodes が増え deadline 超過頻度が増える可能性 | bench で expert/midgame_30 elapsed と depthCompleted を比較。劣化大なら 2M (1 << 21) で再評価 |
| 追加 3 check 間隔短縮 | `performance.now()` call が 4 倍 | per-request 内では無視できる規模 |
| F1 signal.reason | reason 文字列マッチ (`message === ABORT_REASONS.TIMEOUT`) で typo すると検知失敗 | **`ABORT_REASONS` 定数化 (M-1 反映) で typo 防止** + 単体テストで全 case 検証 |
| **既存テスト破壊リスク (L-1)** | F2/F3 修正で既存テストが破壊される可能性 | **`grep` 検証済 (2026-05-09 時点): `createSearchContext` / `deadlineAt` / `findBestMove` を直接参照する既存テストは 0 件**。F2/F3 修正で既存テストは無影響 |
| **複数タブ運用 (軽微指摘 #14)** | 同一 user × gameId をタブ A/B で同時に動かすとサーバ多重抑制でタブ A の探索が abort される | サポート対象外として明記。`inFlightRequests` Map は instance ローカル制約のみ |
| **モバイル発熱・バッテリー** | F1 timeout 後の retry でモバイル端末が熱を持つ | retry=1 + backoff 300ms でユーザー体感 12 秒以内に modal、低スペック端末でも許容範囲 |
| **DDoS リスク (C-2)** | 追加 1 採用後の rate-limit 未実装による未認証 DB 連投 | **追加 1 を C-2 案 A で削除済**。Issue #190 で Pro upgrade + rate-limit 実装後に再検討 |

---

## 既存 `issue-176.md` とのクロスリファレンス (軽微指摘 #13)

fix-PR2 マージ後、[docs/plans/issue-176.md](docs/plans/issue-176.md) の Phase 4 セクションに以下を追記:

```md
> **注: Phase 4 開始時点で `docs/plans/issue-176-timeout-fix.md` の F3 (blunder guard を SearchContext deadline 配下に + `searchDeadlineAt`/`hardDeadlineAt` の二段 deadline) が前倒し適用済。Phase 4 (= shogi-PR2) で blunder guard の根本再設計 (撤廃 / tie-breaker 化 / 評価関数強化) を行う際は、専用 budget 設計を踏襲する。**
```

---

## ブランチ戦略 (AGENTS.md ルール準拠、第 3 版で 2 PR 分割)

### fix-PR1: `fix/#176-timeout`

- **起点**: `origin/main` (commit `030ff53` 起点で既に作成済、第 1 版・第 2 版・第 3 版 push 済)
- **commit 構成**: F5 → F1 → F2 → F4 → F6 (fix-PR1 範囲) + 計画 md 第 3 版コミット
- **マージ後**: ローカル + origin の `fix/#176-timeout` を削除 (AGENTS.md ルール 9、ユーザー確認の上で)

### fix-PR2: `fix/#176-timeout-followup` (fix-PR1 マージ後に作成)

- **起点**: `origin/main` (fix-PR1 マージ後の最新)
- **commit 構成**: F3 → 追加 2 → 追加 3 → F6 (fix-PR2 範囲)
- **マージ後**: 同様に削除

### Issue #176 のクローズ

- fix-PR2 マージ + shogi-PR2 (Phase 3+4) 完了まで **しない**
- shogi-PR2 (Phase 3+4) は Issue #176 の本来スコープ、本 timeout fix はその派生

---

## 完了条件

### fix-PR1 (致命修正 + 504 頻度劇的低減)

1. **F5 (maxDuration 5→10)、F1 (signal.reason)、F2 (timeLimitMs 削減)、F4 (retry 予算)、F6 (fix-PR1 範囲のテスト)** が積まれている
2. 全 commit 時点で `npm run lint` (0 errors) / `typecheck` / `test:ci` (既存 + 新規追加すべてパス) / `build` が通る
3. bench (Group 2、`bench-pr1` タグ) で expert/midgame_30 max < 4000ms 確認
4. Vercel preview で龍王 5 局以上対局 + モバイル動作確認 + card-shogi 復旧確認 (B-4) を ユーザー確認
5. ユーザー指示で fix-PR1 を main にマージ

### fix-PR2 (再発予防 + 副次最適化)

1. **F3、追加 2、追加 3、F6 (fix-PR2 範囲)** が積まれている (追加 1 は C-2 案 A で削除済、計画書 commit には含めない)
2. 全 commit 時点で lint / typecheck / test:ci / build が通る
3. bench (Group 3、`bench-pr2` タグ) で全 case max < 5000ms、`depthCompleted` 劣化なし
4. Vercel preview 動作確認
5. ユーザー指示で fix-PR2 を main にマージ
6. Issue #176 にコメントで fix-PR1 + fix-PR2 の bench 結果サマリを記録
7. 既存 `issue-176.md` の Phase 4 セクションにクロスリファレンス追記
8. fix-PR2 マージ後、Issue #176 の **shogi-PR2 (本来 Phase 3+4)** に着手 (本 timeout fix とは独立)
9. すべて完了後、ユーザー判断で:
   - **Vercel Pro upgrade** (Issue #190 着手準備)
   - Issue #190 (AI 性能強化) 計画 md 作成 → 着手

---

## 想定 Q&A (第 3 版補強)

### Q1: F3 で deadline 超過時に blunder guard を skip すると、デタラメな手 (タダ取りされる手) を返さないか?

A: F2 で expert 3500ms に削減 + F3 で `searchDeadlineAt = 3300ms` に設定するため、通常局面では blunder guard が 200ms budget 内で走り切る。**deadline 超過になるのは異常局面 (合法手 80+ など)** のみで、その場合は `findBestMove` の探索結果 (深さ N まで読んだ best move) が採用される。これは PR #185 までの「blunder guard 自体が deadline 後に走って 504 を引き起こす」状態より明らかに改善。

### Q2: 案 C (overallTimeoutMs=12000ms) でも 12 秒待たされるのは UX 悪化では?

A: 504 が連発する **異常時のみ** の最悪値。通常時は 1 invocation 約 4s で完了するので、ユーザー体感は変わらない。案 A (22s) より UX 短縮、案 B (retry 撤廃) より 503/network 一過性障害への耐性を確保した中間最適。

### Q3: `signal.reason` の文字列マッチ ("overall timeout" など) が typo に弱くないか?

A: **`ABORT_REASONS` 定数化で対策済 (第 3 版 M-1 反映)**:

```ts
export const ABORT_REASONS = {
  CANCEL: "cancel",
  SUPERSEDE: "supersede",
  TIMEOUT: "overall timeout",
  UNMOUNT: "unmount",
} as const;
```

実装ファイルでは raw 文字列ではなく `ABORT_REASONS.TIMEOUT` 等の定数経由で参照。typo は型エラーで検知。単体テスト (F6 fix-PR1 範囲) で全 case 検証。

### Q4: fix-PR1 だけでマージして fix-PR2 を遅らせる利点は?

A: fix-PR1 (F5+F1+F2+F4+F6) だけで「**永久停止根治 + 504 頻度劇的低減 + retry 戦略最適化**」が成立。**production 障害を即時止血**できる。fix-PR2 は再発予防 + 副次最適化なので、bench を慎重に取ってから出せる。Issue #109「マージ前レビュー」観点でも fix-PR2 の品質を担保できる。

第 3 版で **F5 を fix-PR1 に移動** (N3 反映) したことで、fix-PR1 単独の 504 頻度低減効果が計算上 maxDuration=10s 内に収まり、fix-PR1 マージ後の preview で **504 ほぼ撲滅**を確認できる。

### Q5: Hobby のままで本当に大丈夫か? Pro upgrade すべきタイミングは?

A: 本 timeout fix のスコープなら Hobby で十分 (maxDuration 10s は上限 60s の余裕内、Active CPU 4 hrs は個人利用 + 同時 5 人 × 月 10 対局未満なら持つ)。**Pro upgrade のトリガー**は:

- AI 性能強化 (Issue #190、カード戦略 / 読み合い / NNUE 等) で maxDuration 60s 超が必要な場合
- 同時ユーザー数が増え月 30 対局以上の規模に達した場合
- 商業利用 (有料サブスク / 広告 / マネタイズ) を始める場合

これらのいずれかが見えたタイミングで Pro upgrade。

### Q6: 既存の `findBestMove` の互換性は維持されるか?

A: 維持。F1〜F6 は内部実装変更で、`findBestMove(state, player, options, variant, ctx?)` のシグネチャは変えない。`SearchContext` の interface に `searchDeadlineAt` / `hardDeadlineAt` が追加されるが、既存呼び出し元 (engine.ts) は新 API 経由なので影響軽微。

### Q7: 複数タブで対局を同時進行した場合の挙動は?

A: 軽微指摘 #14 通り **サポート対象外**。`inFlightRequests` Map は instance ローカルなので、Vercel が複数 instance を起動した場合に同 user × gameId の探索が複数 instance で走る可能性がある。本対応では無視 (= 通常運用では発生しないシナリオ)。

### Q8: モバイル端末での発熱 / バッテリー消耗は問題ないか?

A: F1 retry=1 + backoff 300ms により、ユーザー体感 12 秒以内に modal が出る (案 C)。低スペック端末でも:

- 通常時: 4s × 1 invocation = サーバ計算なのでクライアント負荷は fetch のみ (低)
- 504 連発時: 12s 内に modal、それ以降は手動再試行までクライアント負荷ゼロ
- AGENTS.md UI/UX 方針「モバイル発熱・バッテリー消耗最小化」と整合

### Q9: なぜ追加 1 (auth + DB read 並列化) を fix-PR2 から削除したのか? (C-2)

A: 本リポジトリには **rate-limit が完全に未実装** (`middleware.ts` 0 件、`rate-limit`/`Upstash`/`throttle` 0 件)。並列化採用後は **未認証 request でも `prisma.game.findUnique` が必ず発火** → DDoS で Neon Free tier (100 接続) と Hobby Function Duration (100 GB-Hours/月) 枯渇リスク。

F5 (maxDuration 5→10) で **cold start spike 1〜2s は十分吸収可能** (auth+DB 直列実行 200〜400ms 込みで余裕)。並列化メリット (200〜400ms 短縮) はリスクに見合わない。Issue #190 の Vercel Pro upgrade + rate-limit 実装後に再検討。

### Q10: bench 結果ファイルを git に入れない理由は? (C-1)

A: PR #185 で確立した運用 (`bench-results/.gitignore` で `*` 全件 ignore) を踏襲。bench 結果は履歴トレースより **PR レビュー時の参照** が主目的なので、PR 本文に max / p50 / p95 / depthCompleted の表を貼付すれば十分。git 履歴に毎回 JSON を残すとリポジトリが太るデメリットの方が大きい。

将来 CI artifact 化や bench 履歴比較が必要になれば、Issue #190 等で別途検討。
