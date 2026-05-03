# Issue #107 全体リファクタ＆アセット先読み — 実装プラン (レビュー反映版)

> このファイルは Issue #107 の作業計画書です。別セッションや別端末で作業を継続する際の引継ぎ資料として、リポジトリ内 (`docs/plans/issue-107.md`) に保管しています。
>
> - **親 Issue**: #107 (カード将棋 全体リファクタ＆アセット先読み)
> - **親ブランチ**: `feature/#107` (各 Step 派生ブランチの統合先)
> - **派生ブランチ命名**: `{prefix}/#107-{slug}` (例: `refactor/#107-cleanup`, `refactor/#107-memo`, `refactor/#107-compute`, `feature/#107-preload`, `refactor/#107-split`)
> - 進行中の派生ブランチや進捗状況は git log と PR で追跡してください。

---

## Context

カード将棋の機能追加が進む中、モバイル端末でのプレイ中に「若干重い」「ラグがある」体感が出ている。Issue #107 は **保守性と実行時パフォーマンスを両面から再点検** し、特に SE 遅延 (音ズレ) や初回再生時のもたつき、UI のフレームドロップを根絶することがゴール。BGM 軽量化と龍王 BGM 配置は別 Issue 化済み。

本 md は当初プランを実コードと突き合わせてレビューした結果を反映した **最終版**。修正主要点は以下:

- ブランチ戦略: ユーザー指示「既存 `feature/#107` を利用」 + Q1「Step ごとに個別 PR」を反映 → **`feature/#107` を親ブランチとし、Step ごとに派生ブランチを切る** 運用に変更
- Vitest: `vitest@4.1.2` / `@vitejs/plugin-react@6.0.1` / `"test": "vitest"` script は **既存** ([package.json:10,52,59](package.json#L10)) → `vitest.config.ts` 新規作成 + `jsdom` のみ追加 + `test:ci` script 追加に縮小
- カード系定数 (`MANA_CAP / DRAW_COST / MANA_PER_TURN / FAST_THRESHOLD_MS / INITIAL_MANA / MANA_FAST_BONUS`): 既に [definitions.ts](src/lib/shogi/cards/definitions.ts) に集約済み → constants.ts 切出は **見送り**
- Howler 動的 import: [use-sound.ts:46](src/hooks/use-sound.ts#L46) で **既に動的 import 済み** → 「対局開始 onClick で動的 import」案は不要、`Howler.ctx?.resume()` の追加と BGM 先読みのみ新規価値
- shogi-board.tsx の DOM 属性: `data-square-key` は **不在**、`data-legal` のみ ([shogi-board.tsx:176](src/components/game/shogi-board.tsx#L176)) → リスク欄の DOM 属性記述を実態に合わせる
- rect getter は `querySelectorAll` のみ (`document.getElementById` は使用なし)
- CardView.onClick の API 統一案 (`(instanceId: string) => void`) は **撤回** (現状の `() => void` 維持で memo 効果は得られる)

---

### 調査で確定した主要なボトルネック (事実確認済み)

1. **React.memo がプロジェクト全体で 0 件** ([src/components/game/](src/components/game/)) — 親 ([card-shogi-game.tsx](src/components/game/card-shogi/card-shogi-game.tsx) 1,401 行 useReducer) が更新されるたびに、ShogiBoard の 81 マス・手札 CardView 全枚・CapturedPieces などが全部再描画される。**モバイル CPU の常時負荷の主要因**。
2. **AI 着手後の固定 `setTimeout(500ms)`** ([use-card-shogi-game.ts:858](src/hooks/use-card-shogi-game.ts#L858)) — `getAiMove` 自体が 100-300ms 掛かる上に、さらに 500ms 待機して dispatch している。
3. **王手中の `unusableCardIds` 計算** ([card-shogi-game.tsx:806](src/components/game/card-shogi/card-shogi-game.tsx#L806)) — target ありカードのみで `getCheckEscapingSquares` (81 マス × `simulateCardEffect` + `isInCheck`) を呼ぶ。target なしカード (mana_up/no_promote) は `simulateCardEffect` 内 default で null 早期 return されるため軽い。**毎レンダリング走るが手札カード種数 × 81 マスの計算量で、王手中だけ顕在化**。
4. **`cardTargetSquares` の計算** ([card-shogi-game.tsx:751-793](src/components/game/card-shogi/card-shogi-game.tsx#L751-L793)) — `pendingCard.phase === "selectTarget"` の時のみ走る (それ以外は early return)。**通常時は問題なし**。selectTarget フェーズが続く間 (ユーザーがタップする数秒〜) のみ高頻度。
5. **常時走るレア度 CSS アニメ** ([globals.css](src/app/globals.css)) — `card-rarity-bg-rare/super-rare/epic` が `linear infinite` 4.5-5.5s × 重畳 pulse + box-shadow 振動。`prefers-reduced-motion` ブロックは未実装。
6. **handleSquareClick の DOM 探索** ([card-shogi-game.tsx:486-560](src/components/game/card-shogi/card-shogi-game.tsx#L486-L560)) — `findVisibleCapturedPieceRect` / `getBoardSquareRect` が `querySelectorAll` ベース ([card-shogi-game.tsx:313](src/components/game/card-shogi/card-shogi-game.tsx#L313), [:329](src/components/game/card-shogi/card-shogi-game.tsx#L329), [:632](src/components/game/card-shogi/card-shogi-game.tsx#L632))。タップ毎に走る。
7. **eventLog 監視 useEffect 内 `playSfx` 呼び出し** ([card-shogi-game.tsx:362-483](src/components/game/card-shogi/card-shogi-game.tsx#L362-L483)) — 親再描画が遅い (子の不要な再描画を含む) と、eventLog 反映 → useEffect 実行 → SE 発火 のサイクルが伸びて音ズレに見える。Step 2 の memo 化が間接的に音ズレ改善に効く連鎖あり。
8. **巨大ファイル** — `card-shogi-game.tsx` 1,401 行 / `use-card-shogi-game.ts` 1,089 行で責務が混在し最適化の見通しが効かない。

### 意図的に手を出さない判断

- **`moves.ts` の `applyMove` を mutate-revert 化する案は取り下げ** — `applyMove` (board.ts) は捕獲・成り・盤上置換と分岐が多く、差分管理を間違えるとデグレの温床。現状の `cloneGameState` ベースを維持し、別の角度 (キャッシュ・依存削減) で攻める。
- **`useReducer` から Context / Zustand 等への分割は本 Issue 範囲外** — 振る舞い不変の枠を守るため、構造的な状態管理リファクタは将来 Issue へ。
- **CSS 重要属性 (`box-shadow` / `filter`) の根本見直しは本 Issue 範囲外** — 見栄えが特定属性に依存。`prefers-reduced-motion` で逃げる。
- **`cardState` のフィールド単位分割は本 Issue 範囲外** — Issue 本文「カード状態・トラップ状態・マナ・手札等の責務分離」に対し、本プランは reducer の **handler レベル分離** (Step 5) までで対応。
- **constants.ts 切出は見送り** — 既に [definitions.ts](src/lib/shogi/cards/definitions.ts) に集約済みで、別ファイル化は import 経路を変えるだけで価値が薄い。

### ユーザー合意済みの方針

- **PR は Step ごとに個別 PR** (Q1 確定)
- **ブランチ運用**: 既存 `feature/#107` を親ブランチとし、Step ごとに派生ブランチ (`refactor/#107-cleanup` 等) を切る。各派生ブランチの PR は `feature/#107` をターゲットにマージ → 全 Step 完了後に `feature/#107` → `main` を統合 PR で合流
- AI 後 500ms 待機は **撤廃** (即時 dispatch / ユーザー選択どおり)
- BGM フォーマット変換 (WAV→OGG/MP3) は **別 Issue 化**
- ファイル分割 Step (Step 5) を **本 Issue に含める**
- ブランチ命名はサフィックス形式 (`{prefix}/#{Issue番号}-{slug}`) を許容 → AGENTS.md にルール追記
- **Vitest を活用** (既存導入済み)、デグレ防護網として `vitest.config.ts` 追加
- `prefers-reduced-motion` 対応は **2 倍スロー化**
- 龍王 BGM 未配置問題は **別 Issue 化**
- カード系定数は **definitions.ts のまま** (Q2 確定)
- テスト環境は **jsdom** (Q3 確定)

### 振る舞い不変ライン

カード効果・ターン進行・トラップ判定・AI 思考結果・演出時間・SE 種別の対応は変えない。AI 後 500ms 撤廃のみユーザー合意済みの例外。撤廃により AI 着手後の体感は「考えて即動く」へ変わる。SE 開始 (約 30-50ms) と DOM 更新が重なって違和感が出る場合は、**実機検証で確認した上で**短縮 (150ms 等) への調整を別途ユーザーに相談する。

### 計測手段 (各 Step 共通)

- `pnpm build` の出力で Route 別 First Load JS を before/after 比較し、PR 本文に記載
- React DevTools Profiler のスクリーンショットを PR 本文に添付 (Step 2, Step 3 のみ)
- モバイル実機 (iPhone Safari + Android Chrome) で対局フローを必ず体感確認

---

## ブランチ運用 (改訂)

```
main
 └─ feature/#107  (親ブランチ。各 Step 派生ブランチの統合先)
     ├─ refactor/#107-cleanup     (Step 1) ※ Step S1 (二歩指しガード) も含む
     ├─ refactor/#107-memo        (Step 2)
     ├─ refactor/#107-compute     (Step 3)
     ├─ feature/#107-preload      (Step 4)
     ├─ refactor/#107-split       (Step 5)
     └─ fix/#107-{slug}           (Step S2 以降の潜在バグ修正、発見都度追加)
```

- 各 Step 派生ブランチは **`origin/feature/#107` 起点**で作成 (派生親が feature/#107 のため、AGENTS.md ルール 4 の「origin/main 起点」の例外として記載)
- 各 Step PR の base ブランチは `feature/#107`
- 全 Step 完了後、`feature/#107` → `main` の統合 PR を 1 本作成

## 潜在バグ修正方針 (Step S シリーズ)

Issue #107 のスコープに **「リファクタ中に発見した潜在バグの是正」を含める**。本 Issue の検証 (Vercel preview / モバイル実機) で見つかったバグは、リファクタ Step とは別に **Step S{n}** として発見順に管理し、`fix/#107-{slug}` 派生ブランチで個別 PR とする(または Step 1〜5 進行中に同ブランチへ含めて修正)。

**運用ルール**:
- 振る舞いを変更する修正は本セクションに必ずバグレポート (現象 / 原因 / 影響範囲) を記載
- 修正は Vitest による回帰テスト追加とセットで行う
- 通常の Step (1〜5) 内で同根の修正が自然に含まれる場合は、その Step 内に組み込んで OK (本書に記録は残す)

### Step S4: モバイルでゲーム終了カード (詰み/投了結果) を最小化可能に (Step 3 に含めて修正)

**現象**: モバイルで詰み/投了になると、画面下部に「後手の勝ち（詰み）」+「ホームへ」+「もう一局」のカードが常時表示され、最後の盤面・持ち駒が見えなくなる

**修正方針**:
- 終了カードに右上 × ボタンを追加。タップで折りたたみ → 1 行バー (`▲ 結果テキスト (タップで開く)`) に縮小
- 縮小バーをタップすると元のカードに戻り「ホームへ」「もう一局」を再操作可能
- 対象:
  - card-shogi mobile/tablet ([card-shogi-game.tsx](src/components/game/card-shogi/card-shogi-game.tsx) `xl:hidden` ブロック)
  - standard shogi mobile ([mobile-drawer.tsx](src/components/game/mobile-drawer.tsx) `!isGameActive && !hideEndCard` ブロック)
- 状態は各コンポーネント local state (`endCardMinimized`)。「もう一局」で URL 遷移 → 再 mount で reset されるため自動的に開いた状態に戻る

**本ブランチで対応**: Step 3 (`refactor/#107-compute`) に含めて修正済み

### Step S3: タップ中フィードバックを :active で復活 + フィルタボタン UX 改善 (Step 3 に含めて修正)

**現象**:
- Step S2 の hover ガード ((hover: hover) and (pointer: fine)) を適用したところ、touch device ではタップしたカード自体にもエフェクト (lift / 黄色) が出なくなった
- マスターカタログ上部の検索フィルタボタンが「押してる感覚とずれてる」(タップしても視覚反応が遅延、または出ない)

**原因**:
- 旧 `:hover` は touch でタップ後に持続するため Step S2 で `(hover: hover)` ガードしたが、結果として touch では一切 hover 系エフェクトが発火しなくなった
- フィルタボタン側はそもそも tap 中の視覚フィードバック (`:active` ベース) が無く、ring は hover 専用だったため touch で反応が無かった

**修正方針**:
- [globals.css](src/app/globals.css) の `.card-hover-focus` / `.card-hover-lift` に `:active` ルールを追加。touch でも mouse でもタップ/クリック中だけエフェクトを出し、離すと自動クリア。ドラッグ張り付き問題は `:active` の特性で再発しない (ドラッグ離れたら active 解除)
- [card-filter-bar.tsx](src/components/cards/card-filter-bar.tsx) のフィルタボタンに `active:ring-2 active:ring-amber-400/70 active:ring-offset-1 active:ring-offset-background` を追加。`transition-all` → `transition-opacity duration-150` で transition 対象を絞り、視覚反応を即時化

**本ブランチで対応**: Step 3 (`refactor/#107-compute`) に含めて修正済み

### Step S2: モバイル hover の挙動不正 + カードデザイン UX 改善 (Step 3 に含めて修正)

**対象画面**: マスターカタログ ([/cards](src/app/cards/page.tsx)) / カードデザイン ([/card-design](src/app/card-design/page.tsx))

**バグ・要望**:

- **a. モバイル hover 不正**: タップでホバー演出 (lift + 黄色) が発火し、ドラッグで他カードに張り付いて不自然な動きになる
  - **原因**: [globals.css:443-470](src/app/globals.css#L443) の `.card-hover-focus:hover` が `(hover: hover) and (pointer: fine)` でガードされていないため、touch device でも `:hover` が成立し続ける
  - **修正**: 該当 hover ルールを `@media (hover: hover) and (pointer: fine)` で囲む

- **b. カードデザインの hover から黄色を消す**: lift 効果のみ残し、黄色 outline / overlay / drop-shadow を削除
  - **原因**: マスターカタログと同じ `card-hover-focus` クラスを使い回している
  - **修正**: 黄色を含まない新クラス `.card-hover-lift` を globals.css に追加し、card-design ページでは `card-hover-focus` から `card-hover-lift` に差し替え + `card-hover-overlay` 子要素を削除

- **c. マスターカタログのカード選択時にローディングマスク**: 詳細画面 (`/cards/[id]`) への遷移中に `<LoadingOverlay show fullScreen />` を表示
  - **修正対象**: [card-catalog-tile.tsx](src/components/cards/card-catalog-tile.tsx) — `useState` で loading 状態を管理し、onClick で `setLoading(true)` → `router.push()`

- **d. カードデザインのヘッダ固定 + モバイルカード幅縮小**:
  - 「ホーム」リンク + カードデザインの説明書きエリアを `sticky top-0 z-40` で固定
  - モバイルでは CardBack プレビュー (各カード本体) を縮小。`MOCK_SIZE_CLASS` (sizes.ts) は対局画面でも使われるため触らず、card-design ページ側のラッパに `transform: scale()` の CSS を当てる

**本ブランチで対応**: Step 3 (`refactor/#107-compute`) に含めて修正済み

### Step S1: ターゲット選択フェーズで無効マスをタップすると演出が走る (Step 1 に含めて修正)

- **対象カード**: `double_pawn` (二歩指し) / `pawn_return` (歩戻し) / `piece_return` (駒戻し)
- **現象**: ターゲット選択中、ハイライトされていない無効マスをタップすると、持ち駒/盤上駒のフライト演出 + 中央カード使用演出が走る (実効果は適用されない)。ユーザーには「カードが空振りした」見た目になる
- **原因**: [card-shogi-game.tsx:495-554](src/components/game/card-shogi/card-shogi-game.tsx#L495) の `handleSquareClick` が、ターゲット妥当性を検証する前に `flushSync(() => setPieceFlight(...))` で駒フライトを起動している。検証は L556 の `selectSquare(pos)` 内 ([use-card-shogi-game.ts:912-914](src/hooks/use-card-shogi-game.ts#L912)) で行われるが、その時点では既に演出が始まっている。`pendingPlayFlightRef.current` も L548 でセットされるため駒フライト完了で中央カード演出も連鎖発火する
- **影響**: 同根の構造で 3 種すべてに発生。王手中の使用可否チェックも同様に `selectSquare` 内のためすり抜ける
- **修正方針**:
  - [src/lib/shogi/cards/effects.ts](src/lib/shogi/cards/effects.ts) に `isPawnReturnLegalSquare` を新規追加 (現状はインライン判定のみ)
  - 同 effects.ts に共有ヘルパ `isValidCardTargetSquare(state, cardState, player, defId, target)` を追加。各カード種別の妥当性 + 王手中の王手回避判定を 1 関数に集約
  - `handleSquareClick` の駒フライト起動前と `selectSquare` の SELECT_CARD_TARGET dispatch 前の両方で `isValidCardTargetSquare` を呼ぶ
  - 既存の effects.test.ts に該当境界テスト 8-10 ケース追加
- **本ブランチで対応**: Step 1 (`refactor/#107-cleanup`) に含めて修正済み (commit 5)

---

## 全 Step 共通: ガバナンス & デグレ防護

- 各 Step 開始時 `git fetch origin` → **`origin/feature/#107` 起点** で派生ブランチ作成
- 各 Step push 後にユーザー確認を待つ (PR 作成・マージ・Issue クローズは指示まで禁止 / AGENTS.md ルール 1)
- 各 PR 本文 Test Plan に共通チェックリスト:
  - [ ] モバイル端末で対局開始 → game_start SE が遅延なく鳴る
  - [ ] 5 種カード (mana_up / pawn_return / double_pawn / piece_return / no_promote) 全て使用 → 演出 → finalize → AI 応手
  - [ ] no_promote トラップ発動 → 成り宣言が無効化される
  - [ ] 王手中に王手回避できないカードが非活性
  - [ ] UNDO 直後にカード操作不可
  - [ ] BGM 切替時の音飛びなし
  - [ ] タブ非アクティブ → アクティブ復帰でアニメ完了 (保険タイマー動作)

---

## Step 1: クリーンアップ・基盤整備 (+ Step S1 ターゲット検証ガード)

**ブランチ**: `refactor/#107-cleanup` (`origin/feature/#107` 起点)
**目的**: 振る舞い不変を担保しやすい純粋なお掃除を先行。後続 Step のレビュー雑音を排除し、Vitest 設定追加と AGENTS.md ルール追記を同時実施。Step S1 (ターゲット検証ガード) も同ブランチに含める。
**所要**: 半日

### 変更ファイル

#### 新規

- [src/components/game/card-shogi/animation-constants.ts](src/components/game/card-shogi/animation-constants.ts) — 各演出ファイル冒頭の const を**実際の命名のまま**(`namespace` プレフィクスは付けて衝突回避)集約。実値:
  - `draw-flight-card.tsx`: CARD_W=576, CARD_H=352, FADE_IN_MS=500, HOLD_MS=1500, FADE_OUT_MS=300, FADE_OUT_TAIL_MS=100, FLASH_DELAY_S, SHIMMER_DURATION_S=0.7, GLOW_DURATION_S=0.8
  - `card-play-flight.tsx`: CARD_W=576, CARD_H=352, POP_IN_MS=220, HOLD_MS=700, FADE_OUT_MS=320, FLASH_DELAY_S, SHIMMER_DURATION_S=0.6, GLOW_DURATION_S=0.75
  - `piece-flight.tsx`: PIECE_SIZE=84, SPEED_PX_PER_SEC=1800, ROTATION_SEC_PER_TURN=0.1, MIN_DURATION_MS=180, FALLBACK_PADDING_MS=500
  - `mana-flight.tsx`: DURATION_S=1.1, FLOAT_DISTANCE_PX=60, BOX_W=200, BOX_H=56
  - `mana-gauge.tsx`, `fast-move-badge.tsx` の値は実装開始前に再確認
  - 名前衝突回避のため `DRAW_*` / `PLAY_*` / `PIECE_*` / `MANA_FLIGHT_*` 等のプレフィクスを付与
- [vitest.config.ts](vitest.config.ts) — Vitest 設定 (`environment: 'jsdom'`, `include: ['src/**/*.test.ts']`)
- [src/lib/shogi/cards/__tests__/effects.test.ts](src/lib/shogi/cards/__tests__/effects.test.ts) — `applyPawnReturn / applyDoublePawn / applyPieceReturn / hasNoPromoteMark / addNoPromoteMark / removeNoPromoteMark / moveNoPromoteMark / hasSameKindTrapPlaced / simulateCardEffect / getCheckEscapingSquares` の境界値テスト 30-40 ケース

#### 修正

- [src/components/game/card-shogi/draw-flight-card.tsx](src/components/game/card-shogi/draw-flight-card.tsx)、[card-play-flight.tsx](src/components/game/card-shogi/card-play-flight.tsx)、[piece-flight.tsx](src/components/game/card-shogi/piece-flight.tsx)、[mana-flight.tsx](src/components/game/card-shogi/mana-flight.tsx)、[fast-move-badge.tsx](src/components/game/card-shogi/fast-move-badge.tsx)、[mana-gauge.tsx](src/components/game/card-shogi/mana-gauge.tsx) — 冒頭マジックナンバーを `animation-constants.ts` から import に置換
- [src/hooks/use-card-shogi-game.ts](src/hooks/use-card-shogi-game.ts) — `selectCardTarget` (UI から未使用、grep 確認済み) を削除 + 戻り値オブジェクトからも除去
- [src/components/game/card-shogi/card-shogi-game.tsx](src/components/game/card-shogi/card-shogi-game.tsx) — `pendingCardRect` キャッシュロジックの 3 重複 (cardPlayEvent / trapSetEvent / manaChargeEvent reason="card") をローカルヘルパ `getOriginRect(instanceId)` に抽出。**振る舞い不変の確認**: `cached?.id === ev.instance.instanceId` の比較ロジックを変えない。
- [package.json](package.json) — `jsdom` を devDependencies に追加。`test:ci` (`vitest run`) を script に追加。**`vitest` / `@vitejs/plugin-react` の追加はしない (既存)**。`pnpm install` で `pnpm-lock.yaml` も同時更新
- [AGENTS.md](AGENTS.md) — 「複数 Step 分割時のブランチ命名はサフィックス形式を許容 (`{prefix}/#{Issue番号}-{slug}`)」をルール 3 に追記

#### 確認 (修正なし、本 Step で結果のみ PR 本文に記録)

- ホーム画面 [src/app/page.tsx](src/app/page.tsx) の bundle 解析: `pnpm build` の出力で `/` ルートに `card-shogi` 系コンポーネントが含まれていないか確認。混入していたら別 Issue 化のメモを残す
- **UNDO 後の eventLog ⇔ lastEventIndexRef 整合性**: [card-shogi-game.tsx:482](src/components/game/card-shogi/card-shogi-game.tsx#L482) の `lastEventIndexRef.current = eventLog.length` が UNDO で eventLog が短縮された時に再発火・取りこぼしを起こさないか目視確認。問題があれば別 Issue 化(本 Step では fix しない、計測のみ)
- [src/hooks/use-touch-handler.ts](src/hooks/use-touch-handler.ts) (157 行) の pointerup ハンドラがタップ毎に何 ms 掛かっているか、Vercel preview のモバイル実機で Chrome DevTools Performance タブで measure。重いなら別 Issue 化

### 受け入れ条件

- `pnpm build` 成功・`pnpm lint` warning ゼロ
- `pnpm test:ci` で effects.ts のユニットテスト全パス
- 既存の export shape 不変 (`useCardShogiGame` 戻り値は selectCardTarget 削除のみ)
- Vercel preview で 5 種カード全使用 + ドロー + トラップ発動 + UNDO 確認
- PR 本文に `pnpm build` の Route 別 First Load JS を記載 (本 Step がベースライン)

---

## Step 2: 子コンポーネント React.memo 化

**ブランチ**: `refactor/#107-memo` (`origin/feature/#107` 起点、Step 1 マージ後に切る)
**目的**: 親 useReducer の state 変化のたびに子が無条件に再レンダリングされる現状を断ち切る。**モバイル CPU 負荷の主要因の解消**。
**所要**: 1 日

### memo 化対象 (効果順)

**重要な前提**: `ShogiBoard` / `HandArea` / `CapturedPieces` 自身を memo 化しても、親が `board` / `hand` 配列を毎手 immutable update するため上位コンポーネント自体は再描画される。**memo 化の効果は子 (`BoardSquare` / `HandCard` / 各駒) で出る** — 変わっていない要素 (80 マス / 他の手札カード / 動かなかった駒) の再描画が skip される。

| 優先度 | 対象 | 効果根拠 |
|---|---|---|
| ★★★★★ | `BoardSquare` (新規切出) + `ShogiPiece` | 81 マス × 駒種ごと描画。memo 比較 (piece / isSelected / 等) で変わっていないマスは skip。1 手指すと再描画されるのは動いた 2 マスのみ |
| ★★★★☆ | `HandCard` (新規切出) + `CardView` | 手札 4-7 枚。SIZE_CLASS / RARITY_BG_CLASS 計算 + EPIC_ORBS_BY_SIZE.map が走る。手札増減で他カードは skip |
| ★★★★☆ | `CapturedPieces` 内の駒コンポーネント | hand 内の同一駒種は同一参照なら skip 可能 |
| ★★★☆☆ | `DeckPile` / `TrapSlot` / `ManaGauge` / `CardShogiHistory` | これら自身を memo 化することで親の他フィールド変化時に再描画されない |
| ★★☆☆☆ | `ShogiBoard` / `HandArea` 自身 | 自身の memo 化効果は薄いが、付けてもコストはほぼゼロ。子の memo を活かすため、props (`legalMoves` 等の配列) を親側で `useMemo` 安定化することの方が重要 |

### 変更ファイル

#### ShogiBoard 内マス分割 (本 Step の核)

- [src/components/game/shogi-board.tsx](src/components/game/shogi-board.tsx)
  - 81 マスの `<div>` 描画ロジックを内部コンポーネント `BoardSquare` に切り出し、`React.memo` でラップ
  - ShogiBoard 自身も `React.memo` でラップ (board prop が毎手変わるので大半のケースで再描画されるが、cardState だけ変わったケースで skip 可能。コストはほぼゼロのため付ける)
  - `BoardSquare` props は **ローカル完結** (rowIdx / colIdx / piece / isSelected / isLegalTarget / isCardTarget / isNoPromote / isHidden / isLastMove / isKingInCheck / canHover / squareSize / dotSize / playerColor / onClick: (row, col) => void / setRef)
  - 親側で `onSquareClick = useCallback((row, col) => parentOnClick({ row, col }), [parentOnClick])` を 1 度だけ生成して渡す。`BoardSquare` 内でも `() => onClick(rowIdx, colIdx)` を作るが、memo 比較で onClick prop が同一なら再生成されない (BoardSquare 自体が再描画されない)
  - `setRef` も同様
  - **DOM 属性維持確認**: `data-legal` 属性 ([shogi-board.tsx:176](src/components/game/shogi-board.tsx#L176)) と `squareRefs` Map (row-col キー) への ref 登録経路を `BoardSquare` 内で確実に維持 (DOM 参照ベースのコードがある可能性 — 例: `[data-hand-scroll]` の `querySelectorAll`)
  - **ShogiBoard の props 安定化**: 親 [card-shogi-game.tsx](src/components/game/card-shogi/card-shogi-game.tsx) で `legalMoves / hiddenBoardSquares / cardTargetSquares / noPromoteSquares` 等を `useMemo` で配列安定化 (欠けていれば追加)

#### 子 memo 化

- [src/components/game/shogi-piece.tsx](src/components/game/shogi-piece.tsx) — `React.memo` でラップ
- [src/components/game/card-shogi/card-view.tsx](src/components/game/card-shogi/card-view.tsx) — `React.memo` でラップ。**onClick 型は現状の `() => void` 維持** (API 変更しない)
- [src/components/game/card-shogi/hand-area.tsx](src/components/game/card-shogi/hand-area.tsx) — `React.memo` + 各カード wrapper を `HandCard` 内部子コンポーネントに切り出し memo 化。インラインの `() => onCardClick?.(c.instanceId)` は `HandCard` 内で `useCallback` に
- [src/components/game/captured-pieces.tsx](src/components/game/captured-pieces.tsx) — `React.memo` でラップ
- [src/components/game/card-shogi/deck-pile.tsx](src/components/game/card-shogi/deck-pile.tsx)、[trap-slot.tsx](src/components/game/card-shogi/trap-slot.tsx)、[mana-gauge.tsx](src/components/game/card-shogi/mana-gauge.tsx)、[card-shogi-history.tsx](src/components/game/card-shogi/card-shogi-history.tsx) — 各々 `React.memo`

#### 親側 prop 安定化

- [src/components/game/card-shogi/card-shogi-game.tsx](src/components/game/card-shogi/card-shogi-game.tsx)
  - `cardTargetSquares / hiddenBoardSquares / hiddenOwnCapturedTypes / unusableCardIds` 等の useMemo 結果を子 props に直接渡す (現状の中間変数 `ownHand / opponentManaGauge` 等は維持して OK)
  - インラインの `() => {}` を渡している箇所をモジュールスコープの `const NOOP = () => {}` で安定化 (例: `onPieceClick={() => {}}` 箇所)
  - `gameConfig` (l144) は既に依存個別参照なので **触らない** (オーバー最適化回避)

### リスク / 注意

- **DnD / swipeable 不使用 を grep で確認済み** ([src/components/game/card-shogi/](src/components/game/card-shogi/) 配下に `useSensor / useDroppable / DragDrop / swipeable` ヒットなし) → `HandCard` 切り出しで衝突する API はない。
- `HandArea` の `HandCard` 切り出しは現状の `<div key={c.instanceId}>` 構造を踏襲。`unusableCardIds: Set<string>` は親 useMemo で参照安定済み。
- `BoardSquare` 切り出しで現状の `data-legal` 属性 + `squareRefs` Map ref 登録が維持されるよう注意。`data-card-id` ([card-view.tsx:216](src/components/game/card-shogi/card-view.tsx#L216)) や `data-captured-piece` / `data-hand-scroll` は別コンポーネントの属性で本 Step の改変対象外。
- `React.memo` の比較は浅い参照。配列 prop が毎回新生成されると無効化される。**親側 useMemo の網羅確認は必須**。
- **`React.memo` の custom 比較関数 (`areEqual`) は使わない** — custom 比較を書くとバグの温床 (state が古いまま表示・props 漏れ等)。本 Step は **default の浅い比較のみ** 使い、props 安定化の方で memo を効かせる
- **flushSync × DOM 属性の互換性**: [card-shogi-game.tsx:486-560](src/components/game/card-shogi/card-shogi-game.tsx#L486-L560) の `handleSquareClick` 内で `flushSync(() => setPieceFlight(...))` した後、新しい `BoardSquare` 構造でも rect getter が正しく動くか実装時 + Vercel preview で必須確認

### 受け入れ条件

- React DevTools Profiler で 1 手指したときに `ShogiPiece` の再描画が動いた駒+直前の駒の 2 回程度
- 演出フロー (cardPlayEvent → pieceFlight → playFlight → COMMIT_PLAY_CARD) が変わらない
- **flushSync × `setPieceFlight` の rect 取得が正常動作** (動作確認: 歩戻し / 駒戻し / 二歩指しの 3 種で駒フライトが正しい位置から発火)
- Vercel preview で 5 種カード + ドロー + トラップ動作 + UNDO 全パス
- PR 本文に Profiler スクリーンショット (before/after) と First Load JS 比較を記載

---

## Step 3: 計算最適化 + AI 500ms 撤廃 + reduced-motion

**ブランチ**: `refactor/#107-compute` (`origin/feature/#107` 起点、Step 2 マージ後に切る)
**目的**: 王手中の重い計算を軽くし、AI 着手後の固定待機を撤廃する。OS 設定でアニメ抑制可能にする。
**所要**: 1 日

### 変更ファイル

#### unusableCardIds 最適化 (依存削減は取り下げ、関数最適化のみ)

- [src/lib/shogi/cards/effects.ts](src/lib/shogi/cards/effects.ts) — `canEscapeCheckWithCard(state, player, defId): boolean` を新規 export。`getCheckEscapingSquares` の早期 return 版 (1 マスでも回避できれば true)。target なしカードは default で false 返す (王手中使用不可)
- [src/components/game/card-shogi/card-shogi-game.tsx](src/components/game/card-shogi/card-shogi-game.tsx)
  - `unusableCardIds` の useMemo で `getCheckEscapingSquares(...).length === 0` を `!canEscapeCheckWithCard(...)` に置換
  - **依存配列は現状維持**: `[displayedOwnHand, gameState, cardState, playerColor, inCheck]`。個別フィールドへの分解は **取り下げ** — `useCond` 関数が `cardState` 全体を引数に取るため、依存削減すると別フィールド変化時に古い結果を返すリスクがある
- `cardTargetSquares` ([card-shogi-game.tsx:751-793](src/components/game/card-shogi/card-shogi-game.tsx#L751-L793)) は `pendingCard.phase === "selectTarget"` の時のみ計算が走る (early return 済み) ため、**本 Step では触らない** (現状で問題なし)

#### AI 後 500ms 撤廃 (ユーザー選択どおり)

- [src/hooks/use-card-shogi-game.ts](src/hooks/use-card-shogi-game.ts) (l858-863) — `setTimeout(() => { ... }, 500)` を撤廃し、`getAiMove` 解決直後に **即時 dispatch**。`onComment("ai_move")` も同タイミング即時呼出
- **React batching**: React 19 では Promise.then 内も自動 batch される。まずは素直に撤廃のみ実装し、Profiler で複数 re-render を確認したら `AI_RESOLVED_MOVE` 統合 action を別途検討
- **実機検証ポイント**: AI 着手後の駒移動 SE と DOM 更新の重なり方を Vercel preview のモバイル実機で確認。違和感があれば 100-200ms 程度の短縮形を別途ユーザーに相談する

#### CSS reduced-motion 対応 (2 倍スロー化)

- [src/app/globals.css](src/app/globals.css) — 末尾に `@media (prefers-reduced-motion: reduce)` ブロックを追加。`card-rarity-bg-slide / card-rarity-*-pulse / card-rarity-shine / card-rarity-orb-* / animate-deck-draw-glow` の `animation-duration` を 2 倍に伸ばす (停止ではなく低周波化)

#### handleSquareClick の DOM 探索軽量化 (本 Step では触らない)

- [src/components/game/card-shogi/card-shogi-game.tsx](src/components/game/card-shogi/card-shogi-game.tsx) の `findVisibleCapturedPieceRect` / `getBoardSquareRect` は `querySelectorAll` ベースだが、現状でも flushSync 後にしか呼ばれない設計のため **本 Step では触らない**。タップ毎に走るが頻度はタップ操作数に等しく、計算量は限定的。Vercel preview のモバイル実機で実測して **重ければ別 Issue 化** (本 Issue は範囲をぶらさない)

#### Vitest 追加

- [src/lib/shogi/cards/__tests__/effects.test.ts](src/lib/shogi/cards/__tests__/effects.test.ts) — `canEscapeCheckWithCard` の境界テスト (王手回避可能・不可能・カード種別ごと の 5-8 ケース)

### 受け入れ条件

- React DevTools Profiler で `unusableCardIds` 計算時間が王手中で 30-50% 短縮
- AI 着手の体感がスムーズになる (固定待機 500ms 撤廃)
- `prefers-reduced-motion: reduce` 設定時、レア度アニメが 2 倍長で動く (停止しない)
- `pnpm test:ci` 全パス
- PR 本文に First Load JS 差分・AI 着手の前後比較動画 (任意) を記載

---

## Step 4: アセット先読み機構 + AudioContext 早期化

**ブランチ**: `feature/#107-preload` (`origin/feature/#107` 起点、Step 3 マージ後に切る)
**目的**: モバイル回線でのプレイ開始時もたつき / 1 手目の SE 取りこぼし / BGM 切替時の音飛びを根絶。BGM フォーマット変更は別 Issue 化されたため、本 Step は **既存 WAV を維持したままできる範囲のプリロード強化** に集中。
**所要**: 1 日

### 変更ファイル

#### 新規

- [src/lib/audio/manifest.ts](src/lib/audio/manifest.ts) — アセットマニフェスト集約。`SFX_FILES` (use-sound.ts) と `CHARACTERS.bgmTrack` (characters.ts) を統合した `AssetManifest` 型を定義し、`AUDIO_MANIFEST` を export。将来カード画像追加時に `image: { card: Record<string, string> }` を足せる構造に
- [src/hooks/use-asset-preloader.ts](src/hooks/use-asset-preloader.ts) — ロビー専用フック。`useEffect` で manifest を読んで `<audio preload="auto">` 風に `new Audio(); audio.muted = true; audio.preload = "auto"; audio.load()` で先読み。SE 全種は mount 時に並列ロード、選択中キャラの BGM は選択変化のたびにロード。冪等 (Map で URL 重複排除)

#### 確認済みの現状 (修正不要)

- **Howler は既に動的 import** ([use-sound.ts:46](src/hooks/use-sound.ts#L46)) で対局画面 mount 時にロード。**本 Step で動的 import を二重に書かない**
- **SFX は use-sound.ts mount 時に全種事前ロード済み** ([use-sound.ts:50-53](src/hooks/use-sound.ts#L50)) — `new HowlCtor({ src: [src], volume: 0.7 })` で `html5` 未指定 = false (Web Audio)。これは既に最適。デコード済みバッファから直接再生されるため SE 遅延の最小実装
- **BGM は HTML5 Audio モード** ([use-sound.ts:75](src/hooks/use-sound.ts#L75)) — `html5: true` でストリーミング再生。長時間ファイル向けで妥当
- → 本 Step は **Howler の再生方式を変えず**、AudioContext の resume タイミングと **ロビーでの先読み** のみで音ズレを潰す

#### 修正 (音ズレ対策の中核)

- [src/hooks/use-sound.ts](src/hooks/use-sound.ts)
  - `SFX_FILES` 定義を `manifest.ts` import に置換
  - **AudioContext 早期 unlock**: `prepareAudio()` ヘルパを export。内部で動的 import 済の `Howler` から `Howler.ctx?.resume()` を呼び出す (Safari の autoplay policy 対策)
  - SFX preload 強化: 既存の Howl pre-instanciate に加え、`isReady` を await できる Promise (`onSoundReady`) を返す
  - `bgmTrack` 受け取り型を `string | string[]` に拡張 (将来 OGG/MP3 ペアになっても Howler の src 配列で fallback 可能)
- [src/data/characters.ts](src/data/characters.ts) — `bgmTrack` 型を `string | string[]` に拡張 (現状値は string のままで型互換)
- [src/app/page.tsx](src/app/page.tsx)
  - `useAssetPreloader` をマウント (SE 一括 + 選択中キャラ BGM 先読み)
  - 「対局開始」ボタンの `onClick` 内で `prepareAudio()` を await してから `router.push` する (ユーザージェスチャ内で AudioContext.resume を確実に走らせる)
- [public/sw.js](public/sw.js)
  - `CACHE_NAME` を `shogi-v2` にバンプ (古いキャッシュクリア)
  - SE のプリキャッシュ対象は現状維持 (manifest と二重管理を承知の上で、本 Step ではコメントに「`src/lib/audio/manifest.ts` と同期せよ」と明記)
  - **BGM (WAV) は PRECACHE_ASSETS に追加しない** (約 2.2MB を SW install 時にすべて取りに行くと初回起動が重くなる。代わりにロビーで選択キャラ BGM のみ Audio 先読み)

### リスク / 注意

- `useAssetPreloader` で `new Audio()` を作るとブラウザによっては自動再生 policy で警告が出ることがある。**`audio.muted = true; audio.load()` でメタデータと一部バッファだけ取得する形** にするのが安全
- `Howler.ctx?.resume()` を呼ぶには Howler が import 済みである必要がある。use-sound.ts は **対局画面 mount 時** に動的 import するため、ロビーから `prepareAudio()` を呼ぶには **ロビーで予め use-sound (またはその一部) を mount する** か、`prepareAudio()` 自身が動的 import を内包する形にする (後者を推奨、影響範囲を局所化)
- 上記の「動的 import + resume」で 30-50ms の遅延が出る可能性。**ロビーマウント時に裏で `import("howler")` を prefetch しておけば、onClick 時の遅延ほぼゼロに** できる (`useEffect(() => { import("howler") }, [])` で開始)

### 受け入れ条件

- モバイル実機 (Vercel preview) でホーム → 対局遷移後、最初の `game_start` SE が遅延なく鳴る
- BGM 切替時の "ぷつっ" 音 / 数百 ms の無音区間がなくなる (体感)
- bundle size: ロビー画面の First Load JS が 30KB 増以下 (Howler は対局開始ボタン押下時の動的 import で抑制)
- PR 本文に Network タブの BGM/SE ロード時系列スクリーンショットを添付

---

## Step 5: 大型ファイル分割

**ブランチ**: `refactor/#107-split` (`origin/feature/#107` 起点、Step 4 マージ後に切る)
**目的**: card-shogi-game.tsx (1,401 行) と use-card-shogi-game.ts (1,089 行) を責務単位で分解。**Vitest による reducer テストでデグレを担保**。
**所要**: 2 日

### リスク認識

本 Step は **本 Issue 内で最もリスクが高い**。理由:
- 行数移動が大きく、他 Step (#107-2, #107-3) でいじったコードと merge conflict が起きやすい → **#107-2, #107-3 を先にマージしてから本 Step を最新 origin/feature/#107 起点で着手する**
- 演出フロー (eventLog 監視 → flushSync → pieceFlight → playFlight → COMMIT_PLAY_CARD) は隙間なくチェーンしており、ファイル間に分けるとタイミング依存が見えにくくなる
- ユニットテストでカバーできる範囲には限界がある (DOM rect 取得・flushSync 等は jsdom では再現困難)

### 緩和策

- **既存ロジックを 1 行も変えず**、ファイル境界だけを引く (純粋な move-only リファクタ)
- 関連するコメント (`// Issue #82: ...`) もそのまま運ぶ
- export shape (関数名・引数・戻り値) を 100% 維持
- 各 handler の Vitest を網羅し、reducer 経由の state 遷移を二重チェック

### 変更ファイル

#### card-shogi-game.tsx の分割

- [src/components/game/card-shogi/use-card-event-effects.ts](src/components/game/card-shogi/use-card-event-effects.ts) (新規) — eventLog 差分監視の useEffect (l362-483) + rect getter 群 (`getDeckRect / getHandRect / getBoardSquareRect / findVisibleCardRect / findVisibleCapturedPieceRect`)
- [src/components/game/card-shogi/use-card-piece-flight.ts](src/components/game/card-shogi/use-card-piece-flight.ts) (新規) — pieceFlight state / pendingPieceFlightRef / pendingPlayFlightRef / cachePendingCardRect / handlePieceFlightComplete / handlePlayFlightComplete
- [src/components/game/card-shogi/use-card-draw-flight.ts](src/components/game/card-shogi/use-card-draw-flight.ts) (新規) — drawFlight state / freshlyDrawnId / handleDrawFlightComplete (double rAF + 120ms 保険スクロールロジック含む)
- [src/components/game/card-shogi/use-mana-flight-layer.ts](src/components/game/card-shogi/use-mana-flight-layer.ts) (新規) — manaFlights 配列 state / triggerManaFlight / removeManaFlight (多重発火対応)
- [src/components/game/card-shogi/use-fast-move-badge-layer.ts](src/components/game/card-shogi/use-fast-move-badge-layer.ts) (新規) — fastMoveBadges 配列 state / triggerFastMoveBadge / removeFastMoveBadge
- [src/components/game/card-shogi/use-overlay-event.ts](src/components/game/card-shogi/use-overlay-event.ts) (新規) — overlayEvent state / setOverlayEvent (王手・トラップ発動・ゲーム開始の中央オーバーレイ)
- [src/components/game/card-shogi/card-shogi-layout-mobile.tsx](src/components/game/card-shogi/card-shogi-layout-mobile.tsx) (新規) — `<md` 用レイアウト JSX
- [src/components/game/card-shogi/card-shogi-layout-tablet.tsx](src/components/game/card-shogi/card-shogi-layout-tablet.tsx) (新規) — `md..xl-1` 用レイアウト JSX
- [src/components/game/card-shogi/card-shogi-layout-xl.tsx](src/components/game/card-shogi/card-shogi-layout-xl.tsx) (新規) — `xl` 以上の 4 列レイアウト JSX
- [src/components/game/card-shogi/card-shogi-game.tsx](src/components/game/card-shogi/card-shogi-game.tsx) — 上記フック・レイアウトを使う薄い shell に縮小 (300-400 行目標)

#### use-card-shogi-game.ts の reducer 分割

- [src/hooks/card-shogi/reducer-types.ts](src/hooks/card-shogi/reducer-types.ts) (新規) — Action / 内部 state 型定義
- [src/hooks/card-shogi/reducer-shogi.ts](src/hooks/card-shogi/reducer-shogi.ts) (新規) — 駒指し系 handler (`handleSelectSquare / handleMakeMove / handleConfirmPromotion / handleResign / handleUndo` 等) + `makeMoveWithEffects`
- [src/hooks/card-shogi/reducer-card.ts](src/hooks/card-shogi/reducer-card.ts) (新規) — カード系 handler (`handleDrawCard / handleBeginPlayCard / handleConfirmPlayCard / handleCommitPlayCard / handleCancelPlayCard` 等)
- [src/hooks/card-shogi/reducer.ts](src/hooks/card-shogi/reducer.ts) (新規) — ルート reducer。switch で各 handler に委譲
- [src/hooks/card-shogi/use-ai-effect.ts](src/hooks/card-shogi/use-ai-effect.ts) (新規) — AI 自動応手の useEffect 分離
- [src/hooks/card-shogi/use-persist-effect.ts](src/hooks/card-shogi/use-persist-effect.ts) (新規) — DB 保存の useEffect 分離
- [src/hooks/use-card-shogi-game.ts](src/hooks/use-card-shogi-game.ts) — 上記モジュールを統合する薄いフックに (200-300 行)

#### Vitest 追加 (デグレ防護網の中核)

- [src/hooks/card-shogi/__tests__/reducer-shogi.test.ts](src/hooks/card-shogi/__tests__/reducer-shogi.test.ts) (新規) — 駒指し系 handler のシナリオテスト (10-15 ケース)
- [src/hooks/card-shogi/__tests__/reducer-card.test.ts](src/hooks/card-shogi/__tests__/reducer-card.test.ts) (新規) — カード系 handler のシナリオテスト (BEGIN_PLAY_CARD → SELECT_CARD_TARGET → CONFIRM_PLAY_CARD → COMMIT_PLAY_CARD の正しい遷移、UNDO 後のカード操作不可、王手中の使用ガード等の 15-20 ケース)

#### デッドコード最終整理

- [src/lib/shogi/cards/types.ts](src/lib/shogi/cards/types.ts) — `CardAction` の `CHARGE_MANA / SET_TRAP / TRIGGER_TRAP` を grep 再確認の上で削除 (UI からの dispatch なし、reducer 内実装も合わせて削除)。`RESET_TURN_TIMER` は [use-card-shogi-game.ts:825](src/hooks/use-card-shogi-game.ts#L825) で内部使用ありで残す

### 受け入れ条件

- 各ファイル 500 行以内
- export shape 維持 (`useCardShogiGame` 戻り値・`CardShogiGame` props 不変)
- `pnpm test:ci` 全パス (reducer テスト含む)
- Vercel preview で 5 種カード + ドロー + トラップ発動 + UNDO + 投了 を全確認
- PR 本文に First Load JS 差分を記載 (大幅な増減はない想定)

---

## 検証手順 (各 Step 共通)

### ローカル / CI

1. `pnpm install` → `pnpm build` → `pnpm lint` → `pnpm test:ci` 全パス確認
2. ローカル dev server は基本起動しない (Vercel preview で検証)
3. `pnpm build` の Route 別 First Load JS を PR 本文に記載

### Vercel Preview (各 Step push 後)

1. デスクトップ Chrome / Safari で対局フロー全体を一周
2. **モバイル実機 (iPhone Safari + Android Chrome)** で:
   - 対局開始 → game_start SE が遅延なく鳴る
   - 駒移動 SE / カード使用 SE / マナチャージ SE が音ズレなく鳴る
   - 5 種カード全使用 + 演出完走
   - no_promote トラップ発動と成り無効化
   - 王手中の手札非活性
   - UNDO 後のカード操作不可
   - BGM 切替音飛びなし
   - タブ切替後の演出復帰
3. **React DevTools Profiler** で:
   - Step 2 後: 1 手指したときの再描画コンポーネント数が大幅減 (例: ShogiPiece の再描画が ≤2 個 / 1 手)
   - Step 3 後: AI 着手後の dispatch が即時実行 (500ms 待機なし) / unusableCardIds 計算時間短縮

### 別 Issue 切り出し予定 (本プラン範囲外)

- BGM フォーマット変換 (WAV → OGG/MP3) と SW プリキャッシュ追加
- 龍王 BGM `bgm-ryuou.wav` 未配置の解消
- `mana_up` カードの完全撤去 (Issue #80 別途)
- `getPieceMoves` の標準将棋側最適化 (mutate-revert 含む大規模変更)
- Framer Motion bundle 削減
- Context / Zustand 等への状態管理リファクタ
- ホーム画面 bundle に card-shogi が混入していた場合の dynamic import 化
- [src/hooks/use-touch-handler.ts](src/hooks/use-touch-handler.ts) のモバイル特化最適化 (実機で計測後判断)

---

## Step 進行サマリ

| 順 | ブランチ | 目的 | 効果 | リスク |
|---|---|---|---|---|
| 1 | refactor/#107-cleanup | 演出定数集約・dead code・Vitest 設定・AGENTS.md 追記 | 保守性 | 低 |
| 2 | refactor/#107-memo | React.memo 化 (BoardSquare / HandCard 切出含む) | **モバイルラグ★★★** | 中 |
| 3 | refactor/#107-compute | 計算最適化 + AI 500ms 撤廃 + reduced-motion | **モバイルラグ★★** | 中 |
| 4 | feature/#107-preload | アセット先読み + AudioContext 早期 resume | **音ズレ★★★** | 低-中 |
| 5 | refactor/#107-split | ファイル分割 + reducer テスト | 保守性 (構造) | 中-高 |

順序根拠:
- Step 1 を先に: 後続 Step のレビュー雑音排除 + Vitest 設定整備
- Step 2, 3, 4 でモバイル UX 改善を先に届ける
- Step 5 を最後: 他 Step とのコンフリクト最小化、テスト網が Step 1, 3 で揃ってから着手。**revert 困難** (1500+ 行の移動を含む) なので、他 Step が安定してから

ロールバック容易性 (各 Step マージ後にデグレ発覚した場合):
- Step 1: 容易 (定数移管 / テスト追加のみ)
- Step 2: 容易 (memo 化を外すだけ)
- Step 3: 容易 (`canEscapeCheckWithCard` を旧式に戻す + `setTimeout` 復活)
- Step 4: やや困難 (manifest 経由の参照を散布した後)
- Step 5: 困難 (ファイル数増加・import パスの変更が他で参照される)

各 Step push 後に Vercel preview 確認 → ユーザーに PR 作成・マージの可否を都度確認。所要時間は目安 (push 後のユーザー確認待ちを含めると、全体は数日〜2 週間程度の期間想定)。
