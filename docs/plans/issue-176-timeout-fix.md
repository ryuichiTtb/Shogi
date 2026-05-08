# Issue #176 Timeout Fix 対応計画 第 2 版 (レビュー指摘反映済)

作成日: 2026-05-09 (第 1 版 2026-05-09)
対象 PR: PR #185 (Issue #176 PR 1) のフォローアップ
ブランチ: `fix/#176-timeout` (origin/main 起点、commit `042537e` で第 1 版 push 済)
関連 Issue: #176 (本対応の親)、#190 (Pro 前提の AI 性能強化、本対応完了 + Pro upgrade 後に着手)

---

## 第 2 版での変更点 (レビュー指摘 22 件 + ユーザー判断 4 件 反映)

| 区分 | 件数 | 反映内容 |
|---|---:|---|
| 致命級 | 1 | F1 設計を `useRef` 案 → **`signal.reason` 採用** に書き換え |
| 高優先度 | 3 | F4+F5 累積整合 → **案 C (overall=12000ms)**、F3 → **二段 deadline + `!ctx.stopped`**、実装順序 → **F1 を最初に** |
| 中優先度 | 5 | 追加 1 セキュリティ追記、追加 2 メモリ見積もり修正、F5 maxDuration **Hobby 上限 60s 内に確定**、modal 文言の `kind` 別分岐、モバイル受け入れ基準追加 |
| 軽微 | 4 | race テスト追加、コメント更新指示明記、関連ソース読了済の旨記載、既存 `issue-176.md` クロスリファレンス、複数タブ言及 |
| レビュー 2 追加 | 8 | A-1 signal.reason、A-2 案 C、A-3 `!ctx.stopped` 統合、A-4 **2 PR 分割**、B-1 bench 3 群構成、B-2 命名規則、B-3 行番号修正、B-4 card-shogi 同根明文化 |
| ユーザー判断 | 4 | Vercel **Hobby 維持**(Pro upgrade は #190 で別途)、F4+F5 → 案 C、**2 PR 分割**、F1 → signal.reason |

---

## Context

PR #185 (Issue #176 PR 1) を main にマージ後、本番環境 (Vercel) で `POST /api/ai-move` が 504 Gateway Timeout を返し、3 件目の 504 以降 CPU が手を指さなくなる致命的 UX 障害が発生。

ユーザー提供のコンソールログ 3 件、別調査者の精読、Vercel 公式 docs 調査 (Hobby/Pro plan の maxDuration 上限・wall-clock 計測等) を統合した結果、原因は以下 2 つの **連鎖** と確定:

1. **サーバ側**: `expert.timeLimitMs` (4500ms) と `maxDuration` (5000ms) の余白不足、blunder guard が `SearchContext` 不参照で deadline 後に走る、cold start + DB + TT alloc が 5s 踏み超す
2. **クライアント側**: [`use-ai-request.ts`](src/hooks/ai/use-ai-request.ts) で `AbortError` 4 経路 (cancel / unmount / overall timeout / 別 request 上書き) を区別せず silent stale で破棄 → `onError` 不発 → AI 永久停止

main 進行 (PR #186 / #188) は AI 関連ファイルに 0 行も触れておらず、競合は無し。

本計画は `fix/#176-timeout` ブランチで **2 PR 分割** で進める:

- **PR1 (致命修正先行)**: F1 + F2 + F4 (3 commit + 関連テスト)
- **PR2 (再発予防 + 副次最適化)**: F3 + F5 + 追加 1〜3 + F6 (6 commit + テスト)

PR1 だけで「永久停止根治 + 504 頻度低減 + retry 最適化」が成立し production に即時リリース可能。

---

## 関連ソース読了確認 (レビュー指摘 #12 / B-4 対応)

第 2 版作成時点で以下を読了し、F1/F2/F3/F4/F5/追加 1〜3 の設計に反映済:

| ファイル | 確認内容 |
|---|---|
| [src/lib/auth/current-user.ts](src/lib/auth/current-user.ts) | `getCurrentAppUser` は account なら [L128-133](src/lib/auth/current-user.ts#L128-L133) の `prisma.user.findUnique`、guest なら [L164-185](src/lib/auth/current-user.ts#L164-L185) で 2 DB calls (findUnique + update)。**確実に DB ヒットするので追加 1 (Promise.all 並列化) のメリットあり** |
| [src/hooks/use-shogi-game.ts](src/hooks/use-shogi-game.ts) | AI useEffect deps `[currentPlayer, status, aiRetryCounter]` ([L333](src/hooks/use-shogi-game.ts#L333))。F1 retry → `aiRetryCounter++` で再 fire 経路は機能する。silent stale 経路は [L306-310](src/hooks/use-shogi-game.ts#L306-L310) (B-3 行番号修正済) |
| [src/hooks/use-card-shogi-game.ts](src/hooks/use-card-shogi-game.ts) | AI useEffect deps `[currentPlayer, status, pendingCard, isDrawing, isPlayingCard, isCheckBreakAnimating, disableAi, aiRetryCounter]` ([L144-152](src/hooks/use-card-shogi-game.ts#L144-L152))。silent stale は [L118-122](src/hooks/use-card-shogi-game.ts#L118-L122) で **同根**。F1 修正は両 hook 同時適用で復旧可 |
| [src/hooks/card-shogi/reducer.ts](src/hooks/card-shogi/reducer.ts) | `pendingCard` / `isDrawing` / `isPlayingCard` / `isCheckBreakAnimating` / `doubleMove` の演出フラグ。AI 思考中の演出割込みは F1 (cancel reason) で安全に処理可能 |
| [src/components/game/ai-error-modal.tsx](src/components/game/ai-error-modal.tsx) | 文言「通信や一時的なエラーで AI 思考が完了しませんでした」は timeout 経路を含意しない (中指摘 #8) → F1 内で `kind` 別文言分岐 |

---

## 現状認識 — 504 と永久停止の発生メカニズム (第 1 版から継続)

### 1. サーバ側 (504 の直接原因)

#### 1-A. expert timeLimitMs が maxDuration に近すぎる

[engine.ts:38-44](src/lib/shogi/ai/engine.ts#L38-L44) の `expert.timeLimitMs = 4500` と [route.ts:26](src/app/api/ai-move/route.ts#L26) の `maxDuration = 5` で **余白 500ms**。計画書 [docs/plans/issue-176.md:67](docs/plans/issue-176.md#L67) の「hard stop 4.0 秒以内」を expert で踏み超している。

#### 1-B. blunder guard が deadline を完全に無視

[engine.ts:198-225](src/lib/shogi/ai/engine.ts#L198-L225) の hanging piece チェックは `findBestMove` が deadline 厳守で 4500ms 使い切った後にさらに **100〜500ms 余分に走る**。`SearchContext` を一切参照していない。

#### 1-C. 探索開始前のオーバーヘッド

[route.ts:118-134](src/app/api/ai-move/route.ts#L118-L134) で `getCurrentAppUser` → `prisma.game.findUnique` が **直列実行**。さらに [search-context.ts:62](src/lib/shogi/ai/search-context.ts#L62) で `new TranspositionTable()` が **毎 request** 走る。

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

3 件目の 504 console stack に `await in (anonymous)` が含まれていたのもこれと整合 (requestMove が await 中の overall timeout で abort された時の trace)。

同様の silent stale パターンが [use-ai-request.ts:138-142](src/hooks/ai/use-ai-request.ts#L138-L142) の `delay()` 経路にもある (backoff 待機中の overall timeout)。

---

## 修正方針 (第 2 版)

### 致命級・高優先度の確定設計

| # | 内容 | 第 2 版での確定 |
|---|---|---|
| **F1** 🔴 | AbortError silent stale バグ修正 | **`signal.reason` 採用** (Web 標準、既存 [L125](src/hooks/ai/use-ai-request.ts#L125) と整合、race 完全安全) |
| **F2** 🔴 | DIFFICULTY_PARAMS 削減 | **beginner 800 / intermediate 1800 / advanced 3000 / expert 3500** ms |
| **F3** 🟠 | blunder guard deadline 配下 | **二段 deadline (`searchDeadlineAt` / `hardDeadlineAt`、200ms 専用 budget) + `!ctx.stopped` で signal abort も同時吸収** |
| **F4** 🟠 | retry 予算整備 | **maxRetries=1、backoff=300ms、overallTimeoutMs=12000ms** (案 C) |
| **F5** 🟡 | maxDuration 拡大 | **5 → 10 (Hobby 上限 60s の余裕内)** |
| **追加 1** 🟡 | auth + DB read 並列化 | `Promise.all`、ただし**未認証クエリ許容のセキュリティトレードオフ**を明記 |
| **追加 2** 🟢 | TT サイズ削減 | 4M → 1M、効果は**アロケーションコスト 1/4** (メモリ消費 80MB→20MB は誤り、V8 sparse array で実消費はほぼ 0) |
| **追加 3** 🟢 | deadline check 間隔短縮 | 1024 → 256 node |
| **F6** 🟢 | 単体テスト追加 | F1 race/並走系を含む |

### 実装順序 (第 2 版・F1 先頭、2 PR 分割)

#### **PR1 (致命修正先行)** ─ `fix/#176-timeout`

| 順 | コミット | ファイル | 検証 |
|---:|---|---|---|
| 1 | **F1**: AbortError signal.reason 区別 + modal 文言分岐 | use-ai-request.ts、ai-error-modal.tsx、AiRequestError 型 | unit test 追加 (race 含む) |
| 2 | **F2**: DIFFICULTY_PARAMS timeLimitMs 削減 + 根拠コメント更新 | engine.ts | bench で max < 4s 確認 |
| 3 | **F4**: retry 予算整備 (maxRetries=1、backoff=300ms、overall=12000ms) | use-ai-request.ts | unit test 更新 |
| 4 | **F6 (PR1 範囲)**: F1+F2+F4 のテスト網羅 | __tests__/ | test:ci 全パス |

PR1 で「永久停止根治 + 504 頻度低減 + retry 最適化」が成立。Vercel preview 動作確認後、ユーザー指示でマージ → production 即時リリース。

#### **PR2 (再発予防 + 副次最適化)** ─ `fix/#176-timeout-followup` (PR1 マージ後に origin/main 起点で新規)

| 順 | コミット | ファイル | 検証 |
|---:|---|---|---|
| 5 | **F3**: blunder guard を二段 deadline 配下に + `!ctx.stopped` 統合 | engine.ts、search-context.ts | unit test 追加、bench で max 改善確認 |
| 6 | **F5**: maxDuration 5 → 10 + 根拠コメント更新 | route.ts | preview deploy 確認 |
| 7 | **追加 1**: auth + DB read を Promise.all 並列化 + セキュリティコメント | route.ts | typecheck、preview |
| 8 | **追加 2**: TT サイズ 4M → 1M + コメント更新 | transpositionTable.ts | bench で elapsed/depthCompleted 確認 |
| 9 | **追加 3**: deadline check 1024 → 256 node + コメント更新 | search-context.ts | bench で elapsed 確認 |
| 10 | **F6 (PR2 範囲)**: F3 deadline テスト追加 | __tests__/ | test:ci 全パス |

PR2 完了後、Vercel preview で龍王 5 局以上対局 + bench 3 群比較を確認 → ユーザー指示でマージ。

---

## F1: AbortError silent stale バグ修正 (🔴 致命) ─ `signal.reason` 採用

### 設計

`AbortController.abort(reason)` + `signal.reason` を使い、abort 経路を 4 種に区別。既存 [use-ai-request.ts:125](src/hooks/ai/use-ai-request.ts#L125) と同形式で統一。

#### コア修正

```ts
// AiRequestError 型に "timeout" を追加
export interface AiRequestError {
  kind: "network" | "http" | "timeout" | "invalid";
  status?: number;
  message: string;
}

// abort 呼び出し時に reason を埋め込む
inFlightRef.current?.abort(new DOMException("supersede", "AbortError"));
controller.abort(new DOMException("cancel", "AbortError"));
controller.abort(new DOMException("overall timeout", "AbortError"));
controller.abort(new DOMException("unmount", "AbortError"));

// catch 内で signal.reason を見て分岐
} catch (err) {
  if ((err as { name?: string }).name === "AbortError") {
    const reason = controller.signal.reason as DOMException | undefined;
    if (reason?.message === "overall timeout") {
      // 予算切れ: onError を発火し、UI を復旧可能状態に
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

#### `delay()` 経路 (backoff 待機中) も同様の区別

```ts
// use-ai-request.ts:138-142 周辺
} catch (err) {
  if ((err as { name?: string }).name === "AbortError") {
    const reason = controller.signal.reason as DOMException | undefined;
    if (reason?.message === "overall timeout") {
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

### 修正対象

- [src/hooks/ai/use-ai-request.ts](src/hooks/ai/use-ai-request.ts):
  - `AiRequestError` に `kind: "timeout"` 追加
  - `controller.abort()` 呼び出し全箇所に reason DOMException を渡す
  - catch 内で `signal.reason` を見て分岐
  - `delay()` 経路にも同じ区別を適用
- [src/components/game/ai-error-modal.tsx](src/components/game/ai-error-modal.tsx):
  - `error: AiRequestError | null` prop 追加
  - 文言を `kind` 別分岐
- [src/hooks/use-shogi-game.ts](src/hooks/use-shogi-game.ts) / [src/hooks/use-card-shogi-game.ts](src/hooks/use-card-shogi-game.ts):
  - `aiError` 受け取りを `AiRequestError | null` 型化
- [src/components/game/shogi-game.tsx](src/components/game/shogi-game.tsx) / [src/components/game/card-shogi/card-shogi-game.tsx](src/components/game/card-shogi/card-shogi-game.tsx):
  - `<AiErrorModal>` に `error={aiError}` を渡す

### F1 単体テスト (レビュー指摘 #10 race/並走テスト追加)

`src/hooks/ai/__tests__/use-ai-request.test.ts` (新規):

1. **意図的 cancel** (`cancel()`) → `onError` 不発、stale return
2. **unmount cleanup** → `onError` 不発、stale return
3. **別 request 上書き** (連続 `requestMove`) → 前 request の `onError` 不発
4. **HTTP 504 が maxRetries 回連続** (本ケースは PR1 の F4 で `maxRetries=1`) → `onError({ kind: "http", status: 504 })` が **1 回だけ** 発火
5. **overall timeout fire** (短い `overallTimeoutMs` で意図的に発火) → `onError({ kind: "timeout" })` 発火 ← **F1 の核心**
6. **HTTP 503 が 1 回 → 200 で成功** → retry で復旧、`onError` 不発
7. **race: supersede 中に前 request の overall timer が遅れて発火** → 新 request 側に reason 混線しない (signal.reason が物理的に分離されているため)
8. **race: backoff `delay()` 中に overall timeout 発火** → onError({ kind: "timeout" }) 発火
9. **race: 既に aborted な signal で fetch 起動** → 同期 AbortError → silent stale (cancel 扱い)

テスト技術:
- `vi.mock("global.fetch")` で 503/504/200/AbortError を制御
- `vi.useFakeTimers()` で `setTimeout` を制御
- `act` / `renderHook` で React hook 駆動

---

## F2: DIFFICULTY_PARAMS の timeLimitMs 削減 (🔴 致命)

### 修正値

[`engine.ts:DIFFICULTY_PARAMS`](src/lib/shogi/ai/engine.ts#L26-L56):

| difficulty | 現行 | 第 2 版 | 根拠 |
|---|---:|---:|---|
| beginner | 1000 | **800** | 計画書 [issue-176.md:67](docs/plans/issue-176.md#L67) 目安 |
| intermediate | 2000 | **1800** | 計画書目安 |
| advanced | 4000 | **3000** | hard stop 4s 以内、余白拡大 |
| expert | 4500 | **3500** | 計画書目安、Stage C bench で max 3.8s 観測済 |

### 棋力影響 (高指摘 #3 / Q5 補足)

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

## F3: blunder guard を SearchContext deadline 配下に + `!ctx.stopped` 統合 (🟠 高)

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

## F4: retry 予算整備 (🟠 高) ─ 案 C 採用

### 採用案 (ユーザー判断)

**案 C**: `maxRetries=1`、backoff `300ms`、`overallTimeoutMs=12000ms`

### 累積整合確認 (高指摘 #2)

| 項目 | 値 |
|---|---|
| 1 試行最大 (maxDuration=10s) | 10s |
| backoff | 300ms |
| 最悪累積 (1 retry 含む) | 10 + 0.3 + 10 = **10.3s** |
| overallTimeoutMs | **12000ms** |
| 余白 (overall - 累積) | **1.7s** ✅ |

→ overall timeout は累積を包含し、retry 中に発火しない。F1 の onError 経路と意味論的に整合。

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

## F5: maxDuration を 5 → 10 に拡大 (🟡 中) ─ Hobby 上限 60s 内

### Vercel プラン確定 (中指摘 #7、ユーザー判断)

- **本リポジトリの契約プラン: Hobby**
- **Hobby Function maximum duration: 10s default / 60s max** (Vercel 公式 docs [docs/plans/hobby](https://vercel.com/docs/plans/hobby) より)
- **採用値: 10s** (Hobby 上限 60s の 1/6、cold start spike 5s 込みでも余裕)

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

## 追加 1: route.ts auth + DB read を Promise.all 並列化 (🟡 中)

### 修正方針 (中指摘 #5 セキュリティトレードオフ反映)

```ts
// route.ts:118-134 修正後
const [user, game] = await Promise.all([
  (async () => {
    try { return await getCurrentAppUser(); }
    catch { return null; }
  })(),
  // 注: 並列化により未認証 request でも DB read が走る。所有者チェック
  // (game.playerId !== user.id) で漏洩は防がれるが、攻撃者が任意 gameId で
  // 連投すると DB 負荷が線形に増える。Vercel WAF / rate-limit は別レイヤで対策。
  prisma.game.findUnique({
    where: { id: body.gameId },
    select: { id: true, playerId: true, status: true },
  }),
]);
if (!user) return jsonError(401, "Unauthorized");
if (!game) return jsonError(404, "Game not found");
if (game.playerId !== user.id) return jsonError(403, "Forbidden");
if (game.status !== "active") return jsonError(409, "Game not active");
```

### 効果見積もり

- `getCurrentAppUser()` は **確実に DB を叩く** ([current-user.ts:128-133](src/lib/auth/current-user.ts#L128-L133) account / [L164-185](src/lib/auth/current-user.ts#L164-L185) guest)
- cold start で auth-DB と game-DB の `max(...)` で 200〜400ms 短縮見込み
- 並列化採用判断: **採用** (cold start 短縮効果あり、セキュリティトレードオフはコメントで明記)

---

## 追加 2: TT サイズ 4M → 1M entries (🟢 低)

### メモリ消費見積もり修正 (中指摘 #6)

**第 1 版の誤り**: 「メモリ消費 80MB → 20MB」

**正しい認識**:
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

## 追加 3: deadline check 1024 → 256 node (🟢 低)

### 修正

[src/lib/shogi/ai/search-context.ts:79](src/lib/shogi/ai/search-context.ts#L79):

```ts
// 旧: if ((ctx.nodes & 1023) === 0) {
// 新: if ((ctx.nodes & 255) === 0) {  // 1024 → 256 で検知遅延 1/4
```

コメント更新で根拠を明記。

---

## 検証方法 (第 2 版)

### bench 3 群構成 (B-1)

| 群 | 構成 | 目的 | ファイル名 |
|---|---|---|---|
| Group 1 (baseline) | 現状 (PR #185 後) | 比較基準 | `bench-results/timeout-fix-baseline-runs3.json` |
| Group 2 (PR1 適用後) | F1+F2+F4 適用 | 504 解消 + 永久停止根治の確認 | `bench-results/timeout-fix-pr1-runs3.json` |
| Group 3 (PR2 適用後 = full) | F1+F2+F3+F4+F5+追加 1〜3 適用 | 副次最適化が累積デグレを起こさないかを確認 | `bench-results/timeout-fix-pr2-runs3.json` |

実行:

```bash
# Group 1 (PR #185 head)
git checkout 030ff53
npx tsx scripts/bench-ai.ts --runs=3 --out=bench-results/timeout-fix-baseline-runs3.json

# Group 2 (PR1 head)
git checkout fix/#176-timeout  # PR1 最終 commit
npx tsx scripts/bench-ai.ts --runs=3 --out=bench-results/timeout-fix-pr1-runs3.json

# Group 3 (PR2 head)
git checkout fix/#176-timeout-followup  # PR2 最終 commit
npx tsx scripts/bench-ai.ts --runs=3 --out=bench-results/timeout-fix-pr2-runs3.json
```

### bench 結果ファイルの git 管理規則 (B-2)

- **`bench-results/` は git 管理対象** (`.gitignore` 例外)
- ファイル名規則: `{phase}-{group}-runs{N}.json`
- 例: `timeout-fix-baseline-runs3.json` / `timeout-fix-pr1-runs3.json`
- 古い bench は PR マージ後に削除可。直近 1 PR 分は履歴比較のため保持
- PR 本文に bench 結果サマリ表 (max / p50 / p95 / depthCompleted) を貼付

### 受け入れ基準

#### 機能 (PC)

- 龍王 (expert) で 5 局以上対局し 504 が出ないこと
- 504 が出ても retry で復旧 (1 回まで)、または **モーダルが表示**されて「もう一度試す / 投了する」が機能すること
- cold start 直後 (preview deploy 直後) の 1 手目でも 504 が出ないこと
- 待った / 投了 / 終局時に AI 思考が即座にキャンセルされること
- card-shogi の各種演出 (ドロー / カード使用 / 王手崩し / 二手指し) 中に AI がブロックされ、演出後に再開されること
- **card-shogi で 504 連発 → モーダル表示 → retry / 投了 で復旧** (B-4: 標準将棋と card-shogi で同根 silent stale バグが両方直る確認)

#### 機能 (モバイル) (中指摘 #9)

- iOS Safari / Android Chrome での 504 → modal 表示 → retry/投了タップで復旧確認
- modal がモバイル小画面 (320px 縦) でボタン領域が潰れずタップ可能
- 504 中に他操作 (アバター・サイドメニュー等) で modal が消えない (= modal の dismiss 無効化が機能している)
- card-shogi のモバイル端末での演出進行中 → AI 切断 → modal 表示 → 復旧の挙動

### bench 受け入れ基準

- expert/midgame_30 max < 4000ms (F2 + F3 効果)
- advanced/midgame_30 max < 3500ms (F2 効果)
- 全難易度の `depthCompleted` が PR #185 後 (Stage C bench) と同等以上
- `stoppedBy: "deadline"` の比率が極端に増えていないこと
- TT サイズ縮小 (追加 2) で `depthCompleted` が大きく劣化していないこと

### Issue #109 観点 3 段階レビュー

- [x] 計画段階レビュー: 第 1 版 → レビュー 22 件指摘 → 本第 2 版
- [ ] 実装完了時レビュー: 各 commit 後 + PR push 前
- [ ] PR レビュー段階: 動作確認結果 + bench サマリ + Issue #109 観点の自己レビュー結果を提示

---

## リスク・トレードオフ (第 2 版補強)

| 項目 | リスク | 緩和策 |
|---|---|---|
| F2 timeLimitMs 削減 | expert/advanced で探索深さ低下、AI が弱くなる可能性 | bench の `depthCompleted` を比較。劣化が大きければ Issue #190 の AI 強化で補填 |
| F3 200ms 専用 budget | budget 不足で blunder guard が一部 case で走り切らない可能性 | bench で blunder guard 起動局面の hardDeadlineAt 残量を計測 |
| F5 maxDuration 拡大 | runaway 関数の検出が遅れる | Hobby 上限 60s に対して 10s なので runaway protection は十分機能 |
| 追加 1 並列化 | 未認証 request でも DB read が走る | コメントで明記、Vercel WAF / rate-limit は別レイヤで対策 |
| 追加 2 TT 4M→1M | hit 率低下で探索 nodes が増え deadline 超過頻度が増える可能性 | bench で expert/midgame_30 elapsed と depthCompleted を比較。劣化大なら 2M (1 << 21) で再評価 |
| 追加 3 check 間隔短縮 | `performance.now()` call が 4 倍 | per-request 内では無視できる規模 |
| F1 signal.reason | reason 文字列マッチ (`message === "overall timeout"`) で typo すると検知失敗 | const で文字列定数化 + 単体テストで全 case 検証 |
| **複数タブ運用 (軽微指摘 #14)** | **同一 user × gameId をタブ A/B で同時に動かすとサーバ多重抑制でタブ A の探索が abort される** | サポート対象外として明記。`inFlightRequests` Map は instance ローカル制約のみ |
| **モバイル発熱・バッテリー** | F1 timeout 後の retry でモバイル端末が熱を持つ | retry=1 + backoff 300ms でユーザー体感 12 秒以内に modal、低スペック端末でも許容範囲 |

---

## 既存 `issue-176.md` とのクロスリファレンス (軽微指摘 #13)

PR2 マージ後、[docs/plans/issue-176.md](docs/plans/issue-176.md) の Phase 4 セクションに以下を追記:

```md
> **注: Phase 4 開始時点で `docs/plans/issue-176-timeout-fix.md` の F3 (blunder guard を SearchContext deadline 配下に + `searchDeadlineAt`/`hardDeadlineAt` の二段 deadline) が前倒し適用済。Phase 4 で blunder guard の根本再設計 (撤廃 / tie-breaker 化 / 評価関数強化) を行う際は、専用 budget 設計を踏襲する。**
```

---

## ブランチ戦略 (AGENTS.md ルール準拠、第 2 版で 2 PR 分割)

### PR1: `fix/#176-timeout`

- **起点**: `origin/main` (commit `030ff53` 起点で既に作成済、第 1 版 push 済)
- **commit 構成**: F1 → F2 → F4 → F6 (PR1 範囲) + 計画 md 第 2 版コミット
- **マージ後**: ローカル + origin の `fix/#176-timeout` を削除 (AGENTS.md ルール 9、ユーザー確認の上で)

### PR2: `fix/#176-timeout-followup` (PR1 マージ後に作成)

- **起点**: `origin/main` (PR1 マージ後の最新)
- **commit 構成**: F3 → F5 → 追加 1 → 追加 2 → 追加 3 → F6 (PR2 範囲)
- **マージ後**: 同様に削除

### Issue #176 のクローズ

- PR2 マージ + Phase 3+4 (PR 2) 完了まで **しない**
- Phase 3+4 は Issue #176 の本来スコープ、本 timeout fix はその派生

---

## 完了条件

### PR1 (致命修正先行)

1. F1 (signal.reason)、F2 (timeLimitMs 削減)、F4 (retry 予算)、F6 (PR1 範囲のテスト) が積まれている
2. 全 commit 時点で `npm run lint` (0 errors) / `typecheck` / `test:ci` (既存 + 新規追加すべてパス) / `build` が通る
3. bench (Group 2) で expert/midgame_30 max < 4000ms 確認
4. Vercel preview で龍王 5 局以上対局 + モバイル動作確認 + card-shogi 復旧確認 (B-4) を ユーザー確認
5. ユーザー指示で PR1 を main にマージ

### PR2 (再発予防 + 副次最適化)

1. F3、F5、追加 1〜3、F6 (PR2 範囲) が積まれている
2. 全 commit 時点で lint / typecheck / test:ci / build が通る
3. bench (Group 3) で全 case max < 5000ms、`depthCompleted` 劣化なし
4. Vercel preview 動作確認
5. ユーザー指示で PR2 を main にマージ
6. Issue #176 にコメントで PR1 + PR2 の bench 結果サマリを記録
7. 既存 `issue-176.md` の Phase 4 セクションにクロスリファレンス追記
8. PR2 マージ後、Issue #176 の **本来 Phase 3+4** に着手 (本 timeout fix とは独立)
9. すべて完了後、ユーザー判断で:
   - **Vercel Pro upgrade** (Issue #190 着手準備)
   - Issue #190 (AI 性能強化) 計画 md 作成 → 着手

---

## 想定 Q&A (第 2 版補強)

### Q1: F3 で deadline 超過時に blunder guard を skip すると、デタラメな手 (タダ取りされる手) を返さないか?

A: F2 で expert 3500ms に削減 + F3 で `searchDeadlineAt = 3300ms` に設定するため、通常局面では blunder guard が 200ms budget 内で走り切る。**deadline 超過になるのは異常局面 (合法手 80+ など)** のみで、その場合は `findBestMove` の探索結果 (深さ N まで読んだ best move) が採用される。これは PR #185 までの「blunder guard 自体が deadline 後に走って 504 を引き起こす」状態より明らかに改善。

### Q2: 案 C (overallTimeoutMs=12000ms) でも 12 秒待たされるのは UX 悪化では?

A: 504 が連発する **異常時のみ** の最悪値。通常時は 1 invocation 約 4s で完了するので、ユーザー体感は変わらない。案 A (22s) より UX 短縮、案 B (retry 撤廃) より 503/network 一過性障害への耐性を確保した中間最適。

### Q3: `signal.reason` の文字列マッチ ("overall timeout" など) が typo に弱くないか?

A: 文字列定数化することで対策:

```ts
// use-ai-request.ts 冒頭
const ABORT_REASONS = {
  CANCEL: "cancel",
  SUPERSEDE: "supersede",
  TIMEOUT: "overall timeout",
  UNMOUNT: "unmount",
} as const;

// 使用箇所
controller.abort(new DOMException(ABORT_REASONS.TIMEOUT, "AbortError"));

// catch 内
if (reason?.message === ABORT_REASONS.TIMEOUT) { ... }
```

単体テストで全 case 検証 (F6 PR1 範囲)。

### Q4: PR1 だけでマージして PR2 を遅らせる利点は?

A: PR1 (F1+F2+F4) だけで「永久停止根治 + 504 頻度低減 + retry 最適化」が成立。**production 障害を即時止血**できる。PR2 は再発予防 + 副次最適化なので、bench を慎重に取ってから出せる。Issue #109「マージ前レビュー」観点でも PR2 の品質を担保できる。

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
