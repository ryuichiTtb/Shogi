# Issue #235 S4: L2 TurnAction 単一探索 + TT 拡張 + 汎用評価拡張基盤 — 実装計画

> epic 正本: `docs/plans/issue-235-card-shogi-ai-redesign.md` (§3 L2 / §6 探索コア / §6 item 7 EvalFeature / §7 段階計画 S4 行 / §10 R-1 / §11 D-I)。本 doc は S4 の実装計画 (M1 レビュー対象)。

## 0. 位置づけ・ゴール / 非ゴール
**位置づけ**: S0〜S3 で L0 カーネル (単一権威 applyTurnAction) と L1 (CardSpec registry + ValueModel) が完成。S4 は **L2 = カード込み多手読みの単一探索エンジン**を構築する epic 最大の山場・最大リスク (epic §10 R-1)。

**ゴール**:
1. **P1 深さ非対称の解消** — advanced/expert のカード使い渋り (57%) の構造的主因。現状 move は findBestMove で深く読むが、playCard/draw は root で 1 ply lookahead の浅い bolt-on 評価 (engine.ts root action loop + searchDoubleMoveSuperAction) でしか比較されない。これを **TurnAction (move/draw/playCard) を一級市民とする単一 negamax 木**へ統合し、カードも move と同じ深さで読む。
2. **TT を cardState 込みに拡張** (P6/P7) — 同一盤面・異 cardState の誤ヒット解消。
3. **汎用評価拡張基盤 (EvalFeature registry)** — 状態異常 (no_promote) を最初の具体例に、将来の新評価要素を宣言的に探索/評価へ差し込める 5 接面標準化 (epic §6 item 7)。S4 で確認済の現行バグ (noPromoteMarkCountDelta 符号逆 / 幻の成り手 / digest.manaCap 定数焼き込み) も同時精算。
4. **D-I (ユーザー決定 2026-06-10)** — no_promote マーク駒の mustPromote マス不成進入を許容する mark-aware 着手生成。

**非ゴール (S5/S6/別送り)**: L3 相手モデル (相手 playCard/draw の確率展開、超上級、#193 PR1e 依存) / movement 系状態異常 (利き変更、epic §6 item 7.4 でスコープ外明示) / standard variant の新エンジン化 (当面 move-only negamax 温存、epic §11 D-B)。

## 1. 挙動変化 (S4 は意図的に棋力を大きく変える)
- カードが move と同じ深さで読まれる → advanced/expert のカード使用が局面に応じて増える想定 (57% 非対称の緩和)。**「局面依存化 ≠ 棋力向上」ゆえ bench 実測で評価** (epic §8.4.5 caveat)。
- 状態異常を背負った駒の盤面価値が評価に反映される (マーク大駒の減価 / 相手マーク駒のファントム脅威除去)。
- D-I: マーク駒が最奥段へ不成進入できる (現行 UI バグの修正 = プレイヤー/AI 双方の合法手が正される)。
- standard variant / ゲームルール (マーク無し挙動) は不変。

## 2. 目標構造 (epic §6 / §6 item 7 の実装像)
- **単一探索木**: `negamax(world: WorldState, ...)`。各ノード候補 = `getLegalTurnActions(world, player)` = 全 move + (許可深さ・selector で) draw + playCard。move/draw/playCard を同列に最大化。
- **ターン制御**: `turnEnded` で二手指し等の同色マルチ ply を player 反転抑止 (現 super-action を木に統合、double_move 特別扱い廃止)。
- **TT**: zobrist を cardState fold 込みに拡張 (`boardHash ^ cardFold`)。fold ポリシーは slice 単位で型強制宣言 (item 7.2 (ii))。
- **leaf 評価**: 盤面 evaluators 7 成分 + ValueModel 集約 + EvalFeature registry の per-piece/global/option 寄与 (item 7.4)。
- **selector**: ノード分岐を move 上位 M + カード top-K + draw に絞る。難易度別 maxDepth/budget/M/K。深さ予算超過は move フォールバック (既存 deadline + S3 派生 action-phase budget を踏襲)。

## 3. 段階分割 (additive→cutover、単一 revert 隔離を維持)
S1〜S3 同様、低リスクな additive / correctness を先に、cutover を単一 revert 可能な単位に。各段 lint→typecheck→test:ci→build + bench (棋力ゲート)。standard byte-level 不変を全段で固定。

- **S4a (correctness、独立出荷可): mark-aware 着手生成 (D-I)**
  - `moves.ts` (= UI/kernel/AI 共有の合法手 SSOT) を **cardState/noPromoteMarks 考慮**に拡張。マーク駒は成れない (promote 手を出さない) + **盤上内に着地する限り mustPromote マスへ不成手を生成** (D-I = ユーザー決定)。
  - **D-I の確定セマンティクス (ユーザー言明)**: 判定基準は「着地マスが盤上か」のみ。**行き所のない駒 (dead piece) はマーク駒に限り許容** (例: マーク歩が 2段目→1段目 へ不成進入し敵駒を取って以後動けなくなるのは意図どおり = 取ることが目的)。盤外着地のみ非合法 (例: マーク桂が 2段目から跳ぶと盤外 → 着手生成が盤上のみ生成するので自然に除外、moves.ts `isValidPos` で continue)。**M1 指摘 (桂が 3段目→1段目 で on-board だが dead になるケース) は本原則で「許容」に確定** (歩の capture-intent と同型。off-board のみ NG)。
  - **設計判断 = optional cardState 引数方式 (M1 推奨)**: `getFullLegalMoves`/`getPieceMoves` に optional `cardState?` を追加。既存 caller (M1 grep 実測 6 経路: rules.ts:122 evaluateGameEnd / ai/legal-moves.ts:30 / engine.ts×3 / turn/current-rules.ts:56 / use-shogi-game.ts) は **未渡で完全等価** = standard byte-level 不変を保証しやすい。WorldState ラッパ層案より既存波及が小さく、かつ「同一 predicate 共有」(R-5) も満たす。captureGen.ts のローカル `mustPromoteAfterMove` も mark-aware 化要 (探索専用ゆえ cardState 供給経路は限定)。
  - **詰み判定経路も mark-aware に (M1 high 派生)**: card-shogi の `evaluateGameEnd` (rules.ts:122) / `isCheckmate` がマーク無視のままだと、マーク駒の合法手集合が変わった結果「探索の詰み」と「UI の詰み演出」が乖離する。S4a で詰み判定経路にも cardState を通す。
  - 影響: 現行 UI バグ (マーク歩が最奥段へ進めない reducer.ts:400) + AI の幻の成り手を**同時に根本解消**。kernel silent block (move-effects.ts:88-90) は冗長化するが安全網として残置可。
  - 特性化テスト: マーク歩 2段目→1段目 不成可 (dead 許容) / マーク桂 2段目→盤外は不生成 / マーク桂 3段目→1段目 不成可 (on-board dead) / マーク無しは既存生成とバイト等価 (mutation で pin) / card-shogi 詰み判定の UI・探索一致。
- **S4b (additive、flag OFF): WorldState 搬送探索の足場 + EvalFeature registry スケルトン + kernel 戻り値拡張**
  - `negamax`/`quiescence` を WorldState で回せる**並走経路**を `useTurnActionSearch` フラグ裏に新設 (既存 move-only negamax は無改変=バイト等価、standard 温存。S1b `useKernelSearch` パターンを先例に)。
  - **kernel 戻り値拡張 (M1 high 反映、S4c の TT 部分を軽くするため前倒し)**: 現 `ApplyTurnActionResult` = `{world, events, turnEnded}` は `makeMoveWithEffects` の `triggeredCheckBreak` を境界で捨てている (world-kernel.ts:67-71)。S4c の TT 全量再計算ゲートが参照できるよう、**`boardChangedBeyondMove: boolean` (move 1 手分以外の盤面変更 = check_break 捕獲 / playCard の pawn_return・piece_return 等) を additive 追加** (flag OFF 経路では無害)。move 限定名 `triggeredCheckBreak` でなく一般名にする (playCard 盤面効果も incremental hash 前提を破るため)。
  - EvalFeature registry の (i) 状態 slice / (ii) TT fold 宣言 (`Record<keyof CardGameState, "fold"|"evalIrrelevant">` 型強制 + 網羅 unit test) / (iv) per-piece/global/option の合成点を additive に用意。**production 未配線** (flag OFF)。
  - **PoC-1 再検証 (epic §8.4.5 honest caveat。注: epic の "S4a 再校正" 呼称 = 本計画の S4b に対応。epic の S4a/S4b は PoC 段階の旧2分割呼称、本計画 S4a〜S4e が確定版)**: 実エンジン (LMR/TT/quiescence 込み) に selector 雛形を載せ M/K の枝刈り余地を再測。**production 比 depthCompleted ±10% が成立する M/K/budget の存在を確定**してから S4c の cutover 粒度・難易度別係数を決める。不成立なら epic §7 フォールバック発動。
- **S4c (cutover、単一 revert 主点): TurnAction 単一探索木 + TT cardState 化** — **M1 指摘で 2 コミットに事前分割**:
  - **S4c-1: 単一木統合 + selector (TT は move-only 据え置き)**。root bolt-on (engine.ts action loop + `evaluateActionWithLookahead` + `searchDoubleMoveSuperAction`/Kernel) を撤去し単一木へ統合。getLegalTurnActions が各ノードで候補生成、negamax が同列最大化。**相手ノードのカード抑止**: 現 `getLegalActions` は `isRoot===true` のみ card/draw 追加 (current-rules.ts:59)。単一木で isRoot ガードを外す場合、相手ノード (+ S4 では自分の深いノードも) の card/draw 生成抑止を selector の手番/深さ条件で担保 (相手 move-only = 性能安全 + S5 まで相手カード非展開)。double_move は turnEnded マルチ ply で統合。
  - **S4c-2: TT cardState fold ON**。`boardHash ^ cardFold`。S4b で追加した `boardChangedBeyondMove` フラグで盤面変更ノードを検知し computeHash 全量再計算 (incremental updateHash は move 1 手分専用ゆえ、draw/playCard/盤面変更ノードでは使えない — これらは computeHash 起点)。fold は slice 変化検知 (updateCardDigest パターン流用)、hand は defId 多重集合で正規化。
  - selector (move 上位 M + カード top-K + draw) を本配線。難易度別係数。
  - **挙動変化の主点** = カードが深く読まれる。bench before/after (nodes/s + TT hit-rate カウンタで S4c-1 / S4c-2 の退行要因を切り分け)。単一 revert = S4c-2 で flag ON 化 (rollback = flag OFF + bolt-on 復帰)。
- **S4d (cutover 継続): EvalFeature 評価寄与の本配線 + 状態異常評価 + 既知バグ精算**
  - per-piece modifier (no_promote: マーク駒の成り上昇分減価 + 相手マーク駒の成り脅威割引) を `computeMaterial`/`evaluatePromotionThreats` へ引数追加で実装 (evaluateWithBreakdown と構造共有)。
  - global scalar 型へ digest を一本化 (`noPromoteMarkCountDelta` + `NO_PROMOTE_MARK_COEFFICIENT` を**フィールドごと削除** → 符号逆バグ消滅 + per-piece との二重計上回避)。option value = S3 trap valueModel を接続。
  - 既知負債精算: `digest.manaCap` を cardState 読みに是正 / `DEAD_MANA_THRESHOLD` cap 比率化 / `world-kernel.ts` の TurnAction 型 L0→L2 逆依存解消 / top-K selector とセンチネル0価値カードの飢餓回避規約。
  - lifecycle (v) 宣言で no_promote の follow/capture-cleanup インラインを registry 駆動へ移行 (将来要素の受け皿)。
- **S4e (校正): selector M/K/budget 校正 + 棋力 bench 確定**
  - 難易度別 M/K/budget/maxDepth を bench で校正 (epic §7「S4b 最適化・校正」相当)。phase 別カード使用率 + depthCompleted を多面測定。決定的 unit test で flaky 回避 (PR3-3 C-13 / S3c 方式)。
  - 棋力ゲート: depthCompleted は selector で意図的に変わる前提のため、epic §12 の多面指標 (棋力 variance / カード使用率改善 / undo 堅牢性) で評価。S4a..S4e 完了で S4 DoD 達成。

> 段の粒度はトレードオフ。S4b/S4c が大きすぎると判明したら PoC-1 再検証 (S4b) 結果に基づきさらに分割する (epic §7 注記)。

## 4. 現行構造の棚卸し (移植元マップ、S4 で再設計)
- `src/lib/shogi/ai/search.ts`: `negamax`/`quiescence` (GameState のみ、`applyMoveForSearch` で子生成)、root `evaluateActionWithLookahead` (1ply lookahead bolt-on)、`searchDoubleMoveSuperAction`(+Kernel) (super-action 別系統)、`getOpponentResponseScore` ← S4c で単一木へ統合。
- `src/lib/shogi/ai/engine.ts`: root action loop (move vs card/draw 浅比較、S3 派生 action-phase budget) ← S4c で撤去。
- `src/lib/shogi/ai/zobrist.ts` + search.ts `updateHash`: 盤+持ち駒+手番のみ ← S4c で cardState fold 追加。
- `src/lib/shogi/ai/transpositionTable.ts` + search-context.ts (per-request TT) ← S4c で cardState-aware key。
- `src/lib/shogi/ai/evaluate.ts` `evaluate`/`evaluateWithBreakdown` (単一合成点) + `evaluators/*` (material/promotion-threat 等) ← S4d で per-piece modifier フック。
- `src/lib/shogi/ai/cards/digest.ts`: `noPromoteMarkCountDelta` (符号逆) / `manaCap` 定数焼き込み / global scalar 群 ← S4d で精算・registry global-scalar 化。
- `src/lib/shogi/ai/turn/action-generator.ts` `getCardActions` (root のみ、S3 派生 dedupe 済) ← S4c で各ノード getLegalTurnActions へ。
- `src/lib/shogi/moves.ts` `getFullLegalMoves`/canPromoteMove/mustPromote ← S4a で mark-aware 化 (D-I)。
- `src/lib/shogi/kernel/world-kernel.ts` `applyTurnAction` (L0 単一権威、search が遷移に使用) + TurnAction 型 ai/ import (逆依存) ← S4c で探索遷移に採用 + S4d で型逆依存解消。
- `src/lib/shogi/cards/card-spec-server.ts` CardSpec (statusEffect/validTargets スロット追加先) ← S4d で L1 接続。

## 5. リスク
- **R-1 候補爆発** (epic §10 R-1、最重要): TurnAction を全ノードで展開すると budget 爆発 (C-2 実測 budget=3≈130万 evaluate)。→ selector (M/K/budget) で必ず絞る。S4b の PoC-1 再検証で「±10% を実現する M/K が実エンジンで存在するか」を cutover 前に確定。
- **R-2 PoC-1 fidelity** (epic §8.4.5): PoC-1 は bare-αβ で production の 64-67% 深度。LMR/TT の soft 枝刈りとの相互作用で M/K 最適値が転移しない可能性 → S4b で実エンジン再校正必須。
- **R-3 TT 誤ヒット silent 化**: cardState fold 漏れ / move 以外の盤面変更 (check_break) の incremental hash 破壊。→ fold 型強制 (網羅 unit test) + 盤面変更ノードの全量再計算ゲート (item 7.2 (ii))。
- **R-4 棋力退化 / flaky**: 探索構造変更で advanced/expert の手が変わる。→ bench before/after + 決定的 unit test (相対順序、PR3-3 C-13 / S3c 方式)。selector を per-leaf O(small) に保つ (item 7.4、リーフ毎割当禁止)。
- **R-5 二重実装分裂 (D-I)**: mark-aware 合法手を AI 専用に作ると kernel/UI と分裂。→ S4a で UI/kernel/AI 共有の単一 predicate に実装。
- **R-6 standard 巻き込み**: WorldState 搬送で standard の move-only negamax を壊す。→ S4b は flag OFF 並走、standard byte-level 不変ゲート。cardState 未供給経路は従来等価。
- **R-7 cutover の revert 粒度**: S4c が巨大化し単一 revert 不能に。→ S4b で足場を additive に積み、S4c を S4c-1 (単一木+selector) / S4c-2 (TT fold ON) に分割、各々を revert 可能単位に保つ (M1 指摘反映)。
- **R-8 double_move マルチ ply の中間局面 (M1 high 反映)**: 現 super-action は 1手目 turnEnded=false の不変条件 (search.ts:825) + **check_break defer** (二手指し1手目は発火保留、2手目最終局面で発火、move-effects.ts:142-148 = #220/#222 でバグった経緯あり) に依存。単一木統合で「同色連続 ply を turnEnded=false で繋ぐ」設計にすると、**中間局面 (turnEnded=false、check_break 未発火) を leaf 評価 / TT store してはならない**。→ 中間ノードは leaf 評価・TT store をスキップする不変条件を S4c-1 で実装。kernel-search-equivalence.test.ts (既存 double_move 詰みケース) + reducer 二手指しテストを S4c-1 の blocking gate にする。
- **R-9 TT fragment / ヒット率劣化 (M1 medium)**: cardState fold で同一盤面が複数キーに分散しヒット率低下 (PoC-3 は断片化 1.001 だが random playout の過小サンプリング下界、§8.4.5 caveat 4)。→ §6 で TT hit-rate カウンタを実測、合否バンドで監視。

## 6. 検証ゲート / bench 方法論
- 各段 lint → typecheck → test:ci (全 green) → build。S4b 以降 bench 追加。
- **standard 不変ゲート**: 全段 standard variant byte-level 不変 + reducer/undo/effects/world-kernel-equivalence/kernel-search-equivalence テスト不変。
- **決定的 calibration**: `evaluate-action.test.ts` 系の相対順序 assert (S3c 方式) で探索選択の回帰を pin。flaky は bench に置かない。
- **棋力 bench** (`RUN_PERF_BENCH`): `measure-baseline-235.ts` (全4難易度) で depthCompleted + phase別カード使用率。S4 bench に nodes/s + TT hit-rate カウンタ追加 (item 7.6、退行が fold 起因か eval 起因か切り分け)。
- **合否バンド (M1 medium 反映、暫定値=S4b PoC-1 再検証で確定)**: selector で depthCompleted が意図的に下がるが暴落は退化なので下限を引く。
  - **depthCompleted**: before-baseline (§8.2: advanced 5.78 / expert 6.00) 比 **−15% を下限** (selector の意図的減少を許容しつつ暴落をブロック)。
  - **カード使用率**: advanced/expert **57% → ≥70% を改善線**、かつ pawn_return 系 100% 維持 (退行ガード)。beginner/intermediate は 100% 維持。
  - **TT hit-rate**: S4c-2 (fold ON) で S4c-1 (move-only TT) 比 **−X% 以内** (X は S4c-1 実測値を基準に S4c-2 着手時に確定)。
  - **補助**: 棋力 variance / undo 堅牢性 (epic §12)。「多面指標」を逃げ道にせず各軸に下限/目標を数値固定。
- **D-I (S4a)**: マーク駒 mustPromote 不成進入の特性化テスト (歩 dead 許容 / 桂 盤外不生成 / 桂 on-board dead 許容) + UI/kernel/AI 合法手一致 + card-shogi 詰み判定一致テスト。
- **card-digest.test 更新 (M1 low)**: `noPromoteMarkCountDelta` 削除 (S4d) に伴い card-digest.test.ts の関連 assertion を削除/更新 (デッドテスト残置防止)。

## 7. rollback
- S4a = correctness 拡張 (mark-aware 生成)。revert = cardState 非考慮の旧生成へ差し戻し (マーク無し局面は元々等価ゆえ低リスク)。
- S4b = additive (flag OFF)。revert 安全。
- **S4c が主 cutover** = flag ON 化 + bolt-on 撤去。revert = flag OFF + root bolt-on 復帰 (1 コミット隔離)。
- S4d/S4e = 評価寄与・係数。revert = registry 寄与の無効化 / 係数差し戻し。

## 8. S4 DoD
- [ ] D-I: mark-aware 着手生成 (盤上内不成進入許容) を UI/kernel/AI 共有 predicate で実装。特性化テスト緑。
- [ ] TurnAction 単一探索木に統合 (root bolt-on + super-action 撤去、double_move 木統合)。
- [ ] TT cardState fold 化 (型強制宣言 + 網羅テスト + 盤面変更ノード全量再計算)。誤ヒットゼロを特性化で確認。
- [ ] EvalFeature registry 5 接面 + no_promote per-piece 評価。符号逆バグ / 幻成り / manaCap 定数 / L0→L2 型逆依存 を精算。
- [ ] selector (M/K/budget) を実エンジンで校正。PoC-1 再検証で ±10% 実現性確定。
- [ ] 棋力 bench で合否バンド達成 (depthCompleted ≥ before−15% / card% advanced・expert ≥70% / TT hit-rate 許容内)。standard byte-level 不変。
- [ ] 各段 lint/typecheck/test:ci/build green。S4a→S4b→S4c-1→S4c-2→S4d→S4e の順 (S4c-2 が flag ON 主点)。
- [ ] L3 相手モデル / movement 系状態異常 / standard 新エンジン化は S5/S6/別送り (非ゴール明記)。

## 9. M1 マイルストーン1レビュー反映 (策定直後、2026-06-10、AGENTS.md ルール8)
独立 adversarial agent (general-purpose、32 tool uses、現行コード精読 + grep 実測) でレビュー。**当初版判定 = 要修正 (high 2 / medium 5 / low 3)**。骨格 (additive→cutover / 4層整合 / 現行 bolt-on・符号逆・幻成り・L0→L2 逆依存の実在) は妥当と確認。本版で全件反映済。

### high 反映
- **H-1 (TT 全量再計算ゲートの前提不在)**: 計画が参照する `triggeredCheckBreak` は `makeMoveWithEffects` 戻り値にあるが `applyTurnAction` の `ApplyTurnActionResult` (world-kernel.ts:67-71) が境界で捨てている。→ S4b で `boardChangedBeyondMove` を additive 追加 (前倒し)。incremental updateHash は move 1 手分専用ゆえ draw/playCard/盤面変更ノードは computeHash 全量起点、を §3 S4c-2 に明記。
- **H-2 (double_move 中間局面)**: check_break defer + 1手目 turnEnded=false 不変条件を単一木で保つ要。中間局面の leaf 評価/TT store 禁止を R-8 に新設、S4c-1 の blocking gate に既存 equivalence テストを指定。

### medium 反映
- **M-1 (S4c 過大)**: S4c を S4c-1 (単一木+selector、TT move-only) / S4c-2 (TT fold ON) に分割。退行要因の切り分けと R-3 隔離。
- **M-2 (D-I 桂 dead-piece エッジ)**: 桂 3段目→1段目 (on-board だが dead) は**ユーザーの capture-intent 原則で「許容」に確定** (歩と同型、off-board のみ NG)。§3 S4a に明記。
- **M-3 (棋力ゲート合否バンド欠如)**: §6 に depthCompleted ≥ before−15% / card% ≥70% / TT hit-rate 許容内 / pawn_return 100% 維持 を数値固定。
- **M-4 (moves.ts シグネチャ波及)**: optional cardState 引数方式を採用 (既存 6 caller 未渡で等価)。card-shogi 詰み判定経路 (rules.ts:122) も mark-aware 化を §3 S4a に追加。
- **M-5 (TT fragment)**: R-9 新設、hit-rate カウンタで監視。

### low 反映
- **L-1 (card-digest.test 更新)**: `noPromoteMarkCountDelta` 削除に伴うテスト更新を §6 に追加。
- **L-2 (epic ↔ 計画の S4a/b 呼称ズレ)**: epic の "S4a 再校正" = 本計画 S4b、を §3 S4b に注記。
- **L-3 (相手ノードのカード抑止)**: 単一木で isRoot ガードを外す際の相手 move-only 担保を §3 S4c-1 に明記。

### 着手前のユーザー確認事項 (S4a 着手時)
- **D-I 桂 dead-piece の許容範囲**: 本版では「on-board なら dead でも許容」と解釈 (ユーザーの歩 capture-intent 言明に基づく)。桂が 3段目→最奥段で不成のまま動けなくなるケースまで許容してよいか最終確認 (否なら「不成進入先に後続合法手がある場合のみ許容」へ predicate 変更)。
- **合否バンドの暫定数値** (depthCompleted −15% / card% 70% / TT hit-rate X%) は S4b の PoC-1 再検証実測で確定する暫定値。
