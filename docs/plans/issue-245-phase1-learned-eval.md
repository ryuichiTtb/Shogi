# Issue #245 フェーズ1 実装計画: 学習型評価エンジン(PoC・実現性検証)

> 本書は「ユーザーが読んで**学習方式を決める**ための設計書」である(handoff 方針: 私が計画を起草 → ユーザーが方式決定)。
> 各オープン論点に **選択肢 + 推奨 + 根拠** を併記し、最後に「ユーザー判断が必要な論点」へ集約する。
> 着手はユーザーの方式決定後。本書自体は rule-8 の M1 レビュー(単一 general-purpose agent / Issue #109 観点)を経てから実装に進む。

---

## 0. 一言サマリ(初心者向け)

- **やりたいこと**: AI が局面を採点する「ものさし」を、いまの**人手で書いた数式**から、**対局データで鍛えたニューラルネット(NN)**に置き換える。
- **なぜ**: 人手の数式では「カードを正しい場面で正しく使う」価値を測りきれず、無駄なカード使用(過剰ドロー / タダ取りされる歩打ち / 打った歩の駒戻し)が残った(#235 実機確認)。「使わせる(forcing)」は改悪だったので撤去済み。**正しい評価で自律判断**させるのが本筋。
- **どうやる**: #235 で作った **World 探索(カード込みの先読み)はそのまま土台に使い**、その「末端の局面採点」だけを学習した NN に差し替える。
- **フェーズ1のゴール**: いきなり本番投入ではなく、**小さく作って「本当に賢くなるか」「速度は足りるか」を検証(PoC)**する。お金(クラウド GPU)は**見込みが立ってから**使う。

---

## 1. 前提・現状(フェーズ0 完了時点 = origin/main `c7ba936`)

### 1.1 土台になる #235 World 探索

- **探索本体**: [`src/lib/shogi/ai/search.ts`](../../src/lib/shogi/ai/search.ts) の `findBestMoveWorld` / `negamaxWorld` / `quiescenceWorld`。カード状態 (`WorldState.cardState`) を全ノードで帯同する card-aware な alpha-beta + quiescence + TT(置換表)。
- **リーフ評価(差し替え対象)**: World 探索の末端は **`evaluate(state, variant, cardDigest)`**([`src/lib/shogi/ai/evaluate.ts`](../../src/lib/shogi/ai/evaluate.ts))を呼ぶ。`search.ts` 内に同関数の呼び出しが多数(quiescence stand-pat / leaf / root tie-break 等)。
  - 現状の評価成分: material(+PST)/ hand-value / king-safety / rook-files / piece-safety / promotion-threat / tempo / cardDigest(マナ・手札・トラップ等の数式)。**全て人手係数**。
  - World リーフは **`world.gameState`(盤面)+ `world.cardState`(カード状態の全量)** に常時アクセスできる → **NN 入力に必要な情報は全てその場に揃う**。
- **production の現状**: route flag (`useTurnActionSearch`) は **OFF**。production AI は **安定版 bolt-on 経路**(従来 engine + #235 で入れた eval バグ修正は反映済)。**World 経路は dormant(眠っている)**。
  - → **学習 NN はまず World 経路のリーフ評価に入れる**。production(bolt-on)には触れない = **無回帰が構造的に保証**される(flag OFF のまま検証できる)。

### 1.2 集まっている教材(学習データ)

- **スキーマ**(Neon 適用済): `TrainingGame`(1試合メタ + 勝敗ラベル)+ `TrainingSample`(1決定点 = 盤面 + カード状態 + 採用行動 + events)。[`prisma/schema.prisma`](../../prisma/schema.prisma)。
- **収集経路**:
  - 人間対局の自動キャプチャ([`src/hooks/use-card-shogi-game.ts`](../../src/hooks/use-card-shogi-game.ts)、env `ENABLE_TRAINING_CAPTURE`、Vercel で有効化済)。
  - ヘッドレス自己対戦バッチ([`scripts/selfplay-245.ts`](../../scripts/selfplay-245.ts)、JSONL 出力、動作確認済)。
- **現在量**: 人間 **1試合 / 53サンプル**(実機検証分)。**NN 学習には桁違いに不足** → フェーズ1ではまず**自己対戦で量を作る**のが前提(後述 P1-0)。
- **データ形式**(学習で使う中身):
  - `TrainingSample.boardState` = `serializeBoardForTraining`(盤面 9×9 + 持ち駒 + 手番 + 手数 + 終局状態。moveHistory/positionHistory は導出可能ゆえ除外)。
  - `TrainingSample.cardState` = `serializeCardState`(マナ / 手札 / 山札 / トラップ / no_promote マーク)。
  - `TrainingSample.action` = `TurnAction`(`move` / `draw` / `playCard{defId,target}`)。
  - **勝敗ラベル** = `TrainingGame.winner`(`sente` / `gote` / `draw`)。サンプルへは非正規化せず join で付与。

### 1.3 行動空間・カード(符号化設計の前提)

- 盤面: 標準将棋 9×9。駒種は標準将棋の駒(成り含む)。
- 行動: `move`(駒指し)/ `draw`(ドロー)/ `playCard`(カード使用、`defId` + 任意 `target`)。
- カード: 現状 **7種**(`mana_up` / `pawn_return` / `double_pawn` / `piece_return` / `check_break` / `double_move` / `no_promote`)。[`src/lib/shogi/cards/definitions.ts`](../../src/lib/shogi/cards/definitions.ts)。
- カード状態: マナ(現在値 + 上限、上限は将来動的化想定 [[project_card_mana_cap_dynamic]])/ 手札(defId 多重集合)/ 山札(枚数)/ トラップ(defId)/ no_promote マーク(盤上座標)。

---

## 2. フェーズ1 の目的・成功条件

### 2.1 目的

> **「集めた教材で評価 NN を学習 → World 探索のリーフ評価に差し替え → 人手評価より賢くカードを判断できるか + Vercel 時間内に動くか を検証する」**

NN を「正解の台帳(暗記)」でなく **「初見局面も汎化して採点する頭脳」** として育てる(#245 設計原則)。フェーズ1は**本格化(フェーズ2)の前に、実現性とコスト見込みを確かめる PoC**。

### 2.2 成功条件(= フェーズ1完了の定義)

PoC として、以下を**実測で示せれば成功**(本番常時 ON は別ゲート = M3 / フェーズ2):

1. **パイプラインが回る**: データ export → 符号化 → 学習 → 重み書き出し → TS で読み込み → World リーフで推論、が一気通貫で動く。
2. **賢さの兆候**: #235 で問題化した「無駄カード局面」(過剰ドロー / タダ取り歩打ち / 駒戻し)の代表セットで、**学習 NN 評価が人手評価より妥当な符号・大小**を出す(後述の診断 fixture で測る)。
3. **速度の現実性**: World 探索に NN を挿したとき、**1手の探索が制限時間内に達成する深さ(depthCompleted)が現行 World 比 −N% 以内**(N は難易度別ゲートで定義、#235 の depthCompleted ゲート流儀)で、かつ**Vercel 関数の時間制限(現状 overallTimeoutMs ≈ 24s)内 / 難易度別 timeLimitMs 内**に収まる見込みが立つ(M1 NIT-1)。落ちるなら「どの最適化(WASM / NNUE 増分更新 / 量子化)でどこまで戻るか」を見積もる。
4. **スケール較正**(M1 MAJOR-1): NN 出力が**人手 eval と同じ cp スケール**(または明示的に較正された等価スカラー)で、futility margin / delta pruning / MATE_SCORE 等の cp 前提と整合する。整合しないなら margin 群の再調整がスコープに入る。
5. **無回帰**: production(bolt-on, route OFF)に一切影響しない(二重 flag ガード = `useTurnActionSearch` + `useLearnedEval` 両 OFF)。`npm run lint/typecheck/test:ci/build` 緑。

> ★**重要な期待値調整**: フェーズ1は「**強くなった**」を確定する段ではなく「**この道で強くできる/速度が足りる**という見込み」を得る段。データ量・データ品質(自己対戦は現 AI 強度が上限 = garbage-in 懸念)があるため、PoC で出る棋力は限定的でよい。判断は「**伸びしろと速度のボトルネックが見えたか**」で行う。

---

## 3. オープン論点と設計空間(★ユーザーが方式を選ぶための本体)

各論点に **選択肢 / 推奨 / 根拠** を示す。最終決定は §7 に集約。

### 論点A: 学習方式 — NNUE 寄り vs AlphaZero 寄り

| | A-1: NNUE 寄り(**推奨**) | A-2: AlphaZero 寄り |
|---|---|---|
| 概要 | **現 World 探索(alpha-beta)はそのまま**、リーフの**評価値(value)だけ**を学習 NN に差し替え | 探索を **MCTS** に置換 + **policy(着手確率)+ value** の2出力 NN、自己対戦で強化学習 |
| 既存資産の流用 | ◎ World 探索・TT・quiescence をそのまま使う(差し替えは `evaluate` の1点) | △ 探索を MCTS へ作り直し(World alpha-beta は土台にならない) |
| 学習の容易さ | ◎ 教師あり回帰(局面→勝敗/評価値)1本。小型で済む | △ self-play ループ + policy/value 同時学習 + 大量計算が必要 |
| データ要件 | 中(自己対戦 + 人間棋譜の局面と勝敗) | 大(MCTS 自己対戦を大量に回す前提) |
| 推論速度 | ◎ 小型 NN(NNUE は整数 + 増分更新で超高速)。alpha-beta は評価回数が多いが NNUE 向き | △ MCTS は評価回数を減らせるが NN が大きめ + ロジック複雑 |
| GPU コスト | 小〜中(小型回帰) | 大(self-play 強化学習) |
| 本プロジェクト適合 | ◎ #245 のビジョン(World 探索 + 学習評価)そのもの。#235 の投資が全て生きる | △ 野心的・将来オプション。土台再構築でフェーズが長期化 |
| リスク | 評価のみ学習 = 探索の質は現状依存。だが現探索は #235 で十分機能 | 実装・計算・運用すべて重い。PoC が大掛かりになり「小さく検証」に反する |

**推奨 = A-1(NNUE 寄り / value-only)**。理由: (1) #235 の World 探索基盤を**そのまま土台**にでき投資が生きる、(2) 教師あり回帰1本で**小さく速く検証**できる、(3) 推論速度(最大の山場)に最も有利、(4) #245 のビジョン「World 探索 + 学習評価」に直結。AlphaZero は**フェーズ2以降の将来オプション**として温存(本書 §8)。

> 補足: 「NNUE 寄り」と言っても、PoC の第一歩は **小型 MLP の純 TS forward pass** から始め、速度が足りなければ **NNUE の増分更新 / 整数量子化 / WASM** へ段階的に深掘りする(論点F)。「NNUE 化」は速度最適化の到達点であって、初手の必須要件ではない。

### 論点B: 入力符号化(NN に局面をどう見せるか)

value-only(A-1)なら **policy 用の行動符号化は不要**で、「**リーフ局面を NN 入力ベクトルに変換する encoder**」だけ作ればよい。

- **盤面**: 駒種 × 所有者 × マス の **multi-hot 平面**(将棋 NNUE の標準的な「玉位置 × 駒種 × マス」= HalfKP 系も将来検討可。PoC はまず単純な「駒種×所有者×81マス」one-hot で開始)。
- **持ち駒**: 各駒種の枚数(先手/後手)。
- **カード状態**: マナ(現在/上限)、手札(defId ごとの枚数 = 7次元の count)、山札枚数、トラップ(defId one-hot × 2)、no_promote マーク(盤面平面に 1ch 追加)。
  - ★**要決定(M1 MINOR-4)**: `serializeCardState` は上記に加え **墓地 / ドロー進捗 / 状態異常** も保持する(schema コメント準拠)。これらを NN 入力に含めるかを P1-1 で決める。「導出可能 / 評価に効かない」フィールドは入力から落として次元を絞る(オーダー量・過学習の両観点)。
- **手番**: side-to-move 1bit(または常に「手番側視点」へ正規化)。
- ★**マナ上限の可変前提**(M1 MINOR-4): マナ上限は将来動的化想定([[project_card_mana_cap_dynamic]])。encoder は**固定上限を前提にせず**、現在値/上限を正規化した連続値で持つ(将来の上限変更で再符号化が不要な設計)。
- ★**設計原則**: **encoder は TS で1つだけ書き、学習側(export)と推論側(World リーフ)で共有**する(数式の二重実装による train/inference スキューを構造的に防ぐ)。学習は TS encoder の出力 JSONL を Python が読む形にする。
- ★**正規化**: 評価は「先手絶対視点(正 = 先手有利)」が既存 `evaluate` の規約。NN も同規約に合わせる(または手番側視点 + 符号反転を一貫させる)。#235 で「符号逆」バグを踏んでいるため**符号規約は最重要・テストで固定**。スケール(cp 等価)も同様にテストで固定(M1 MAJOR-1)。

### 論点C: 学習ターゲット(ラベル)

| | C-1: 勝敗(outcome)のみ(**PoC 推奨**) | C-2: 探索スコア(bootstrapping) | C-3: 併用 |
|---|---|---|---|
| ラベル | `TrainingGame.winner` を局面へ付与(z ∈ {+1,0,-1}、先手視点) | World 探索の評価値を教師に蒸留 | outcome + 探索スコアの加重 |
| 長所 | **いま持っているデータでそのまま学習可**。実装最小 | 密な信号で学習が安定・速い | 両者の良さ |
| 短所 | 信号が疎(1試合=1ラベル)・ノイズ大 | 教師が現 eval 品質に縛られる(天井が現 eval) | 実装やや増 |

**推奨 = C-1(outcome のみ)で PoC 開始**。理由: 既存スキーマ(`winner`)で即学習でき**最小実装**。信号の疎さは自己対戦で**局面数を稼いで**緩和。フェーズ2で C-3(探索スコア併用 = AlphaZero 流の value target 強化)へ拡張する余地を残す。

### 論点D: ネット構造・規模

- **PoC**: 小型 MLP(入力 → 隠れ 256〜512 × 2層程度 → スカラー value)。**まず小さく**(速度・過学習の両面)。
- **将来(速度が課題なら)**: NNUE 型(feature transformer = 大きな疎入力を低次元へ + 小さい dense + **増分更新** + **int8 量子化**)。
- 重みの**配布形式**: 学習(Python)→ 重みを **JSON or バイナリ**で書き出し → TS が読み込み(リポジトリ同梱 or 後日 DB/CDN)。サイズは小型なら数十 KB〜数 MB。

### 論点E: 学習環境・費用(ユーザー GPU 非保有)

| | E-1: 無料 CPU で PoC(**推奨・第一歩**) | E-2: クラウド GPU |
|---|---|---|
| 用途 | 小型 NN × 小データの実現性確認 | 本格学習・大量自己対戦(フェーズ2) |
| 費用 | **0 円** | 従量(学習の都度) |
| 妥当性 | 「見込みが立つまで無料」= ムダ金回避 | **PoC が有望と判明してから**着手 |

**推奨 = E-1 を先に**。小型 NN + 自己対戦データ程度なら**ローカル CPU で十分回る**。**GPU(費用発生)はフェーズ1のゲート(§2.2)を満たし「伸びしろあり」と判断してから**。GPU 選定・料金感の Web 調査が必要になった時点で**ユーザーへ都度確認**(AGENTS §7)。

### 論点F: 推論実行先・速度(★最大の技術的山場)

World 探索は **1手で数千〜数万局面**を評価する。NN 評価が遅いと depth が出ない / Vercel 504。

| | F-1: 純 TS forward pass(**PoC 起点**) | F-2: WASM 推論(onnxruntime-web 等) | F-3: NNUE 増分更新(自前) |
|---|---|---|---|
| 速度 | 遅い(基準計測用) | 速い | 最速 |
| 実装 | 最小(依存追加なし) | パッケージ追加(要確認) | 自前実装・複雑 |
| 立ち位置 | **まず速度の現実を測る**ベースライン | 中間最適化 | 到達点(フェーズ2) |

**推奨 = F-1 でまず計測 → 不足分を F-3(NNUE 増分)/ F-2(WASM)で詰める**。
- ★**増分更新が効く理由**: alpha-beta は親→子で**盤面が 1 手分しか変わらない**。NNUE の feature transformer は「変化した特徴だけ差分更新」できるので、毎ノードの全結合再計算を避けられる(将棋 AI で実証済みの定石)。これが「数千評価/手」を現実的にする鍵。
- ★PoC では **World bench(depthCompleted)** と **1局面あたり評価コスト(µs)** を測り、「現 eval 比で depth が何 % 落ちるか」を数値化する。これが GPU 投資判断の主材料。
- ★**推論先**: production は **Vercel serverless(Node)** で動く前提(現 route と同じ)。ブラウザ WASM は将来オプション(クライアント推論 = サーバ時間制限回避)だが PoC では Node 内 forward pass に統一。

### 論点G: データパイプライン

- **export**: Neon の `TrainingGame`/`TrainingSample` → JSONL(学習入力)。フェーズ0で JSONL helper(`training/jsonl.ts`)+ 自己対戦の JSONL 出力はある。**DB → JSONL の export スクリプト(P0-6 の残)**を P1-0 で仕上げる。
- **量の確保**: 自己対戦を**まとまった局数**回して数万〜数十万局面を作る(現 53 サンプルでは学習不可)。自己対戦は現 bolt-on AI 強度が上限 = **データ品質に天井**がある点を明記(フェーズ2で強い NN → 強い自己対戦の正のループへ)。
  - ★**生成元と推論先のエンジン非対称**(M1 MINOR-2): `selfplay-245.ts` の chooser は **bolt-on 経路**(`useKernelSearch:true`)でデータを作る。一方フェーズ1の NN は **World 経路**のリーフに入る。学習データの生成元(bolt-on)と推論先(World+NN)が異なる非対称が残る。PoC では許容(パイプライン+速度検証が主目的)だが、フェーズ2 で World+NN 自己対戦へ切替えて非対称を解消する。
- **人間棋譜の必須投入**(ユーザー要件): 量は少ないが**高品質なお手本**として学習に必ず混ぜる(重み付け / オーバーサンプリングは PoC で調整)。

---

## 4. 推奨パスに基づく作業分解(段階コミット、単一ブランチ)

> 前提: §7 で **A-1(NNUE 寄り value-only)/ C-1(outcome ラベル)/ E-1(無料 CPU PoC)/ F-1 起点** が承認された場合の分解。方式が変われば再計画する。
> 各段は rule-6 の必須チェック(lint → typecheck → test:ci → build)を通す。Python 学習スクリプトはリポジトリ同梱(Vercel バンドル外 = ランタイム非依存)。

### P1-0: データ基盤(export + 量の確保) — **コード変更小、お金 0**
- DB(Neon)→ JSONL export スクリプト(`scripts/export-training-245.ts`、読み取り専用)。**現状この DB 読み取り経路だけが未作成**(JSONL helper `training/jsonl.ts` と自己対戦の JSONL 出力 `selfplay-245.ts` は実在 = M1 MINOR-1)。
- 自己対戦を**まとまった局数**生成して JSONL を蓄積(`scripts/selfplay-245.ts` を活用、難易度・デッキを散らす)。
- データ量・分布の診断(局面数 / source 内訳 / 勝敗バランス / カード使用率)。
- **DoD**: 学習に投入できる JSONL が「数万局面」規模で揃い、人間 53 サンプルも統合されている。

### P1-1: 符号化(encoder)確定 — **TS、共有設計**
- `src/lib/shogi/ai/learned/encoder.ts`(仮): `encodePosition(gameState, cardState, variant) → Float32Array`(or 疎表現)。**学習 export と推論で共有**。
- 符号規約(先手絶対視点)・特徴次元・テスト(既知局面 → 期待ベクトル、対称性)を固定。
- **DoD**: encoder のユニットテスト緑。export スクリプトが encoder を使って特徴 + ラベルの JSONL を吐ける。

### P1-2: PoC 学習(Python / CPU) — **お金 0**
- `training/`(Python、リポジトリ配下の学習専用ディレクトリ、Vercel 非バンドル)に小型 MLP の学習スクリプト。**最小依存で開始**(numpy / scikit-learn で足りるなら可)、必要になったら PyTorch(**パッケージ追加 = ユーザー確認**、Python 側 = ランタイム外)= M1 NIT-2。
- outcome ラベル(C-1)で回帰 → 重みを JSON/バイナリへ書き出し。
- **DoD**: 学習が収束(loss 低下)し、検証局面で「妥当な符号・大小」を返す重みが出る。重み出力は**人手 eval の cp スケールへ較正**(線形フィット等、M1 MAJOR-1)できる形にする。

### P1-3: 推論統合(TS、World リーフへ差し替え) — **二重 flag ガード**
- `src/lib/shogi/ai/learned/infer.ts`(仮): 重み読み込み + forward pass(F-1 純 TS)。`evaluateLearned(gameState, cardState, variant) → number`(**先手視点 cp 較正済スカラー**)。
- **eval 切替は「呼び出し点は複数・切替ロジックは1関数」で集約**(M1 MAJOR-1): World 経路は `evaluate(...)` を**複数箇所**で呼ぶ(`search.ts` 行 900/921 = quiescenceWorld stand-pat、行 1104 = negamaxWorld futility staticEval、+ depth≤0 で降りる leaf)。これらを World 専用ラッパ `evalLeafWorld(state, cardState, variant, cardDigest)` 1 関数に通し、**内部で flag 分岐**(`useLearnedEval` ON → `evaluateLearned`、OFF → 既存 `evaluate`)。呼び出し点に分岐を散らさない(疎結合・将来の絡み合い回避)。
- ★**スケール整合の検証**(M1 MAJOR-1): NN を挿す箇所には **futility margin(300/500)/ delta pruning(`capturedValue + 200`)/ MATE_SCORE** など cp 前提のハードコードが連動する。NN を cp 等価に較正するか、揃わなければこれら margin の再調整を P1-3/P1-4 のスコープに含める(「スケール規約バグ」= 符号規約バグと並ぶ穴)。
- ★**二重 flag**(M1 MAJOR-2): World 経路自体が `useTurnActionSearch`(production OFF・dormant)でガード済。NN flag `useLearnedEval` は **World 経路の内部 flag**として追加。検証は `useTurnActionSearch=true`(bench/test のみ)× `useLearnedEval=true` の組で行う。**production route は両 flag OFF のまま**(完全無回帰)。
- **DoD**: `useLearnedEval` ON で World 探索が学習評価で動く。**`useLearnedEval=false` のとき World 経路が現行 World 経路と byte 等価**(特性化。production bolt-on とは別レイヤである点を区別)。

### P1-4: 検証(賢さ + 速度) — **計測**
- **賢さ**: 「無駄カード局面」診断 fixture(過剰ドロー / タダ取り歩打ち / 駒戻し)で、学習 NN 評価 vs 人手評価の符号・大小を比較。#235 の card-bench 反省(開始局面流用で gap=0)を踏まえ、**自己対戦から developed な多様局面を抽出**した fixture を別途作る。
- **速度**: World bench(depthCompleted)を「人手 eval / 学習 NN(F-1)」で比較。1評価あたり µs も計測。Vercel 時間制限内見込みを算定。
- **DoD**: §2.2 の 4 条件を数値で評価。ボトルネック(速度)が定量化される。

### P1-5: 判断ゲート(フェーズ2 / GPU 投資の是非) — **ユーザー判断**
- PoC 結果(伸びしろ + 速度ボトルネック)をユーザーへ提示。
- 有望 → フェーズ2(クラウド GPU で本格学習 + 速度最適化 [NNUE 増分 / WASM / 量子化] + 定期再学習)。
- 速度が壁 → F-3/F-2 の最適化 PoC を先に。賢さが出ない → 符号化 / ラベル(C-3)/ データ量を見直し。

---

## 5. 必須チェック(rule 6)

- TS 変更を伴う段(P1-0/1/3/4): `npm run lint` → `npm run typecheck` → `npm run test:ci` → `npm run build`。
- Python 学習スクリプト(P1-2): Vercel バンドル外ゆえ build には影響しないが、TS gate は通す。Python の lint/test は別途軽量に。
- doc のみ(本書): lint/typecheck 通過確認で代替可(build 省略可)。

---

## 6. リスク・性能・デグレ(Issue #109 観点)

| リスク | 内容 | 緩和 |
|---|---|---|
| **推論速度(最大)** | NN が遅く depth 低下 / Vercel 504 | F-1 でまず計測 → NNUE 増分(F-3)/ WASM(F-2)/ 量子化で段階改善。PoC で定量化してから本番判断 |
| **評価スケール不一致**(M1 MAJOR-1) | NN 出力 cp スケールが人手 eval と食い違い、futility/delta margin(300/500/200)等の枝刈り前提が壊れ探索歪み | NN を cp 等価に較正(P1-2 で線形フィット)or margin 再調整(P1-3/4)。スケールをテストで固定 |
| **データ量不足** | 53 サンプルでは学習不可 | 自己対戦で数万局面生成(P1-0)。人間棋譜は高品質お手本として混合 |
| **データ品質の天井 / 生成元乖離**(M1 MINOR-2) | 自己対戦は現 bolt-on AI 強度が上限(garbage-in)、かつ生成元(bolt-on)と推論先(World+NN)が非対称 | PoC は「パイプライン + 速度」検証が主目的と割り切る。フェーズ2で World+NN 自己対戦へ切替え+正のループ |
| **過学習 / 汎化失敗** | 暗記になり初見局面で弱い | 小型ネット + 検証分割 + データ多様化。#245 原則「教材であって台帳でない」を指標化 |
| **符号 / スケール規約のバグ** | 先手視点の符号反転ミス(#235 で実例)+ cp スケールずれ | encoder/infer の符号・スケールをテストで固定。flag OFF byte 等価で隔離 |
| **production デグレ** | 本番に影響 | 二重 flag(`useTurnActionSearch`+`useLearnedEval`)OFF のまま World 経路のみで検証。`evaluate` 経路は不変 |
| **決定性** | 学習は非決定、推論は決定であるべき | 重みは固定ファイル。推論は純関数。乱数を推論に持ち込まない。F-2(WASM)/量子化移行時は「同一入力→同一出力」特性化テストを設ける(M1 MINOR-3。整数量子化=NNUE は浮動小数の演算順序差が無く決定性に有利) |
| **重み配布 / cold start**(M1 NIT-3) | 数 MB 重みの同梱が Vercel バンドル肥大・cold start の JSON parse 遅延を招く | P1-3 でバンドルサイズ・cold start 影響を 1 度計測。大きければバイナリ化 / 後日 DB・CDN 配信(フェーズ2) |
| **外部依存膨張** | ML パッケージ追加 | Python は最小依存(numpy/sklearn)で開始、必要なら PyTorch(ランタイム外)。TS 側 WASM ライブラリ追加は都度確認(AGENTS §7) |

---

## 7. ★ユーザー判断が必要な論点(方式決定)

以下を決めていただければ §4 の作業分解で着手できる。**括弧内が私の推奨**。

1. **学習方式**(論点A): **A-1 NNUE 寄り value-only(推奨)** / A-2 AlphaZero 寄り。
2. **学習ラベル**(論点C): **C-1 outcome のみで PoC(推奨)** / C-2 探索スコア / C-3 併用。
3. **学習環境**(論点E): **E-1 無料 CPU で PoC を先に(推奨)** / 最初から E-2 GPU。
4. **推論起点**(論点F): **F-1 純 TS で速度計測 → 不足分を最適化(推奨)** / 最初から F-3 NNUE 増分。
5. **外部通信・パッケージ**(AGENTS §7、都度確認): (a) NNUE/AlphaZero/GPU 料金の **Web 調査**の可否、(b) Python **PyTorch** 等の導入可否(ランタイム外)、(c) 将来 TS 側 **WASM 推論ライブラリ**の導入可否。
6. **データ量**: 自己対戦を**何局**回してよいか(計算は無料だが時間がかかる)。目安: 数百〜数千局。

---

## 8. スコープ外(フェーズ2 以降)

- クラウド GPU での本格学習・大量自己対戦・定期再学習(「プレイするほど強くなる」ループ)。
- 推論速度の本格最適化(NNUE 整数量子化 / WASM / 増分更新の作り込み)。
- AlphaZero 流(MCTS + policy/value)への発展(A-2 を選ばなかった場合の将来オプション)。
- 学習 NN の **production 常時 ON 化**(= route flag を World+NN へ cutover。M3 + 十分な棋力実証が前提)。
- 重み配布の運用(リポジトリ同梱 → DB/CDN 配信、バージョニング)。

---

## 9. マイルストーン(rule 8)

- **M1(本書)**: 計画レビュー(単一 general-purpose agent / Issue #109 観点)。方式決定はユーザー(§7)。
- **M2(PoC 実装完了時)**: P1-1〜P1-4 完了時にレビュー(符号化の正しさ / 無回帰 / 速度計測の妥当性)。
- **M3(本番 cutover 前)**: フェーズ2 で route を World+NN に切替える直前。棋力実証 + 速度 + デグレを徹底レビュー。

---

## 10. 参照

- Issue: #245(エポック・本文に全体計画)、#235(World 探索基盤 = 土台)、#109(共通レビュールール)。
- フェーズ0 計画: [`docs/plans/issue-245-phase0-data-collection.md`](./issue-245-phase0-data-collection.md)。
- #235 S4(World 探索)計画: [`docs/plans/issue-235-s4-search-engine.md`](./issue-235-s4-search-engine.md)。
- 主要コード: 探索 [`src/lib/shogi/ai/search.ts`](../../src/lib/shogi/ai/search.ts) / 評価 [`src/lib/shogi/ai/evaluate.ts`](../../src/lib/shogi/ai/evaluate.ts) / 学習収集 [`src/lib/shogi/training/`](../../src/lib/shogi/training/) / スキーマ [`prisma/schema.prisma`](../../prisma/schema.prisma)。

---

## 11. M1 レビュー反映(2026-06-15、単一 general-purpose agent / Issue #109 観点)

**総合判定 = APPROVE_WITH_NITS(BLOCKER なし、実装着手に進める品質)**。レビュアーは `search.ts`/`evaluate.ts`/`engine.ts`/`route.ts`/`schema.prisma`/`training/*`/`selfplay-245.ts` を実読し、計画の技術的前提(World リーフ = `evaluate(state,variant,cardDigest)`、`world.gameState`+`world.cardState` 両アクセス可、flag OFF 無回帰)が**いずれも実コードで裏付けられる**と確認。以下を本書へ反映済。

### MAJOR(反映済 = 本文を更新)
- **MAJOR-1(評価スケール + 呼び出し点の正確化)**: World 経路の `evaluate` 呼び出しは「1点」でなく複数(`search.ts` 行 900/921 = quiescenceWorld stand-pat、行 1104 = negamaxWorld futility staticEval、+ leaf)。さらに futility margin(300/500)・delta pruning(`+200`)・MATE_SCORE が **cp スケール前提**でハードコードされ、NN 出力スケールがズレると枝刈りが歪む。→ §2.2(成功条件4)・§3 論点B(スケールをテスト固定)・§4 P1-2(cp 較正)・P1-3(切替は `evalLeafWorld` 1 関数集約 + スケール整合検証)・§6(リスク表に「評価スケール不一致」追加)へ反映。
- **MAJOR-2(二重 flag の明示)**: World 経路自体が `useTurnActionSearch`(production OFF・dormant)でガード済 → NN は **World 内部 flag `useLearnedEval`** で二重ガード。検証は `useTurnActionSearch=true × useLearnedEval=true` の bench/test のみ、production は両 OFF。byte 等価の対象は「`useLearnedEval=false` の World 経路 === 現行 World 経路」(production bolt-on とは別レイヤ)。→ §2.2(成功条件5)・§4 P1-3・§6 へ反映。

### MINOR / NIT(反映済)
- **MINOR-1**(export は DB 読み取り経路のみ未作成、JSONL helper/自己対戦出力は実在)→ §4 P1-0 に明記。
- **MINOR-2**(自己対戦の生成元 = bolt-on、推論先 = World+NN の非対称)→ §3 論点G・§6 に追加。
- **MINOR-3**(F-2 WASM/量子化移行時の決定性特性化テスト、整数量子化は決定性に有利)→ §6 リスク表に反映。
- **MINOR-4**(`serializeCardState` は墓地/ドロー進捗/状態異常も保持 → 入力に含めるか P1-1 で要決定。マナ上限可変前提で encoder 設計)→ §3 論点B に反映。
- **NIT-1**(速度 DoD を「depthCompleted ≧ 現行−N% かつ timeLimitMs 内」へ具体化)→ §2.2 成功条件3。
- **NIT-2**(Python は最小依存で開始、必要なら PyTorch)→ §4 P1-2・§6。
- **NIT-3**(重み同梱の Vercel バンドル/ cold start 影響を P1-3 で計測)→ §6 リスク表。

### レビュアーが評価した強み
方式選択の論拠の一貫性(NNUE 寄り value-only 推奨)、#235 の失敗(engagement 下駄 / card-bench gap=0)の計画内在化、train/inference スキューを encoder 単一実装で構造的に封じる設計、無料 CPU→GPU のコストゲート、ガバナンス(rule-6/8、§7 ユーザー方式決定集約、都度確認)の織り込み。

### 残(着手時に確定)
NN 出力スケールの較正方法(線形フィット vs スケール固定学習)、encoder の最終入力次元、速度ゲートの N%(難易度別)は P1-1〜P1-4 の実装着手時に数値で確定する。
