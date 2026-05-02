# Issue #82 対応プラン: カード将棋 カード初版の内容確定

> このファイルは Issue #82 の作業計画書です。Web版 Claude Code 等から作業を継続する際の引継ぎ資料として、リポジトリ内に保管しています。

## Context

カード将棋の Phase A 以降に向けて、設計書 [`docs/card-shogi-design.md`](../card-shogi-design.md) 3.3 の「(案)」を確定版に書き換えるためのIssue。

- カードの **効果・コスト・レア度・説明文・エッジケース** を確定する
- Phase 0 実装済み3種 (`mana_up` / `pawn_return` / `no_promote`) は実装現状と整合させる
- Issue #80 (全カード効果実装) の前提仕様となる
- Issue #83 (デッキ編成) は別件 (本Issueでは扱わない)

## 現状サマリ (調査結果)

### 設計書側 (3.3節)
- **通常カード (案)** 11種: 2歩指し / マナUP / 桂馬戻り / 歩戻り / 香戻り / 2手指し / チェンジ・ザ・ワールド / 時間(自分)UP / 時間(相手)DOWN / トラップ破壊 / 持ち駒破壊
- **トラップカード (案)** 2種: 成り無効化 / 王手駒取り
- 「想定コスト」は `低 / 中 / 高` のラフな表記、レア度列なし、説明文なし
- バランス懸念欄に検討事項が列挙済み (2手指しの追加制約、CTW 終盤問題、持ち駒破壊の範囲)

### コード側 (現状)
| 場所 | 内容 |
|---|---|
| [src/lib/shogi/cards/types.ts](../../src/lib/shogi/cards/types.ts) | `CardId` ユニオン、`CardRarity = "common" \| "rare" \| "super_rare" \| "epic"` (4段階) |
| [src/lib/shogi/cards/definitions.ts](../../src/lib/shogi/cards/definitions.ts) | `CardDefinition` (kind/cost/rarity/effectId/targeting/status/phase/detailDescription/addedAt/relatedIssues) |
| [src/lib/shogi/cards/effects.ts](../../src/lib/shogi/cards/effects.ts) | `applyManaUp` / `applyPawnReturn` / `applyTrapSet` / `applyTrapClear` |
| [src/lib/shogi/cards/labels.ts](../../src/lib/shogi/cards/labels.ts) | レア度ラベル: `ノーマル / レア / 激レア / 究極` |
| [src/app/cards/page.tsx](../../src/app/cards/page.tsx) | マスターカタログ。status / kind / rarity フィルタ完備 |

### Phase 0 実装済み3種(コード現状値)
| id | name | kind | cost | rarity | status |
|---|---|---|---|---|---|
| `mana_up` | マナUP | normal | 2 | common | active |
| `pawn_return` | 歩戻し | normal | 3 | common | active |
| `no_promote` | 成り無効化 | trap | 4 | rare | active |

## 確定済み方針 (2026-05-02 ユーザー判断)

- **スコープ (2026-05-02 拡張)**: **Issue #80 を統合し、仕様確定 + 効果実装 + UI演出まで本Issueで完結させる**
  - 当初は「設計書更新 + `definitions.ts` への確定カード `status: "preparing"` 登録まで」だったが、仕様だけ決めて実装を別Issueに送る運用は細かい修正・改善がしづらいため統合
  - 各カードは `status: "active"` で本実装まで実施
- **レア度**: **4段階で確定** (`common / rare / super_rare / epic` ⇄ `ノーマル / レア / 激レア / 究極`)
- **採用カード**: **ゼロベースで再選定**(設計書 3.3 案は参考)
- **進行スタイル**: **1枚ずつ「採用判断 → 仕様確定 → 実装 → UI演出 → Vercel preview 確認 → リリース判定」を最後まで完結させてから次のカードへ**
- **既存サンプルカード (`sample_normal_*` / `sample_trap_*` 8種) の扱い**: 本Issueでは触らない(レア度ビジュアル検証用として残置)
- **設計書 3.3 書き換えタイミング**: **A案 一括書き換え** — 全カード確定後にまとめて 3.3 節を書き直す
- **「リリース判定」の意味**: 本Issueでは **仕様確定 + 実装完了の承認**(`status: "active"` で動作している状態)

## 進め方: カード1枚ごとのサイクル

ユーザーが「全カード追加完了」と判断するまで、以下のサイクルをカード1枚ごとに繰り返す。
**1枚を完成させる前に次のカードに進まない**(ユーザーの判断で並行する場合を除く)。

### Step 0: 準備 (Issue着手時に1度だけ)
1. `git fetch origin` 済み (origin/main = `d2dcf48` 「カード使用演出と関連UX調整 (Issue #106)」)
2. `git checkout -b feature/#82 origin/main` でブランチ作成
3. 本プランファイルをコミット & プッシュ(Web版 Claude Code から作業継続できる状態にする)
4. プランファイルはカード追加ごとに進捗を追記

### Step 1〜N: カードごとのサイクル

各カードについて以下を1枚ずつ実施:

#### (1) ユーザーから構想ヒアリング
- ユーザーが「こういう効果/能力のカードが面白い」と構想を提示
- ユーザーが先に決めている要素(名前 / コスト / レア度 / 効果詳細 等)があればそれを尊重
- 不明な要素は Claude がドラフトで埋める

#### (2) ドラフト版作成 (Claude)
以下の項目をすべて埋める:
- **カード ID** (英小文字スネークケース)
- **カード名 (表示名)**
- **種別** (normal / trap)
- **必要マナ (cost)** — 数値
- **レア度** (common / rare / super_rare / epic)
- **効果詳細** (エッジケース込)
- **UI 説明文 (短) `description`**
- **詳細説明 `detailDescription`**(改行可)
- **ターゲット指定 `targeting`** (none / ownPiece / enemyPiece / square)
- **備考** (バランス懸念・既存カードとの相互作用 等)

ドラフト提示はチャット上で表形式 or 構造化テキストで行う。

#### (3) 微調整 → 確定版
- ユーザーが内容を確認・微調整して確定指示を出す
- 数往復になることを許容

#### (4) コード反映 — 仕様 (`definitions.ts`)
- [`src/lib/shogi/cards/types.ts`](../../src/lib/shogi/cards/types.ts): `CardId` ユニオンに ID を追加(新規カードのみ)
- [`src/lib/shogi/cards/definitions.ts`](../../src/lib/shogi/cards/definitions.ts): 以下で登録
  - `status: "active"`、`phase: "A"` (Phase 0 既存3種は `phase: "0"` 維持)、`effectId` は実装に合わせる
  - 確定した cost / rarity / targeting / description / detailDescription
  - `addedAt: <そのカード追加日>`、`relatedIssues: [82]`(必要に応じて関連Issue追加)
  - icon は仮の絵文字を当てる(後ほど画像化想定)

#### (5) コード反映 — 効果ロジック実装
- [`src/lib/shogi/cards/effects.ts`](../../src/lib/shogi/cards/effects.ts): カードの純粋関数を実装
- 必要なら [`src/lib/shogi/cards/types.ts`](../../src/lib/shogi/cards/types.ts) に新しい状態フィールドを追加
- [`src/lib/shogi/cards/state.ts`](../../src/lib/shogi/cards/state.ts): 状態追加時は `createInitialCardState` / `serializeCardState` / `deserializeCardState` も更新(DB 往復対応)
- [`src/hooks/use-card-shogi-game.ts`](../../src/hooks/use-card-shogi-game.ts): 効果適用フックの分岐追加
- 必要なら [`src/lib/shogi/rules.ts`](../../src/lib/shogi/rules.ts) など盤面ロジックに介入(成り判定に効果反映 等)

#### (6) コード反映 — UI 演出 (必要なカードのみ)
- カード使用時の演出(既存の早指し演出やマナアニメと整合)
- 永続効果がある場合(成り無効化マーク 等)は盤面駒に視覚マーカーを追加
- framer-motion で 1〜2秒のアニメーションが基本

#### (7) typecheck / commit / push
- `npx tsc --noEmit` 通過確認
- ブランチに commit & push (memory: 「コミット & プッシュは事前確認不要」)
  - コミットは「仕様 / 効果ロジック / UI演出」の単位で分割推奨(変更が小さい場合は1コミットでも可)
- Vercel preview で `/cards` と対局画面の両方で動作確認(memory: 「ローカル dev server は基本起動しない、Vercel preview で検証」)

#### (8) ユーザー最終チェック
- ユーザーが Vercel preview の `/cards` 画面でカード表示と、対局画面で効果動作を確認

#### (9) リリース判定
- ユーザーがいずれかを判定:
  - **調整** → 該当ステップに戻って修正
  - **リリース** → そのカードは完了。`status: "active"` で次のカードへ進む

#### (10) サイクル継続 / 完了判定
- ユーザーが「次のカード」と指示 → 新しいカードで Step 1(1) に戻る
- ユーザーが「カード追加完了」と指示 → Step Final へ

### Step Final: 設計書 3.3 の確定版書き換え

全カードがリリース判定で確定した後、[`docs/card-shogi-design.md`](../card-shogi-design.md) 3.3 節を確定版に再構成:
- 「(案)」表記を全削除
- 通常カード表: `カード名 / コスト / レア度 / 効果 / UI説明 / 備考`
- トラップカード表: `カード名 / コスト / レア度 / 発動条件 / 効果 / UI説明 / 備考`
- レア度 4段階定義の節を追加 ([`labels.ts`](../../src/lib/shogi/cards/labels.ts) と整合)
- 「エッジケース・例外仕様」節を新設(2手指し詰み禁止 / CTW 終盤 / 持ち駒破壊範囲 等のうち、確定したカードに関連するもの)
- Phase 0 既存3種(`mana_up` / `pawn_return` / `no_promote`)の cost / rarity を最終仕様で記述

書き換えのタイミングは2案あり、サイクル開始時にユーザー確認:
- **A: 一括書き換え (推奨)** — 全カード確定後にまとめて 3.3 節を書き直す
- **B: 逐次書き換え** — 1枚確定するたびに 3.3 節を追記更新

### 既存サンプルカードの扱い

[`definitions.ts`](../../src/lib/shogi/cards/definitions.ts) の `sample_normal_*` / `sample_trap_*` 8種は #104 のレア度ビジュアル検証用。
- 検証用途が終わっていれば撤去候補
- 撤去判断は最初のカード追加サイクル開始前にユーザー確認

## 進捗トラッカー (カード追加状況)

| # | カードID | 名前 | 種別 | レア度 | コスト | 状態 |
|---|---|---|---|---|---|---|
| 1 | `mana_up` | マナUP | normal | common | 2 | **廃止 (deprecated)** — 2026-05-02、マナでマナを増やす設計の意義が薄いため |
| 2 | `pawn_return` | 歩戻し | normal | common | **1** (旧3) | **リリース** — 2026-05-02、コスト 3→1 に変更 (他項目は現状維持) |
| 3 | `no_promote` | 成り無効化 | trap | rare | 4 | **リリース** — 2026-05-02、効果を「成り宣言を1回無効化」→「成り不可状態を永続付与(取られたら消失=案A)」に変更。実装込みで完結 |
| 4 | `double_pawn` | 二歩指し | normal | rare | 3 | **仕様ドラフト中** — 2026-05-02 着手、二歩禁則を解除して同列に追加配置 |

> カード確定ごとに行を追加していく。状態欄は `ドラフト中 / 確定 / preparing登録済 / 仕様確定リリース / 廃止` 等。

## Verification (Issue 完了時)

- [ ] 全採用カードが [`definitions.ts`](../../src/lib/shogi/cards/definitions.ts) に `status: "active"` で登録済み(廃止カードは `deprecated`)
- [ ] 各カードの効果ロジックが `effects.ts` 等に実装され、対局画面で動作する
- [ ] `npx tsc --noEmit` パス
- [ ] Vercel preview の `/cards` 画面で全 active カードが表示されている
- [ ] Vercel preview の対局画面で全カードの効果・UI演出が確認できる
- [ ] [`docs/card-shogi-design.md`](../card-shogi-design.md) 3.3 から「(案)」が外れ、確定版になっている
- [ ] Phase 0 既存3種の cost / rarity が設計書とコードで一致
- [ ] レア度名称が 設計書 ⇄ [`labels.ts`](../../src/lib/shogi/cards/labels.ts) で一致
- [ ] Issue #82 の受け入れ条件 (拡張版):
  - 全採用カードの 効果・コスト・レア度・説明・実装 が確定 / 実装済み
  - 設計書 3.3 から「(案)」が外れている
  - Vercel preview で全カードの動作確認完了
- [ ] Issue #80 の取り扱いをユーザーに確認(クローズ / open維持の判断)

## ExitPlanMode 後の最初のアクション

1. `git checkout -b feature/#82 origin/main` でブランチ作成
2. 本プランファイル(`docs/plans/issue-82.md`)を初回 commit & push
3. **既存サンプルカードの撤去要否** をユーザーに確認
4. **設計書 書き換えタイミング (A: 一括 / B: 逐次)** をユーザーに確認
5. **「リリース判定」の意味** (本Issueでは仕様確定承認 / 効果実装まで含む) をユーザーに確認
6. 1枚目のカードの構想ヒアリングへ進む
