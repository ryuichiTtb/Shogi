# Issue #245 Stage 2 P2-2b 実装計画: 学習評価の本検証 (勝率 + カード行動 + 速度)

> 本書は Stage 2 設計 ([issue-245-stage2-learned-eval-design.md](./issue-245-stage2-learned-eval-design.md)) の **§6 P2-2b** を実装レベルまで具体化したもの。
> P2-2a ([issue-245-p2-2a-winrate-harness.md](./issue-245-p2-2a-winrate-harness.md)) で作った勝率ハーネスを **実際に回して測る** 段。
> 着手前 rule-8 M1 レビュー (単一 general-purpose agent / Issue #109、実コード照合) の対象。
> production は `useTurnActionSearch` / `useLearnedEval` 二重 flag OFF で無回帰据置。**本段は src を原則触らない** (新スクリプト + 計測に閉じる)。

---

## 0. 一言サマリ (初心者向け)

- **やること**: 学習評価 (50 局 bootstrap で訓練した NN) が **本当に賢くなったか** を、値でなく **振る舞い** で確かめる。3 つ測る:
  1. **カード行動診断** (新規・速い・情報量大): Stage 1 で正体を突き止めた *over-valued 局面* (「飛車の前の歩を戻す」を `pieceSafety` が +85 と過大評価する) で、学習評価がその手を **ちゃんと低評価するか** を測る。
  2. **速度ベンチ** (既存 `bench-learned-245.ts`): NN 推論で先読みがどれだけ浅くなるか。
  3. **対戦勝率** (既存 `winrate-245.ts` = P2-2a): 学習 AI vs 安定版 AI を N 局対戦させ勝率を数える。**cutover 可否の主指標**。
- **賢い進め方**: ① と ② は **数秒〜数分** で終わり信号が濃い。③ は **数時間** かかる。だから **①② を先に回して go/no-go を判断**し、有望なときだけ ③ の長時間計測に踏み込む (無駄な数時間を避ける)。
- **落とし穴回避**: (a) 主指標は **勝率 + カード行動**。val MSE では判断しない (PoC で 2 回だまされた)。(b) *1 つの fixture だけ* で「直った」と宣言しない (S4e の轍) → 診断は既知 fixture **+ 実データからサンプルした多数局面の分布** で測る。(c) 現モデルは 50 局訓練の小物 → 負け/五分でも「bootstrap 無効」か「データ不足」か切り分けられない → **段階的にデータを増やして再測する判断フロー** を用意する (§6)。

---

## 1. 目的・成功条件

### 目的
P2-2a のハーネスと新設のカード行動診断・既存速度ベンチを使い、学習評価の cutover 可否を **勝率 + カード行動** で判定する。「投資 (本番 348 局フル生成 = D=4 で 12〜15h 級) してよいか」の go/no-go をデータで下す。

### このタスク単体の完了条件
1. **カード行動診断スクリプト** を新設し、over-valued 局面 (既知 fixture + 実データ多数局面) で「学習評価が card 手を move より低評価するか」の gap を hand-eval / learned-eval で比較出力できる。
2. **速度ベンチ** (既存) と **勝率ハーネス** (既存) を回し、depthCompleted/nps と勝率 (draw 2 扱い + 先後内訳 + NN 呼出数) を取得できる。
3. 上記 3 計測の結果を集約し、cutover 判断 (§6 判定フロー) を下せる材料を揃える。
4. full gate (lint/typecheck/test:ci/build) 緑。production 二重 flag OFF で byte 不変 (新規は診断スクリプト + テストのみ、src 改変なしを目標)。
5. #109 疎結合・デッドコード無し。診断は `findBestMove` 直呼び (bench と同型) で src 非改変。

> 注: 「本番 348 局フル生成」と「cutover 実配線 (route→engine)」は **P2-3** の仕事。P2-2b は **測って判断材料を出す** まで + 有望時の次アクション定義まで。

---

## 2. 現状のコード事実 (実コード確認済み)

| # | 事実 | 出典 |
|---|---|---|
| D1 | `findBestMove(state, player, options, variant, ctx, cardState)` は `RootSearchResult` を返し、world 経路 (`ctx.useTurnActionSearch`) では `rootActionScores?: {action, score}[]` が **root 全 action (move/card/draw) の深読みスコア** で埋まる | `search.ts:542-553,1346,1382` |
| D2 | `rootActionScores` は **engine (`findBestMoveWithStats`) の `FindBestMoveResult` には露出していない** (`move/action/stats` のみ)。診断は search 層の `findBestMove` 直呼びで取得する | `engine.ts:534-538` |
| D3 | `bench-learned-245.ts` は `findBestMove` を `createSearchContext({useTurnActionSearch,useLearnedEval,selectorK})` で直呼びし src 改変なしで学習 eval を起動する既存前例。診断はこのパターンを踏襲 | `scripts/bench-learned-245.ts:40-52` |
| D4 | over-valued 局面 (Stage 1 で特定): ①**初期局面 + pawn_return 手札** で現 hand-eval は playCard を最善視 (特性化テスト) ②手作り tactic 局面 `placePawnReturnTactic` (飛の利きを塞ぐ自歩 + 標的金) | `search-world.test.ts:433-452,386-398` |
| D5 | 過大評価の駆動項 = `pieceSafety` +85 (飛筋開放で相手歩を「タダ取り可能」と読む浅い 1 手検知、飛の深入りリスクを見ない)。cardDigest はむしろ −7 = カード加点でなく盤面評価の浅さ。手作り係数では直せない = Stage 2 が本丸 | `issue-245-tobe-eval-selector.md:190` |
| D6 | `evaluateLearned(state, cardState)` は先手絶対視点 cp を返す。人手 `evaluate(state, variant, cardDigest)` と同一視点・同一スケール規約 (P1 で符号統一) | `infer.ts:56-83` / `diag-learned-245.ts:114-115` |
| D7 | 勝率ハーネス `winrate-245.ts` は env で `WINRATE_MODEL/PAIRS/DIFFICULTY/OPPONENT(control|bolt-on)/MODE(depth|time)/MAXDEPTH/MS`。NN 呼出 > 0 と model ロードを assert 済 | `scripts/winrate-245.ts:37-43,99-129` |
| D8 | 診断の入力にできる実局面: `local-data/training/*.jsonl` (labeled-small=自己対戦 bootstrap ラベル付き、human-245=人間対局)。`parseTrainingRecordLine` (`jsonl.ts:14`) で record を parse し、`boardState` は GameState キャスト、`cardState` は **serialize 形式ゆえ `deserializeCardState()` (`cards/state.ts:75`) で復元** (diag-learned が同パターン) | `diag-learned-245.ts:56-70,107-115` |
| D9 | 保全モデル: `model-bootstrap-small.json` (50 局 bootstrap α0.5, hidden32) 主、`model-outcome-small.json` (outcome baseline) 副。いずれも featureDim 2478 | `local-data/training/` |

---

## 3. 三計測の設計

### 3.1 カード行動診断 (新規 `scripts/diag-cardgap-245.ts`) — 最速・最情報

**測るもの**: 各局面で world 探索の `rootActionScores` を取り、
- `bestMoveScore` = move アクション中の最大スコア
- `bestCardScore` = playCard アクション中の最大スコア
- `gap = bestCardScore − bestMoveScore` (>0 = カードが最善視される = 過大評価の疑い)
を **hand-eval (useLearnedEval OFF)** と **learned-eval (ON)** の 2 モードで算出し比較する。

**対象局面 (S4e「1 fixture」轍回避 = D4/D5)**:
1. **既知 over-valued fixture 2 種** (初期局面 + pawn_return / `placePawnReturnTactic`): 現 hand-eval で gap>0 (card 最善) を確認 → learned-eval で **gap が下がる / 負に転じる** かを見る (= 過大評価解消の直接検知)。
2. **実データ多数局面** (D8): `labeled-small.jsonl` 等から **card アクションが打てる局面** (手札非空 + マナ足りる) をサンプルし、hand/learned 各モードで gap 分布 (平均 gap、card 最善割合 = gap>0 の割合) を出す。learned が hand より **card 最善割合を下げる**なら「無意味カードを減らす」方向の広い証拠。

**出力 (M1 反映=誤検知切り分け)**: gap 単独でなく **構成要素 `bestMoveScore` / `bestCardScore` を hand/learned 両モードで併記**する。これにより「learned が pieceSafety 過大評価を直して card を下げた」のか「learned が card 全般を一律過小評価して鈍っただけ (別種の劣化)」のかを、move 側スコアの動きと合わせて切り分けられる (M1 誤検知シナリオ①)。fixture 別 (hand {bestMove,bestCard,gap} / learned {…} / 最善 action kind の変化) + 実データ集計 (N 局面、hand の card 最善割合 [gap>0] vs learned、平均 gap 差、平均 bestMove/bestCard の move-side 差)。

**符号・視点の前提 (M1 MINOR-1、最重要)**: `rootActionScores[].score` は `-negamaxWorld(...)` = **着手側 (手番プレイヤー) 視点**であり「先手絶対 cp」ではない (`search.ts:1314/1322/1324`)。ただし `gap = bestCardScore − bestMoveScore` は **同一 `findBestMove` 呼出・同一 root ノード内**の 2 スコアの差ゆえ両者の手番視点が揃い、後手番局面でも gap の符号は「その手番プレイヤーにとって card が move より良いか」を正しく表す。→ **実データ複数局面の集計は "その手番から見た gap" のまま平均・カウントしてよい (絶対視点への符号反転変換は不要、むしろ誤り)**。hand/learned 2 モードは **同一 state・同一 cardState・同一 player** で呼ぶ限り比較は健全。

**実装**: `bench-learned-245.ts` と同型で `findBestMove` 直呼び (D2/D3、src 非改変)。ctx を `useLearnedEval` false/true で 2 本作り同一局面 (同一 state/cardState/player) に適用。決定論 (`addNoise:0, nearEqualThreshold:0`, `maxDepth` 固定)。**`timeLimitMs` は maxDepth 固定探索が早期 break (`findBestMoveWorld` の `timeLimitMs*0.55`, search.ts:1268) に掛からないよう十分大きく取る** (テスト `TACTIC_OPTIONS`=60000ms 準拠、M1 NIT-3)。深さは fixture が過大評価を出す最小 (D=4〜5)。

**fixture① の sanity 前提確認 (M1 MINOR-2)**: 初期局面 + pawn_return が「hand-eval で playCard 最善」なのは engine 経由 (`findBestMoveWithStats`, blunder guard/selector 込み) で観測された事実。診断は `findBestMove` 直呼び (selector 全展開・engine 後処理なし) で測るため経路が違う。→ **診断 ctx でも初期局面 fixture① が hand-eval で gap>0 を出すことをまず実測確認**し、起点局面が崩れていないこと (= 元から card 最善) を担保してから learned と比較する。gap>0 が出なければ fixture① は診断の起点として機能しない (別 fixture / tactic 局面を主に据える)。

> **解釈の限界 (明記)**: 「learned が card gap を下げる」は *必要条件* であって *十分条件ではない* (どの局面で card が真に悪いかの ground truth は無い。card 全般を鈍らせただけでも gap は下がる = 上記構成要素併記で切り分ける)。ゆえに **最終判定は勝率 (§3.3)**。本診断は「50 局モデルが正しい方向に動いたか」の **速い前段スクリーニング**。

### 3.2 速度ベンチ (既存 `bench-learned-245.ts`)

`BENCH_MODEL=local-data/training/model-bootstrap-small.json BENCH_MS=2000 BENCH_RUNS=3` で NN ON/OFF の depthCompleted/nps 比を取得。P1 実測 (nps ~81%) の再確認 + hidden32 の現モデルでの depth 低下量を確定。**cardOrderKey precompute の NN 化増分** (設計 §9 MINOR-3) にも留意し、world 経路の実効 depth を記録。

### 3.3 対戦勝率 (既存 `winrate-245.ts` = P2-2a) — 主指標

- **相手**: (主) `control` = same-engine (探索同一・評価だけ人手) / (副) `bolt-on` = 現行 production。
- **難易度**: `advanced`/`expert` を主 (addNoise≈0 = ノイズ最小 = 少ない N で有意)。
- **モード**: (a) `depth` (同 maxDepth = 評価純粋比較) を主、(b) `time` (同時間 = 実運用、速度ハンデ込み) を副。
- **N**: まず 2N=100〜200 局規模。draw 率 d で「勝率[除外]」の有効 N は (1−d)×2N に目減り → draw 多ければ増やす。スコア率[0.5] も併記。
- **実時間の見積り** (§7 で実測較正): depth=4 の 1 ペア (2 局) の所要から 2N の総時間を外挿。長時間 (数時間規模) が確実なら **①② の結果を見てから** 投資判断 (§6)。

---

## 4. 統計・信頼性 (P2-2a §4 継承)

- 真の勝率 55%(vs50%) を有意水準 5%・検出力 80% で見抜くには片側 ~2N≈250 局規模、60% なら ~130 局規模。draw の目減りを見て 2N を上積み。
- **非決定性** (P2-2a §3.6): deck shuffle / addNoise / Zobrist がプロセス毎 `Math.random`。単一プロセス + 統計吸収で対処 (完全 seed 決定論は別段)。デッキ運は色 swap で相殺されず N に委ねる。
- **健全性モニタ**: val MSE (bootstrap 0.2116 < outcome 0.4590) と符号正解率 (`diag-learned-245.ts`) は **モニタのみ**。判定には使わない。

---

## 5. 実装物 (最小・src 非改変目標)

| 物 | 種別 | 内容 |
|---|---|---|
| `scripts/diag-cardgap-245.ts` | **新規** | §3.1 のカード行動診断。`findBestMove` 直呼び (src 非改変)。fixture 2 種 + 実データサンプルの gap 比較 |
| `src/lib/shogi/training/__tests__/` (診断純粋部があれば) | 新規/任意 | gap 算出ロジックを純粋関数に切り出せる部分はユニット化 (ダミー rootActionScores で分岐検証)。過剰なら診断スクリプト内に留める |
| 既存 `winrate-245.ts` / `bench-learned-245.ts` | 流用 | 改変なしで実行 |
| 本計画書 + 計測結果ログ | doc | 結果を `docs/plans/` or 会話に記録 |

> **src 改変が必要になった場合** (例: `rootActionScores` を engine に露出したい): その必要性・無回帰論証を M1/M2 で明示し `?? undefined` 等で production 不変を保つ。**現設計では findBestMove 直呼びで src 改変ゼロを目標**とする。

---

## 6. 判定フロー (50 局モデルの鶏卵問題への対処)

計測後、以下で go/no-go を決める:

```
[①カード行動診断] learned が既知 over-valued fixture で gap を下げる (card→move へ)?
   ├─ NO  → 50 局 bootstrap は核心 (pieceSafety 過大評価) を直せていない。
   │         勝率の長時間計測に進む前に **データを増やす** (bootstrap ラベル局を段階増 → 再訓練 → 再診断)。
   │         val MSE が良くても診断が動かなければデータ/ネット/ラベルを iterate。
   └─ YES → [②速度] depth 低下が許容内 (探索が実用に耐える)?
              └─ YES → [③勝率] control 比 depth モードで勝率 ≥ baseline (五分以上)?
                         ├─ 勝ち越し + カード行動改善 → **本番フル生成 (P2-3) へ go** (投資前バックアップ必須)
                         ├─ 五分       → データ不足 or bootstrap 限界の切り分け:
                         │                bootstrap ラベル局を段階増 (例 50→150→350) して勝率再測し、
                         │                単調改善なら「データ不足」= 増やす価値あり。頭打ちなら手法見直し。
                         └─ 負け越し    → 現手法 (bootstrap α0.5/hidden32) では不利 → 設計 §8 の
                                          α・hidden・ラベル定義を iterate (val MSE はモニタに留める)。
```

- **① が主スクリーニング** (速い・核心に直結)。① NO なら ③ の数時間投資は無駄 → データ増を先行。
- **③ が cutover の最終ゲート** (P2-2a の単一情報源方針)。
- **本番 348 局フル生成 (12〜15h)** は ①②③ が揃って初めて着手。**着手前に学習データ (自己対戦 411 局 + モデル) のバックアップ** (現状ローカル単一ディスクのみ、`Math.random` 依存で再生成不可)。

---

## 7. 実時間較正 (計測前に確定)

- `winrate-245.ts PAIRS=1 depth D=4 control advanced` の所要を実測し 2N の総時間を外挿 (本計画着手時にバックグラウンドで計測)。
- depth モードは CPU 速度非依存の探索深さ固定ゆえ 1 手あたりノード数 × 手数 × 2N。time モードは 2s/手 × 平均手数 × 2N の下限 (探索 overhead 込み)。
- 較正値を本節に追記し、③ の N と実行可否 (overnight 化するか) をユーザーと確認する。

---

## 8. テスト計画

- 診断ロジックを純粋関数化できる部分 (gap 算出 = rootActionScores → {bestMove,bestCard,gap}) は **ダミー配列でユニット化** (card 無し/move 無しの端境、gap 符号)。
- 既存 `search-world` / `winrate` / `world-kernel-equivalence` テスト緑維持。src 非改変ゆえ無回帰は構造的。
- スクリプトは tsconfig include で typecheck 対象。

---

## 9. リスク (#109 観点)

- **性能/計算量**: 全てオフライン計測 (production 非経路)。診断・bench は数秒〜数分、勝率は 2N×探索 budget (§7 較正)。ホットパス影響なし (P2-2a の NN カウンタ `++` のみ)。
- **保守性/疎結合**: 診断は `findBestMove` 直呼びで src 非改変、専用スクリプトに閉じる。
- **デグレ**: src 改変ゼロ目標 → 無回帰は構造的。改変が必要なら二重 flag + `?? default` + route 未伝播で保証し M2 で論証。
- **UI/UX/モバイル**: 該当なし (オフライン CLI)。
- **誤判定の穴**: (a) 1 fixture 宣言の轍 → 実データ分布併用 (§3.1)。(b) silent fallback → NN 呼出 assert (ハーネス既装)。(c) 小サンプル → §4 の N 設計 + draw 目減り。(d) 鶏卵 → §6 の段階増データ判断フロー。
- **外部通信/機密**: Neon read でも都度確認・接続文字列スクラブ。`local-data/` 非追跡 (snapshot 必須)。

---

## 10. スコープ外 (後続段)

- **P2-3**: 本番 348 局フル生成 (overnight, D=4, 投資前バックアップ) + cutover (route→engine の `useLearnedEval` 活性化) + **M3 マージ前レビュー**。
- **データ段階増による再訓練**: ① NO / ③ 五分のとき (§6)。bootstrap ラベル局を増やし再 encode/train/診断。
- **RNG 注入による完全 seed 決定論**: 影響大につき別段。

---

## 11. M1 レビュー反映 (2026-07-04、単一 general-purpose agent / Issue #109、実コード照合)

**判定: APPROVE_WITH_NITS** (BLOCKER/MAJOR なし)。前提事実 D1〜D9 は全て実コードで裏取り CONFIRMED (D8 のみ文言精緻化)。設計 3 本柱 (カード行動診断・速度 bench・勝率) は #235/PoC の轍 (1 fixture 誤判定・val MSE 依存・小サンプル・flag 非対称交絡) を構造的に回避と評価。src 非改変目標も `findBestMove` 直呼びで達成可能と確認 (診断は engine の `worldPathActive` ゲートを経由せず自前で world 分岐 `search.ts:567` + `evalLeafWorld` の NN ゲート `useLearnedEval && hasLearnedModel()` `search.ts:898` を ctx 切替で駆動、P2-2a の engine 配線に非依存)。以下を反映済 (コード設計変更なし・文言追記レベル):

| # | 指摘 | 反映先 |
|---|---|---|
| MINOR-1 | `rootActionScores[].score` は着手側視点 (先手絶対 cp でない)。gap は呼出内相対ゆえ手番視点のまま集計してよい (絶対視点変換は誤り) | §3.1「符号・視点の前提」 |
| MINOR-2 | 初期局面 fixture① が診断 ctx (findBestMove 直呼び・selector 全展開) でも hand-eval gap>0 を出す sanity を実測確認してから learned 比較 | §3.1「fixture① の sanity 前提確認」 |
| 誤検知① | learned が card 全般を鈍らせただけでも gap は下がる → 出力に `bestMoveScore`/`bestCardScore` を gap と併記し move 側の動きで切り分け | §3.1「出力」 |
| NIT-1 | cardState は `parseTrainingRecordLine` の戻り値そのままでは serialize 形式 → `deserializeCardState` で復元 | §2 表 D8 |
| NIT-3 | maxDepth 固定探索が `timeLimitMs*0.55` 早期 break に掛からぬよう timeLimitMs を十分大きく | §3.1「実装」 |
| NIT-2 | gap 純粋関数のユニット化で card 無し/move 無しの端境と符号を網羅 (既記載) | §8 (実装時に網羅確認) |

**結論**: 上記反映により P2-2b の実装 (診断スクリプト `scripts/diag-cardgap-245.ts` 新設 + gap 純粋関数ユニット、src 非改変) に着手可。

---

## 12. 実測結果 (2026-07-04、model-bootstrap-small = 50 局 bootstrap α0.5 hidden32)

### 12.1 カード行動診断 (`diag-cardgap-245.ts`、D=4、`findBestMove` 直呼び)

**fixture (既知 over-valued)**:

| fixture | hand-eval | learned-eval | 判定 |
|---|---|---|---|
| tactic (飛前歩戻し) | cardGap **+141** / top=playCard | cardGap **0** / top=**move** | ✅ 過大評価解消 (card→move 反転) |
| 初期局面 + pawn_return | cardGap +2 / top=playCard | cardGap 0 / top=move | ✅ 同上 |

**実データ分布 (labeled-small=自己対戦、card-playable 3030 局面から N=60 サンプル、stride 50)**:

| 指標 (scale 不変=符号系) | hand | learned |
|---|---|---|
| card 選好割合 (cardGap>0) | 11.7% | **10.0%** (ほぼ同等) |
| draw 選好割合 (drawGap>0) | 8.3% | 8.3% (同一) |
| top=card 局面数 | 7/60 | 6/60 (ほぼ同等) |
| 平均 bestMoveScore (scale 参考) | 988.6 | 1448.0 (別 scale) |

> ★N=12 の予備測定では card 選好 16.7%→33.3% と「learned が card 好き」に見えたが、**N=60 で 11.7%→10.0% に収束 = N=12 は小サンプルのノイズ**だった (1 fixture/小 N で宣言しない設計の実証)。

**診断の結論**: 学習評価 (50 局) は **① 既知の over-valued fixture (pieceSafety +85 の飛前歩戻し) を的確に低評価** し、**② 一般局面のカード使用率は hand とほぼ同等** (dumbing-down でもなく card 好きでもない中立)。→ M1 誤検知①「card 全般を鈍らせただけ」は **否定** (learned は選択的)。狙い通りの限定的改善だが、一般局面のカード選好が「正しい」かの ground truth は無く、**優劣の最終判定は勝率が必須** (診断は前段スクリーニングの役目を果たした)。

### 12.2 速度・実時間の現実 (勝率スコープの再検討が必要)

- **depth=4 のフル対局は 1 対局 7.5 分超** (control 相手・advanced、1 ペア=2 局が 28 分でも未完)。1 局面 depth-4 world 探索 ~7〜14s。
- → 勝率 depth モードは N=50 ペア (100 局) ≈ **12h 級**、N=100 ペア ≈ **24h 級** = 本番フル生成と同格の overnight 投資。
- **methodology 選択肢** (勝率実行前にユーザー確認): (a) depth モード N 小 + overnight、(b) **time モード短予算** (例 500ms/手 → 1 局 ~2 分、N=50 ペア ~3h、ただし NN 速度ハンデ込み)、(c) depth=3 (浅いが速い)。診断が modest-positive ゆえ、**まず (b) time モード中規模で粗い勝率を取り、有望なら (a) で精密化**が費用対効果良。

### 12.3 次アクション (§6 判定フローの現在地)

診断 ① = YES (fixture 解消)、一般局面中立。→ ② 速度は許容 (nps 実測は §3.2 bench で別取り)。→ **③ 勝率が未取得 = cutover 可否は未確定**。50 局モデルの鶏卵問題ゆえ、勝率が五分/負けでも「bootstrap 無効」か「データ不足」か切り分け要 (§6)。**ユーザー判断待ち = 勝率 methodology (12.2) + 50 局モデルのまま測るか先にデータ増か**。
