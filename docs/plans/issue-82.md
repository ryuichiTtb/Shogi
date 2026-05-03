# Issue #82 対応プラン: カード将棋 カード初版の内容確定

> このファイルは Issue #82 の作業計画書です。Web版 Claude Code 等から作業を継続する際の引継ぎ資料として、リポジトリ内に保管しています。

---

## 🔁 セッション引継ぎメモ (2026-05-02 EOS — Vol.2)

別セッションでこのプランを再開する際は、まずこのセクションを通読してください。

### ブランチ・PR・push 状態
- **ブランチ**: `feature/#82` (origin/main 起点で開始 → 途中で `origin/main` を merge して同期済み)
- **未push コミットなし** — `origin/feature/#82` と同期済み
- 最新コミット: `70e0c8a fix: 手札スクロールが効かない稀ケースを堅牢化 (Issue #82)`
- このセッションの最後に **PR を作成 → main へマージ** 完了予定。次セッションは `main` を起点に新ブランチを切ってください。

### Issue 状態
| Issue | タイトル | 状態 | 補足 |
|---|---|---|---|
| #82 | カード将棋: カード初版の内容確定 | open / 継続 | スコープを #80 統合で実装込みに拡張済。本セッションでは Step1〜3 + 周辺改善を実施 |
| #80 | カード将棋: 全カード(11種)の効果実装 | open | #82 に統合済 |
| #112 | カード更新履歴メタ追加 | open / 別セッション対応中 | **本セッション内では触らない** |
| #113 | カタログフィルタを複数選択化 | merged (origin/main 同期済) | 本ブランチに取り込み済 |
| #115 | カード共通項目の拡張 | open / 一部前倒し済 | `useCondition` / `useConditionDescription` 部分は本Issueで先取り。残り (`targetingFilter` / `relatedCards`) は #115 で |
| #116 | カード将棋 初期手札ドロー演出と山札30枚化 | open / 未着手 | 本セッションで起票。次セッション以降で別途対応 |

### カード仕様確定状況(進捗トラッカー本体は下記)
| # | カード | 状態 |
|---|---|---|
| 1 | `mana_up` | 廃止 (deprecated) |
| 2 | `pawn_return` | リリース (cost 1, 歩・と金両対応) |
| 3 | `no_promote` | リリース (永続成り不可付与、案A) |
| 4 | `double_pawn` | リリース (2026-05-02) |
| 5 | `piece_return` | **リリース** (2026-05-02) |

### 本セッション (Vol.2) の主な完了事項

**Step 1 — カード使用条件の共通項目化**
- `CardDefinition` から関数フィールドを切り出し `CARD_USE_CONDITIONS` Map にまとめた (Server→Client 境界の serialize 制約のため)
- `pawn_return` / `double_pawn` / `piece_return` に `useCondition` を適用
- `unusableCardIds` 計算と `BEGIN_PLAY_CARD` reducer ガードを共通化

**Step 2 — `piece_return` (駒戻し) を実装**
- 玉以外の自分の駒1枚を持ち駒に戻す。成駒は unpromote。ピン駒不可。
- cost 3 / rarity rare / icon ↩️ (歩戻しと同アイコン許容)
- 検証用ハックを `TEST_CARD_IDS` 配列ベースに汎用化 (`double_pawn` + `piece_return` を両プレイヤー初期手札に 2 枚ずつ)

**仕様変更 — 王手中もカード使用許可**
- 「王手中はカード使用不可」を撤廃
- 王手回避になる選択肢があるカードのみ使用可、配置先も王手回避になるマスのみ
- ヘルパ: `simulateCardEffect` / `getCheckEscapingSquares`

**Step 3 — 駒移動アニメーション基盤**
- 新規 `PieceFlight` コンポーネント (回転しながら from→to へ飛ぶ)
- 演出順は **カード使用 → 駒フライト → 中央カード演出 → 手番交代** の3段
- 着地点(to)はフライト中だけ `opacity: 0` で隠し、到着で再表示
- `flushSync` で効果適用前に hide を確実に反映 → 隙間ゼロ
- 移動速度 1800 px/s 一定 + 回転 0.1s/回転 一定 (絶対速度)
- フライト中の駒サイズ 84px、文字サイズも `squareSize` prop 経由で比例

**ドロー演出 (DrawFlightCard) のチューニング**
- タイミング: 山札→中央 500ms / ホールド 1500ms / 中央→手札 300ms (合計 2300ms)
- rotateY: 0→中央 2.5 周 / 中央以降維持
- rotateZ: 0→中央 2 周 / 中央→手札 +3 周 (累積 1800°)
- ease: easeOut → linear → linear (中央→手札も等速化)
- フェードアウトは「中央→手札の最終 100ms」だけ急速にかける形に変更
- ドロー完了時に手札スクロールを最後尾へ移動 (PC 縦 / モバイル 横)

**周辺改善**
- カード詳細ページに「使用条件」枠を追加 (`useConditionDescription`)
- pendingCard / isDrawing / isPlayingCard の状態漏れを横断点検し reducer + UI hook + canDraw 式の3レイヤーで防御
- 歩戻しの detailDescription を実装に整合 (歩・と金両対応)
- 駒戻しの「ピン駒不可」を平易な表現に書き直し
- `mana_up` の `description:` コロン抜け typo 修正

### 検証用ハック(本Issue完了時に削除すること)
- [`src/app/actions/game.ts`](../../src/app/actions/game.ts) `createGame` 関数内に **`TEST_CARD_IDS = ["double_pawn", "piece_return"]` を両プレイヤーの初期手札に 2 枚ずつ追加するブロック** がある。
- 6枚目以降のカードを検証する際は `TEST_CARD_IDS` を差し替える運用。
- **本Issue完了時 (全カードリリース時) にブロック自体を削除する**

### 次セッションで進めるアクション
1. **6枚目のカードの構想ヒアリング**(設計書 3.3 案: 桂馬戻り / 香戻り は `piece_return` で吸収済、残り候補は 2手指し / チェンジ・ザ・ワールド / 時間UP/DOWN / トラップ破壊 / 持ち駒破壊 / 王手駒取り / 状態異常解除 など)
2. ドラフト → 微調整 → 実装 → UI演出 → Vercel preview 検証 → リリース判定 のサイクルを回す
3. 余力次第で Issue #116 (初期手札3枚ドロー演出 + 山札30枚化) に着手 — 別セッション・別ブランチ推奨

---

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
| 4 | `double_pawn` | 二歩指し | normal | common | **2** (旧3) | **リリース** — 2026-05-02 初版 / 2026-05-03 cost 3→2 + rarity rare→common に再調整 (通常カード枠へ移動)。二歩禁則のみ解除して同列追加配置。配置先ハイライト + 使用条件未達カードを非活性化。AI 思考をカード使用演出完了まで保留する fix も含む |
| 5 | `piece_return` | 駒戻し | normal | rare | 3 | **リリース** — 2026-05-02 (Vol.2)、玉以外の自分の駒を持ち駒に戻す (歩戻しの上位互換)。成駒は unpromote。ピン駒不可。駒移動アニメ (PieceFlight) 演出付き |

> カード確定ごとに行を追加していく。状態欄は `ドラフト中 / 確定 / preparing登録済 / 仕様確定リリース / 廃止` 等。
>
> 検証用ハック (`TEST_CARD_IDS`) は本Issue完了時に削除する。6枚目以降の検証では同配列を差し替える運用。

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
