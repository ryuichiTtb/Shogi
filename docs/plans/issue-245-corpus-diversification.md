# Issue #245: 教材コーパスの多様化 + ラベルのカード認識化

学習評価 (#245 Stage 2) の教材を「序中終盤すべてで網羅的に多様」にし、あわせて
**ラベルがカードの種類を区別できるようにする**ための計画。M1 レビュー (2026-07-26) 反映済。

計画正本はこのファイル。実装中に判明した事実はここへ追記する。

---

## 1. なぜやるか (実測に基づく動機)

### 1.1 教材多様性の測定結果 (348 局 / 35,897 局面、2026-07-26)

| 指標 | 実測 | 評価 |
|---|---|---|
| 他局と完全一致するサンプル (0-15 手) | 66〜87% | **深刻** |
| 同 (31-60 手) | 8.5% | 良好 |
| 同 (61 手以上) | 0.74% | 良好 |
| **初手の種類** | **2 通り** (pawn_return 197 局 / 8四→7三 151 局) | **深刻** |
| **完全同一棋譜** | **68 局 (19.5%)**、distinct 280 本 | **深刻** |
| 千日手で終局 | 120 局 (34.5%) / 8,076 サンプル (22.5%) | 品質低下 |
| デッキ構成 | **全 348 局で同一 1 種** | **深刻** |
| 教材に 1 枚も無いカード | **piece_return / check_break / double_move** | **深刻** |

**中終盤の「完全一致」は少ないが、全局が同じ 2 通りの序盤から派生**しているため、
カバーする局面空間は狭い。ユニーク率が高いことは多様性の十分条件ではない。

**根因**: `advanced` 難易度は `addNoise = 0` = 完全決定的。教材の 71% がこの設定同士の対戦で、
乱数源はデッキシャッフルのみ (初期手札の組合せは片側 6 通り) に縮退していた。

### 1.2 ラベルがカードの種類を区別していない (最大の発見)

`src/lib/shogi/ai/cards/digest.ts:66-69`:

```ts
const handValueDelta =
  computeHandValue(cardState.hand.sente.length) -   // 枚数のみ
  computeHandValue(cardState.hand.gote.length);
```

手札の評価が **枚数だけ**。カード種別が無視される。実測でも:

| 同一盤面グループ | 評価値が完全一致 | 中央値の差 |
|---|---|---|
| 手札の中身が違う (1,295 種) | **57.3%** | **0.0 cp** |
| 手札同じ・マナだけ違う (110 種) | 24.5% | 18 cp |

> ⚠ **この 57.3% / 1,295 グループは段2 の M1 で再現できなかった** (グルーピングキーが記録されて
> いなかったため)。再測 (2026-07-27、`snap-labeled-348-D5.jsonl`) では
> 「盤面+持駒+手番+マナ」キーで 1,310 グループ / 一致 93.3%、「マナ無視」キーで 1,507 グループ /
> 一致 63.1%。**結論の向き (ラベルが手札の中身を区別していない) はどのキーでも変わらない**が、
> 絶対値は参照値として使えない。合否判定は §6 のとおり **同一スクリプトの before/after 比較**で行う。

一方 **encoder は手札を defId 別枚数で符号化している** (`encoder.ts:200-224`)。
つまり **「入力ではカード種別を区別するのに、正解ラベルは区別しない」**。
NN はカードの使いどころを学びようがない = 実機で残る「無駄なカード使用」の有力な原因。

---

## 2. M1 レビューの BLOCKER (方針を変えた 4 点)

### B-1: digest の手札評価を種別依存にしてはならない (却下)

一見自然な修正 (`getCardValue` を手札にも適用) は **TT 誤 hit を再発させる**。

- move-only の `negamaxWorld` は子を `applyTurnAction` で生成し、その中で
  `advanceDrawProgress` が 5 ターンごとに**自動ドロー**を発火する (`world-kernel.ts:95-127, 336`)。
- `computeCardFold` は deck を **length でしか fold しない** (`card-zobrist.ts:124`、
  「同 length・内容違いは同 key」をテストで pin 済)。
- → 同 board・同手札多重集合・同 deck 長でも**山札順が違えば自動ドロー後の手札種別が変わる**
  = 同 TT key で異 score。#235 S4d-4 で潰した誤 hit の再来。
- 加えて encoder は deck を length しか符号化しないので、**山札順がラベルへ漏れて NN には純ノイズ**。

**将来やるなら deck fold の是正 (先頭 k 枚の defId を fold) が前提条件。今回は digest を一切触らない。**

また `getCardValue` は pawn_return / double_pawn / piece_return / double_move が
**0 センチネル** (`card-spec-server.ts:92-101`) なので、適用しても教材デッキの 3 種中 2 種は
区別できず「半分の是正」にしかならない。

### B-2: 正しい解は「ラベル探索の root で playCard を展開する」

手作りの数字を増やすのではなく、**カードを実際に使ってみた結果を探索に発見させる**。

- **TT が安全な理由** (段2 M1 で当初の説明が事実誤りと判明し訂正): `playCard` も turn 終了処理で
  `advanceDrawProgress` を呼ぶため**自動ドローを発火しうる** (`world-kernel.ts:409` → `95-127`)。
  ただし **move 枝も同じ `advanceDrawProgress` を通る** (`world-kernel.ts:336`) ので、
  root のカード展開が**増分の山札依存を生むことはない**。TT が安全なのは
  `computeCardFold` が hand を **defId 多重集合**で fold するから (`card-zobrist.ts:104-108`) であって、
  「deck を触らないから」ではない。
  → 将来 hand の fold を枚数のみへ緩める / deep node でカードを展開する場合は **deck fold の是正が前提**。
- `draw` は deck 先頭を引くので**展開しない** (山札順への依存を断つ、既存設計方針の踏襲)。
- production 影響ゼロ (ラベル専用エントリを新設し、route/engine から呼ばない)。

**これは今回の必須要件**。ラベルが手札の中身を区別しない限り、デッキ多様化は
「入力だけ増えてラベルは同一」= 純粋なノイズ注入に化ける。

### B-3: 分岐生成は「行動列のリプレイ」で作る

サンプルの `boardState`/`cardState` を deserialize してそのまま再開すると、
`serializeBoardForTraining` が **moveHistory / positionHistory を保存しない** (`serialize.ts:15-28`)
ため `isRepetition` が分岐前の反復を数えられず、千日手が検出されないまま
**200 手打ち切りの `finalStatus="active"` draw を量産**する。clean は既定で repetition しか
落とさないのでこれをすり抜けて教材に混入する。

→ 分岐点は必ず**教材 JSONL の行動列を `applyTurnAction(spectatorMode:true)` で先頭から再生**して作る。
初期 cardState は `sample[0].cardState` を deserialize したものを使う
(`createInitialCardState` はシャッフルが走るので呼ばない)。
再生の各 ply で `serializePosition` をサンプルと突合し、不一致の試合は分岐に使わない。

### B-4: 既出手禁止だけでは中終盤の多様化にならない

31 手以降 92-97%・61 手以降 99.3% が既にユニークなので、完全一致キーの ban は
そこでほぼ発火しない。ユーザーの狙い「序中終盤すべてで網羅的に多様化」には
**(a) リプレイ方式の分岐生成 / (b) デッキ多様化 / (c) 難易度・手番運の多様化** の三本柱が必須。

終盤帯はプールが薄い (clean 後 140 手以降は 1,804 / 26,012 = 6.9%) ので、
**分岐本数を終盤に厚く寄せる** (1 本が短いのでコストも安い)。

---

## 3. ユーザー決定 (2026-07-26)

| 論点 | 決定 |
|---|---|
| 進め方 | **8 段階すべて実施** (前半だけの試行は選ばない) |
| 旧教材 (348/clean 229 局) | **新レシピで付け直して合流させる** (+19〜23 時間) |
| 教材生成の AI | **world 経路へ切替** (10 局パイロットで手数・終局理由・カード率を確認) |
| double_move | **配線を直して教材に含める** (+1〜2 日、段 6.5 を追加) |
| 探索深さ | **5 のまま据え置き** |
| 千日手局 | **完全除外** (clean 実装済) |
| 重複判定 | **厳し目** = エンコーダ入力が 1 つでも違えば別サンプル (実装済) |
| production 影響 | 個人の趣味アプリのため**フラグで守らず直接入れ替えてよい**。ただし正しさ (TT 誤 hit・千日手検出・棋力低下) は引き続き確認 |

---

## 4. 実装計画 (8 段階)

各段は独立にレビュー・検証できる粒度。段ごとに commit し、full gate (lint→typecheck→test:ci→build) を通す。

### 段 1: ラベル基盤の健全化 (0.5 日) — 実装済み
**目的**: 新旧レシピのラベルが 1 ファイルに混ざる事故を構造的に防ぐ + 嘘ラベルを排除する。

- `TrainingGameData` に `labelMeta {version, depth, expandCards, expandDraw}` を optional 追加し、ラベル出力時に刻む
- `labelKeyHash` に recipe ハッシュを混ぜる (recipe が違えば既済扱いにならない)
- `evaluatePositionWorldMoveOnly` が depth 1 未完了時に 0 でなく **null** を返すようにし、
  スクリプトは searchScore に **null を明示的に書く** (嘘ラベルの排除。
  「キー欠落 = 未採点」と「null = 採点不能」を区別するため)
- `encode-training-245.ts` で全入力の labelMeta 一致を assert

**検証**: 旧 recipe で human 1 局を再実行し searchScore が既存出力と一致 (recipe 追加が値を変えない pin。
行全体は labelMeta が増えるためバイト一致にはならず、searchScore 配列で突合する) /
recipe を変えた 2 回目で再採点されること / null 返しの単体テスト。

#### 段 1 実装仕様 (M1 レビュー反映後の確定版)

| 対象 | 内容 |
|---|---|
| `src/lib/shogi/training/types.ts` | `LabelMeta` 型を新設。`TrainingGameData.labelMeta?: LabelMeta \| null` を末尾に追加。`searchScore` のコメントを「未採点 (キー欠落) / 採点不能 (null) / 採点済み (number)」の 3 状態へ更新 |
| `scripts/utils/label-identity.ts` | `recipeKey` (キー順非依存の正規形、未刻印は `"legacy"`) / `sameRecipe` / `CURRENT_LABEL_RECIPE_VERSION` を追加。`labelIdentityKey` は **searchScore に加えて labelMeta も除く** (入力行 ↔ 出力行の突合が壊れないため)。`labelKeyHash(record, recipe)` は recipe を明示引数で受け「内容 × レシピ」でハッシュする |
| `vitest.config.ts` | `include` に `scripts/**/*.test.ts` を追加 (同一性キーは高コスト事故に直結するのでテストを走らせる。`node:crypto` を client 同居ディレクトリへ持ち込まない選択) |
| `src/lib/shogi/ai/search.ts` | `evaluatePositionWorldMoveOnly` の戻り型を `number \| null` へ。反復途中で停止が刺さった値は採用しない (`if (ctx.stopped) break`)。到達深さを `ctx.depthCompleted` へ記録 |
| `scripts/label-search-score-245.ts` | `LABEL_DEPTH` / `LABEL_TIME_MS` を起動時に検証 (NaN は JSON 往復で null に化けレシピ識別が壊れる)。RECIPE を出力へ刻印。RESUME 時に OUT へ別レシピ行があれば**起動時に停止**。done-keys / claim のハッシュに RECIPE を混ぜる。採点不能 (`unscored`) と深さ未達 (`shallow`、`ctx.depthCompleted` の実測) を数え、>0 なら警告 + 非ゼロ終了 |
| `scripts/label-done-keys-245.ts` | 各レコード**自身の** labelMeta でハッシュ。レシピ内訳と `searchScore=null` 件数を報告 |
| `scripts/encode-training-245.ts` | bootstrap 時のみ全入力のレシピ一致を検査し、混在なら停止。`.meta.json` に `labelRecipe` と `searchScoreCoverage {scored, unscored, ratio}` を記録。採点済みが 1 件も無ければ停止 (bootstrap のつもりが実質 outcome、という取り違えの防止) |
| `scripts/merge-labeled-245.ts` (新規) | ワーカー出力の結合。重複判定を `labelIdentityKey` の 1 実装へ寄せる (結合側で書き直すと labelMeta まで比較して同一局の新旧が両方残る)。レシピ混在で停止、期待件数と突合 |
| `scripts/clean-training-245.ts` | 連結地点なのでレシピ内訳を表示し、混在時に警告 |

**`labelMeta.depth` は要求値であって到達値ではない**。到達値は `ctx.depthCompleted` で実測し
`shallow` カウンタとして監視する (ラベルの浅さは「値は返るのに質だけ落ちる」静かな劣化なので、
完了時に必ず目立たせる)。

**★既存の D5 資産は「legacy」扱いになる (承知のうえの仕様)**。段1 より前に生成した
`local-data/training/labeled-348-D5.jsonl` (348 局・約 20 時間) とその done-keys / claims は
`labelMeta` を持たないため `recipeKey` が `"legacy"` になり、これから走らせる `v1|d5|c0|w0` とは別レシピ扱いになる。結果として
(i) 同じファイルへ `LABEL_RESUME=1` で追記しようとすると起動時に停止し、
(ii) 既存 done-keys / claims はハッシュが合わず全局が再採点対象になる (中身は同じ move-only D=5 なのに)。
ユーザー決定 (§3) で**旧教材は新レシピで付け直す**ことになっており、段2 で `expandCards:true` へ変わるため
どのみち作り直すので許容する。既存 encode 成果 (`features-clean-D5.jsonl` 等) は単一 legacy なので再現性に影響なし。

**段1 実施時の検証結果 (2026-07-27)**
- full gate: lint 0 error / typecheck 緑 / test:ci 全緑 / build 成功
- **pin**: human 1 局を D=5 で再採点し、変更前に生成した `labeled-human-D5.jsonl` と searchScore 全 53 件がバイト等価
  (試合メタも labelMeta を除けば同一) = 段1 の変更はラベルの値を 1 ビットも変えていない
- 同レシピの done-keys では全スキップ / 別レシピ (D=3) では再採点 / 別レシピの OUT へ RESUME すると
  起動時に停止し OUT に書き込まない / `LABEL_DEPTH` の `""`・`abc`・`0`・`2.5` を起動時に拒否
- encode: レシピ混在で停止 (成果物を差し替えない) / 未採点入力を bootstrap に渡すと停止 / outcome モードは従来どおり
- merge: 同一レシピの重複を 1 件へ / 混在で停止し出力を書かない / 自己上書きを拒否

### 段 2: ラベル探索の root カード展開 (1 日) ★本丸
- `getWorldLegalActions(world, variant, expandCards, expandDraw = expandCards)` に分離
- ラベル専用エントリ `evaluatePositionWorldWithCards` を新設 (root のみ expandCards=true / expandDraw=false)
- noise / nearEqual / 打ち切り は持ち込まない (`findBestMoveWorld` を流用しない)
- 既存 `evaluatePositionWorldMoveOnly` は A/B 対照として残す

**検証**: 既定引数追加で既存テスト全緑 (挙動不変 pin) / カードアクション 0 件の局面で新旧のラベルがバイト一致 /
20-30 局面 microbench (ms/局面・depthCompleted) / **手番別ラベル差**の計測 /
**カード枝の厳密性** (参照実装との過小不一致ゼロ) / **一致率の before/after**。

#### 段 2 実装仕様 (M1 レビュー反映後の確定版)

**★カード枝は full-window `(-∞, +∞)` で読む — 窓を絞る最適化は 2 度試して 2 度とも失敗した**

段2 の失敗モードは「例外もエラーも出ず、カードの価値だけが静かに消える」ことなので、
探索窓の選択がそのまま成否を決める。3 案を**教材の実局面を試合横断で抽出して**実測した。

| 方式 | カードが効く局面を拾えた数 | 取りこぼし幅 | 速度 (move-only 比) |
|---|---|---|---|
| null 窓 scout + 上振れ時のみ再探索 (PVS) | — | **最大 172.7cp** | ×1.4 |
| `(-∞, -iter)` = alpha 側だけ開ける | **4 / 22** | **最大 120.3cp** | ×1.27 |
| **full-window `(-∞, +∞)`** (採用) | **7 / 22** | **0 (基準)** | **×2.21** |

- **窓を絞ると壊れる理由**: beta が有限になった瞬間、探索としては許容される非厳密な枝刈りが
  「カードを捨てる方向」にだけ効く — `quiescenceWorld` の fail-hard (`return beta` で窓端を返す) /
  **LMR の縮小 scout が fail-high しても再探索されない** / 評価値が小数なので幅 1cp の窓の内側に
  値が収まり TT に `flag="exact"` が付きうる。
  M1 が指摘した null-move の fail-hard は主因ではなかった (`disableNullMove` を実装して
  カード部分木全体で止めても 120.3cp の取りこぼしは 1cp も減らなかったため、フラグごと撤去した)。
- **full-window なら原理的に発火しない** (beta=+Infinity ゆえ fail-high 系の cut が成立せず、
  null-move も `Number.isFinite` ガードで自動 skip)。
- **速度ゲートを ×2 → ×2.5 へ緩める**。×2 は実装前の見込み値で、失敗モードを知る前のものだった。
  実測 ×2.21 なら深さ5 で全教材を採点しても 8 並列で 2 日弱 = 計画 §5 のラベル予算 (1〜2 日) 内に収まる。
  **ラベルは 1 度作れば何度も学習に使う資産**なので、ここは速度より正しさを取る。
- ★この判断は「先頭 N 局面」で測っていた間は見えなかった (1 試合の序盤だけを見ており残差 0 に見えた)。
  診断は**必ず試合横断で間引き抽出**する (`DIAG_STRIDE`)。

| 対象 | 内容 |
|---|---|
| `getWorldLegalActions` | 第 4 引数 `expandDraw = expandCards` を追加 (既定値ゆえ既存 16 箇所の 3 引数呼出は完全不変)。`isInCheck` は expandDraw のときだけ計算 |
| `search.ts` ラベル用エントリ | `evaluatePositionWorldMoveOnly` / `evaluatePositionWorldWithCards` を共通の内部関数へ集約。move 部分は既存と同じ `negamaxWorld` 1 呼び出し、カードは root の追加枝を **full-window** で読む。カード枝の子局面は反復間で不変なので 1 度だけ作り、手番側から見て良い順に並べる |
| 反復のコミット規約 | 反復ごとに一時変数へ受け、**move 探索とカード掃引の両方を完走した反復だけ**を確定値へ commit (段1 と同じ「停止が刺さった反復は捨てる」規約)。カード掃引の途中で止まった値を採らない |
| 終局ガード | `state.status === "active"` かつ合法 move が 1 つ以上ある時のみカードを展開。本ゲームの終局判定は盤面のみ (`getFullLegalMoves` が空 → checkmate) で、カードで詰みを解除できるかは見ていないため、ラベルだけカードで詰みを回避すると実ゲームと食い違う |
| `turnEnded` 防御 | カード枝で `applied.turnEnded === false` なら skip。現行カード集合では到達不能だが、`targeting:"none"` かつ王手中使用可のカードが 1 枚増えた瞬間に kernel の no-op 経路 (`world-kernel.ts:401-405`) へ落ち、符号反転した誤値が max に採用される |
| ラベルバッチ | `LABEL_EXPAND_CARDS` (既定 `"1"`) を追加。`"0"`/`"1"` 以外は起動時に停止。**起動時にレシピを表示**する (完了時のみだと誤レシピで走り切ってから気づく) |
| 診断 | `scripts/diag-label-cards-245.ts` を新設 (検証 5 項目、下記) |

**バイト等価の主張範囲 (MINOR-3)**: 「move 部分は既存と同じ 1 呼び出し」は **1 反復の内部**でしか成立しない。
カード部分木は killer/history を更新する (`search.ts:1196-1205`) ため、**反復を跨ぐと** move 側の
LMR/futility の適用対象が変わりうる。**バイト等価が構造的に保証されるのはカードアクション 0 件の局面だけ**。

**王手 root の 1 段差 (NIT-1)**: root が王手のとき `negamaxWorld` の check extension が move 側にだけ効き、
カード枝が 1 段浅くなる。実教材で該当は 0.06〜0.11% (`double_pawn` のみ。他は `checkUsage:"forbidden"`)。
深さを揃えるとカード枝が production の `findBestMoveWorld` より深くなる別の非対称を生むので**揃えない**。

**手番非対称バイアスの扱い (M1 推奨)**: 段2 では**対称化 (相手カード応手の展開) は実装しない**。
move 枝もカード枝も等しく `turnEnded=true` で相手番へ渡るので兄弟比較は歪まず、
encoder には手番ビットと自他の手札 (defId 別枚数) が両方あるので「手番側 × 自分の手札」に比例する差は
**学習可能な実信号**であって幻の定数ではない。ただし大きさは実測し、
**手番別の中央値 |delta| が 50cp を超えたらユーザー判断へ上げる**
(根拠: 既存のテンポ項 ±15cp、futility margin 300/500cp、ラベルは tanh(·/1000) なので 50cp ≒ ラベル空間 0.025)。
超えた場合の選択肢は (a) 受容して段7 の勝率ゲートに委ねる / (b) ply≤1 まで相手カードも展開して対称化
(コスト増・段2 スコープ拡大) / (c) 手番別に中心化 (実信号まで消すので非推奨)。

**診断スクリプト `scripts/diag-label-cards-245.ts` の 5 項目** (①②④ は**終了コード 1 で落ちる機械ゲート**)
1. **バイト一致**: カードアクション 0 件の局面で move-only と完全一致 (1 件でも不一致なら異常)
2. **microbench**: ms/局面・depthCompleted を両方式で比較 (**2.5 倍**超なら設計見直し)。
   ウォームアップを 1 局面捨て、計測順を局面ごとに入れ替える (常に同順だと後発が JIT で有利になる)
3. **手番別ラベル差**: `delta = withCards - moveOnly` を手番別に n / 平均 / 中央値 / p90 / `delta≠0` 率で集計。
   「カードが 1 件以上ある局面」に限定した数字も併記する (平均だけだと裾に支配される)
4. **符号規約**: カードは root の**追加選択肢**なので手番側視点でラベルは下がりえない。1 件でも下がったら
   探索か符号反転の実装バグ (#235 で繰り返しバグった最危険領域)。あわせて
   **カード枝が値を更新した件数・更新幅**を出す (更新 0 なら段2 は無効。①②③では検知できない)
5. **一致率の before/after**: 同一盤面・別手札グループのラベル一致率を、同一キー・同一サンプルで
   move-only / withCards の両方について出す (§6 のゲート)

**★深さを変えて複数回まわすこと + 試合横断で間引き抽出すること**。段2 の実装バグは
**深さ依存**で出た (PVS 版の 172.7cp 取りこぼしは D=3 で再現し D=4 では消えた。
`(-∞,-iter)` 版の 120.3cp は逆に D=4 でだけ出た)。さらに「先頭 N 局面」で測ると
1 試合の序盤しか見ないため残差 0 に見えてしまう。`DIAG_STRIDE` で試合と手数を跨いで拾うこと。

**段2 の実測結果 (2026-07-27、教材 `snap-selfplay.jsonl` を試合横断で間引き抽出、full-window 採用版)**

| 深さ | ① バイト一致 | ② 速度 | ④ 符号違反 | カード枝がラベルを更新した割合 |
|---|---|---|---|---|
| 3 (40 局面) | 18 局面 / 不一致 0 | ×2.05 | 0 / 40 | 22.7% (5/22、更新幅 中央値 65.3cp・最大 152.6cp) |
| 4 (40 局面) | 18 局面 / 不一致 0 | ×2.22 | 0 / 40 | 31.8% (7/22、更新幅 中央値 120.3cp・最大 231.0cp) |
| **5 = 本番レシピ** (24 局面) | 14 局面 / 不一致 0 | **×1.68** | 0 / 24 | **50.0%** (5/10、更新幅 最大 378.0cp) |

深いほど倍率が下がる (×2.22 → ×1.68) = move 側の探索が重くなるぶんカード枝の相対コストが薄まる。
**本番レシピ (深さ5) では ×1.68** なので、ラベル生成の総時間は当初見込みから 7 割増程度で収まる。

- **⑤ 一致率 (D=4 / 25 グループ)**: 「盤面+持駒+手番+マナ」96.0% → **76.0%** /
  「マナ無視」92.0% → **68.0%** = §6 のゲート達成 (同一スクリプト・同一キーの before/after)。
  言い換えると **ラベルが割れた割合が 4% → 24%** (マナ無視で 8% → 32%) になった。
  ★⑤ の測定母集団は**手番側の手札が違うグループだけ**なので (診断が
  `ownKeys.size >= 2` で絞る)、下の「構造的上限 15.2%」はここに含まれていない = **差し引いてはいけない**。
  残る 76% の内訳 (カードが使えない / カードが最善 move を超えず正しく同値) は未測定で、
  「どこまで下げられるのが理想か」は現時点では言えない。
- **③ 手番非対称バイアス**: 深さ3・100 局面 (教材全体を等間隔で抽出) で
  `|delta|` 中央値は先手番 **0.0cp** / 後手番 **0.0cp**、p90 は 0.0 / 46.7cp。
  **escalation 閾値 50cp を下回るのでユーザー判断へ上げる必要なし**。
  符号は理論どおり (root は手番側しかカードを展開しないので先手番は + / 後手番は −)。
  変化率が後手番 21.9% vs 先手番 6.9% と偏るのは教材のマナ・手札分布によるもので、ラベル側の構造要因ではない。
  ★40 局面の試行で一度「後手 83.0cp」と出て閾値を超えたが、これは**中央値の実装が偶数長で
  上側に張り付いていた**ための artifact だった (値の半分が 0 のとき「中央値 = 最小の非ゼロ」に化ける)。
  線形補間へ直して再測したうえの数字が上記。**小標本の分位点は実装で結論が変わる**ので注意。
- ★上表は「先頭 N 局面」で測っていた初期値 (×1.2〜1.45 / 更新幅 中央値 4.6cp) とは別物。
  先頭固定だと 1 試合の序盤しか見ておらず、**カードが効く中終盤を丸ごと外していた**。

### 段 3: 多様化コア (純粋モジュール、1 日) — 実装済み
`src/lib/shogi/training/diversify.ts` を新設。

- `actionKey(action)`: move=type/from/to/promote/dropPiece、playCard=defId+target (instanceId は除く)、draw='d'
- `positionKey(gameState, cardState)` = encoder 入力のハッシュ (clean と同一式)
- `SeenIndex` = `Map<posKey, Map<actKey, count>>` + serialize/load
- `pickDiverseAction(candidates, seen, opts, rng)`: best からの cp margin と上位 topN で絞り、
  **count 昇順の最小層から mulberry32 で一様抽選** (ハード ban にせず最小層抽選に一本化 = 枯渇しない)

**検証**: 単体テストで「未出手があれば必ず未出が選ばれる / 全既出でも最小 count が選ばれる /
同 seed で再現する / instanceId 違いが同一キー / 手札順違いが同一 posKey」を pin。

#### 段 3 実装メモ (M2 反映後)

- **ハッシュは node:crypto を使わず FNV-1a 32bit の 2 パス (前向き + 後ろ向き) を連結**して 64bit 相当にした。
  `src/lib/shogi/training/` は client から import されるディレクトリなので Node 専用 API を避ける。
  M2 が実測で検証: 200 万件で衝突 0、走査方向を変える工夫は同方向 2 パスより 3〜4 倍良く、
  先頭差異・末尾差異のどちらでも崩れない (理想比 ~4.5 倍以内)。衝突しても
  「別局面のカウントが混ざって多様化がわずかに偏る」だけで教材の正しさは壊れない。
- `pickDiverseAction` は**記録しない純粋関数**。`recordSeen` は呼び出し側の責務。
  `marginCp` / `topN` の NaN・負値は丸める (env 由来の異常値で長時間バッチを落とさない)。
- `SeenIndex` の永続化は 2 形式: 追記用 `posKey actKey` (1 行 = 1 回、**並列 append 可**) と
  圧縮用 `posKey actKey count`。パーサは両方受け、壊れた行は無視する。
- `seenKeysFromSample(sample)` を用意した。「保存済みサンプル → キー」の変換は段4/段5/段7 で
  何度も要るので 1 本化する (各所で `boardState as EncoderPosition` + `deserializeCardState` を
  書き直すと定義がズレる)。
- **★段6.5 への申し送り**: `playCard` の actKey は `defId + target` なので、target を持たない
  `double_move` は**どの 2 手を指すかに関係なく 1 キーに潰れる**。段6.5 で double_move を教材へ
  入れるなら「1 回使うとその局面では以後選ばれにくい」だけになり、多様な二手指しは生成されない。
  必要なら actKey に move ペアを含める拡張が要る。

### 段 4: engine の候補スコア素通し + 自己対戦の多様化配線 + 10 局パイロット (2 日) — 実装済み
- `FindBestMoveResult` に `rootActionScores?` を**加算のみ**で追加 (route の応答には載せない)
- selfplay chooser を **world 経路** (`useTurnActionSearch:true`) へ切替、難易度は advanced/expert 固定
  (難易度ノイズは rootActionScores 確定後の後付けなので、乱数を我々の抽選に一本化する)
- 多様化ラッパ: rootActionScores が無ければ素通し (早期 return 対策、必須)
- `scripts/build-seen-index-245.ts`: 既存教材から posKey/actKey 行ファイルを 1 回だけ生成
  (131MB を毎回 parse しない)。並列ワーカーはこのファイルを共有し追記する

**検証**: 10 局パイロットで手数・終局理由・カード使用率・depthCompleted を現行と比較 /
初手が 2 通りでなく分散 / 同一棋譜 0 件 / フォールバック発生率。

#### 段 4〜6 実装メモ

| 対象 | 内容 |
|---|---|
| `src/lib/shogi/ai/engine.ts` | `FindBestMoveResult.rootActionScores?` を**加算のみ**で追加 (world 経路が返したときだけ非 undefined)。route の応答には載せないので production 無影響 |
| `scripts/selfplay-245.ts` | chooser を **world 経路** (`useTurnActionSearch`) へ切替。`rootActionScores` を `pickDiverseAction` へ渡し、**無い経路 (合法手 1 つの早期 return / fallback) は素通し**する (必須。素通しにしないと手が返らず生成が止まる)。seed 固定・共有 SeenIndex への追記・選択内訳の統計出力 |
| `scripts/build-seen-index-245.ts` (新規) | 既存教材から `posKey actKey` の行ファイルを 1 度だけ作る (131MB を毎回 parse しない。並列ワーカーが追記共有できる形式) |
| `src/lib/shogi/training/selfplay.ts` | `playOneGame` に `initialWorld?` / `maxAdditionalMoves?` を optional 追加 (既存呼出は無改変)。`replayToPly` を新設 |
| `scripts/branch-selfplay-245.ts` (新規) | 層化抽出 (序盤 0-39 / 中盤 40-99 / 終盤 100+、既定比 1:2:3 で終盤厚め)。**候補が薄い帯の不足は他帯へ回す**ので本数を落とさない。同一親から最大 3 本。ガード = 再生突合一致 / status active / doubleMove null / 合法アクション 2 以上 |
| デッキ多様化 (段6) | `DECK_PRESETS` 5 種 (A 従来 / B 駒戻し / C トラップ / D 4種混合 / E 高コスト) を局ごとに抽選。**教材に 1 枚も無かった `piece_return` / `check_break` を必ず含む**。`double_move` は探索未対応 (段6.5) なので入れない。`SELFPLAY_DECK_POOL=0` で従来の単一デッキに固定 (A/B 対照) |

**多様化の代償を実測する**: chooser は「最善スコア − 選んだ手のスコア」を集計して出力する。
0cp なら同点手を選んだだけ = 棋力低下ゼロ。これが大きいときは `SELFPLAY_MARGIN_CP` を絞る。

**分岐は親のデッキ構成をそのまま継ぐ**。分岐は元対局の `cardState` (山札の中身ごと) を
引き継ぐので、ここで別の構成を記録すると**メタと実際の山札が食い違う**。
親の識別は `sourceGameId` に `branch:<親index>:<ply>` として残す (段7 の train/val 分割で
同じ親から出た枝を同一グループとして扱うため)。

**分岐点では親が実際に指した手を先に「既出」として登録する**。登録しないと最小層抽選で
親と同じ手を引く確率が残り (topN=6 なら約 17%)、「分岐したのに元と同じ」= 生成時間の丸損になる。

**並列ワーカーは必ず別 seed で回す**。同 seed だと初期 SeenIndex も同じなので全ワーカーが
同じ抽選列を辿り、潰そうとしている「完全同一棋譜」を作り直してしまう
(未指定なら pid を混ぜて自動でばらし、実際に使った seed をログへ出す)。
抽選用とデッキ抽選用は**別の乱数ストリーム**にする (1 本だと `SELFPLAY_DIVERSIFY=0` のとき
消費数が変わってデッキ割当がずれ、A/B 比較が交絡する)。

#### 段 4 パイロット結果 (10 局 × 2 本、2026-07-27、デッキは従来の単一構成で多様化のみ A/B)

| 指標 | 対照 (多様化 OFF) | **多様化 ON** |
|---|---|---|
| **初手の種類** | **2 通り** | **7 通り** ✅ |
| 完全同一棋譜 | 0 局 | 0 局 |
| ユニーク局面 | 100% | 100% |
| 手数 (平均 / 最小 / 最大) | 125 / 69 / 200 | 113 / 38 / 200 |
| 終局理由 | 詰み 7 / 打切 2 / **千日手 1** | 詰み 9 / 打切 1 / **千日手 0** ✅ |
| カード使用率 | 9.1% | 6.6% |
| ドロー率 | 0.2% | 0.7% |
| 平均 depthCompleted | 2.72 | 2.35 |
| 素通し (フォールバック) 率 | — | **2.1%** |
| **多様化の代償** | — | 平均 0.3cp / 中央値 0.0cp / **抽選時点の探索が同点と見た手が 97.6%** |

- **教材の中核問題 (初手が 2 通りしかない) が 7 通りへ改善**。千日手も 1 → 0。
- **代償は小さい**: 97.6% が「**抽選時点の探索 (平均 depth 2.35) が同点と見た手**」で、平均損失 0.3cp。
  `SELFPLAY_MARGIN_CP=60` は妥当と判断する。
  ★ただし「同点 = 棋力低下ゼロ」とは言い切れない。同点判定はその浅い探索自身が出した値で、
  浅いほど同点は機械的に増える。#235 S4e で「gap=0 だから損ゼロ」と判断して実機で改悪だった
  のと同じ形なので、断定はしない (教材ラベルは別パスで深く読み直して付けるため、
  影響は「棋譜の質」に限られる)。
- ★**抽選は engine のタダ捨てガードを通らない**。ガードは「探索が同点と見るが実は horizon 起因で
  タダ捨て」の手を潰すもので、まさに margin 帯に効く。教材に production AI なら指さない手が
  混じりうることを承知のうえで使う (ラベルは深く読み直すので学習素材としては成立する)。
- ⚠ **カード使用率が 9.1% → 6.6% へ低下**。互角帯の候補は move が多数を占めるため、
  一様抽選するとカードの採用比率が下がる。段6 のデッキ多様化と段2 のラベル改善が
  カード学習の主役なので許容するが、段7 の本生成後に再確認する。
- ⚠ 平均 depthCompleted が 2.72 → 2.35 (−14%)。**要因は未特定** (局面の複雑化とも、
  多様な局面で TT ヒット率が落ちたためとも取れる)。時間予算は両者同じ。

### 段 5: 分岐生成 (リプレイ方式、2〜3 日) ★中終盤の網羅 — 実装済み
- `replayToPly(record, targetPly)`: 行動列を再生し、各 ply で `serializePosition` を突合
- `playOneGame` に `initialWorld?` / `maxAdditionalMoves?` を optional 追加 (既存呼出は無改変で通る)
- `scripts/branch-selfplay-245.ts`: **層化抽出** (序盤 0-39 / 中盤 40-99 / 終盤 100+)。
  終盤は 1 本が短いので本数を厚く。同一親からの採用は k=2〜3 本まで
- ガード: status active / 合法アクション 2 以上 / doubleMove===null / 突合一致

**検証**: 既存 5 局のリプレイで全 ply が一致 / 既存テスト全緑 /
20-30 本の小規模生成で finalStatus 分布 (active draw が増えていないこと)・posKey 重複率。

### 段 6: デッキ多様化 (0.5 日) — 実装済み
`piece_return` / `check_break` を含む複数構成のプールから局ごとに抽選。

**検証**: perf-bench で depthCompleted が棋力ゲートを割らないこと (check_break の valueModel は
自玉 8 近傍の利き計算を伴うのでコスト増の可能性) / 5 局試行で該当カードが実際に手札・盤上に現れ、
encoder の該当次元が非ゼロになること。

### 段 6.5: double_move の教材対応 (1〜2 日、ユーザー決定で追加) — 実装済み
**現状の破壊**: selfplay の chooser は `world.doubleMove` を engine に渡していない
(`FindBestMoveOptions` に口が無い)。二手指し継続中 (`turnEnded=false`, `movesLeft=2`) に再度
呼ばれた engine が通常ターンと誤認して playCard/draw を返すと、`applyPlayCardAction` が
`doubleMove:null` を返して**二手指し状態が黙って消える**。さらに `buildTrainingSample` が
doubleMove を保存しないので、1 手目のサンプルが通常局面と区別できない。

- `FindBestMoveOptions` に `doubleMove` を追加し、chooser から渡す
- `buildTrainingSample` / `TrainingSampleData` に doubleMove 状態を保存
- encoder に二手指し継続フラグを足すかは別途判断 (featureDim 変更 = 既存モデルと非互換)

**検証**: 二手指しを含むデッキで 10 局生成し、二手指しが黙って消える棋譜が 0 件であること。

#### 段 6.5 実装メモ

| 対象 | 内容 |
|---|---|
| `FindBestMoveOptions.doubleMove?` | 二手指し継続中の状態を探索へ伝える。`findBestMove` → `findBestMoveWorld` の root world へ渡す。**production の route は渡さない** (1-response 方式で engine が 2 手をまとめて返すため) = 従来どおり null で完全不変 |
| `findBestMoveWorld` | root world が継続状態を持つと `getWorldLegalActions` が card/draw を抑止して move-only になる。継続中は root へ double_move 候補を足さない (二手指し中に更に二手指しはできない)。**root ループにも `!turnEnded` 分岐を入れた** (下記 ★) |
| `TrainingSampleData.doubleMoveMovesLeft?` | 継続中だけ「あと何手指せるか」を刻む。**盤面だけでは二手指しの 1 手目か通常局面かを区別できない**ので、これが唯一の手がかり。通常ターンでは付けない (既存サンプルと同じ形) |
| chooser | `world.doubleMove` を engine へ渡す。渡さないと engine が通常ターンと誤認して playCard/draw を返し、適用時に kernel が `doubleMove:null` を返して**二手指し状態が黙って消える** |
| デッキ | プールに構成 F (double_move 4 + pawn_return 4 + double_pawn 4) を追加。`SELFPLAY_DECK=A〜F` で 1 種に固定できる (検証用) |

**★M2 が見つけた BLOCKER (符号反転)**: `findBestMoveWorld` の root ループは
`applied.turnEnded` を見ずに**常に `-negamaxWorld(...)`** していた。二手指しの 1 手目は
`turnEnded=false` で**手番が自分のまま**続くため、ここで反転すると root の argmax が argmin になり、
**AI が 1 手目に最悪手を選ぶ**。実測で「2 手目に詰む最強手」が最下位 (12/12、score −89996) に落ちていた。
中間ノードには `!turnEnded` 分岐があったが root には無く、「状態が消えないこと」しか検証していなかった
ため素通りしていた。root にも同じ分岐を入れて修正
(あわせて子の boardHash も全量計算にした。`updateHash` は手番を無条件に flip するので、
手番が続く子ではパリティが汚れる)。

**検証結果**: 構成 F で 5 局・463 決定 → **二手指し発動 34 回 / 状態が消えた棋譜 0 件**、
発動直後 2 手の残り手数は必ず `2 → 1`。単体テスト 6 件で固定 (教材側 3 件 = 継続の進み方 /
通常ターンには刻まない / 盤面には情報が無い、**探索側 3 件** = 継続中でもタダ取りを選ぶ・
root スコアが手番側視点である・2 手目は通常どおり)。
探索側テストは**修正を外すと実際に落ちる**ことを確認済み (これが無かったのが流出原因)。

**encoder への継続フラグ追加は見送り**。`featureDim` が変わると現在 Preview に載っているモデルと
非互換になる。サンプルには記録済みなので、将来 encoder を変える判断をしたときに**教材を作り直さずに**
使える (順序として安全なほう)。

**★段2 のラベル探索は double_move を展開しない** (`getLabelCardActions` → `getWorldLegalActions` が
S4c-1 の方針で除外)。二手指しの局面自体は教材に入るが、「二手指しを使うと得か」はラベルに現れない。
必要になったらラベル側の別段で対応する。

### 段 7: 本生成 → clean → ラベル → encode → 学習 → 検証
- 生成 (通常 + 分岐、ワーカー間で SeenIndex 共有)
- **clean をラベルの前に**回す (3 フィルタとも searchScore 非依存 = 約 28% のラベル代を先に落とす)
- 新レシピで一括ラベル (取り合い方式 + done-keys)。**旧 229 局も新レシピで付け直す** (ユーザー決定)
- encode: 分岐は `familyId` (= 親の内容ハッシュ) で同じ親の枝を同一グループへ寄せ、
  train/val 分割のリークを防ぐ

  **family の受け渡し** (親と枝が別の組に散ると、検証に「学習で見たのとほぼ同じ局面」が混ざる):
  1. 分岐生成が枝へ `familyId = 親の内容ハッシュ` を刻む (`sourceGameId` にも同じ値を残す)
  2. clean が**サンプルを間引く前に** `familyId` を刻む (鍵は全行動列から導くので、
     間引いた後に計算すると枝が持つ親の鍵と一致しない)
  3. encode が `familyId` 単位で連番を振り、train/val はその単位で分ける
- train → **勝率 (control 比) + カード行動診断 + 実機**で判定 (**val MSE では判断しない**)

#### 段 7-1 の実測 (本生成 350 局 / 50,288 局面、2026-07-27 10:53〜14:48)

7 ワーカー × 50 局。`scripts/diag-corpus-diversity-245.ts` で測った旧教材との比較:

| 指標 | 旧 348 局 | 新 350 局 |
|---|---|---|
| distinct な棋譜 | 280 / 348 (80.5%) | **350 / 350 (100%)** |
| 完全同一の複製 | 68 試合 (最大クラスタ 35) | **0** |
| 初手の種類 | 2 通り | **20 通り** |
| 序盤 15 手帯の他局一致 | 52.6% | **6.5%** |
| 局面のユニーク率 | 89.2% | **98.5%** |
| カードの種類 | 3 種 | **6 種すべて** (check_break 103 / no_promote 170 が薄め) |
| デッキ構成 | 1 種 | **6 種** (50〜64 局ずつ) |
| 千日手 | 120 局 (34.5%) | **1 局** |
| 二手指し | 0 | **888 サンプル** |
| 勝敗 | 先手 161 / 後手 54 / 引分 133 | 先手 121 / 後手 145 / 引分 84 |

**残る偏り**: 200 手打ち切り (`status=active`) が **81 局 (23%)**。旧教材の千日手が
「短いループ」だったのに対し、多様化で反復を避けた結果「長い膠着」へ移った形。
局面自体は多様 (ユニーク率 98.5%) だが、1 局 210〜223 局面と重く採点費用を食う。

**生成時の chooser 統計**: 決定の 96〜98% で抽選、79〜80% が最善と別の手、うち 97% が同点 (0cp)、
平均コスト 0.6cp。**ただし平均到達深さは 1.85** (パイロットは 2.35) なので、この「同点」は
深さ 2 相当の自己申告。真の代償は `scripts/diag-diversify-cost-245.ts` で深さ 4 で測り直す。

#### ★多様化の「代償 0cp」は浅い自己申告だった (深さ4 で測り直した結果)

生成ログは「同点 97% / 平均 0.6cp」と報告するが、その判定に使った探索は**平均到達深さ 1.85**。
`scripts/diag-diversify-cost-245.ts` で教材全体から 333 決定を等間隔に抜き、**深さ 4 で読み直した**結果:

| 指標 | 生成ログ (深さ ~2) | 深さ 4 で読み直し (第 1 版・**過小評価**) |
|---|---|---|
| 同点 (0cp 以下) | 97% | 76.3% |
| 50cp 超の損 | — | 14.7% |
| 100cp 超の損 | — | 12.6% |
| 最大の損 | 60cp (margin 上限) | 86,390cp (= 詰みを逃した) |

**★この第 1 版の数値は過小評価だった** (事前監査が指摘 → コードで裏取り)。理由:
探索の root は 2 手目以降を**狭い窓**で読み、最善を超えなければ本気で読み直さない
(`src/lib/shogi/ai/search.ts:1477-1483` の PVS)。fail-low した手のスコアは真の値より
**良い側に丸められる**ので、そのまま引き算すると損が小さく出る。
→ 修正版は「実際に選んだ手」だけを、その手を指した後の局面を**別途フルの窓で読み直して**
評価する (最善側 = PV のスコアは元から厳密なのでそのまま使う)。
同じ 3 決定で第 1 版 0cp → 修正版 3cp / 337cp と、実際に差が出ることを確認済み。

**教訓**: 探索の出力を「候補どうしの比較」に使うときは、**PV 以外のスコアは信用できない**。
比較したい手は必ず自前でフルの窓で読み直すこと。これは診断ツール全般に効く (S4e の
gap=0 誤判定も同じ穴の可能性がある)。

**なぜ margin では防げないか**: 生成時の探索が詰みを見ていないので、詰みを逃す手も
「同点」の帯に入ってしまう。margin を狭めても、浅い探索が同点と誤認する限り効かない。
深く読ませれば減るが、**同点が減る = 候補が減る = 多様性が落ちる**という逆向きの作用がある
(多様性は探索の浅さから生まれている)。

**それでも教材として採用する判断**:
1. ラベル (searchScore) は深さ 4 の探索値で、**指し手の質とは独立**に付く。高い費用を払う成果物は汚れない。
2. 悪手の後の局面も AI は評価する必要がある。弱い指し手から生じた局面も正当な学習対象。
3. 汚れるのは**勝敗ラベル**だけで、これは encode 段の混合比 α で扱える (採点し直し不要)。
   → 学習時に α ∈ {0.5, 0.8, 1.0} を A/B する (encode + train は数分)。
4. 作り直すと 4〜12 時間かかるうえ、多様性が落ちる。

**含み (今後の教材で効く対策)**: 生成時の 1 手あたり時間予算を増やすと悪手は減るが多様性も減る。
「悪手を減らしたい」なら margin ではなく**深さ**を上げるしかない、という関係を覚えておく。

#### ラベルに乗らないもの (既知の穴・今回は許容)

- **二手指し (`double_move`) はラベル探索で展開されない**。`getLabelCardActions` →
  `getWorldLegalActions` は `double_move` を候補から外す (`src/lib/shogi/ai/search.ts:823`、
  実行配線が #235 S4c-1d 待ちのため)。さらに `evaluatePositionWorldLabel` は
  `doubleMove: null` で読むので、**二手指しの途中の局面 (888 サンプル = 1.8%) も
  「普通のターン」として採点**される。
  → ラベルは常に**控えめ側**にずれる (使える手を 1 つ見落とすので過大評価にはならない)。
  → 直すには探索側の統合 (S4c-1d) が要り、レシピも v2 になる。今回は許容して記録に留める。
- **勝敗ラベルの信頼性**: 200 手打ち切り (`status=active`) は `winner="draw"` になる
  (`src/lib/shogi/training/selfplay.ts:85-86`)。実際には「決着しなかった」だけで引き分けではない。
  局数で 23% / サンプル数で約 34%。混合比 α で扱える (encode 段の判断なので採点後でよい)。

#### ラベルの深さは D=4 (2026-07-27 実測で決定)

Stage2 設計 §8 のユーザー決定は「**D=4 起点。P2-0 で生成時間を実測し 4↔5 を微調整**」、
本計画 §5 のラベル予算は **1〜2 日**。新教材で実測した単価は次のとおり (生成 7 本と競合した状態):

| 深さ | 単価 | 全教材 (clean 後 約 7.4 万局面) を 8 並列で |
|---|---|---|
| D=5 | **55.2 秒/局面** | 約 4〜6 日 → **予算超過** |
| D=4 | **13.7 秒/局面** | 約 26〜33 時間 → 予算内 |

旧教材での実測 (21.5 秒/局面, §7) より深さ5 が 2.5 倍高いのは、新教材の局面が
多様で進んでいる (手が広い・カードが絡む) ため。**よって本番レシピは `v1|d4|c1|w0`**。
どちらも到達深さは要求どおり (shallow 警告ゼロ) で、浅いラベルが混ざる形の劣化ではない。

代案として「D=5 + 4 局面に 1 つへ間引き」も同予算に収まるが、
- 教材の量は多様化フェーズの主目的そのもの (前回 val MSE が頭打ちだった主因が量)
- 設計 §12 は D=4〜5 のどちらでも「pieceSafety の horizon (1 手) を超える」条件を満たす
ことから、**全局面を D=4 で採点する**方を採る (間引きの偏りも入らない)。

#### ⚠ このブランチをマージするときの注意

コミット `60d9d95` の subject が `fix(#245): ...` になっている (本来この repo では禁止)。
GitHub の closing keyword と解釈されると **#245 (エポック = クローズ厳禁) が自動で閉じる**。
マージ後は必ず `gh issue view 245` で state を確認し、closed なら `gh issue reopen 245` する。
履歴の書き換え (amend + force push) は破壊的操作なのでユーザー確認なしには行わない。

#### 段 7 の手順書 (実行順に。※印は数時間〜数日かかる)

```bash
# 0) 出現回数の索引を既存教材から 1 度だけ作る (数秒)
SEEN_IN=local-data/training/snap-selfplay.jsonl \
  SEEN_OUT=local-data/training/seen-index.txt npx tsx scripts/build-seen-index-245.ts

# 1) ※本生成 (7 ワーカー × N 局)。ワーカーごとに別 seed、索引は共有
bash local-data/run-generate-245.sh 50
#    進捗: wc -l local-data/training/gen-245.part*.jsonl
#    ログ: tail local-data/training/gen-245.part0.log

# 2) ※分岐生成 (中終盤を厚く)。生成済み + 旧教材の両方を親にできる
BRANCH_IN=local-data/training/snap-selfplay.jsonl,local-data/training/gen-245.part0.jsonl,... \
  BRANCH_OUT=local-data/training/branch-245.jsonl BRANCH_COUNT=200 \
  SELFPLAY_SEEN=local-data/training/seen-index.txt npx tsx scripts/branch-selfplay-245.ts
#    ★分岐の出力を再び BRANCH_IN に入れることはできない (再生の突合が必ず外れる)
#    ★分岐生成は clean の**前**の生棋譜に回す (clean はサンプルを間引くので、
#      間引かれた棋譜では ply0 からの再生が成立しない)

# 3) clean を**ラベルの前に**回す (千日手除外 + 重複除去。ラベル代を約 28% 節約)
#    ★CLEAN_IN には「新規生成 + 分岐 + 旧教材の**生ファイル**」を全部並べる。
#      - 分岐の親が入っていないと、親が学習・枝が検証に散って検証が甘くなる
#        (encode が `⚠ N family は分岐棋譜だけで親が居ません` と警告する)
#      - **過去に clean 済みの出力 (labeled-clean-D5.jsonl 等) は再利用しない**。
#        familyId を刻む前に間引かれているので、枝が持つ親の鍵と一致しない
CLEAN_IN=local-data/training/snap-selfplay.jsonl,local-data/training/gen-245.part0.jsonl,...,local-data/training/branch-245.jsonl \
  CLEAN_OUT=local-data/training/corpus-clean.jsonl \
  npx tsx scripts/clean-training-245.ts

# 4) ※ラベル付け (深さ4・カード展開あり)。8 ワーカーの取り合い方式
#    local-data/run-label-claim.sh (入力・出力名を差し替えられる版)
#    進捗: npm run label:progress  (LABEL_WATCH=60 でダッシュボード)
#    ★本番前に必ず小さな入力で通し検証する (3 試合 × 3 局面 / DEPTH=2 なら 1 分):
#      LABEL_IN_FILE=... TAG=probe-claim WORKERS=2 DEPTH=2 bash local-data/run-label-claim.sh
#      実際にこれで「初回実行 (既済成果ゼロ) では既済一覧が作られず全ワーカーが即死する」
#      不具合を見つけた。ログは >> 追記・wait は正常に返るので、気付かないまま
#      「1 日回したのに 0 件」になりうる。ランチャ側で
#        (a) 既済ゼロなら空の一覧を置く (b) 採点 0 件なら止まる
#      を入れて対処済み。

# 5) ワーカー出力を結合 (重複排除・レシピ混在チェック)
MERGE_IN=<part を列挙> MERGE_OUT=local-data/training/labeled-new.jsonl \
  MERGE_EXPECT_IN=local-data/training/corpus-clean.jsonl npx tsx scripts/merge-labeled-245.ts

# 6) 特徴へ変換 (レシピ一致を assert・採点率を .meta.json へ記録)
ENCODE_IN=local-data/training/labeled-new.jsonl ENCODE_OUT=local-data/training/features-new.jsonl \
  ENCODE_BOOTSTRAP=1 npx tsx scripts/encode-training-245.ts

# 7) 学習 → 判定 (val MSE では判断しない)
npx tsx scripts/train-245.ts
npx tsx scripts/diag-cardgap-245.ts     # ①カード行動診断
npx tsx scripts/bench-learned-245.ts    # ②速度
#    ③実機 (Preview) → ④対戦勝率 scripts/winrate-245.ts の順で判定する
```

**多様性の達成指標** (生成物に対して測る): 初手の種類数 / 完全同一棋譜 0 件 /
0-15 手帯の他局一致率 / posKey ユニーク率。段4 パイロットでは初手 2 → 7 通り、千日手 1 → 0 だった。

**判定 (段7 の最後) で気を付けること**:
- **カード行動診断の局面は新教材から採る**。既存の 7 シナリオ (`makeScenarios`) は
  すべて開始局面の流用 (`{...initial, moveCount: 50}` の盤面は初期配置) で実戦を代表しない。
  過去にこれで「gap=0 だから棋力低下ゼロ」と誤判定し、実機で改悪が発覚した。
- **勝率ハーネスのデッキが 1 種**。教材は 6 種のデッキで生成するので、
  評価も少なくとも `piece_return` / `check_break` / `double_move` を含む構成で回さないと、
  「学習したが使ったことのないカード」の判断品質を測れない。

---

## 5. コスト見積り

| 項目 | 見積り |
|---|---|
| 実装 (段 1〜6.5) | 8〜10 日 |
| 教材生成 | 1〜2 日 |
| ラベル付け (新規) | 8 並列で 1〜2 日 |
| ラベル付け (旧 229 局の付け直し) | 8 並列で 19〜23 時間 |
| 学習 | 5 分 |

実測単価: **深さ5 ラベル = 21.5 秒/局面 = 0.62 CPU 時間/局** (8 並列で約 5 分/局)。

---

## 6. 検証の最終判定

- **val MSE では判断しない** (過去 2 回の誤読源。しかも新旧でラベル定義が違うので比較不能)
- 判定は **①カード行動診断 → ②速度 bench → ③実機 (ユーザー) → ④対戦勝率** の順
- 多様性の達成指標: 初手の種類数 / 0-15 手帯の他局一致率 / posKey ユニーク率 / 完全同一棋譜件数
- ラベルの達成指標: **同一盤面・別手札グループのラベル一致率が、同一スクリプト・同一キーで測った
  before (move-only) から有意に下がること**。`scripts/diag-label-cards-245.ts` が before/after を
  同時に出す。キーは「盤面+持駒+手番+マナ」と「マナ無視」の 2 通りを併記する
  (一致率がキーで 63%↔93% と大きく動くため、単一の絶対値をゲートにしない)。
  **§1.2 の 57.3% は再現不能ゆえ参照値にしない**。
- **段2 の構造的上限 (⑤ の母集団とは別枠)**: 手札が違うグループのうち **15〜19% は
  「非手番側の手札だけ」が違う** (実測: 348-D5 で 17.9%、clean-D5 で 18.7%、診断の間引き後は 15.2%)。
  root は手番側しかカードを展開しないので、この帯は段2 では原理的に 1cp も動かない。
  ★ただし ⑤ の測定母集団は「手番側の手札が違うグループ」に限定されているので、
  **⑤ の数字からこの割合を差し引くのは誤り**。この上限は「段2 でも触れない領域が別にある」という
  事実の記録であり、恒久解は deep node のカード展開 (段2 スコープ外)。
