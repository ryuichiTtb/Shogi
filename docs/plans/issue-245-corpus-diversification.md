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

- `playCard` は deck に触れない (`world-kernel.ts:374-418`) ので**新たな山札依存を生まない = TT 安全**。
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

### 段 1: ラベル基盤の健全化 (0.5 日)
**目的**: 新旧レシピのラベルが 1 ファイルに混ざる事故を構造的に防ぐ。

- `TrainingGameData` に `labelMeta {version, depth, expandCards, expandDraw}` を optional 追加し、ラベル出力時に刻む
- `labelKeyHash` に recipe ハッシュを混ぜる (recipe が違えば既済扱いにならない)
- `evaluatePositionWorldMoveOnly` が depth 1 未完了時に 0 でなく **null** を返すようにし、
  スクリプトは searchScore 未設定で書く (嘘ラベルの排除)
- `encode-training-245.ts` で全入力の labelMeta 一致を assert

**検証**: 旧 recipe で human 1 局を再実行し searchScore が既存出力とバイト一致 (recipe 追加が値を変えない pin) /
recipe を変えた 2 回目で再採点されること / null 返しの単体テスト。

### 段 2: ラベル探索の root カード展開 (1 日) ★本丸
- `getWorldLegalActions(world, variant, expandCards, expandDraw = expandCards)` に分離
- ラベル専用エントリ `evaluatePositionWorldWithCards` を新設 (root のみ expandCards=true / expandDraw=false)
- noise / nearEqual / 打ち切り は持ち込まない (`findBestMoveWorld` を流用しない)
- 既存 `evaluatePositionWorldMoveOnly` は A/B 対照として残す

**検証**: 既定引数追加で既存テスト全緑 (挙動不変 pin) / カードアクション 0 件の局面で新旧のラベルがバイト一致 /
20-30 局面 microbench (ms/局面・depthCompleted、+10〜20% 見込み、2 倍超なら設計見直し) /
**手番別ラベル平均差**を計測 (root だけカード展開すると手番側に下駄が乗る = #235 P1 と同型のリスク)。

### 段 3: 多様化コア (純粋モジュール、1 日)
`src/lib/shogi/training/diversify.ts` を新設。

- `actionKey(action)`: move=type/from/to/promote/dropPiece、playCard=defId+target (instanceId は除く)、draw='d'
- `positionKey(gameState, cardState)` = encoder 入力のハッシュ (clean と同一式)
- `SeenIndex` = `Map<posKey, Map<actKey, count>>` + serialize/load
- `pickDiverseAction(candidates, seen, opts, rng)`: best からの cp margin と上位 topN で絞り、
  **count 昇順の最小層から mulberry32 で一様抽選** (ハード ban にせず最小層抽選に一本化 = 枯渇しない)

**検証**: 単体テストで「未出手があれば必ず未出が選ばれる / 全既出でも最小 count が選ばれる /
同 seed で再現する / instanceId 違いが同一キー / 手札順違いが同一 posKey」を pin。

### 段 4: engine の候補スコア素通し + 自己対戦の多様化配線 + 10 局パイロット (2 日)
- `FindBestMoveResult` に `rootActionScores?` を**加算のみ**で追加 (route の応答には載せない)
- selfplay chooser を **world 経路** (`useTurnActionSearch:true`) へ切替、難易度は advanced/expert 固定
  (難易度ノイズは rootActionScores 確定後の後付けなので、乱数を我々の抽選に一本化する)
- 多様化ラッパ: rootActionScores が無ければ素通し (早期 return 対策、必須)
- `scripts/build-seen-index-245.ts`: 既存教材から posKey/actKey 行ファイルを 1 回だけ生成
  (131MB を毎回 parse しない)。並列ワーカーはこのファイルを共有し追記する

**検証**: 10 局パイロットで手数・終局理由・カード使用率・depthCompleted を現行と比較 /
初手が 2 通りでなく分散 / 同一棋譜 0 件 / フォールバック発生率。

### 段 5: 分岐生成 (リプレイ方式、2〜3 日) ★中終盤の網羅
- `replayToPly(record, targetPly)`: 行動列を再生し、各 ply で `serializePosition` を突合
- `playOneGame` に `initialWorld?` / `maxAdditionalMoves?` を optional 追加 (既存呼出は無改変で通る)
- `scripts/branch-selfplay-245.ts`: **層化抽出** (序盤 0-39 / 中盤 40-99 / 終盤 100+)。
  終盤は 1 本が短いので本数を厚く。同一親からの採用は k=2〜3 本まで
- ガード: status active / 合法アクション 2 以上 / doubleMove===null / 突合一致

**検証**: 既存 5 局のリプレイで全 ply が一致 / 既存テスト全緑 /
20-30 本の小規模生成で finalStatus 分布 (active draw が増えていないこと)・posKey 重複率。

### 段 6: デッキ多様化 (0.5 日)
`piece_return` / `check_break` を含む複数構成のプールから局ごとに抽選。

**検証**: perf-bench で depthCompleted が棋力ゲートを割らないこと (check_break の valueModel は
自玉 8 近傍の利き計算を伴うのでコスト増の可能性) / 5 局試行で該当カードが実際に手札・盤上に現れ、
encoder の該当次元が非ゼロになること。

### 段 6.5: double_move の教材対応 (1〜2 日、ユーザー決定で追加)
**現状の破壊**: selfplay の chooser は `world.doubleMove` を engine に渡していない
(`FindBestMoveOptions` に口が無い)。二手指し継続中 (`turnEnded=false`, `movesLeft=2`) に再度
呼ばれた engine が通常ターンと誤認して playCard/draw を返すと、`applyPlayCardAction` が
`doubleMove:null` を返して**二手指し状態が黙って消える**。さらに `buildTrainingSample` が
doubleMove を保存しないので、1 手目のサンプルが通常局面と区別できない。

- `FindBestMoveOptions` に `doubleMove` を追加し、chooser から渡す
- `buildTrainingSample` / `TrainingSampleData` に doubleMove 状態を保存
- encoder に二手指し継続フラグを足すかは別途判断 (featureDim 変更 = 既存モデルと非互換)

**検証**: 二手指しを含むデッキで 10 局生成し、二手指しが黙って消える棋譜が 0 件であること。

### 段 7: 本生成 → clean → ラベル → encode → 学習 → 検証
- 生成 (通常 + 分岐、ワーカー間で SeenIndex 共有)
- **clean をラベルの前に**回す (3 フィルタとも searchScore 非依存 = 約 28% のラベル代を先に落とす)
- 新レシピで一括ラベル (取り合い方式 + done-keys)。**旧 229 局も新レシピで付け直す** (ユーザー決定)
- encode: familyId があれば同 family に同じ gameIndex を振り val リークを防ぐ
- train → **勝率 (control 比) + カード行動診断 + 実機**で判定 (**val MSE では判断しない**)

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
- ラベルの達成指標: **同一盤面・別手札グループでラベルが割れる割合が 57.3% 一致から下がること**
