# Issue #176 Timeout Fix 対応計画 (レビュー用)

作成日: 2026-05-09
対象 PR: PR #185 (Issue #176 PR 1) のフォローアップ
新規ブランチ: `fix/#176-timeout` (origin/main 起点)

---

## Context

PR #185 (Issue #176 PR 1) を main にマージしてから本番運用 (Vercel) で **`POST /api/ai-move` が 504 Gateway Timeout を返す** 事象が発生。さくら (低難易度) では稀、龍王 (expert) ではほぼ毎対局で発生し、3 件目の 504 以降 **CPU が手を指さなくなる (永久停止)** という致命的 UX 障害になる。

ユーザーから提供された開発者ツールのコンソールログ 3 件と、別調査者の精読結果 + 私の Vercel 公式 docs 調査結果を統合した結果、原因は以下 2 つの **連鎖** と確定した:

1. **サーバ側**: `expert.timeLimitMs` (4500ms) が `maxDuration` (5000ms) に対して余白不足 + blunder guard が deadline を無視して deadline 後に追加 100〜500ms 走る → cold start や DB 遅延と重なって 5 秒を踏み超え Vercel が hard kill → 504
2. **クライアント側**: `use-ai-request.ts` で **overall timeout (15s) 発火による `controller.abort()` を、意図的 cancel と同じ `silent stale` 経路で破棄**しており、`onError` が呼ばれず `aiError` がセットされず → モーダル出ず + AI useEffect も deps 変化なしで再 fire しない → **AI 永久停止**

main へのマージ後、PR #186 (#79 tuner-page) と PR #188 (#187 デッキ SFX) が先行マージされているが、`git log 030ff53..HEAD -- src/hooks/use-shogi-game.ts src/hooks/use-card-shogi-game.ts src/hooks/ai/ src/app/api/ai-move/ src/lib/shogi/ai/ src/components/game/ai-error-modal.tsx` の結果は **空** で、AI 関連ファイルは一切触られていない。**他作業との競合は影響していない**。

本計画は PR #185 のフォローアップ修正をブランチ `fix/#176-timeout` (origin/main 起点) で進める手順を、レビューしやすい粒度で文書化する。

---

## 現状認識 — 504 と永久停止の発生メカニズム

### 1. サーバ側 (504 の直接原因)

#### 1-A. expert timeLimitMs が maxDuration に近すぎる

[src/lib/shogi/ai/engine.ts:38-44](src/lib/shogi/ai/engine.ts#L38-L44):

```ts
expert: {
  maxDepth: 24,
  timeLimitMs: 4500, // ← 計画書の「hard stop 4.0秒以内」を逸脱
  ...
}
```

[src/app/api/ai-move/route.ts:26](src/app/api/ai-move/route.ts#L26): `export const maxDuration = 5;`

→ Vercel hard stop までの **安全余白 500ms** しかない。計画書 [docs/plans/issue-176.md:67](docs/plans/issue-176.md#L67) は明確に:

> `maxDuration = 5` は最終保険であり、内部探索 deadline は通信・JSON・React 反映・cold start の余白を残すため hard stop 4.0 秒以内を基本にする

と書いていたが、実装では expert で踏み超している (構造上の地雷)。

#### 1-B. blunder guard が deadline を完全に無視

[src/lib/shogi/ai/engine.ts:198-225](src/lib/shogi/ai/engine.ts#L198-L225):

```ts
if (
  !usedFallback &&
  move !== null &&
  (difficulty === "advanced" || difficulty === "expert")
) {
  const nextState = applyMoveForSearch(state, move);
  if (hasHangingPiece(nextState, player, variant)) {
    const legalMoves = getFullLegalMoves(state, player, variant);
    const safeMoves = legalMoves.filter((m) => {
      const ns = applyMoveForSearch(state, m);
      return !hasHangingPiece(ns, player, variant);
    });
    // ... 全合法手を再評価
  }
}
```

このコードは `findBestMove` (deadline 厳守) が返ったあとに実行される。**`SearchContext` を一切参照していない** ため、4500ms ぴったり使い切った後でさらに **100〜500ms 余分に走る**。中盤で駒数が多いほど顕著で、龍王 (expert) でほぼ毎対局再現する観察と完全に整合。

PR #185 のコメントには「Stage A では現行挙動を維持する。Phase 4 (PR 2) で抑制ロジックを再設計する」とあるが、**現行挙動 = deadline 違反であることに気づかずラベルを貼っていた**点が見落とし。

#### 1-C. 探索開始前のオーバーヘッド

[src/app/api/ai-move/route.ts](src/app/api/ai-move/route.ts) で `findBestMoveWithStats` 呼び出し前に以下を **直列実行**:

- L121: `getCurrentAppUser()` (Clerk auth + Prisma find)
- L128-131: `prisma.game.findUnique` (Neon にラウンドトリップ)
- `findBestMoveWithStats` 内の [src/lib/shogi/ai/search-context.ts:62](src/lib/shogi/ai/search-context.ts#L62): `new TranspositionTable()` で `new Array(1<<22)` = 4M entries を毎 request 確保

PR #185 のコミットメッセージ自身が「book hit でも 13〜14ms」「beginner 4ms→304ms に増加」と TT 確保コストを記録している。

帰結: **(cold start + auth + DB + TT alloc) + 4500ms search + (blunder guard + JSON serialize) が容易に 5s を超えて Vercel が 504 を返す**。

### 2. クライアント側 (永久停止の真因 ─ 真のバグ)

[src/hooks/ai/use-ai-request.ts](src/hooks/ai/use-ai-request.ts) の retry/timeout 設計を時間軸に展開:

| パラメータ | 値 |
|---|---|
| `maxRetries` | 2 (= 計 3 回試行) |
| `overallTimeoutMs` | 15000ms |
| `backoffMs(attempt)` | 600ms, 1500ms |
| 1 試行最大 (Vercel hard stop) | 5000ms |

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
          → attempt3 の fetch が AbortError を投げる
```

ここで [src/hooks/ai/use-ai-request.ts:168-172](src/hooks/ai/use-ai-request.ts#L168-L172):

```ts
} catch (err) {
  if ((err as { name?: string }).name === "AbortError") {
    // 明示的キャンセル / overall timeout / unmount。リトライしない。
    return { stale: true, requestId };
  }
  // ...
}
```

`AbortError` は 4 つの異なる原因で発生:
1. `cancel()` 経由の意図的キャンセル (待った/終局)
2. unmount 経由の cleanup
3. **overall timeout fires → `controller.abort()`** ← **ここが silent**
4. 別 request 上書きで前 request を abort

すべて同じ「stale 扱い」で **`onError` を呼ばずに silent return**。同様の silent stale パターンが [src/hooks/ai/use-ai-request.ts:138-142](src/hooks/ai/use-ai-request.ts#L138-L142) の `delay()` 経路にもある (backoff 待機中の overall timeout)。

その結果:

- `setAiError` が呼ばれない → `<AiErrorModal open={aiError !== null} />` は閉じたまま
- [src/hooks/use-shogi-game.ts:306-311](src/hooks/use-shogi-game.ts#L306-L311) / use-card-shogi-game.ts の同等箇所が `result.stale` 経路で `SET_AI_THINKING false` のみして終了
- 当該 useEffect の deps は `[currentPlayer, status, aiRetryCounter]` だが、どれも変わっていない → **useEffect は二度と再実行されない**
- → **AI は永久に手を指さず、UI も復旧手段を一切提示しない**

3 件目の 504 console stack に `await in (anonymous)` が混じっていたのもこれと整合 (requestMove が await 中の overall timeout で abort された時の trace)。

---

## 修正方針 — 優先度別に整理

| # | 内容 | 優先度 | 由来 |
|---|---|---|---|
| **F1** | `use-ai-request.ts` の AbortError silent stale バグ修正 | **🔴 致命** | 別調査 (私が見落とし) |
| **F2** | `engine.ts` の DIFFICULTY_PARAMS 全難易度 timeLimitMs 削減 | **🔴 致命** | 両調査一致 |
| **F3** | `engine.ts` の blunder guard を SearchContext deadline 配下に | **🟠 高** | 別調査 (私が見落とし) |
| **F4** | `use-ai-request.ts` の retry 予算整備 | 🟠 高 | 両調査一致 |
| **F5** | `route.ts` の maxDuration を 5 → 10 に拡大 | 🟡 中 | 両調査一致 |
| **+1** | `route.ts` の auth + DB read を Promise.all 並列化 | 🟡 中 | 私の元案 (副次) |
| **+2** | TT サイズを 4M → 1M entries に削減 | 🟢 低 | 私の元案 (副次) |
| **+3** | deadline check 間隔を 1024 → 256 node に短縮 | 🟢 低 | 私の元案 (副次) |
| **F6** | F1 の AbortError 区別ロジックの単体テスト追加 | 🟢 低 | 別調査 |

**F1 + F2 が必須**。これだけで「504 が出ても retry で復旧」「retry も尽きたらエラーモーダルで投了/再試行を選べる」状態になり、永久停止は根治する。F3〜F5 + 追加項目は再発予防 (504 そのものの発生頻度を下げる)。

---

## F1: use-ai-request.ts の AbortError silent stale バグ修正 (🔴 致命)

### 問題

[src/hooks/ai/use-ai-request.ts](src/hooks/ai/use-ai-request.ts) の `AbortError` 検知が、4 つの原因 (意図的 cancel / unmount / overall timeout / 別 request 上書き) を区別せず、すべて silent stale で破棄。`onError` が呼ばれず、UI 復旧手段が消失する。

### 修正方針

`AbortController` を作成する時点で **abort 理由を識別するフラグを内部 ref に持たせる**。abort 関数を呼ぶ際、理由を flag にセット → catch 側でフラグを見て分岐:

- 意図的 cancel (`cancel()` 呼び出し / unmount / 別 request 上書き) → 従来通り silent stale
- overall timeout fire → `onError({ kind: "timeout", message: "overall timeout" })` を呼んでから stale return

### 設計案

```ts
interface AbortReason {
  kind: "cancel" | "timeout" | "supersede";
}

// 各 controller に reason ref を紐づける
const abortReasonRef = useRef<AbortReason | null>(null);

const overallTimer = setTimeout(() => {
  abortReasonRef.current = { kind: "timeout" };
  controller.abort(new DOMException("overall timeout", "AbortError"));
}, overallTimeoutMs);

// 既存 request の上書き
inFlightRef.current?.abort();
// 上書き理由を別 ref に立てる必要があるが、新 controller 側に flag を持たせる方が綺麗
// 実装: inFlightRef + abortReasonRef を Map<controller, reason> で管理 or controller を
// 拡張オブジェクトでラップ

// catch 内
} catch (err) {
  if ((err as { name?: string }).name === "AbortError") {
    const reason = abortReasonRef.current;
    if (reason?.kind === "timeout") {
      onError?.({ kind: "timeout", message: "AI 思考が時間内に完了しませんでした" });
    }
    return { stale: true, requestId };
  }
  // ...
}
```

### 修正対象

- [src/hooks/ai/use-ai-request.ts](src/hooks/ai/use-ai-request.ts):
  - `AiRequestError` に `kind: "timeout"` を追加 (型定義 line 47)
  - `requestMove` 内で `AbortController` 作成時に同時に `abortReason` ref を初期化
  - `setTimeout` で overall timeout 発火時に `abortReason = "timeout"` 設定
  - 既存 request 上書き時 (`inFlightRef.current?.abort()`) は前 controller に `reason = "supersede"` を設定 (= 上書き対象側に reason を持たせる必要)
  - `cancel()` で `reason = "cancel"` 設定
  - `unmount` cleanup で `reason = "cancel"` 設定
  - catch 内の `AbortError` 分岐で reason を見て `onError` 呼び出し or silent stale を選択
  - `delay()` 経路の catch (line 138-142) も同様に reason 区別

### テスト (F6 で追加)

- AbortError 種類別の挙動を vitest で検証:
  - cancel → onError 呼ばれない
  - timeout → onError({ kind: "timeout" }) 呼ばれる
  - supersede → onError 呼ばれない
  - 通常 503/504 → onError({ kind: "http", status: 504 }) 呼ばれる (overall timeout に達しない場合)

---

## F2: engine.ts の DIFFICULTY_PARAMS 全難易度 timeLimitMs 削減 (🔴 致命)

### 問題

[src/lib/shogi/ai/engine.ts:38-44](src/lib/shogi/ai/engine.ts#L38-L44) の expert timeLimitMs 4500ms が、計画書 [docs/plans/issue-176.md:67](docs/plans/issue-176.md#L67) の「hard stop 4.0 秒以内」を逸脱。advanced も 4000ms で余白薄。

### 修正方針

| difficulty | 現行 | **提案** | 根拠 |
|---|---:|---:|---|
| beginner | 1000 | **800** | 計画書目安 |
| intermediate | 2000 | **1800** | 計画書目安 |
| advanced | 4000 | **3000** | hard stop 4s 以内、余白拡大 |
| expert | 4500 | **3500** | 計画書目安、Stage C bench で max 3.8s 観測済み (3500 でも棋力影響軽微) |

### 修正対象

- [src/lib/shogi/ai/engine.ts](src/lib/shogi/ai/engine.ts) の `DIFFICULTY_PARAMS` 定義 (line 26-56)

### 棋力への影響

- beginner/intermediate: ノイズ大、定石本ありなので影響小
- advanced/expert: 探索深さ 1 段減る局面があり得るが、Stage C bench で expert max 3.8s であった時点で既に 4500ms 上限に張り付いていた = **timeLimitMs を下げても探索 depth は近い結果に収束**。実害は小〜中。
- 念のため bench で `expert/midgame_30` の depthCompleted を比較し、大きく劣化していないことを確認

---

## F3: engine.ts の blunder guard を SearchContext deadline 配下に (🟠 高)

### 問題

blunder guard が `findBestMove` 後に走り、`SearchContext` を見ない。`findBestMove` が timeLimitMs ぴったり使い切った後さらに 100〜500ms 追加で走る。

### 修正方針

`findBestMoveWithStats` 内の blunder guard ブロックに **deadline チェック**を追加:

```ts
// blunder guard: deadline 残量チェック付き
if (
  !usedFallback &&
  move !== null &&
  (difficulty === "advanced" || difficulty === "expert") &&
  // 追加: deadline まで余裕がある場合のみ実行
  performance.now() < ctx.deadlineAt
) {
  const guardBudgetMs = Math.max(0, ctx.deadlineAt - performance.now());
  // guardBudgetMs を使い切ったら早期 break する形で再構成
  // または「budget 不足なら blunder guard をスキップ」のシンプル実装

  const nextState = applyMoveForSearch(state, move);
  if (hasHangingPiece(nextState, player, variant)) {
    const legalMoves = getFullLegalMoves(state, player, variant);
    const safeMoves: Move[] = [];
    for (const m of legalMoves) {
      // 各 iteration で deadline 確認
      if (performance.now() >= ctx.deadlineAt) break;
      const ns = applyMoveForSearch(state, m);
      if (!hasHangingPiece(ns, player, variant)) {
        safeMoves.push(m);
      }
    }
    if (safeMoves.length > 0 && performance.now() < ctx.deadlineAt) {
      // 安全な手の評価。deadline 超過で break
      let bestSafeScore = -Infinity;
      let bestSafeMove = safeMoves[0];
      for (const m of safeMoves) {
        if (performance.now() >= ctx.deadlineAt) break;
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

### 設計判断

- **deadline 超過なら blunder guard を完全 skip** が最もシンプル。bestMove は `findBestMove` の探索結果をそのまま採用
- 中間案: 「blunder guard 専用の小さな budget (例: 200ms)」を確保し、deadline -200ms までに findBestMove を返してもらう設計。ただし findBestMove の deadline を変えると bench 結果と整合が崩れる
- → **deadline 時点で blunder guard を skip** に統一 (棋力デグレリスクは小さい、deadline 超過 = 探索が長引いた局面 = 元の bestMove も信頼度高い)

### 修正対象

- [src/lib/shogi/ai/engine.ts:198-225](src/lib/shogi/ai/engine.ts#L198-L225) の blunder guard ブロック

---

## F4: use-ai-request.ts の retry 予算整備 (🟠 高)

### 問題

最悪ケースで retry 累積時間 (5+0.6+5+1.5+5 ≈ 17.1s) が `overallTimeoutMs` (15s) を超え、最終 attempt の途中で overall timeout が発火する。F1 で onError 経路を直しても、retry 戦略自体が overflow しているのは bug 寄り。

### 修正方針 (案 A 採用、案 B は予備)

**案 A (推奨): `maxRetries: 2 → 1` で 2 試行に削減**

最悪累積: 5 + 0.6 + 5 = 10.6s → overall 15s 内に収まり、`overallTimeoutMs` が attempt 中に発火しない

利点:
- 504 の連発時に「無駄な 3 回目」を待たない (UX 短縮)
- F1 の overall timeout 区別と二重化された安全網

欠点:
- network 一時障害が長引いた場合、retry 余裕が減る (が F5 で maxDuration 拡大により 504 自体が減るので影響軽微)

**案 B (予備): `overallTimeoutMs: 15000 → 22000ms` に伸ばす**

最悪累積 17.1s ≪ 22s で確実に各 attempt 内に発火しない。
ただし「最悪 22 秒待たされる」UX は許容できないので **採用しない**。

### 修正対象

- [src/hooks/ai/use-ai-request.ts](src/hooks/ai/use-ai-request.ts) の `useAiRequest` のデフォルト引数 `maxRetries = 2` を `maxRetries = 1` に
- backoff も 600ms → **300ms** に短縮 (DB resumed 待ち想定で十分)

---

## F5: route.ts の maxDuration を 5 → 10 に拡大 (🟡 中)

### 問題

現行 `maxDuration = 5` は cold start + DB read + TT alloc の累積に対して余白不足。

### 修正方針

[src/app/api/ai-move/route.ts:26](src/app/api/ai-move/route.ts#L26): `export const maxDuration = 5;` → **`10`**

### 根拠

- Vercel docs より、Hobby/Pro/Enterprise いずれも上限 300s
- F2 適用後の expert は 3500ms 探索。cold start 1〜2s + auth/DB 200〜500ms + TT 100ms + serialize 50ms ≈ 4900〜6200ms
- **maxDuration 10 なら余白 3800〜5100ms** (Pro plan の cold start spike も吸収可)
- **maxDuration 8 だと spike 5s で詰む可能性、15 だと過剰**
- 課金影響ゼロ (実 billed time は探索完了まで)
- runaway protection (= AI コードがバグった場合の早期 kill) と cold start ばらつき吸収のバランスから **10 が最適**

### 修正対象

- [src/app/api/ai-move/route.ts:26](src/app/api/ai-move/route.ts#L26): `export const maxDuration = 5;` → `10`
- 同ファイル冒頭のコメント更新 (「maxDuration: 5」→「maxDuration: 10」、根拠も更新)

---

## 追加項目 (副次効果)

### 追加 1: route.ts の auth + DB read を Promise.all 並列化 🟡 中

[src/app/api/ai-move/route.ts:118-134](src/app/api/ai-move/route.ts#L118-L134) で `getCurrentAppUser` → `prisma.game.findUnique` を **直列実行**しているが、`game` を `playerId` で絞り込む前に `userId` が必要なため完全並列化はできない。代わりに **gameId だけで先に game レコードを fetch し、auth と並列に**:

```ts
const [user, game] = await Promise.all([
  (async () => {
    try { return await getCurrentAppUser(); }
    catch { return null; }
  })(),
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

cold start で 200〜400ms 短縮見込み。

#### 修正対象

- [src/app/api/ai-move/route.ts:118-134](src/app/api/ai-move/route.ts#L118-L134)

#### セキュリティ観点

- 並列化しても所有者チェック (`game.playerId !== user.id`) は引き続き実行される
- 第三者の gameId が body に入っても `Forbidden` で 403 を返す挙動は変わらない

### 追加 2: TT サイズを 4M → 1M entries に削減 🟢 低

[src/lib/shogi/ai/transpositionTable.ts:14](src/lib/shogi/ai/transpositionTable.ts#L14): `TT_SIZE = 1 << 22` → `TT_SIZE = 1 << 20` (4M → 1M)

#### 効果

- `new Array(TT_SIZE)` の確保コスト 1/4
- メモリ消費 約 80MB → 約 20MB (Vercel function memory 圧迫を回避)
- cold start での GC pressure 軽減

#### リスク

- ヒット率 2〜5% 程度低下する見込み → 探索 nodes が若干増える
- bench で expert/midgame_30 の elapsed が劣化していないか確認必須

#### 修正対象

- [src/lib/shogi/ai/transpositionTable.ts:14](src/lib/shogi/ai/transpositionTable.ts#L14)

#### 採用判断

- bench で 4M vs 1M を比較し、「1M で elapsed が許容範囲内」なら採用
- 劣化が大きい場合は 2M (1 << 21) で再評価

### 追加 3: deadline check 間隔を 1024 → 256 node に短縮 🟢 低

[src/lib/shogi/ai/search-context.ts:79](src/lib/shogi/ai/search-context.ts#L79):

```ts
if ((ctx.nodes & 1023) === 0) {
  if (performance.now() >= ctx.deadlineAt) {
    ...
  }
}
```

→ `(ctx.nodes & 255) === 0` (1024 → 256 node ごとに check)

#### 効果

- deadline 検知遅延が 1/4 (最悪 ~50ms → ~12ms)
- F3 (blunder guard deadline) と組み合わせて、deadline 厳守度を上げる

#### リスク

- `performance.now()` 呼び出しが 4 倍 → per-request 内では無視できる規模

#### 修正対象

- [src/lib/shogi/ai/search-context.ts:79](src/lib/shogi/ai/search-context.ts#L79)

---

## F6: 単体テスト追加 (🟢 低)

### 追加テスト

#### `src/hooks/ai/__tests__/use-ai-request.test.ts` (新規)

回帰防止のため以下のシナリオをカバー:

1. **意図的 cancel** (`cancel()` 呼び出し) → `onError` が呼ばれず stale return
2. **unmount cleanup** (component unmount) → `onError` が呼ばれず stale return
3. **別 request 上書き** (連続 `requestMove` 呼び出し) → 前 request 側の `onError` は呼ばれず stale return
4. **HTTP 504 が maxRetries 回連続** → `onError({ kind: "http", status: 504 })` が **1 回だけ**発火
5. **overall timeout fire** (短い `overallTimeoutMs` で意図的に発火) → `onError({ kind: "timeout" })` が発火 ← **F1 の核心テスト**
6. **HTTP 503 が 1 回 → 200 で成功** → retry で復旧、`onError` 呼ばれず

テスト技術:
- `vi.mock` で `fetch` を制御し、503/504/200/AbortError などを返すように
- `vi.useFakeTimers` で `setTimeout` を制御し、overall timeout を確実に発火
- `act` / `renderHook` で React hook を駆動

#### `src/lib/shogi/ai/__tests__/engine.test.ts` (新規)

F3 (blunder guard deadline) のテスト:

1. deadline 超過状態の `SearchContext` を渡すと blunder guard が skip される
2. deadline 内なら従来通り blunder guard が動く

---

## 実装順序とコミット粒度

レビュー粒度を意識して 1 コミット 1 目的で分割。**1 PR 内で全件マージ** (`fix/#176-timeout` → main の 1 PR)。

| 順 | コミット内容 | 該当ファイル | 検証 |
|---:|---|---|---|
| 1 | **F2**: DIFFICULTY_PARAMS の timeLimitMs 削減 | engine.ts | bench で max < 4s 確認 |
| 2 | **F3**: blunder guard を SearchContext deadline 配下に | engine.ts | unit test 追加、bench で elapsed 改善確認 |
| 3 | **F5**: maxDuration を 5 → 10 に拡大 | route.ts | preview deploy で動作確認 (実環境のみ確認可) |
| 4 | **追加 1**: auth + DB read を Promise.all 並列化 | route.ts | typecheck、preview |
| 5 | **追加 2**: TT サイズ 4M → 1M | transpositionTable.ts | bench で elapsed 確認 |
| 6 | **追加 3**: deadline check 1024 → 256 node | search-context.ts | bench で elapsed 確認 |
| 7 | **F1**: AbortError silent stale バグ修正 (reason 区別) | use-ai-request.ts | unit test 追加 |
| 8 | **F4**: retry 予算整備 (`maxRetries=1`、backoff 300ms) | use-ai-request.ts | unit test 更新 |
| 9 | **F6**: 単体テスト追加 (use-ai-request, engine.blunder) | __tests__/ | test:ci 全パス |

各コミット後に `npm run lint && npm run typecheck && npm run test:ci` を実行。Phase 0 ベンチで max < 4s, p95 < 3.5s, p50 1〜3s を確認した段階で push。

### コミット分割の根拠

- 上 2 コミット (F2/F3) で **サーバ側 504 の発生頻度を下げる**
- F5 で **Vercel 側余白を拡大**
- 追加 1〜3 で **副次的に cold start を軽減**
- F1/F4 で **クライアント側永久停止を根治**
- F6 で **回帰防止**

順序は「サーバ側修正 → クライアント側修正 → テスト追加」。サーバ修正だけ Vercel preview に出して動作確認してからクライアント修正、というデバッグ順序にも沿う。

---

## 検証方法

### ローカル

各コミット後:
- `npm run lint` (0 errors 維持)
- `npm run typecheck`
- `npm run test:ci` (既存 236 + 新規追加分すべてパス)
- `npm run build` (Route Handler 登録確認)

最終コミット後:
- `npx tsx scripts/bench-ai.ts --runs=3 --out=bench-results/timeout-fix-runs3.json`
- 受け入れ基準:
  - `expert/midgame_30` max < 4000ms (F2 効果)
  - `advanced/midgame_30` max < 3500ms (F2 効果)
  - 全難易度の `depthCompleted` が PR #185 後 (Stage C bench) と同等以上
  - `stoppedBy: "deadline"` の比率が極端に増えていないこと

### Vercel preview

- preview deploy URL で実機確認:
  - 龍王 (expert) で 5 局以上対局し 504 が出ないこと
  - 504 が出た場合でも retry で復旧 (1 回まで)、または **モーダルが表示**されて「もう一度試す / 投了する」が機能すること
  - cold start 直後 (preview deploy 直後) の 1 手目でも 504 が出ないこと
  - 待った / 投了 / 終局時に AI 思考が即座にキャンセルされること
  - card-shogi の各種演出 (ドロー / カード使用 / 王手崩し / 二手指し) 中に AI がブロックされ、演出後に再開されること

### Issue #109 観点 (3 段階レビュー)

1. **計画段階レビュー**: 本ファイル (issue-176-timeout-fix.md) のレビュー (このタイミング)
2. **実装完了時レビュー**: コミット & push 前に各観点 (要件充足 / 非デグレ / 性能 / UX / 保守性 / セキュリティ) の自己レビュー
3. **PR レビュー段階**: PR 作成前にユーザーへ動作確認結果と Issue #109 観点の自己レビュー結果を提示

---

## 想定される効果

| 局面 | 現状 | 修正後想定 |
|---|---|---|
| **平常時 (warm function)** | 余白 500ms でギリギリ | 余白 6500ms (10s - 3.5s) で完全安全 |
| **Cold start 直後** | 504 多発 (cold +1〜3s で踏み超す) | 余白に吸収、ほぼ 504 出ず |
| **expert 中盤局面** | 4.5s 探索で踏み超し頻発 | 3.5s 探索 + 余白 6.5s で安定 |
| **blunder guard で deadline 超過** | 100〜500ms 余分に走り 504 | deadline 超過で skip、bestMove 即返し |
| **連続失敗時の UX** | 場合により modal 出ず → AI 永久停止 | retry 1 回で modal 即発火、ユーザー復旧可能 |
| **modal 出ない不具合** | overall timeout fire で silent abort → AI 永久停止 | timeout 経路でも `onError({ kind: "timeout" })` 発火、modal 表示 |

棋力面:
- expert/advanced で探索深さが 1 段減る局面はあり得るが、Stage C bench で max が timeLimitMs に張り付いていた = **timeLimitMs を下げても探索結果は近い深さに収束**
- 念のため bench で `depthCompleted` 平均が大きく劣化していないことを確認

---

## リスク・トレードオフ

| 項目 | リスク | 緩和策 |
|---|---|---|
| F2 timeLimitMs 削減 | expert/advanced で探索深さ低下、AI が弱くなる可能性 | bench の `depthCompleted` を比較。劣化が大きければ Phase 4 (PR 2) で評価関数改善で補填 |
| F3 blunder guard deadline | deadline 超過時はタダ取りされる手をそのまま採用する可能性 | deadline 超過は通常そう頻繁には起きない (F2 で余白拡大済)。Phase 4 で blunder guard 自体を再設計 |
| F5 maxDuration 拡大 | runaway 関数の検出が遅れる | Vercel 側上限 300s に対して 10s なので runaway protection は十分機能 |
| 追加 2 TT 4M→1M | hit 率低下で探索 nodes が増え、deadline 超過の頻度が増える可能性 | bench で expert/midgame_30 の elapsed と depthCompleted を比較。大きく劣化すれば 2M (1 << 21) に変更 |
| F1 AbortError 区別 | reason の管理ロジックを誤ると誤検知 (timeout のはずが silent stale 等) する | F6 単体テストで全パターンをカバー |

---

## ブランチ戦略 (AGENTS.md ルール準拠)

- **ブランチ名**: `fix/#176-timeout`
- **起点**: `origin/main` (AGENTS.md ルール 4)
- **作業場所**: 既存 worktree `.claude/worktrees/issue-176` を流用 (現在 `feature/#176` を pointing。`git fetch && git checkout -b fix/#176-timeout origin/main` で切替)
- **マージ後**: ローカル + origin の `fix/#176-timeout` を削除 (AGENTS.md ルール 9、ユーザー確認の上で)
- **PR 作成**: 全コミット完了 + 検証通過後、明示指示があれば作成 (AGENTS.md ルール 1)
- **Issue #176 のクローズ**: PR 2 (Phase 3+4) も残っているため**しない**

---

## 完了条件

1. 上記 9 コミット (F1〜F6 + 追加 1〜3) が `fix/#176-timeout` に積まれている
2. 全コミット時点で `npm run lint` (0 errors) / `typecheck` / `test:ci` (既存 236 + 新規 追加分すべてパス) / `build` が通る
3. bench で expert/midgame_30 max < 4000ms、全 case max < 5000ms を確認
4. Vercel preview で龍王 5 局以上対局し 504 が出ない & 出ても modal で復旧できることをユーザー確認
5. Issue #176 にコメントで「本対応は派生 fix。修正内容と bench 結果を記録」を追加
6. ユーザーから明示指示があれば PR 作成 → マージ
7. マージ後、Phase 3+4 (PR 2) に着手

---

## 想定 Q&A

### Q1: なぜ F1 (AbortError 区別) を「致命」と位置づけるのか?

A: F2 (timeLimitMs 削減) や F5 (maxDuration 拡大) で 504 の発生頻度は大きく下がるが、本番環境のばらつきを完全には制御できない。**いずれは 504 が出る**。F1 がない限り、504 が 3 回連続したときに **UI が永久停止** する致命バグが残る。F1 を入れることで「504 が出てもユーザーが復旧手段を持つ」状態になり、UX 復旧の最終ライン (= safety net) が保証される。

### Q2: F3 (blunder guard deadline) を Phase 4 に回せないか?

A: PR #185 のコメントでは Phase 4 で「blunder guard 自体を再設計」予定だったが、**現状 deadline を無視して deadline 後に走る挙動は 504 の構造的原因の一部**であり、再設計を待たずに deadline 配下に組み込む必要がある。再設計 (撤廃 / tie-breaker 化) は Phase 4 で別途対応。

### Q3: F4 で `maxRetries=1` に減らすと、network 一時障害時の retry 余裕が減らないか?

A: F5 で maxDuration を 10s に拡大することで 504 自体が大幅に減るため、retry の出番自体が減る。また、503 等の一時障害は依然 1 回 retry が走る。3 回試行 → 2 回試行で UX 短縮 + overall timeout overflow 防止のメリットの方が大きい。

### Q4: maxDuration を 8 (別調査の F5) ではなく 10 にする根拠は?

A: F2 適用後の最悪累積 (cold start 1〜2s + auth/DB 200〜500ms + TT 100ms + 探索 3.5s + serialize 50ms) が約 4.9〜6.2s。maxDuration 8 では Pro plan の cold start spike (~5s) が直撃すると詰む。10 なら余白 3.8〜5.1s で spike を吸収可能。15 は過剰で runaway protection の意味が薄れる。**10 が最適**。

### Q5: 棋力低下のリスクは?

A: F2 で expert 4500→3500ms (-22%) は数値だけ見ると大きいが、Stage C bench で expert/midgame_30 max が 3.8s に張り付いていた = **既存実装でも 3.8s で打ち切られていた**ケースが多かった。3.5s でも実質変わらない結果になる見込み。bench の `depthCompleted` 比較で確認する。万が一劣化が顕著なら Phase 4 (PR 2) で評価関数改善で補填する。

### Q6: 既存の `findBestMove` の互換性 (`ctx?` optional 引数) は維持するか?

A: 維持。F1〜F6 は既存 API シグネチャを変更しない。テストやエンドポイントの互換性は保たれる。
