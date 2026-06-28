# Issue #245 Stage 2 設計: 学習評価 (search-score bootstrapping)

> 本書は ToBe 設計 ([issue-245-tobe-eval-selector.md](./issue-245-tobe-eval-selector.md)) の **Stage 2 (評価をひとつの学習ものさしへ)** の実装設計である。
> Stage 1 (足切り廃止、完了・HEAD `f2cab29`) の調査で「カード乱用の真因は盤面評価 (pieceSafety) の浅さ」と判明し、Stage 2 が本丸であることが裏づけられた。
> **実装は別セッションで引き継ぐ前提** (本セッションのコンテキスト逼迫のため)。実装着手前に rule-8 M1 レビュー (単一 general-purpose agent / Issue #109) を経ること。route flag / `useLearnedEval` は検証完了まで **OFF 据置** (production 無回帰)。

---

## 0. 一言サマリ (初心者向け)

- **やること**: World 探索の「末端の局面採点 (リーフ評価)」を、人手の数式から **学習した NN** に差し替える。
- **なぜ今これが本丸か**: Stage 1 の調査で、AI のカード乱用 (無意味な歩戻し等) の原因は「カードへの下駄」ではなく **盤面評価 `pieceSafety` の浅さ** (1 手先しか見ず「タダ取りできる」と誤評価) だと判明。手作り係数では直せない → **学習評価が本丸**。
- **どう賢くするか (PoC の教訓を踏まえた肝)**: 教材の「答え」を **「最後の勝敗」だけ → 「先読みした評価値 (search-score)」も使う** に変える (= search-score bootstrapping)。深く読めば「飛車が深入りして捕まる」が見えるので、その深い結論を NN に教え込めば、浅い過大評価が消える。
- **測り方**: 賢くなったかは **AI 同士の対戦勝率 + カード行動チェック** で測る (勝敗予測の正解率では測らない = PoC で 2 回だまされた罠)。

---

## 1. 背景: Stage 1 の発見と PoC の教訓

### 1.1 Stage 1 の発見 (Stage 2 の動機)
- カード乱用の真因 = `pieceSafety` (駒のタダ取り検知) の **1 手先しか見ない浅さ**。例: 飛車の前の歩を card で戻すと飛筋が開き「相手の無防備な歩をタダ取りできる (+85)」と評価するが、取りに行く飛車が敵陣で捕まるのを見ていない (ToBe doc §10)。
- これは手作り係数では綺麗に直せない (塞ぐと別局面で副作用)。= 学習評価で「深く読んだ結論」を一目で言えるようにするのが筋。

### 1.2 PoC (フェーズ1 P1-0〜P1-4) の教訓
- **パイプライン全段は動作実証済**: encoder → feature-export → 純TS MLP 学習 → infer → evalLeafWorld 差込 → diag/bench。
- **速度は de-risk 済**: NN 疎パス推論は人手比 ~81% nps (致命的でない)。
- **outcome ラベル (最終勝敗) のみの学習は人手評価と互角・終盤は人手が上** (349 試合の信頼測定)。= **「学び方 (信号の濃さ)」が次のレバー**。データ量だけ増やしても頭打ち。
- **罠**: 小サンプルの符号正解率・val MSE で「賢くなった」と判断すると外す (gap=0 / 保留 5 試合錯覚)。**強さは対戦勝率で測る**。

---

## 2. ゴールと成功条件

**ゴール**: World 探索のリーフ評価を学習 NN へ差し替え、**カードの結果を正しく価値判断できる**ようにする (pieceSafety 的な浅い過大評価が消える)。

**成功条件 (= cutover してよい判定)**:
1. **対戦勝率**: 学習評価 AI が 安定版 (人手評価) AI に対し、多数局で **勝率 ≥ baseline (50%)**、できれば有意に上回る。
2. **カード行動**: Stage 1 で見つけた over-valued 局面 (飛車前の歩戻し等) で、学習評価が **その手を正しく低評価**する (= 無意味カードを選ばなくなる)。診断 fixture で確認。
3. **速度**: NN 推論込みで depthCompleted が許容内 (棋力ゲート)。PoC 実績 ~81% nps。
4. **無回帰**: `useTurnActionSearch` / `useLearnedEval` 二重 flag OFF で production (bolt-on) byte 不変。

---

## 3. 中核アイデア: search-score bootstrapping

### 3.1 何を変えるか
- **旧 (PoC)**: 教材の各局面に「最後どっち勝った (z∈{+1,0,−1})」だけを答え (label) として学習。信号がうすい。
- **新 (Stage 2)**: 各局面に **「その局面を深さ D まで読んだ backed-up 評価値 (search-score)」** を答えとして学習 (回帰)。深い読みが「タダ取りに行った飛車が捕まる」等を解決済みゆえ、浅い過大評価が label から排除される。

### 3.2 なぜ pieceSafety を直すか (具体)
- 「飛車前の歩戻し」後の局面を World 探索で深さ 4〜6 読むと、飛車が歩を取りに深入り→捕まる線が見え、backed-up score は静的 +85 でなく現実的な値に下がる。
- この search-score を label に学習させると、NN は「この形は実は良くない」を一目で出すようになる → over-valuation 解消。

### 3.3 循環への対処 (bootstrapping の罠)
- search-score を生成する探索は **現 eval (人手 or 前世代 NN) をリーフに使う** ため、評価の系統誤差が自己強化されうる (ToBe doc §7 / M1 n-1)。
- 緩和: (a) **確定値の錨** — 探索が詰みに到達すると ±MATE の確定 label が混じり全体を正す (§3.4 の squash で ±1 に飽和させ、混合比 α に依らず錨として効かせる)。(b) **outcome との混合** — §3.4 の cp 空間で混合してから squash。(c) **対戦勝率での歯止め** — 自己強化で歪んでも勝率が下がれば検知 (§3.5 の iteration ゲートで毎回測る)。
- α (混合比) と探索深さ D は §8 の決定論点。

### 3.4 ラベルのスケール統一 (★M1 BLOCKER 反映)
**問題 (M1 実コード照合)**: NN 出力は `tanh(z2) ∈ [-1,1]` (mlp.ts:103)、学習 target は MSE で `diff = y − label` (train.ts:103) ゆえ **label は [-1,1] でなければ tanh が飽和し勾配 `(1−y²)` が消失して学習が破綻**する。一方 search-score は cp (材料 ±数百〜詰み ±90000)、outcome は z∈{+1,0,−1}。**3 者のスケールが不整合**ゆえ §3.3 の素朴な `α×search-score + (1−α)×outcome` (cp と {−1,0,1} を直接加算) は成立しない。
**設計 (確定)**: **cp 空間で混合してから tanh で [-1,1] へ squash** する。
1. `outcome_cp = z × CP_REF` (z∈{+1,0,−1} を cp 重みへ。起点 CP_REF ≈ CP_SCALE=1000 = 「勝勢 ≈ +1000cp」)。
2. `mixed_cp = α × search_score_cp + (1−α) × outcome_cp`。
3. `label = tanh(mixed_cp / CP_SCALE) ∈ [-1,1]` (squash 温度 = CP_SCALE=1000、infer の `y × CP_SCALE` (infer.ts:69) と 0 近傍で逆写像が一致)。
**なぜ mix→squash の順序か (squash→mix でない)**: 詰み search-score=±90000 は混合段で `±90000α` と**桁で支配**し、矛盾する noisy outcome を上書きする → squash 後 `tanh(±90000α/1000)≈±1` で **確定値が α に依らず ±1 に錨**される (§3.3(a) の数学的実装)。squash→mix だと矛盾 outcome が詰みを希釈してしまう。
**round-trip の含意**: 推論は既存の `y × CP_SCALE` (infer.ts:69) を維持。非詰みの「完全勝勢」leaf は ~±CP_SCALE(=±1000cp) に圧縮されるが、(i) 探索は eval を相対比較 (αβ 順序・futility margin ~300-500cp) で使い、(ii) 真の詰みは探索が終端で `MATE_SCORE` を直接返す (eval 非経由) ため、NN eval の ±1000cp 飽和は実害なし (PoC の outcome-only モデルと同じ挙動)。CP_REF / CP_SCALE は P2-1 の校正対象。

### 3.5 bootstrapping の iteration と停止規約 (★M1 MAJOR 反映)
1 iteration = **(a) label 生成 (現 eval で World 探索、§3.1) → (b) 再学習 (§3.4 の label) → (c) 対戦勝率測定 (§7 ハーネス)**。停止規約:
- 勝率が前 iteration を**有意に下回ったら停止**し前世代モデルを採用 (自己強化で歪んだ合図)。
- 改善が頭打ち (例: 2 回連続で対安定版 勝率改善 < +2pt) で stop。
- 各 iteration の前進は **対戦勝率 + カード行動チェック**で判定 (val MSE は健全性モニタのみ)。iteration ごとに軽量ゲート、cutover 前に M3。

---

## 4. アーキテクチャ (PoC 基盤の再利用 + 変更点)

| 部品 | 再利用 / 変更 |
|---|---|
| `src/lib/shogi/ai/learned/encoder.ts` | **再利用** (盤面+カード状態→疎特徴。train/infer 単一実装=スキューゼロ) |
| `src/lib/shogi/ai/learned/mlp.ts` | **再利用 + 拡張余地** (1 隠れ層 MLP。hidden 拡大は §8 決定論点) |
| `src/lib/shogi/ai/learned/infer.ts` (`evaluateLearned`) | **再利用** (疎パス predictSparse + cp 較正) |
| `src/lib/shogi/ai/search.ts` `evalLeafWorld` | **再利用** (リーフ評価切替の 1 箇所集約。`useLearnedEval && hasLearnedModel()` で NN) |
| `search-context.ts` `useLearnedEval` | **再利用** (二重 flag。production 両 OFF) |
| `feature-export.ts` / `train.ts` / scripts `*-245.ts` | **変更**: label を outcome → **search-score (bootstrapping)** へ (P2-0/P2-1) |

**差し替え点は既に存在する** (`evalLeafWorld`)。Stage 2 の本質は「**label を濃くする (search-score)**」+「必要ならネット拡大」+「測り方を対戦勝率へ」。

---

## 5. データ

- **教材**: `local-data/training/` に保全済 (自己対戦 ~411 局 + 人間 1 局、gitignore)。`snap-*.jsonl` / `snap-model.json` snapshot あり。元データは Neon DB にも。
- **search-score label の生成 (P2-0)**: 各保存局面に対し World 探索 (`findBestMoveWorld` / `negamaxWorld`) を深さ D で走らせ backed-up score を得て label 化。CPU 律速 (局面数 × 探索コスト)。
- **新規自己対戦**: 評価改善後は新 eval で自己対戦を回し直し iterate (フェーズ2 = 定期再学習)。
- ⚠️ `local-data/` は非追跡。再現実験は snapshot 必須 (背景ジョブがファイル mutate)。

---

## 6. 段階分解 (P2-x、各段 full gate + M2、cutover 前 M3)

- **P2-0 search-score label 生成**: 保存局面 → World 探索の backed-up score → §3.4 の squash で label JSONL。**backed-up score の取得点 (★M1)**: `findBestMoveWorld` の `RootSearchResult.bestScore` を直接取得する (engine の `FindBestMoveResult` には backed-up score が無いため、engine 経由でなく search を直接駆動)。`feature-export.ts` / `encode-training-245.ts` は **label 源を outcome→search-score へ差替** (encoder は不変、`winnerToLabel` のコメント/役割を更新)。**deck 順序非依存化 (★M1 MAJOR)**: encoder は山札を枚数のみ符号化し順序を持たない (encoder.ts) ため、search-score が「次に引く札」に依存すると同一 input に複数 label が付き MSE 下限が上がる → label 生成時は **draw を探索木で展開しない or 固定 canonical deck 順** とし「label = 山札順序を marginalize した値」と定義し 1 サンプル 1 値に確定。探索深さ D は label 生成時間を実測して決める小校正を P2-0 内に置く (§8)。
- **P2-1 bootstrapping 再学習**: `train.ts` の回帰 target を §3.4 の squash 済 label (cp 混合→tanh) へ。hidden は §8 の方針 (まず 32 固定で label 濃化の効果を切り分け) に従う。試合単位 train/val 分割・早期停止は踏襲。
- **P2-2a 対戦勝率ハーネス実装 (★M1 MAJOR: 現コードに不在)**: 現 `playOneGame` は単一 `chooseAction` で両手番を指す (selfplay.ts:55) ため A/B 対戦不可。手番別 chooser (senteChooser/goteChooser) を注入できるよう拡張 (or 新ドライバ) + N 局の勝率集計 + **先後入替で先手バイアス除去** + 決定論 seed。これが cutover ゲートの**単一情報源**。`diag-learned-245.ts` (符号正解率) は**健全性モニタへ降格**を明文化。
- **P2-2b 検証 (新しいものさし)**: ① P2-2a ハーネスで対戦勝率 (学習 vs 安定版、N 局) ② カード行動 diagnostic (over-valued fixture で歩戻しを低評価するか) ③ 速度 bench (cardOrderKey precompute の NN 化増分も計測、§9)。**勝率 + カード行動が主、val MSE は健全性モニタのみ**。
- **P2-3 cutover 判断**: ②③ クリア + ①勝率 ≥ baseline なら `useLearnedEval` (+ route flag) 活性化を検討。**M3 マージ前レビュー**。不可なら label/ネット/データを iterate。
- **P2-4 (将来) GPU 投資ゲート**: CPU で頭打ちなら大ネット・大量自己対戦にクラウド GPU (P1-5 の据え置き判断を継承)。

---

## 7. 検証方法 (新しいものさし = 最重要)

- **AI 同士の対戦勝率** 🥇: 学習評価 AI vs 安定版 AI を多数局自己対戦 (`scripts/selfplay-245.ts` の chooser を 2 種 eval で差し替え)、勝率を集計。代用品ゼロの強さ指標。
- **カード行動チェック** 🎯: Stage 1 で特定した over-valued 局面 (飛車前歩戻し = pieceSafety +85) を fixture 化し、学習評価がその手を低評価 / 選ばなくなるかを決定的に確認 (search-world.test.ts の特性化テストが Stage 2 で更新される = 改善の検知点)。
- **速度 bench**: NN 推論込みの nps / depthCompleted (`bench-learned-245.ts`)。
- **使わない指標**: outcome 符号正解率・val MSE 単独での「賢さ」判定 (小サンプル錯覚の罠)。

---

## 8. 主要な決定論点 (ユーザー判断 / 次セッションで詰める)

> M1 レビュアー推奨値は §12 を参照。以下の D / α / ネット規模はユーザーと相談して確定する。混合 α は **§3.4 の cp 空間で混合してから squash** する点に注意 (素朴な加算ではない)。

1. **search-score の探索深さ D**: 浅い (D=2-3) = 安価だが pieceSafety 過大評価が残りうる / 深い (D=5-6) = 質高いが label 生成が高コスト。**推奨**: pieceSafety の horizon を超える D≥4 を起点に bench 校正。
2. **label 混合 α** (search-score vs outcome): pure search-score (循環リスク) ⇔ outcome 混合 (真実の錨)。**推奨**: TD-Leaf 流に α≈0.7 程度から開始し勝率で校正。
3. **ネット規模** (hidden): PoC は hidden32。表現力不足なら拡大 (要データ量・速度トレードオフ)。
4. **学習器**: PoC は純 TS trainer (依存ゼロ・スキューゼロ)。規模拡大時に PyTorch 検討 (パッケージ追加は AGENTS §7 都度確認)。
5. **GPU 投資**: 当面 CPU。頭打ち確認後に判断 (P1-5 継承)。

---

## 9. リスク (#109)

- **label のスケール統一 (★M1 BLOCKER)**: §3.4 で解決 (cp 混合→tanh squash)。未対応だと tanh 飽和・勾配消失で学習破綻 (mlp.ts:103 / train.ts:103)。
- **bootstrapping 自己強化**: §3.3 の確定値錨 + outcome 混合 + 対戦勝率歯止めで緩和。§3.5 の iteration 停止規約で歪みを検知・前世代採用。
- **deck 順序の隠れ状態 (★M1 MAJOR)**: encoder が山札順序を持たない (枚数のみ) ため search-score の deck 依存が label ノイズ → P2-0 で deck 非依存化 (§6)。
- **`MATE_SCORE`(90000, search.ts:49) と infer 終局値(±100000, infer.ts:47) の不一致 (M1 MINOR)**: §3.4 squash で双方 ±1 に飽和し label では実害なし。終端 mate は探索が直接 `MATE_SCORE` を返し eval 非経由ゆえ整合。将来 cp 規約を統一するなら別 chore。
- **速度**: NN 推論が探索を律速。PoC ~81% nps で de-risk 済だが、ネット拡大時に再測。`evalLeafWorld` は探索リーフで多数回呼ばれる (cardOrderKey precompute (search.ts:1257) も Stage 2 で card 枚数ぶん NN 推論になる点に留意、ToBe M2 NIT → P2-2b bench で増分計測)。
- **データ量**: search-score label は outcome より信号が濃いが、局面数が少ないと過学習。試合単位分割 + 早期停止 + データ追加で対処。
- **無回帰**: 二重 flag OFF で production byte 不変 (Stage 1 同様、構造的保証)。`useLearnedEval` 単独 ON でも World 経路が inactive ならリーフ未到達ゆえ実害なし。
- **早合点の罠**: 小サンプル指標で判定しない。対戦勝率で確認してから cutover。

---

## 10. 引き継ぎ (次セッションへ)

- **現在地**: Stage 1 完了 (HEAD `f2cab29`、branch `feature/#245-phase1-plan`、未マージ、route OFF=production 不変)。PoC 基盤 (encoder/mlp/infer/evalLeafWorld/useLearnedEval/scripts) は実装済・動作実証済。教材 ~411 局は `local-data/` に保全。
- **最初の一手**: 本設計の **rule-8 M1 レビュー (単一 general-purpose agent / #109)** → 反映 → **P2-0 (search-score label 生成)** 着手。
- **大きな決定**: §8 の論点 (探索深さ D / 混合 α / ネット規模) をユーザーと詰めてから P2-1。
- **運用上の罠** (継承): `local-data/` 非追跡 (snapshot 必須) / git は main checkout 上で explicit path add (`-A` 厳禁) / **`fix:` プレフィックス厳禁** (auto-close、`Refs #245` のみ) / Neon は外部通信 (§7 都度確認・接続文字列スクラブ) / 各段 full gate (lint→typecheck→test:ci→build) + M2、cutover 前 M3。
- **#245 はエポック → クローズ厳禁**。

---

## 11. 参照

- ToBe 設計: [issue-245-tobe-eval-selector.md](./issue-245-tobe-eval-selector.md) (§10 Stage1a 発見 / §11 Stage1b / §12 deep-node 据え置き)
- フェーズ1 PoC: [issue-245-phase1-learned-eval.md](./issue-245-phase1-learned-eval.md)
- 共通レビュールール: Issue #109
- 主要コード: [`search.ts`](../../src/lib/shogi/ai/search.ts) (`evalLeafWorld` / `findBestMoveWorld`)、[`learned/`](../../src/lib/shogi/ai/learned/) (encoder/mlp/infer/feature-export/train)、[`search-context.ts`](../../src/lib/shogi/ai/search-context.ts) (`useLearnedEval`)、scripts `*-245.ts`

---

## 12. M1 設計レビュー反映 (2026-06-28、単一 general-purpose agent / Issue #109、実コード照合)

**判定 (初回)**: **CHANGES_REQUIRED** (BLOCKER 1 / MAJOR 3 / MINOR 3 / NIT)。方向性 (search-score bootstrapping で pieceSafety 過大評価を排除し、強さを対戦勝率で測る) と差替点 (`evalLeafWorld` 集約・二重 flag・encoder/mlp/infer 再利用) は実コードに接地し正当。ただし下記を反映するまで P2 着手不可と判定 → **本書へ反映済 (再判定 = 着手可)**。

| # | 指摘 | 反映先 |
|---|---|---|
| BLOCKER | NN 出力 `tanh∈[-1,1]` / train MSE / infer `×CP_SCALE` に対し label を cp(±90000) にすると tanh 飽和で学習破綻。§3.3 の `α×search-score+(1−α)×outcome` は次元不整合 | §3.4 (cp 混合→tanh squash、mix→squash 順序、詰み ±1 錨、round-trip) |
| MAJOR-1 | 対戦勝率ハーネスが現コードに不在 (`playOneGame` は単一 chooser、selfplay.ts:55)。検証主指標が絵に描いた餅 | §6 P2-2a (手番別 chooser + 勝率集計 + 先後入替 + seed)、diag を健全性モニタへ降格 |
| MAJOR-2 | encoder が山札順序を持たず (枚数のみ) search-score の deck 依存が label ノイズ | §6 P2-0 (deck 非依存化)、§9 リスク |
| MAJOR-3 | bootstrapping の iteration 回数・停止規約が未定義 | §3.5 (1 iteration 定義 + 勝率歯止め + 頭打ち stop) |
| MINOR-1 | `MATE_SCORE`(90000) と infer 終局値(±100000) 不一致 | §9 (squash で ±1 飽和ゆえ label 実害なし、終端は eval 非経由) |
| MINOR-2 | `winnerToLabel` / `SparseFeatureRow.label` コメントの陳腐化 | §6 P2-0 (差替時にコメント更新) |
| MINOR-3 | cardOrderKey が Stage2 で NN 推論化し card 枚数ぶん増 | §9 / §6 P2-2b bench で増分計測 |

**§8 決定論点へのレビュアー推奨値** (ユーザーと相談して確定する材料):
- **探索深さ D**: **D=4〜5 推奨**。pieceSafety horizon は 1 手 (ToBe §10)。これを超え、World 経路の実効深さ (#235 bench advanced ≈5.1、TT 有) と整合する 4〜5 が「pieceSafety を見抜くに十分かつ label 生成が現実的」。D≥6 は局面数×指数で重い → **D は label 生成時間を実測して決める小校正 (P2-0 内) を推奨**。
- **混合 α (§3.4 の cp 混合比)**: **α≈0.5〜0.7 起点**。α=1 (pure search) は循環リスク最大、α=0 (outcome のみ) は PoC で頭打ち実証済。データ ~411 局と少なく循環が効きやすいので **outcome 錨を厚め (α≈0.5) から開始**し対戦勝率で ±0.2 校正。**必ず cp 空間で混合してから squash** (§3.4)。
- **ネット規模 (hidden)**: **まず hidden=32 据置で label 濃化のみの効果を切り分け**、頭打ち確認後に 64→128。入力 ~2478 次元・~411 局では容量拡大は過学習側。label と容量を同時に動かすと原因切り分け不能 (train-245.ts は `TRAIN_HIDDEN` env で可変ゆえ拡大は容易)。
