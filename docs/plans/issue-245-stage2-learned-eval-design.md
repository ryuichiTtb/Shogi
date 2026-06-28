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
- 緩和: (a) **確定値の錨** — 探索が詰みに到達すると ±MATE の確定 label が混じり全体を正す。(b) **outcome との混合** — label = `α × search-score + (1−α) × game-outcome` (TD-Leaf 流、outcome が真実の錨)。(c) **対戦勝率での歯止め** — 自己強化で歪んでも勝率が下がれば検知。
- α (混合比) と探索深さ D は §8 の決定論点。

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

- **P2-0 search-score label 生成**: 保存局面 → World 探索で backed-up score → label JSONL。`feature-export.ts` / `encode-training-245.ts` を search-score 対応へ拡張。探索深さ D・label 混合 α は仮値で開始し §8 で校正。
- **P2-1 bootstrapping 再学習**: `train.ts` の回帰 target を search-score (±outcome 混合) へ。hidden 拡大を試す。試合単位 train/val 分割・早期停止は踏襲。
- **P2-2 検証 (新しいものさし)**: ① AI 同士の対戦勝率ハーネス (学習 vs 人手、N 局) ② カード行動 diagnostic (over-valued fixture で歩戻しを低評価するか) ③ 速度 bench。**勝率 + カード行動が主、val MSE は健全性モニタのみ**。
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

1. **search-score の探索深さ D**: 浅い (D=2-3) = 安価だが pieceSafety 過大評価が残りうる / 深い (D=5-6) = 質高いが label 生成が高コスト。**推奨**: pieceSafety の horizon を超える D≥4 を起点に bench 校正。
2. **label 混合 α** (search-score vs outcome): pure search-score (循環リスク) ⇔ outcome 混合 (真実の錨)。**推奨**: TD-Leaf 流に α≈0.7 程度から開始し勝率で校正。
3. **ネット規模** (hidden): PoC は hidden32。表現力不足なら拡大 (要データ量・速度トレードオフ)。
4. **学習器**: PoC は純 TS trainer (依存ゼロ・スキューゼロ)。規模拡大時に PyTorch 検討 (パッケージ追加は AGENTS §7 都度確認)。
5. **GPU 投資**: 当面 CPU。頭打ち確認後に判断 (P1-5 継承)。

---

## 9. リスク (#109)

- **bootstrapping 自己強化**: §3.3 の確定値錨 + outcome 混合 + 対戦勝率歯止めで緩和。
- **速度**: NN 推論が探索を律速。PoC ~81% nps で de-risk 済だが、ネット拡大時に再測。`evalLeafWorld` は探索リーフで多数回呼ばれる (cardOrderKey precompute も Stage 2 で NN 推論になる点に留意、ToBe M2 NIT)。
- **データ量**: search-score label は outcome より信号が濃いが、局面数が少ないと過学習。試合単位分割 + 早期停止 + データ追加で対処。
- **無回帰**: 二重 flag OFF で production byte 不変 (Stage 1 同様、構造的保証)。
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
