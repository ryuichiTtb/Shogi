# Issue #245 Stage 2 P2-2a 実装計画: 対戦勝率ハーネス

> 本書は Stage 2 設計 ([issue-245-stage2-learned-eval-design.md](./issue-245-stage2-learned-eval-design.md)) の **§6 P2-2a** を実装レベルまで具体化したもの。
> 着手前 rule-8 M1 レビュー (単一 general-purpose agent / Issue #109、実コード照合) の対象。
> production は `useTurnActionSearch` / `useLearnedEval` 二重 flag OFF で無回帰据置。

---

## 0. 一言サマリ (初心者向け)

- **作るもの**: 「学習評価を積んだ AI」と「人手評価の AI」を **実際に何十局も対戦させ、勝率を数える** オフライン計測スクリプト。
- **なぜ**: Stage 2 が成功か (= 本番投入 = cutover してよいか) の判定は、val MSE でなく **対戦勝率** で下すと決めた (§7、PoC で 2 回だまされた反省)。その勝率を測る道具が現コードに無い。
- **落とし穴を避ける肝**: ① 相手は「探索方式まで同じで評価だけ人手」に揃える (same-engine control) ② モデルが読めていない時に「引き分け 50% = 合格」と誤判定しない ③ 先手/後手を入替えてバイアスを消す。

---

## 1. 目的・成功条件

### 目的
学習評価 AI と対戦相手 AI を N 局対戦させ、**勝率 (+ 引分率)** を決定的・公平に集計するスクリプトを新設する。これが cutover ゲート (設計 §6 P2-3) の **単一情報源**。

### このタスク単体の完了条件
1. 学習 eval AI (World 探索 + `useLearnedEval` ON) vs 対戦相手を N 局対戦し、勝率を集計・出力できる。
2. **先後入替**でバイアス除去 (同条件で色 swap したペア対局)。
3. **モデルが実際にロードされ NN が呼ばれた**ことをアサート/カウントし、silent fallback による誤 PASS を構造的に防ぐ。
4. full gate (lint/typecheck/test:ci/build) 緑。production 二重 flag OFF で byte 不変。
5. スクリプトは #109 の疎結合・デッドコード無し・最小改変で `playOneGame` を再利用。

> 注: 「実際に勝率がいくつなら cutover」の**判定と測定 (対戦実行)** は次段 **P2-2b** の仕事。P2-2a は**測る道具の実装**まで。

---

## 2. 現状のコード事実 (実コード確認済み)

| # | 事実 | 出典 |
|---|---|---|
| C1 | `playOneGame(opts)` は単一 `chooseAction: (world, player) => TurnAction \| null` を注入。手番別分岐は **chooser 側で `player` を見れば無改変で可能** | `src/lib/shogi/training/selfplay.ts:22,36,55` |
| C2 | 既存実例: `selfplay-245.ts` の `difficultyFor(player)` が chooser 内で `player` 分岐して手番別難易度を実現 | `scripts/selfplay-245.ts:42-54` |
| C3 | `PlayOneGameOptions` に **seed / RNG 注入口なし**。`createInitialCardState(opts.deckSpec)` を内部直呼び (デッキ shuffle は内部の `Math.random`) | `selfplay.ts:24-33,44` |
| C4 | `FindBestMoveOptions` に `useTurnActionSearch` は **有る**が **`useLearnedEval` は無い**。`createSearchContext` 呼出にも未伝播 | `src/lib/shogi/ai/engine.ts:147-187,246-259` |
| C5 | `worldPathActive = useTurnActionSearch && card-shogi && cardState!=undefined`。学習 eval AI は必然的にこの world 経路 | `engine.ts:240-243` |
| C6 | `CreateSearchContextOptions` / `SearchContext` には `useLearnedEval` が既に有る (P1-3 で追加済) | `src/lib/shogi/ai/search-context.ts:82,113,135` |
| C7 | `evaluateLearned` はモデル未ロードで **throw** (防御的)。ただしリーフ側 `evalLeafWorld` は `hasLearnedModel()` ガードで人手 eval に **サイレントフォールバック** | `infer.ts:44-54` / `search.ts` `evalLeafWorld` |
| C8 | `loadLearnedModel(serialized)` はプロセス内シングルトンへ注入。パス解決はスクリプト責務 | `infer.ts:27-32` |
| C9 | 勝敗: `maxMoves` (既定 `SPECTATOR_MAX_MOVES`=200) 到達で `winner="draw"` | `selfplay.ts:37,65` |
| C10 | 探索の非決定性: deck shuffle / `addNoise`・`nearEqualThreshold` (難易度別ノイズ) / Zobrist 鍵のプロセス毎 `Math.random` 初期化 | 前回 Workflow 検査 (search.ts / zobrist.ts) |

---

## 3. 実装設計

### 3.1 方針: `playOneGame` は無改変、合成 chooser で A/B (C1/C2)

新スクリプト `scripts/winrate-245.ts` を新設。`playOneGame` に **手番別に分岐する合成 chooser** を渡す:

```
const chooser: ChooseAction = (world, player) =>
  (player === senteSide ? senteChooser : goteChooser)(world, player);
```

`senteChooser` / `goteChooser` は「学習 eval AI」または「対戦相手 AI」のいずれか。**src (`selfplay.ts`) は改変しない**。

### 3.2 唯一の src 改変: engine に `useLearnedEval` を配線 (C4)

`FindBestMoveOptions` に `useLearnedEval?: boolean` を追加し、`createSearchContext({ ..., useLearnedEval: options.useLearnedEval ?? false })` を 1 行足す。

- **無回帰論証**: production route (`ai-move/route.ts`) は本フラグを渡さない → `?? false` で従来通り。`SearchContext.useLearnedEval` 既定 false (search-context.ts:135) と二重化。`evalLeafWorld` は `useLearnedEval && hasLearnedModel()` の両真でのみ NN 分岐 (C7) ゆえ、production では未ロード×flag OFF で完全不変。
- これは cutover (P2-3) でも route→engine 配線として結局必要になる先行工事。
- **既存 bench との対比 (M1 MINOR-2)**: `bench-learned-245.ts:44-50` は `findBestMove` を直呼びし `ctx` に `useLearnedEval`/`useTurnActionSearch` を直接立てて **src 改変なしで**学習 eval を起動できる (代替手段は実在する)。だが winrate ハーネスは blunder guard / openingBook / fallback / bestAction 抽出を含む **production 相当の指し手強度**で対戦させないと勝率の現実味が損なわれる。ゆえに `findBestMoveWithStats` 経由を選び、engine への 1 行配線を必然とする。

### 3.3 chooser 2 種と「対戦相手」の定義 (§7 の交絡回避)

学習 eval AI chooser:
```
findBestMoveWithStats(world.gameState, player, difficulty, CARD_SHOGI_VARIANT, {
  cardState: world.cardState,
  useKernelSearch: true,
  useTurnActionSearch: true,   // world 経路 (C5)
  useLearnedEval: true,        // 3.2 で配線
  spectator: true,
})
```

対戦相手は **2 種を用意し引数で選ぶ** (交絡を分けて測るため):
- **(主) same-engine control**: 上と同じだが `useLearnedEval:false`。= **探索方式は同一、評価だけ人手**。「学習評価そのものの寄与」を測る。#235 PoC-1 M1 の BLOCKER (flag OFF/ON 非対称交絡) と同型の罠を避ける正道。
- **(副) production bolt-on**: `useTurnActionSearch:false`(+`useLearnedEval` 無)。= 実運用の現行 AI。「実運用差分」を測る。

> **学習 eval はリーフ値だけでなく root カード順序付け (`cardOrderKey`, search.ts:1257) も駆動する (M1 MINOR-1)。**しかし same-engine control との差は「リーフ値」も「順序付け」も**同一 eval 関数由来**ゆえ交絡は eval に閉じる (順序付けは eval から決定論的に導出)。よって same-engine control は「評価関数の差」を正しく分離できる。

> どちらを主指標にするかは §7 のユーザー決定事項。設計 §2 成功条件①の「安定版 (人手評価) AI」は **same-engine control を主**とし bolt-on を副とする、を推奨として提示する。

### 3.4 silent fallback 誤 PASS 対策 (C7、最重要)

`evalLeafWorld` はモデル未ロードだと **無警告で人手 eval に落ちる**。この状態で学習 AI vs same-engine control を測ると **実質同一 AI 同士** = 勝率≈50%(引分多) となり「勝率≥50% ゲート」を誤 PASS する。対策:
1. スクリプト起動時に `loadLearnedModel(model)` 後 `hasLearnedModel()===true` を **assert** (false なら即 fail・exit≠0)。
2. **NN 推論回数カウンタ**を `evaluateLearned` (or 疎パス) に仕込み、対局後に「学習側の総 NN 呼出 > 0」を assert。0 なら「学習経路が一度も通っていない」= 設定ミスとして fail。
   - 実装案: `infer.ts` に `getInferenceCount()/resetInferenceCount()` を追加 (production 未使用ゆえ無害。カウンタは module-local number のインクリメント = ホットパス影響は分岐なしの `++` のみ)。**過剰計装を避け、bench でも流用**。
   - **置き場 (NIT-2)**: `evaluateLearned` は終局局面 (checkmate / 非 active) で NN を呼ばず早期 return する (infer.ts:46-49)。カウンタを「実 NN forward 回数」にするため、早期 return より後・`predictSparse` 呼出直前 (infer.ts:68) でインクリメントする。

### 3.5 先後入替ペア対局 + 勝率集計 + draw 扱い (C9)

- **ペア対局**: 1 ペア = 「学習 AI 先手/相手後手」1 局 + 色を swap した 1 局。先手勝ちバイアスを除去。N ペア (= 2N 局)。
- **集計**: 学習 AI の {勝, 負, 分} をカウント。**draw の扱いは 2 通り出力**して解釈を分けない: (i) 勝率 = 勝/(勝+負) [draw 除外]、(ii) スコア率 = (勝 + 0.5×分)/全局。両方をログに出す (§7 で主指標をユーザーが選べる)。
- 出力: JSON/表で {N ペア, 学習 勝/負/分, 先手時・後手時内訳, NN 呼出総数, 平均手数, draw 率}。

### 3.6 決定論の限界と単一プロセス方針 (C3/C10)

- **完全な seed 決定論は現状不可** (deck shuffle・addNoise・Zobrist が `Math.random`、いずれも注入口なし)。**src へ RNG 注入する改修は本タスクのスコープ外** (playOneGame/buildDeck/zobrist への RNG 引数追加は影響大 → 別段で判断)。
- 現実的方針: **単一プロセスで N ペアを回し、統計 (N を十分大きく) でノイズを吸収**。プロセス分割 (shard) は Zobrist 鍵がプロセス毎初期化で探索条件が揃わないため**使わない**。
- 難易度によりノイズ量が違う (expert/advanced は addNoise≈0、beginner は tadasute guard 等) 点を出力に注記。**測定は advanced/expert を主**とする (ノイズ最小 = 少ない N で有意)。
- **デッキ運は色 swap で相殺されない (M1 MINOR-4)**: デッキは sente/gote 独立に shuffle され上位 2 枚が初期手札 (state.ts:19-23,48-52)。§3.5 のペア対局 (色 swap) は**手番バイアスのみ**相殺し、手札内容・deck 先頭 (draw 価値に効く) の「デッキ運」は同一ペア内でも 2 局で別配列ゆえ相殺されず、N の統計吸収に委ねる。→ §4 の N 見積りはこれを前提とする。
- **設計 §6「seed」要求との相互参照 (M1 MINOR-3)**: 設計正本 `issue-245-stage2-learned-eval-design.md` §6 P2-2a は「決定論 seed」を要件に挙げるが、本段は上記の単一プロセス + 統計吸収で代替し、`playOneGame`/`buildDeck`/`zobrist` への RNG 注入による完全 seed 決定論は影響大につき別段 (§9) へ繰り下げる。M2/M3 で「設計要件未達」と誤読しないための明示。

---

## 4. 統計設計 (§7 主指標の信頼性)

- **必要 N の目安**: 二項で真の勝率 55%(vs 50%) を有意水準 5%・検出力 80% で見抜くには片側 **~2N≈250 局規模**。50%→60% なら ~2N≈130 局規模。**まず 2N=100〜200 局を目安**とし、勝率が 50% 近傍なら N を増やす運用 (P2-2b で実測)。
- **draw による有効 N の目減り (NIT-1)**: 「勝率 [draw 除外]」を主指標にすると、draw 率 d のとき有効試合数は (1−d)×2N に目減りする。将棋 (特に互角の A/B) は draw が出やすいので、draw が多ければ 2N を上積みする。スコア率 [0.5] 指標はこの目減りを受けない。
- **50 局モデルの鶏卵問題** (§9/引き継ぎ): 現モデルは 50 局訓練。負けても「bootstrap 無効」か「データ不足」か切り分け不能。→ **P2-2b で「負け or 五分」なら本番フル生成 (348 局) 前に段階的にデータを増やして再測**する判断フローを P2-2b 計画に置く (本タスクはハーネス実装のみ)。

---

## 5. 公平性: 同時間 vs 同 depth (§9 速度リスク)

- NN 推論は人手比 ~81% nps → 同 time budget だと学習側が浅くなり「評価改善が探索深さ低下と相殺」しうる。
- **両条件で測れるようにする**: (a) 同 time budget (production 現実)、(b) 同 maxDepth (`FindBestMoveOptions.maxDepth`、評価純粋比較)。スクリプト引数で切替。速度そのものは P2-2b の bench (`bench-learned-245.ts`) で別途 nps/depthCompleted を測る。

---

## 6. テスト計画

- **ユニット (test:ci)**: (a) 合成 chooser が `player` で正しく分岐する (ダミー chooser 2 種で手番別採用を検証)。(b) `getInferenceCount` が evaluateLearned 呼出でインクリメントし reset で 0 に戻る。(c) engine `useLearnedEval` 配線: fixture モデルロード時に world 経路で NN 経路を通る / 未ロード or flag OFF で人手 eval のまま (byte 不変) を特性化。
- **無回帰**: 既存 `world-kernel-equivalence` / `search-world` テスト緑維持。production route が両 flag OFF である特性化を追加検討。
- **スクリプト自体は tsconfig include (`**/*.ts`) で typecheck 対象** (前回検査確認)。

---

## 7. 未決事項 (ユーザー判断 → M1 後に確定)

1. **主指標**: same-engine control (評価差) を主・bolt-on を副 — で良いか (推奨: Yes)。
2. **draw 扱い**: 勝率 [draw 除外] とスコア率 [0.5] の**両方出力**で良いか (推奨: Yes、解釈は P2-2b)。
3. **公平性条件**: 同 time budget と同 depth の**両方**を回すか、まず片方か (推奨: まず同 depth で評価純粋比較 → 同 time で実運用確認)。
4. **NN 呼出カウンタの置き場**: `infer.ts` に計装 (推奨) で良いか。

---

## 8. リスク (#109 観点)

- **性能/計算量**: 本タスクはオフライン計測 (production 非経路)。ホットパス影響は NN 呼出カウンタの `++` のみ (分岐なし)。対局 N の実行時間は探索 budget×2N — advanced/expert 主・単一プロセスゆえ overnight 未満の見込み (P2-2b で実測)。
- **保守性/疎結合**: `playOneGame` 無改変・合成 chooser・engine 配線 1 箇所。専用スクリプトに閉じ、production から分離。
- **デグレ**: engine の `useLearnedEval` 追加は `?? false` + 二重 flag + route 未伝播で無回帰。test:ci で特性化。
- **UI/UX/モバイル**: **該当なし** (オフライン CLI、描画・アニメ・音源なし)。
- **デッドコード/マジックナンバー**: N・maxDepth・time budget は引数/env 化。カウンタ API は bench でも流用し死蔵しない。
- **誤判定の穴**: §3.4 の二重 assert (ロード + NN 呼出 > 0) が最大の防御。fixture 1 種で「カード行動改善」を宣言する S4e の轍は **P2-2b で rootActionScores gap 併用**により回避 (本タスク範囲外だが申送り)。

---

## 9. スコープ外 (後続段)

- **P2-2b**: 本ハーネスで実際に対戦を回し勝率を測る + over-valued fixture のカード行動診断 (rootActionScores gap) + 速度 bench + cutover 可否の判定フロー (50 局→段階増データ)。
- **P2-3**: cutover (route→engine の `useLearnedEval` 活性化) 判断、M3 マージ前レビュー。
- **RNG 注入による完全 seed 決定論**: 影響大につき別段で要否判断。

---

## 10. M1 レビュー反映 (2026-07-04、単一 general-purpose agent / Issue #109、実コード照合)

**判定: APPROVE_WITH_NITS** (BLOCKER/MAJOR なし)。前提事実 C1〜C10 は全て実コードで裏取り CONFIRMED (C7 のみ出典行番号を `search.ts:898` へ精緻化)。設計の 3 本柱 = ①`playOneGame` 無改変 + 合成 chooser ②engine への `useLearnedEval` 1 行配線 (route 未伝播 `route.ts:200-233` + `?? false` 二重ガードで無回帰) ③silent fallback 二重 assert — いずれも実コードに接地。#235 の「flag 非対称交絡」「小サンプル誤 PASS」の轍を避ける設計と評価された。以下の MINOR/NIT を本書へ反映済 (コード設計変更なし・1 文追記レベル):

| # | 指摘 | 反映先 |
|---|---|---|
| MINOR-1 | 学習 eval は root カード順序付け (`cardOrderKey`, search.ts:1257) も駆動するが交絡は eval に閉じる旨を明記 | §3.3 (same-engine control 論証の完全化) |
| MINOR-2 | 既存 `bench-learned-245.ts:44-50` の `findBestMove` 直呼び (src 改変なし学習 eval 起動) を代替として認め、production 相当強度ゆえ engine 配線を選ぶ必然性を補強 | §3.2 |
| MINOR-3 | 設計 §6「seed」要求と本段スコープ外判断の相互参照 (M2/M3 の誤読防止) | §3.6 |
| MINOR-4 | デッキ運は色 swap で相殺されず統計吸収に委ねる旨を N 見積り前提として明記 | §3.6 |
| NIT-1 | draw 率 d で勝率[除外]の有効 N が (1−d)×2N に目減り | §4 |
| NIT-2 | NN 呼出カウンタは終局 early return より後・`predictSparse` 直前 (infer.ts:68) に置く | §3.4 |
| NIT-3 (任意) | flag OFF/ON で depthCompleted 桁が破綻しない smoke 特性化 | §6 実装時に検討 |

**結論**: 上記反映により P2-2a の実装コミットに着手可。実装の唯一の src 改変は engine への `useLearnedEval` 配線 1 箇所 (+ `infer.ts` の呼出カウンタ)、他は新スクリプト `scripts/winrate-245.ts` + テストに閉じる。
