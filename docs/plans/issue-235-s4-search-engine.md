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

## 10. M2 マイルストーン2レビュー反映 (S4a 実装完了時, 2026-06-13, AGENTS.md ルール8)
独立 adversarial agent (general-purpose、35 tool uses、worktree コード精読 + grep 実測) + オーケストレータの独立反証で S4a 実装をレビュー。**判定 = APPROVE_WITH_NITS (実装バグ・回帰・クラッシュ・型/null 不安全はゼロ)**。コミット `8d9cff4` で指摘を全件反映。

### bench 非回帰 (同一マシン main=S3c vs S4a 実測)
- depthCompleted: 全4難易度バイト等価 (beginner 3 / intermediate 5.33 / advanced 5.78 / expert 6.0)。
- card%: advanced/expert 57% 不変。intermediate の `calib-trap-only-no-draw` 校正シナリオが trap↔move で揺れるのは **addNoise 由来のノイズ** (S4a 自身の 6 run で trap:move=3:3 に割れる)。S4a はマーク無し初期盤面で `isMarked=false` → 全 funnel バイト等価ゆえ決定論的変化は原理的に不可能、と整合。

### MAJOR 反映 (到達範囲の明文化)
- **観点4 (幻成り排除の production 到達)**: S4a の狙い (b)「AI が幻成り盤面を読まない」は **production AI の手選択には未到達**。実着手は `findBestMove → getSearchLegalMoves` (cardState 非対応) 由来で、`engine.ts:355` が `getLegalActions` の move アクションを `continue` で捨てる。S4a の mark-aware 化が実際に効くのは (1) UI `legalMovesForPieceSelect` (真のバグ修正) と (2) kernel `evaluateGameEnd` (ただし verdict はマーク不変=no-op) のみ。探索木の mark-aware 化は **S4c** (getSearchLegalMoves / captureGen への cardState 配線) で達成。→ current-rules.ts / rules.ts / move-effects.ts のコメントを到達範囲が誤読されないよう正確化 (コード挙動は不変)。

### NIT 反映
- **NIT-1 (テスト未カバー経路)**: 既存7件は step(歩)/jump(桂) のみ。slide emission site (香)・後手方向反転・任意成りマスでのマークを補完する3件を `no-promote-mark-moves.test.ts` に追加 (計10件)。
- **NIT-2 (evaluateGameEnd no-op コメント)**: 「マークで詰み/ステールメート判定も変わる」を「verdict はマーク不変、cardState は funnel family 一貫性 + S4c 足場」へ正確化。

### PASS 確認 (反証して問題なしと確定)
循環回避 (型 import + インライン `isNoPromoteLocked` = `hasNoPromoteMark` とセマンティクス等価) / マーク無しバイト等価 (else 枝が origin/main と字句一致) / D-I セマンティクス (3 emission site 全て promote=false 固定・盤外除外) / reducer UI 修正 (後段フィルタは純粋に冗長・集合等価) / 二手指し stale-mark (予測 gate 限定・kernel commit 経路は常時正確で不正手 commit 不可) / 詰み verdict 不変 (到達マス集合不変・king-safety も同一着地マスで同値、反例なし) / 計算量 (`if(!cardState) return false` 短絡) / 型・null 安全性。

## 11. S4b 実装計画 (concrete、2026-06-13、研究調査 + rule-8 計画策定)
S4b = S4c (TurnAction 単一探索木 cutover) のための **additive な足場 (flag OFF)**。研究調査 (general-purpose agent、search.ts/評価系/PoC-1 マップ) で以下を確定:
- production の deep search (`findBestMove`→`negamax`→`quiescence`) は `useKernelSearch` を一切読まない (S1b は root 1-ply lookahead 評価のみ kernel 化)。よって WorldState 探索は **既存 negamax/quiescence を無改変のまま別シンボルで複製** するのが standard byte 等価を保つ唯一の道。
- selector (上位 M 手絞り) は現 negamax に存在しない (`DOUBLE_MOVE_TOP_K=10` のみ) = 完全新規。
- TT: `computeHash`/`updateHash` (zobrist.ts + search.ts:110)。updateHash は move 1 手分専用 → S4b-1 の `boardChangedBeyondMove` が S4c-2 の全量再計算ゲート前提。
- 符号逆バグ (digest.ts:137) / 幻成り3面 (moves / legal-moves:25 / captureGen) は **S4d 精算 = S4b では触らない**。

### サブ分割 (revert 粒度・レビュー容易性)
- **S4b-1 (完了・commit `587148f`)**: kernel 戻り値 `boardChangedBeyondMove` (H-1 前倒し)。additive・production 不変・特性化テスト7件。
- **S4b-1b (次)**: **TT fold 宣言型のみ** (下記スコープ判断参照)。lean・concrete。
- **S4b-2a**: WorldState 並走探索 (`negamaxWorld`/`quiescenceWorld` 複製 + WorldState 着手ラッパ + cardDigest per-node + 手番ゲート) flag OFF。byte 等価ゲートのみ・棋力中立。
- **S4b-2b**: selector + PoC-1 再検証ハーネス + 実測 (same-engine control 比で ±10% 判定)。S4b の山場・PoC-1 ゲート局所化。

### スコープ判断: EvalFeature 合成点 (iv) は S4d へ繰り下げ
計画 §3 S4b は「EvalFeature の (ii) TT fold 宣言 / (iv) per-piece/global/option 合成点を additive に用意」と記すが、**(iv) を S4b で入れると未配線の optional 引数 = 投機的デッドコード (AGENTS rule 10 抵触)** になる。per-piece modifier の本配線は S4d (符号逆バグ精算と同時に `computeMaterial`/`evaluatePromotionThreats` へ引数追加) であり、S4b-2 の WorldState 探索も既存 `evaluate()` を byte 等価で呼ぶため (iv) を必要としない。
- **判断**: S4b は EvalFeature のうち **(ii) TT fold 宣言型 + 網羅 unit test のみ** を実装する (S4c-2 が実消費する concrete artifact、デッドコードでない)。(i) 状態 slice は `noPromoteMarks` が既存ゆえ新設不要。(iv) 合成点は S4d で本配線時に追加。(v) lifecycle も S4d。
- これにより S4b は「TT の前提 (boardChangedBeyondMove + fold 宣言) + 探索並走経路」に集中し、評価関数本体には一切触れない (= 棋力 byte 不変を最も保ちやすい)。

### S4b-1b: TT fold 宣言型 (concrete、M1 反映で確定)
- **型を3値に拡張** (M1 [MAJOR] 反映): epic §6 item7(ii) は `"fold"|"evalIrrelevant"` の binary だが、`deck` は「length のみ畳む」第3カテゴリが必要なため `type FoldPolicy = "fold" | "foldLength" | "evalIrrelevant"` とする。const `CARD_STATE_FOLD_POLICY: Record<keyof CardGameState, FoldPolicy>` を新設 (client-safe)。
- **確定分類** (M1 がコード read 実測で確定):

  | slice | policy | 根拠 |
  |---|---|---|
  | `mana` | `fold` | digest + canDraw + getCardActions が参照 |
  | `hand` | `fold` (defId 多重集合で正規化) | getCardActions が hand の defId を読む (合法 card action が内容依存) |
  | `trap` | `fold` | digest.trapValueDelta + 同種トラップ抑止 |
  | `noPromoteMarks` | `fold` | digest + mark-aware 合法手生成に影響 |
  | `drawProgress` | `fold` | digest.drawProgressDelta + canDraw 閾値 |
  | `deck` | `foldLength` | canDraw は `deck.length` のみ参照。内容 fold は断片化 (R-9 悪化)、完全無視は auto-draw 後手札差を誤 hit。**length 一致で同一視が正** (内容は draw 展開時に hand 差として別 hash で吸収) |
  | `graveyard` | `evalIrrelevant` | ai/kernel 探索で read ゼロ (grep 実測)。fold は hit 率を無駄に落とすだけ |
  | `manaCap` | `evalIrrelevant` | 現状 `MANA_CAP` 定数 (S4d で動的化したら `fold` へ昇格要 = コメントで将来注記) |
  | `pendingCard` | `evalIrrelevant` | UI 専用、探索未参照 |
  | `lastTurnStartedAt` | `evalIrrelevant` | 探索は `spectatorMode=true` 固定 (search.ts:980/1297) で早指し無効。**この不変条件に依存する旨を注記** (将来 spectatorMode 可変化時の fold 漏れ防止) |
- **網羅 unit test**: `keyof CardGameState` の全 slice が policy に宣言されていること (宣言漏れ = `Record` 型強制でコンパイルエラー + `Object.keys` 比較で実行時網羅検証)。S4c-2 の `cardFold` 実装がこの policy を参照する。
- **この段では fold を計算しない** (宣言と網羅検証のみ)。実 fold は S4c-2。→ 投機的でなく「S4c-2 が消費する仕様 + その網羅性ガード」。

### S4b-2: WorldState 並走探索 + selector + PoC-1 再検証 (M1 反映で 2a/2b に分割)

**S4b-2a (WorldState 複製 + flag、棋力中立・byte 等価ゲートのみ)**:
- **新シンボル複製**: `negamaxWorld(world, depth, α, β, cardDigest, ...)` / `quiescenceWorld(...)` を search.ts に新設。既存 `negamax`/`quiescence` は 1 行も触らない (M1 観点3=複製で byte 等価維持、S1b の super-action 2系統並存が先例)。遷移は `applyTurnAction`。
- **着手生成入口の API 整合 (M1 [MAJOR] 反映)**: `getLegalTurnActions(world, player)` は**実在しない**。実体 `CurrentRules.getLegalActions(state: AiTurnState, player)` は AiTurnState を取るため、**WorldState を受ける薄ラッパ** (例 `getWorldLegalActions(world, player)` = WorldState→必要フィールドで getLegalActions 相当を呼ぶ) を S4b-2a で新設する。着手生成は `getFullLegalMoves` へ cardState を渡せる入口を用意するが、**幻成りの promote:true→false 置換 (iii)② は S4c スコープ**ゆえ S4b-2a では運ぶ経路までに留める。
- **cardDigest の per-node 更新 (M1 [MAJOR] 反映、inert 化回避)**: WorldState 探索の各ノードで cardDigest を root 固定にすると「木でカードを読むのに価値が動かない」inert 化に陥る (PR3-3 C-9 の罠、digest.ts:142-145)。既存 kernel super-action (search.ts:996-1054) が `updateCardDigest` で per-action 更新する**同パターンを踏襲**し、`negamaxWorld` は親 cardDigest を action ごとに `updateCardDigest` して子へ渡す。評価は既存 `evaluate(world.gameState, variant, cardDigest)` を byte 等価で呼ぶ ((iv) 不要、§11 スコープ判断どおり)。
- **手番ゲート (M1 [MAJOR] 反映、L-3 を S4b-2 にも適用)**: selector が card/draw を展開するのは**自分番ノードのみ**。相手番ノード (+ S4 では自分の深ノードも条件次第) は move-only に絞る (相手カード非展開 = 性能安全 + S5 までフェア)。ラッパ `getWorldLegalActions` の手番/深さ条件でゲート。
- **flag**: `SearchContext`/`FindBestMoveOptions` に `useTurnActionSearch?: boolean` (既定 false) を additive 追加 (S1b `useKernelSearch` と一貫)。`findBestMove` root で分岐。standard は防御ガードで従来経路固定。
- **2a の合否 = ゲート訂正 (実コード精読で判明、2026-06-13)**: 当初案「WorldState 経路が move-only 探索と byte 等価」は**達成不可**と確定。理由: production の deep search (findBestMove→negamax→quiescence) は **完全に move-only** (getSearchLegalMoves / applyMoveForSearch / root 固定 cardDigest スカラー W-1)。WorldState 探索はカードを木に入れ、遷移に applyTurnAction (mana チャージ・evaluateGameEnd 込み = applyMoveForSearch と異なる gameState) を使い、cardDigest を per-node 更新するため、move-only 探索とは**本質的に別物**。よって正しいゲートは:
  - **flag OFF = production 完全 byte 等価** (新コードは flag 裏で未到達 = 既存テスト不変 = 真の保証)。
  - **flag ON = 新 card-aware 探索の correctness** (合法な best action を返す / 終局・詰み検知が正しい / 終了する / カード無し局面では move 集合に対し既存 negamax と同じ最善手を選ぶ、を特性化テストで pin)。
  - **棋力中立** (selector・校正は 2b/S4e)。
- **2a の実装スコープ確定 (実コード精読)**:
  - **TT は積まない** (S4c)。move-only boardHash TT は cardState 差を区別せず、カードを木に入れると誤 hit するため。cardFold TT は S4c-2。2a は TT 無しで correct (深さは TT 無しで低めだが 2b の same-engine 比は交絡相殺、TT 無しは保守的=ゲート通過すれば TT 込みでも通る)。
  - **double_move カードは 2a の木から除外** (S4c で統合)。multi-ply で turnEnded=false の手番継続 (applyTurnAction の double_move 分岐) を負うと negamax の符号/再帰が複雑化するため、2a は move + draw + 単発カード (pawn_return/piece_return/double_pawn/mana_up/setTrap) に限定。`getWorldLegalActions` が double_move を除外。
  - **per-node cardDigest**: `negamaxWorld`/`quiescenceWorld` は親 cardDigest を action ごとに `updateCardDigest` して子へ渡し、leaf の `evaluate(world.gameState, variant, nodeDigest)` に per-node 値を供給 (inert 化回避、M1 [MAJOR])。
  - **手番ゲート**: card/draw 展開は `world.gameState.currentPlayer === rootPlayer` のノードのみ (相手ノードは move-only、L-3)。
  - move 系は既存 negamax のヒューリスティクス (PVS/null-move/LMR/futility/killer/history/scoreMove ordering/quiescence) を faithful port。card/draw は reduction 対象外で move の後に評価。

**S4b-2b (selector + PoC-1 再検証ハーネス + 実測)**:
- **selector**: `selectBranchCandidates(actions, depth, M, K)` = move scoreMove 上位 M + card top-K + draw。難易度別 M/K/budget は `FindBestMoveOptions` 経由で注入 (校正は S4e)。
- **PoC-1 再検証ハーネス**: `scripts/measure-baseline-235.ts` を派生コピー (production コード非改変の script header 契約を維持)。`SearchStats` に nodes/s・TT hit-rate カウンタ追加 (epic 7.6)。
- **合否基準 = same-engine control 比 (M1 [BLOCKER] 反映、epic §8.4.5 整合)**:
  - 一次ゲート = **`useTurnActionSearch` ON 経路内**で「selector あり (M/K 制限)」vs「全 TurnAction 展開 (K=∞ 相当の control)」の depthCompleted を比較し **±10%** を判定 (= epic §8.4.5:291 が明文訂正した「same-engine control 比」の実エンジン版)。これが「カード込み探索の枝刈り余地が実エンジンへ転移するか」という PoC-1 本来の問いに答える。
  - **flag OFF 直接比較を一次ゲートにしてはならない**: flag OFF (カード=root 1-ply のみ、木の外) と flag ON (カード=木の中) は探索構造が非対称で、かつ `applyTurnAction` は `applyMoveForSearch` (board.ts:126 軽量 copy-on-write) より重い (makeMoveWithEffects + evaluateGameEnd フル詰み判定 move-effects.ts:180 を毎ノード)。両者の差は「枝刈り余地」でなく「実装オーバーヘッド + カードを木に入れたコスト」を混ぜるため、誤って不成立判定する。
  - production before-baseline 比 (5.78/6.0、§6 −15% 下限) は **M/K 再校正後の S4e 棋力ゲート**として残し、S4b-2b の PoC-1 ゲートとは**分離**する (§6 にどの比較が S4b-2b ゲート/どれが S4e 棋力ゲートか明記)。
- **不成立なら** epic §7 フォールバック発動 (目標を「depthCompleted −X% + カード使用率 +Y%」へ再定義、playCard のみ浅 budget 限定)。**S4b-2b 完了時に必ず実測値をユーザー提示してから S4c 着手**。

### S4b リスクと対策
- **R-6 standard 巻き込み**: 必ず新シンボル複製・flag OFF 並走。既存 negamax 改変は禁止 (byte 等価ゲートで pin)。
- **getSearchLegalMoves/captureGen の cardState 非対応**: S4b-2a で WorldState を運ぶ経路 + cardState を渡せる入口は作るが、幻成り transform (promote:true→false 置換) は S4c。S4b-2a の着手生成は「入口を用意」までで置換ロジックは入れない切り分け。幻成りを読んだまま PoC-1 を測っても、合否が same-engine control 比 (selector あり/なし) ゆえ幻成りは両者に等しく効き交絡相殺される (絶対 depthCompleted の fidelity には影響するが S4b-2b ゲートには無害)。
- **applyTurnAction の重量 (M1 [MINOR] 反映)**: 毎ノード makeMoveWithEffects + evaluateGameEnd を通るため move-only negamax より重い。PoC-1 の絶対 depthCompleted を構造的に押し下げるが、same-engine control 比 (両者とも applyTurnAction 経由) で交絡相殺される。
- **PoC-1 不成立リスク**: ±10% が出なければ S4c の cutover 設計が変わる。S4b-2b 完了時点で必ず実測しユーザーに結果提示してから S4c 着手。

### M1 マイルストーン1レビュー反映 (S4b 計画策定直後、2026-06-13)
独立 adversarial agent (general-purpose、28 tool uses、search.ts/評価系/CardGameState/epic §8.4.5 を read 実測) で S4b 計画をレビュー。**判定 = 条件付き承認** (骨格・additive 戦略・複製アプローチ・(iv) 繰り下げ判断は実コードと整合し妥当)。反映:
- **[BLOCKER] PoC-1 比較基準**: 「flag OFF vs ON ±10%」→ **same-engine control 比** (epic §8.4.5:291 確定基準) に修正。production 絶対比は S4e 棋力ゲートへ分離。上記 S4b-2b に反映済。
- **[MAJOR] `getLegalTurnActions` 実在せず**: WorldState 版ラッパ新設を S4b-2a に明記。
- **[MAJOR] TT fold 分類**: `graveyard`=evalIrrelevant / `deck`=foldLength に確定 (上記表)。型を3値 `FoldPolicy` へ拡張。
- **[MAJOR] cardDigest per-node 更新**: updateCardDigest 踏襲を S4b-2a に明記 (inert 化 = PR3-3 C-9 再発防止)。
- **[MAJOR] 手番ゲート**: 相手/深ノードの card/draw 抑止 (L-3) を S4b-2a に明記。
- **[MINOR] applyTurnAction 重量注記 / lastTurnStartedAt の spectatorMode=true 前提注記 / S4b-2 → 2a/2b 分割**: 反映済。
- **[確認] (iv) 合成点の S4d 繰り下げ = 妥当** (evaluate は root スカラー cardDigest を受けるだけ、(iv) 不在で PoC-1 歪まず、S4b で入れると投機的デッドコード)。

### S4b-2a 実装 + M2 レビュー反映 (実装完了時、2026-06-13)
S4b-2a (WorldState 並走探索) 実装後、独立 adversarial agent (general-purpose、55 tool uses、既存 negamax との port 差分を実証込みで精査) で M2 レビュー。**判定 = CHANGES_REQUESTED → 修正後 APPROVE**。
- **[MAJOR 反映 `c7d3488`] 王手中 draw 違法注入**: `getWorldLegalActions` が `canDraw()` (isInCheck 非考慮) だけで draw を生成し、王手中の自分番ノードで「王手放置パス」を探索木に注入し minimax 汚染。draw ゲートに `!isInCheck` 追加 + 特性化テスト1件。reducer.ts DRAW_CARD (王手中ドロー禁止) と整合。
- **[PASS 確認 (実証込み)]**: flag OFF production 不変 (三重ゲート + cardState 未供給 caller + 既存 negamax 無改変)、negamax 符号規約一貫 (相手詰めろで玉逃げ選択を実証)、詰み検知 (status ベース + actions.length===0 整合、頭金詰みを world/move-only 両経路で同一選択)、per-node digest 引数順、findBestMoveWorld root PVS + 返り値常に合法 move、終了性。
- **[NIT 維持]**: `turnEnded===false` 分岐は 2a で到達不能な防御コード (コメント済、S4c 統合まで現状維持)。stalemate→0 は move-only と意図的一致 (将棋で実質到達不能)。
- ✅ **(解消済) コミット subject 修正**: M2 修正コミットを一度 `fix: #235 ...` (auto-close 罠) にしたが、ユーザー承認のうえ amend で reword (`7bee0c0`→`c7d3488` = `fix: S4b-2a 〜 (M2指摘、Refs #235)`) + doc commit 載せ替え (`6ae8293`→`3353d97`) + force-with-lease。ブランチ内に `fix #235` 系 subject なしを確認済。

### S4b-2b: selector + PoC-1 再検証 実測結果 (2026-06-13)
selector (`selectBranchCandidates`) + ハーネス `scripts/measure-poc1-235.ts` で same-engine control 比を実測。fixture = realistic perf 局面 (initial+8ply、両側カード対称付与=cardDigest 偏り回避)、M=10、time=2000ms、3-run median。

| K | median ratio | min | 合否 (≥90%) | 解釈 |
|---|---|---|---|---|
| **K=1** (card 上位1+draw) | **90.6%** | 88.5% | ✅ **PASS** | カード追加の純コスト ~9% = 枝刈り余地が実エンジンへ転移 |
| **K=2** (card 上位2+draw) | 88.5% | 84.6% | ❌ FAIL | ~11.5%、band をわずか超過 |

- **結論 = PoC-1 は K=1 で PASS (S4c cutover 可能)**。原 PoC (bare-αβ) は K=2 で 91-97% だったが、**実エンジンの move 枝刈り (null-move/LMR) で card が相対的に高コスト化**し K=2 は band 超過 — PoC-1 の honest caveat #1「M/K の同値転移は保証されない、実エンジンで再校正」が的中。**S4c selector の既定は K=1**、K=2 を使うなら card 側にも reduction (card-LMR/budget/phase-gating) が必要 (S4e 校正マター)。
- **絶対 depth が高い (32-39)** のは M=10 selector + 静かな序盤局面での aggressive null-move 枝刈り (実効分岐 ~1.4) のため。fixture を両側カード対称にしても変わらず=cardDigest 非対称由来でないことを確認済。合否は同一エンジン control 比で判定する設計ゆえ絶対 depth は交絡相殺 (TT 無し含め保守的)。**realistic midgame での K 妥当性は S4e 校正で再確認推奨** (PoC fixture は openings で原 PoC と comparable に保つ)。
- **合否バンドの扱い (§6 整合)**: 本 same-engine control 比 (±10%) が S4c cutover の一次ゲート。production before-baseline 絶対比は S4e 棋力ゲートへ分離 (M1 [BLOCKER] 反映どおり)。

## 12. S4c-1 実装計画 (concrete、2026-06-13、研究調査 + rule-8 計画策定)

S4c-1 = S4 最大の cutover。production AI を bolt-on から WorldState 単一探索木 (`findBestMoveWorld`) へ切替え、**カードを move と同じ深さで読む**ようにする (P1 = advanced/expert カード使い渋り 57% の構造的主因を解消)。**S4c-1 から初めて production の棋力が実際に変わる**。

### 12.0 確定スコープ (ユーザー決定 2026-06-13)
- **D-A (double_move 完全統合)**: AI が二手指しを**実際に指せる**ようにする。探索木のマルチ ply 統合 (= 二手指しを読んで選べる「決定」側) + 実行プラミング (route payload・engine 入口・ai-action-bridge・reducer 連携 =「実行」側) を S4c-1 に含める。従来の「論点 A = AI 未接続 (ai-action-bridge.ts:44 が null→move フォールバック)」を解消する。
- **D-B (全難易度 cutover + noise 移植)**: 4 難易度すべてを world 経路へ切替える。`findBestMoveWorld` に `addNoise`/`nearEqualThreshold` を **root アクション上**で移植し、beginner/intermediate の弱さ演出を保つ。
  - **判断根拠**: 単一探索経路 = bolt-on (約 400 行: evaluateActionWithLookahead/searchDoubleMoveSuperAction(+Kernel)/evaluateAction/getOpponentResponseScore/applyActionForLookahead) を将来完全除去でき、カード評価 2 方式の分裂を**生まない**。難易度で経路分割すると逆に分裂を生む。noise 移植は忠実 (addNoise は actionOrderScore 上位5 = カードが -1 で最後尾ゆえ実質「ランダム駒 move」= 現挙動とほぼ等価。nearEqual は near-best プールにカードが入るだけ)。
- **D-C (bolt-on は flag-OFF 経路で残置、削除は S4d)**: cutover 中のロールバックを「flag を戻すだけ」で可能にするため、bolt-on は物理削除せず flag-OFF 経路として残す (§7 ロールバック設計を維持)。world 経路が bench/実機で実証された **S4d** で bolt-on (+ useKernelSearch flag) を物理削除する (その時点では git revert がロールバック)。

### 12.1 探索木の確定セマンティクス (M1 反映で正本化)
1. **カードは root のみ展開** (計画 §3 S4c-1「相手ノード + 自分の深ノードも card/draw 抑止」を正本化):
   - **現状の不整合 (実コード精読)**: `findBestMoveWorld` root が `negamaxWorld` に rootPlayer=`opponent` を渡す (search.ts:1108) ため、gate `currentPlayer === rootPlayer` が**相手ノードで真**= カードが相手番で展開される (S4b-2a の PoC 探索用挙動)。S4c-1 はこれを是正する。
   - **正本**: カード/ドロー展開は **root の自分番ノードのみ**。root 以降 (相手番・自分の深ノード) は move-only 継続 (= 「カードを今打つ」の帰結を move-only で深く読む = move との公平比較を成立させる最小設計。multi-card planning は S5/L3)。double_move の継続 move は move ゆえ move-only 木で自然に読まれる。
   - **実装**: `getWorldLegalActions(world, variant, expandCards: boolean)` へ signature 変更 (rootPlayer 引数を撤去)。root 呼出 (`findBestMoveWorld`) のみ `expandCards=true`、`negamaxWorld` は `expandCards=false` (move-only)。card/draw gate = `expandCards && variant.id==="card-shogi" && world.doubleMove===null`。`negamaxWorld` から rootPlayer 引数を撤去 (threading 簡素化)。
2. **double_move マルチ ply 統合 (D-A 決定側、R-8 反映)**:
   - root の自分番ノードで `double_move` カード action を生成 (現 getWorldLegalActions:780 の `continue` 除外を撤去)。
   - 中間遷移 (turnEnded=false: double_move カード set / 1 手目) は **depth を減らさず**・**符号反転せず**・**同 player 視点で**再帰する (= 「二手指しは 1 ターン」を depth 会計で表現。turn 境界の最終 ply でのみ depth-1)。`applyTurnAction` の turnEnded で判定。
   - **R-8 不変条件 (中間局面の leaf/TT 禁止)**: 中間ノード (doubleMove !== null) は depth 保存設計により常に depth ≥ 1 で進入する (turn 開始ノードが depth 0 なら leaf 化して double_move を展開しない) → **中間ノードは leaf 評価に到達しない** (quiescence 未呼出)。check_break defer (1 手目保留→2 手目発火) 済の不整合盤面を評価しない。S4c-1 は TT 無しゆえ TT store は N/A (S4c-2 で fold 時に同不変条件を再担保)。本不変条件をコメント + 特性化テスト (中間ノードで evaluate が呼ばれないこと) で pin。
   - 中間ノードでは futility/LMR を抑止 (`world.doubleMove === null` を gate に追加)。move-only の turn-ending 子のみ PVS/LMR/futility 適用。
3. **mid-turn 再クエリ実行 (D-A 実行側)**: AI が root で double_move を選んだら、ai-action-bridge が double_move カードを dispatch (現 null 撤去) → reducer が doubleMove 状態へ (currentPlayer は自分のまま) → AI useEffect 再発火 → route payload に doubleMove を載せて再クエリ → engine が mid-turn world を root に探索 (継続 move を move-only で生成) → 最善継続 move を返す → 1 手目 dispatch → movesLeft 2→1 → 同様に 2 手目。**決定側 (root の deep tree) と実行側 (mid-turn 再クエリ) は各々独立に最適でよく、PV の一致は不要**。

### 12.2 返り値拡張: best TurnAction
- `RootSearchResult` に **`bestAction?: TurnAction`** を additive 追加 (move-only `findBestMove` は未設定 = engine が `{kind:"move", move}` を構築 = 既存不変)。
- `findBestMoveWorld` を:
  - root の全 action (move / card / draw / double_move) を**同列にスコアリング**し、`bestAction` (全 kind の argmax) + `bestMove` (move-only argmax、blunder guard 用) + `rootMoveScores` (move のみ) を返す。
  - root の turnEnded=false action (double_move カード) は同 player・同 depth・無反転で再帰 (12.1-2)。
  - **noise/nearEqual を root アクション上で適用** (D-B): nearEqualThreshold>0 なら best から閾値内の root アクションから random、addNoise>0 なら actionOrderScore 上位5 から random (= 既存 findBestMove と同型、対象を Move→TurnAction に一般化)。noise 適用後の action を `bestAction` に反映。
- export 化 (特性化テスト用)。

### 12.3 selector 配線 (root のみ、難易度別注入)
- selector は **root のみ**適用 (カードが root のみ展開ゆえ deep node では no-op)。`negamaxWorld` 内の selector 呼出 (search.ts:941) を撤去 (move-only deep node では move 全展開 + LMR が move 強度を保つ)。
- 既定 **M=∞ (move 上限なし=move 強度温存)・K=1** (PoC-1 で K=1 PASS / K=2 FAIL)。難易度別 `SELECTOR_PARAMS: Record<Difficulty,{M,K}>` を engine に新設し ctx.selectorM/K へ注入 (S4c-1 は全難易度 M=∞/K=1、実校正は S4e)。

### 12.4 engine.ts cutover
- `FindBestMoveOptions` に `useTurnActionSearch?: boolean` を additive 追加 (route が true を渡す)。
- `worldPathActive = (options.useTurnActionSearch ?? false) && variant.id==="card-shogi" && options.cardState!==undefined`。
- ctx に `useTurnActionSearch`/`selectorM`/`selectorK` を注入。`findBestMove` に cardState (6 番目引数) を `worldPathActive ? options.cardState : undefined` で渡す → world 経路へ分岐。
- doubleMove 受領: `FindBestMoveOptions.doubleMove?` (mid-turn 再クエリ用) を additive 追加。rootWorld 構築時に注入。
- **bolt-on の skip**: `worldPathActive` のとき root action loop (315-381) + actionPhaseDeadlineAt 設定 (335-336) を skip。`selectedAction = searchResult.bestAction`、`usingCardAction = bestAction.kind!=="move"`。world 経路は deadline 内でカードを読むため action-phase budget (504 対策) は不要。
- blunder guard: 現状の `!usingCardAction` gate で move 選択時のみ作動 (世界経路でも rootMoveScores が deep move score として有効)。

### 12.5 実行プラミング (D-A)
- **route payload** (use-card-shogi-game.ts:146 + route.ts): `doubleMove`(reducer KernelDoubleMove 相当) と `useTurnActionSearch:true` を追加。
- **route.ts**: `useTurnActionSearch:true` を常時付与 (S1d の useKernelSearch と併存。world 経路 active 時 useKernelSearch は無効果)。
- **ai-action-bridge.ts**: double_move を null でなく `[BEGIN_PLAY_CARD(double_move), CONFIRM_PLAY_CARD]` へ (DOUBLE_MOVE_DEF_ID 分岐撤去)。
- **reducer/hook**: AI が mid-turn (doubleMove 状態) で再クエリされる経路が既存 human フローと同じ machinery (isPlayingCard 等 animation gate) で動くことを検証 (実装時に reducer の doubleMove 遷移 + AI useEffect deps を確認)。

### 12.6 サブ分割 (revert 粒度・review 容易性)
- **S4c-1a (world engine core、非 double_move、flag OFF)**: §12.1-1 (カード root-only 是正 + getWorldLegalActions signature) + §12.2 (best TurnAction + noise 移植) + §12.3 (selector root-only)。double_move は除外維持。production 不変 (flag OFF)。特性化テスト。
- **S4c-1b (double_move 決定側、flag OFF)**: §12.1-2/3 の探索木マルチ ply 統合 + R-8 中間ノード no-leaf 不変条件。production 不変 (flag OFF)。特性化テスト (double_move を最善時に選ぶ / 中間ノード無評価 / kernel-search-equivalence の二手指し詰みケース不変)。
- **S4c-1c (production cutover + 実行プラミング)**: §12.4 (engine cutover) + §12.5 (route/bridge/reducer)。**ここで production 棋力が変わる**。bench 全4難易度 before/after。単一 revert = route の flag を戻す。

### 12.7 検証ゲート (§6 整合 + S4c-1 固有)
- 各サブ段 lint→typecheck→test:ci→build。standard byte-level 不変 (flag OFF 経路)。
- **S4c-1c bench (全4難易度 before/after)**: depthCompleted は **TT 無し (S4c-1) + applyTurnAction overhead + カード追加**で**意図的に下がる**。S4c-1 の bench は**情報取得**目的 (no-TT+card コストの可視化) とし、§6 の棋力合否バンド (depthCompleted ≥ before−15% / card% ≥70%) は **TT 復帰後の S4c-2 / 校正後の S4e** で判定する (S4c-1 では「暴落しすぎていないか」「card% が改善方向か」「beginner/intermediate の weakness が保たれるか」を定性確認)。
- **beginner/intermediate weakness 検証 (D-B 固有)**: noise 移植後の手の分布・depthCompleted を bench で確認し、過度に強くなっていないことを報告。
- **double_move 実機検証 (D-A)**: AI が二手指しを実際に指す経路を test (ai-action-bridge) + 必要なら手動/Vercel で確認。

### 12.8 リスク (§5 に S4c-1 固有を追加)
- **R-10 (double_move 実行の machinery 整合)**: mid-turn 再クエリが human フローの animation gate (isPlayingCard/isCheckBreakAnimating) と整合しないと AI が固まる/二重 dispatch。→ reducer/hook の doubleMove 経路を実装時精査 + bridge test。
- **R-11 (noise 移植による beginner/intermediate 回帰)**: 手の分布変化で弱さが崩れる。→ bench 定量確認、崩れたら nearEqual/addNoise の対象範囲を調整。
- **R-12 (S4c-1 単独の depthCompleted 暴落)**: TT 無し + カードで深さが大きく落ちる可能性。→ S4c-1 bench は情報目的、棋力ゲートは S4c-2(TT)/S4e(校正)。暴落が致命的なら S4c-2 を前倒し。
- **R-8 再掲 (中間局面 leaf/TT)**: §12.1-2 の depth 保存設計 + 特性化テストで pin。

### 12.9 M1 マイルストーン1レビュー反映 (S4c-1 計画策定直後、2026-06-13、AGENTS.md ルール8)
独立 adversarial agent (general-purpose、21 tool uses、search.ts/engine.ts/world-kernel/reducer/hook/route を read+grep 実証) で S4c-1 計画をレビュー。**判定 = CHANGES_REQUESTED**。骨格 (additive→cutover / root-only カード是正 / noise 移植方向 / bolt-on 残置) は実コードと整合し妥当と確認。ただし **D-A (double_move 完全統合) に [BLOCKER] 3 件**が判明し、これらは「実装時確認」でなく「着手前に設計確定が必須」。

#### [BLOCKER] 反映必須 (double_move 実行プラミング)
- **B-1 (AI useEffect が double_move 中に再発火しない = デッドロック)**: `use-card-shogi-game.ts:207-218` の deps に `state.doubleMove` 無し。CONFIRM_PLAY_CARD(double_move) も MAKE_MOVE(1手目) も `currentPlayer` を `dm.active`(自分)維持 (`reducer.ts:618` / `world-kernel.ts:305`)、`isPlayingCard` も false 維持 (`reducer.ts:1046`)。→ **mid-turn 再クエリ方式 (§12.5) は AI が double_move を選んだ瞬間に 1 手目すら指さず停止する**。
- **B-2 (route payload 5 箇所連鎖 + 肥大)**: doubleMove 伝播は (1) `use-ai-request.ts AiMoveRequestParams` / (2) `route.ts AiMoveRequestBody`+validateBody / (3) `FindBestMoveOptions` / (4) `findBestMoveWorld` rootWorld 注入 (`search.ts:1056` の `doubleMove:null` ハードコード) / (5) reducer `state.doubleMove`(UI 拡張型 preFirstMoveState/preCardState 含む) → `KernelDoubleMove` narrowing、の 5 箇所。narrowing 無しで送ると payload 肥大 (MAX_PAYLOAD_BYTES=100KB)。
- **B-3 (mateInOneAvailable 二手指し制約の休眠バグ顕在化 = correctness 穴)**: 二手指し 2 手目には「1 手目で 1 手詰み可能なら 2 手目の詰み手を禁止」制約 (`reducer.ts:357/380` partitionDoubleMoveSecondCandidates)。`getWorldLegalActions:760` は `getFullLegalMoves` のみで本制約を**一切適用しない**。現 bolt-on `searchDoubleMoveSuperAction` も無視しているが、`ai-action-bridge.ts:44` の null フォールバックで double_move を実際に指さないため**休眠**。D-A で実際に指すと**ルール違反手を AI が選び reducer が無条件適用**。探索木・mid-turn・bridge の 3 経路すべてで mateInOne 制約の保証が必要。

#### [MAJOR] 反映
- **M-1 (round-trip 3 回)**: mid-turn 再クエリは「カード使用 + 各継続 move」で 1 ターン 3 リクエスト = レイテンシ/504 リスク 3 倍 + 不自然 UX。→ **代替 = 1-response 方式** (root で double_move 決定時に move1+move2 もサーバ側で確定し 1 レスポンスで返却、bridge が `[BEGIN_PLAY_CARD, CONFIRM_PLAY_CARD, MAKE_MOVE(1手目), MAKE_MOVE(2手目)]` を 1 dispatch 列で実行)。これは B-1(再発火不要)/B-2(payload doubleMove 不要)/M-1 を**同時に解消**。move1/move2 抽出は (a) 木の double_move 線 PV 追跡 or (b) root の double_move 専用評価ヘルパ (score + move1/move2 返却) のいずれか。
- **M-2 (R-8 check extension 抑止漏れ)**: §12.1-2 は中間ノードで futility/LMR 抑止と書くが `negamaxWorld:933` の check extension (`depth++`) 抑止を書いていない。中間ノードで depth++ が起きると double_move 経路の evaluate 到達深度が move 経路と非対称化。→ **中間ノード (doubleMove!==null) では check extension も抑止** (depth を親から純粋保存)。既存保険分岐 (`search.ts:1002-1006`) の `depth-1`→`depth` 改変箇所も明記。
- **M-3 (bolt-on デッドコード化)**: 全難易度 cutover + route 常時 flag ON で bolt-on は flag-OFF test/bench のみ到達。→ S4c-1 完了時点で bolt-on 経路を叩く回帰テスト (kernel-search-equivalence 等が flag OFF) が実在することを §12.7 ゲートで確認。

#### [MEDIUM] 反映
- **MED-1 (noise ソート関数不一致)**: 既存 `findBestMove` addNoise は `scoreMoveForOrdering` (`search.ts:722`) でソートするが、計画示唆の `actionOrderScore` は `scoreMove` (TT/killer/history 参照) で**別関数**。beginner byte 等価が崩れる。→ noise 移植の move ソートは **`scoreMoveForOrdering` を使う**ことを明記。
- **MED-2 (deep-node selector 撤去で PoC-1 再実行不能)**: `negamaxWorld:941` の selector 撤去で `measure-poc1-235.ts` の deep-node selector が効かせられなくなる。→ S4b 完了済ゆえ実害なしだが、S4e で deep-node selector が要るなら撤去でなく「root のみ有効化 (deep は M=∞ で no-op)」を選ぶ。計画に注記。
- **MED-3 (blunder guard rootMoveScores × selector)**: world 経路の rootMoveScores は selector M 絞り後の move のみ。blunder guard の静的フォールバック発動率が変わり得る。→ S4c-1c bench で usedFallback/guard 発動率を観測項目に追加。

#### [MINOR/PASS]
- DEBUG_AI_EVAL は world 経路でも move から導出可で dangling せず (ただしカード採用時は無関係 move の breakdown を出す点を注記)。usedCardAction stats は bestAction.kind から導出可 (PASS)。Date.now() event の payload 混入懸念は杞憂 (TurnAction/CardInstance はプレーン型、PASS)。single-legal-move early return (`search.ts:1068`) も bestAction 設定が必要。

#### M1 が突き付けた根本論点 (ユーザー確認事項)
**D-A (double_move 完全統合) は S4c-1 を過大化させ、かつ B-3 (mateInOne 休眠バグ) という correctness landmine を含む。** M1 の推奨 = **double_move を S4c-1 から分離** (決定側のみ先行 or 実行側ごと別段階 S4c-1d)。現 `ai-action-bridge.ts:44` の null フォールバックを維持すれば、非 double_move カードの深読み cutover (P1 の主因解消) を先に安全に出荷でき、double_move は landmine 対応込みで独立段階に切れる。**着手前にユーザーへ double_move スコープと実行方式 (1-response vs 分離) を確認する。**

### 12.10 最終スコープ確定 (ユーザー決定 2026-06-13: double_move 分離) ★本節が S4c-1 の正本
ユーザー決定 = **double_move を分離**。これにより M1 の [BLOCKER] B-1/B-2/B-3 + [MAJOR] M-1 (すべて double_move 実行起因) は S4c-1 から**除外**され、残る非 double_move 設計は M1 で妥当性確認済 (root-only カード是正・noise 移植方向・bolt-on 残置)。§12.1-2 (double_move マルチ ply) / §12.1-3 (mid-turn 再クエリ) / §12.5 の double_move 部分は **S4c-1d へ繰り下げ (本 S4c-1 では実装しない)**。MED-1/MED-3/M-3/MINOR は本 S4c-1 に反映。

#### S4c-1 で実装する範囲 (非 double_move)
- **S4c-1a (world engine、flag OFF、production 不変)**:
  1. `getWorldLegalActions(world, variant, expandCards: boolean)` へ signature 変更 (**rootPlayer 引数撤去**)。card/draw gate = `expandCards && variant.id==="card-shogi" && world.doubleMove===null`。**double_move は引き続き除外** (現 search.ts:780 の `continue` 維持。AI は double_move を候補化しない = 現状の null フォールバックと整合)。draw gate は `!isInCheck && canDraw` 維持。
  2. `negamaxWorld`: `getWorldLegalActions(world, variant, false)` = move-only。**rootPlayer 引数撤去**。selector 呼出 (search.ts:941) は**残す** (MED-2: move-only に対し M=∞ で no-op、S4e で deep-node M 校正 + PoC-1 再実行余地を保つ)。turnEnded=false 保険分岐 (1002-1006) は double_move 除外ゆえ到達不能のまま維持 (既存 NIT、S4c-1d で live 化)。
  3. `findBestMoveWorld`:
     - root = `getWorldLegalActions(rootWorld, variant, true)` + selector (M=∞/K=1 既定)。全 action は turnEnded=true (double_move 除外) → 既存 root 反転処理が正しい。
     - **bestAction (move/card/draw の argmax) + bestMove (move argmax、blunder guard 用) + rootMoveScores (move のみ) を返す**。
     - **noise/nearEqual を root アクション上で適用** (D-B): nearEqualThreshold>0 = best から閾値内 root アクションから random、addNoise>0 = **`scoreMoveForOrdering`** (MED-1、既存 findBestMove:722 と同関数) で move 上位5 から random。適用後 action を bestAction へ。
     - single-legal-move early return (1068) も **bestAction を設定** (MINOR)。
  4. `RootSearchResult` に `bestAction?: TurnAction` additive 追加 (move-only findBestMove は未設定 = engine が `{kind:"move"}` 構築 = 不変)。`findBestMoveWorld` を export。
  5. テスト: bestAction 正当性 (move/card/draw) + bestAction/bestMove 一致 (move 採用時) + expandCards gate (カードは root のみ・double_move 除外) + noise の対象が scoreMoveForOrdering + flag OFF production 不変。
- **S4c-1b (production cutover、全難易度)**:
  1. `FindBestMoveOptions` に `useTurnActionSearch?: boolean` additive。`SELECTOR_PARAMS: Record<Difficulty,{M:number,K:number}>` 新設 (全難易度 M=∞/K=1、根拠 PoC-1 K=1 PASS をコメント。S4e 校正)。
  2. engine: `worldPathActive = (options.useTurnActionSearch ?? false) && variant.id==="card-shogi" && options.cardState!==undefined`。ctx に useTurnActionSearch/selectorM/K 注入。`findBestMove` に cardState (6番目) を worldPathActive 時のみ渡す。
  3. engine: worldPathActive 時 bolt-on root loop (315-381) + actionPhaseDeadlineAt (335-336) を skip。`selectedAction = searchResult.bestAction`、`usingCardAction = bestAction.kind!=="move"`。blunder guard は既存 `!usingCardAction` gate で move 採用時のみ作動 (rootMoveScores が deep move score)。
  4. route.ts: `useTurnActionSearch:true` を付与 (useKernelSearch と併存、world active 時 useKernelSearch は無効果)。
  5. bolt-on は flag-OFF で残置 (D-C、削除は S4d)。**M-3: flag-OFF 経路を叩く回帰テスト (kernel-search-equivalence 等) が実在することを確認** (デッドコードでないこと)。
  6. bench 全4難易度 before/after: depthCompleted (TT 無しで意図的低下、情報目的) / card% (改善方向か) / **usedFallback・blunder guard 発動率 (MED-3)** / **beginner/intermediate weakness (R-11、過度に強化されていないか)**。棋力合否バンドは S4c-2(TT)/S4e(校正) で判定。
- **double_move 実行**: `ai-action-bridge.ts:44` の null フォールバック維持。world 経路は double_move を候補化しないため bestAction が double_move になることは無く、production は「最善の非 double_move アクション」を指す (旧 bolt-on で double_move 最善時に move へフォールバックしていたのが、新経路では最善カードを指せる = むしろ改善)。

#### S4c-1d (別段階、S4c-1 完了・実証後に着手) = double_move 完全統合
- 決定側 (探索木マルチ ply 統合 §12.1-2 + R-8 中間ノード no-leaf + **M-2 check extension 抑止**) + 実行側 (**1-response 方式** = サーバ側で card+move1+move2 確定し 1 レスポンス返却、bridge が 1 dispatch 列で実行。B-1 再発火不要/B-2 payload doubleMove 不要) + **B-3 mateInOne 二手指し制約を探索着手生成に組込み**。着手前に専用 M1 を再実施。

#### S4c-1 サブ段順序 (確定)
S4c-1a (world engine) → S4c-1b (production cutover + bench) → [S4c-2 TT fold] → [S4c-1d double_move 別途] → S4d → S4e。各段 lint→typecheck→test:ci→build。

### 12.11 S4c-1b 実装 + M2 + bench で発覚した null-move 退化窓バグ (2026-06-13)

#### M2 マイルストーン2レビュー (S4c-1a+1b 実装完了時、AGENTS.md ルール8)
独立 adversarial agent (general-purpose、58 tool uses) で S4c-1a+1b をレビュー。**判定 = APPROVE_WITH_NITS** (ブロッカー無し)。cutover gating / blunder guard 整合 / standard・flag OFF 不変 / double_move 除外 / end-to-end カード配線は実コードで健全と確認。反映した指摘:
- **[MED-1] cutover ブランチの自動テスト皆無** → engine cutover (useTurnActionSearch:true) の特性化テストを search-world.test.ts に追加 (card 採用 / generic move 採用)。
- **[MED-2] deep-node selector の no-op アロケーション** → `selectBranchCandidates` に早期 return (card/draw 無 + M=∞ なら入力即返し) を追加。
- **[MED-3] beginner/intermediate の nearEqual が card 採用し得る** → bench で R-11 を確認 (下記)。

#### ★ bench (flag ON) で card% 0% を検出 → 実バグ発覚 (ユーザー指摘が的中)
S4c-1b cutover 後の bench (BENCH_WORLD=1) で **card% 全難易度 0%** + depthCompleted 異常増 (advanced 15 / expert 22) + node 激減を観測。ユーザーの「カード効果+局面を正しく評価しているか? 一貫して 0% は不自然」という指摘を受け、カード明確有利局面 (自歩 pawn_return で飛の利きを通し成り/駒得) で診断 → **world 探索が無意味な手を選び card を一切採用しない実バグを確認**。

- **根本原因 = null-move 退化窓による ±Infinity 汚染**: `findBestMoveWorld` は aspiration window を持たず PV を full-window (beta=+Infinity) で探索する。`negamaxWorld` の null-move は null 窓 `(-beta, -beta+1)` を使うが、beta=+Infinity では `(-Infinity, -Infinity+1)=(-Infinity, -Infinity)` と退化。これが `quiescenceWorld` に alpha=±Infinity を渡し、`finite > +Infinity = false` で `currentAlpha` が ±Infinity のまま返り、探索全体に ±Infinity が伝播。root 全 action が同値 (-Infinity) 化し argmax が無意味な初手を選ぶ + 反復深化が即完了し depth 暴走。既存 negamax は aspiration で beta 有限のため本問題は起きていなかった。
- **修正 (`search.ts`)**: null-move を `Number.isFinite(beta)` のときのみ実行。beta=+Infinity では `nullScore >= beta` は原理的に成立し得ず null-move 自体が無意味ゆえ skip が正しい (退化窓回避 + 無駄排除)。
- **修正後の検証**: 診断局面で world が **pawn_return を正しく選択** (score 931 > 全 move 837)、depth は現実値 (5) に。回帰テスト追加 (±Infinity 汚染なし / engine 経路 card 採用 / generic move 採用)。

#### 修正後 bench (S4c-1、TT 無し、flag ON 計測)
- depthCompleted: beginner 2.9 / intermediate 4 / advanced 4.7 / expert 4.7 (bolt-on 3/5.33/5.78/6 比で **低下** = TT 無しの想定どおり、棋力ゲート before−15%=5.1 未達)。
- card%: 依然 ~0% (intermediate 1run で 14%)。**バグ修正後も低い理由 = (i) bench の generic fixture (buildPawnReturnHand) は correct な deep search にとって真にカード有利でない (bolt-on は浅い評価+下駄で過剰採用していた)、(ii) TT 無しで depth 4-5 が浅く、カード戦術 (depth ~5 必要) を justify しきれない**。S4c-2 (TT) で depth 回復 → カード戦術が深く見える → card% 改善見込み。

#### 活性化判断: production cutover は S4c-2 後へ延期 (route flag OFF 据え置き)
S4c-1 単独 (TT 無し) は depthCompleted が棋力ゲート未達 + card% 低のため、今 route flag を ON にすると AI 弱化 + カード使用減の**回帰**になる。よって **route.ts の `useTurnActionSearch:true` は追加せず** (production は bolt-on 維持 = 無回帰)、engine.ts の cutover 配線は完成・テスト済 (flag OFF で dormant)。**S4c-2 (TT) で depth 回復後に bench 再測定 → net-positive を確認して活性化**。null-move バグ修正は world 経路の correctness fix として本段で確定 (flag OFF でも価値)。
- **S4c-1 で確定した成果**: world engine (root-only card / bestAction / noise / selector) + **null-move 退化窓バグ修正** + cutover 配線 (dormant) + bench 両刀計測 (BENCH_WORLD)。
- **次段 S4c-2 (TT cardState fold)** で depth 回復を最優先 → 再 bench → 活性化。

#### ★ product 決定 (ユーザー、2026-06-13): カード使用に engagement 下駄 = 楽しさ優先 (A)
「最適に指すと card% が bolt-on (57%) より低くなる」場合の方針として、ユーザーは **A = 多少の損でもカードを使わせてゲームを盛り上げる (engagement 優先)** を選択。**カード使用に engagement 下駄 (card 価値ボーナス) を履かせてよい**と明言。
- **適用先 = S4d/S4e**: world 経路の root カード/draw スコアに engagement ボーナス (bolt-on の getCardValue/getDrawValue 系 + S3 valueModel + 追加の使用促進係数) を加算し、card% を目標帯 (advanced/expert ≥70%、§6) へ引き上げる。S4e で係数を bench 校正 (使いすぎ=弱化 と 使わなさすぎ=engagement 低 のバランス点を探す)。
- **棋力との両立**: 下駄は「僅差なら card を選ぶ」程度に抑え、明確に損なカードは依然選ばない (deep search の correctness は維持)。純粋最適 (B) でなく engagement 寄りだが、暴発防止のため tadasute 等の安全網は保持。

## 13. S4c-2 実装計画 (concrete、2026-06-13、TT cardState fold)

S4c-2 = WorldState 探索に **cardState-aware TT** を導入し、S4c-1 で落ちた depthCompleted (world 4-5 < bolt-on 6) を回復する。TT は engine 最大のバグ源 + 誤 hit が silent に棋力を壊す (R-3) ため correctness 最優先で設計する。

### 13.0 ゴール / 非ゴール
- **ゴール**: (1) world 探索 (negamaxWorld/findBestMoveWorld) に TT probe/store を追加し depthCompleted を bolt-on 比 −15% 以内 (≥5.1) へ回復。(2) TT key = `boardHash ^ cardFold`、cardFold は `CARD_STATE_FOLD_POLICY` (S4b-1b) 準拠。(3) 誤 hit ゼロ (同一盤面・異 cardState は別 key、異 evalIrrelevant slice は同 key)。
- **非ゴール**: card engagement 下駄 (S4d/S4e、決定 A)。double_move (S4c-1d)。selector 校正 (S4e)。standard variant (move-only TT は無改変)。

### 13.1 card zobrist キー + computeCardFold (新規 `card-zobrist.ts`)
move-only の zobrist.ts (盤+持駒+手番) は無改変。cardState 用の別キー表を新設 (client-safe、module load 時 random)。`{lo, hi}` 32bit×2 (zobrist.ts と同形式、XOR 合成)。
- **fold 対象 slice (CARD_STATE_FOLD_POLICY="fold"/"foldLength")**:
  - `mana` (sente/gote 各 0..MANA_CAP): `MANA_KEYS[player][manaValue]`。
  - `hand` (sente/gote): **defId 多重集合で正規化** (順序非依存)。各 defId の所持数 count を `HAND_CARD_KEYS[player][defId][count]` で XOR (count 上限は手札最大枚数)。
  - `trap` (sente/gote): defId or null → `TRAP_KEYS[player][defId]` (null は 0)。
  - `noPromoteMarks` (sente/gote): **★ count でなく position で fold (correctness)**。mark-aware 合法手生成は「どのマスがマークか」に依存するため、count 一致でも position 違いは別局面 = 別 key にする必要。`MARK_KEYS[player][squareIndex(0..80)]` を各マーク駒位置で XOR (policy は "fold" だが実装は position 単位、§13.5 R-3a)。
  - `drawProgress` (sente/gote 各 0..AUTO_DRAW_INTERVAL): `DRAW_PROGRESS_KEYS[player][value]`。
  - `deck` (foldLength): `DECK_LEN_KEYS[player][length]` (length のみ、内容無視)。
- **evalIrrelevant slice はキーに含めない**: graveyard / manaCap / pendingCard / lastTurnStartedAt。
- `computeCardFold(cardState: CardGameState): ZobristHash` = 上記の XOR 合成。**毎ノード full 計算** (O(hand 枚数 + mark 数 + 定数) = 小、incremental は不要・誤りの温床になるため避ける)。
- **doubleMove**: S4c-1 では world.doubleMove 常時 null ゆえ fold 不要。S4c-1d で double_move を木に入れる際に doubleMove(active/movesLeft) を fold へ追加要 (本計画にコメントで予約)。

### 13.2 boardHash の維持 (incremental + 全量再計算ゲート)
world 探索の遷移は `applyTurnAction`。boardHash は:
- **通常 move (`boardChangedBeyondMove === false`)**: 既存 `updateHash(parentBoardHash, parentState, move, childState)` で incremental 更新 (move 1 手分、move-only と同関数)。
- **card / check_break 発火 move (`boardChangedBeyondMove === true`)**: incremental 不可ゆえ `computeHash(childState)` 全量再計算 (S4b-1 の戻り値で検知)。
- **draw / setTrap / mana_up (盤不変)**: boardChangedBeyondMove=false かつ盤不変だが currentPlayer flip + 手番キー変化 → updateHash は move 前提で使えない。**盤不変ノードは parent boardHash の手番キーのみ XOR トグル** (computeHash の SIDE_TO_MOVE 部分) で更新。← 要検討: draw/setTrap/mana_up は move を持たないため updateHash 不可。簡潔策 = これらも computeHash 全量 (盤不変でも安全)。**判断: 実装簡潔性 + 誤り回避優先で「move 以外 (card/draw 全般) は computeHash 全量、通常 move のみ incremental」とする** (boardChangedBeyondMove は「move だが盤が1手以上動いた」検知用。draw/playCard は applied.turnEnded だが move でないので別途 action.kind で分岐)。
- root の初期 boardHash = `computeHash(state)`。

### 13.3 TT probe/store を negamaxWorld に追加 (move-only negamax:340-352 を移植)
- `negamaxWorld` に `hash: ZobristHash` 引数を追加 (boardHash ^ cardFold の合成済 key を渡す)。
- **probe** (関数冒頭、terminal/leaf チェック後): `ctx.tt.probe(hash.lo, hash.hi)`。`ttEntry.depth >= depth` で exact/lower/upper を適用 (move-only と同ロジック)。`ttMove` を move 順序付けに使用 (card/draw は ttMove 非対象)。
- **store** (関数末尾、`return maxScore` 前): flag = `maxScore <= originalAlpha ? "upper" : maxScore >= beta ? "lower" : "exact"`、bestMove = 最善 move (card/draw 採用時は null)。停止後 (`ctx.stopped`) は store しない (ノイズ書き戻し回避、move-only と同)。
- **mate score の ply 調整 (★ correctness)**: TT に格納する mate スコア (`±(MATE_SCORE - ply)`) は ply 依存。move-only negamax が調整しているか確認し、していなければ world でも揃える (していない場合は両系統の既存挙動に合わせ無調整で一貫させる = M1 で確認)。
- quiescenceWorld は TT 不使用 (move-only quiescence と同、hash 引数も不要のまま)。
- 子再帰へ渡す hash: 通常 move = `updateHash` 由来 boardHash ^ `computeCardFold(childCardState)`、card/draw = `computeHash` 由来 ^ cardFold。

### 13.4 findBestMoveWorld + engine 配線
- `findBestMoveWorld`: root boardHash = computeHash、root cardFold = computeCardFold、`ctx.tt.newSearch()` を呼ぶ (move-only findBestMove:568 と同、per-request TT の世代更新)。各 root action の子へ hash を渡す。
- selector / noise / bestAction は S4c-1 のまま。
- engine.ts は無改変 (worldPathActive 経路は既存。TT は ctx.tt を共用)。flag OFF 据え置き (活性化は本段 bench で depth 回復確認後、別途ユーザー確認の上)。
- **bench に TT hit-rate カウンタ追加** (epic item 7.6): `SearchStats` に `ttProbes`/`ttHits` を追加し、退行が fold 起因か eval 起因か切り分け可能にする (S4c-1 比の depth 回復 + hit-rate を測定)。

### 13.5 リスク
- **R-3 TT 誤 hit (最重要)**: fold 漏れ / 盤面変更ノードの incremental hash 破壊。→ (a) noPromoteMarks を position fold (count でなく)。(b) computeCardFold は全 fold slice を網羅 (CARD_STATE_FOLD_POLICY を Object.keys で回し、fold/foldLength のみ XOR、宣言漏れは型 + test でガード)。(c) 盤面変更ノード (boardChangedBeyondMove / card / draw) は computeHash 全量。(d) 特性化テスト: 同一盤面で (i) 異 hand defId → 別 key、(ii) 異 mark position → 別 key、(iii) 異 graveyard (evalIrrelevant) → 同 key、(iv) 異 deck 内容・同 length → 同 key、(v) 異 deck length → 別 key。
- **R-9 TT 断片化**: cardState fold で同一盤面が複数 key に分散し hit 率低下。→ hit-rate カウンタで実測、depth 回復が不十分なら fold 粒度を見直す (例: hand を defId 集合でなく枚数のみに緩める = 誤 hit と hit 率のトレードオフ、S4e)。
- **R-13 mate score TT 汚染**: ply 依存 mate スコアの TT 格納/取得で詰み距離がずれる。→ §13.3 で move-only の扱いに揃える (M1 確認)。
- **R-14 incremental hash と applyTurnAction の不整合**: updateHash は applyMoveForSearch 前提。applyTurnAction の通常 move 結果と updateHash が一致するか (makeMoveWithEffects の盤変更が applyMoveForSearch と同一か) を特性化テストで pin (computeHash(child) === updateHash(parent, move, child) を通常 move で assert)。

### 13.6 検証ゲート
- lint→typecheck→test:ci→build。standard byte 不変 (move-only TT 無改変)。flag OFF で production 不変。
- TT correctness 特性化テスト (R-3 (d) の (i)-(v) + R-14 の incremental=full 一致)。
- **bench (BENCH_WORLD=1)**: depthCompleted が S4c-1 (4-5) から回復し bolt-on −15% (≥5.1) 達成を確認。TT hit-rate を記録。card% も再測 (depth 回復でカード戦術が見え card% が上がるか観測、ただし engagement 下駄前ゆえ目標 70% は S4d/S4e)。
- 回復確認後、route flag 活性化の是非をユーザーに提示 (棋力 net-positive を数値で示す)。

### 13.7 サブ分割
- **S4c-2a**: card-zobrist.ts + computeCardFold + 網羅/correctness テスト (R-3 (d) + cardDigest 整合)。production 未配線 (純粋追加)。
- **S4c-2b**: negamaxWorld/findBestMoveWorld に TT 配線 (hash 引数 + probe/store + boardHash 維持) + R-14/promote-drop テスト + bench。flag OFF 据え置き。

### 13.8 M1 マイルストーン1レビュー反映 (S4c-2 計画策定直後、2026-06-13、AGENTS.md ルール8)
独立 adversarial agent (general-purpose、30 tool uses、digest/zobrist/world-kernel/move-effects/action-generator を read 実証) で S4c-2 計画をレビュー。**判定 = 条件付き承認**。骨格 (card-zobrist fold / boardHash 維持 / TT 移植 / サブ分割) は実コードと整合し妥当、fold 分類 (noPromoteMarks position-fold 必要性 / hand defId 多重集合 / deck length / evalIrrelevant 除外) は全て PASS と確認。ただし下記を反映する。

#### [BLOCKER] B-1: cardDigest.trapValueDelta スタレネスによる「同一 key・異 score」誤 hit (fold 網羅性の枠外)
- **問題**: TT は `(boardHash^cardFold)→score` をキャッシュし score は per-node cardDigest 込み。誤 hit ゼロには「同一 key→同一 cardDigest」が要るが、`trapValueDelta` だけは **盤面依存値** (`card-spec-server.ts` checkBreak=kingExposure / no_promote=promotionThreat) でありながら `updateCardDigest` は **trap defId 変化時のみ再計算** (`digest.ts:206-211/234-236`)、盤面だけ動いたノードでは prev 値を流用 (S3b の root スカラー近似)。→ 同一 (board, trap defId) に異経路で到達すると trapValueDelta が path 依存でズレ score 不一致 → TT が誤 hit。fold (key 一意性) では防げない。
- **反映 (S4c-2 採用 = 最小・安全)**: **trap がセットされたノード (world.cardState.trap.sente!==null || .gote!==null) は TT probe/store を skip** する。これで trapValueDelta スタレネス起因の誤 hit をゼロにする。トラップ保有局面は TT 無効 (depth 回復せず) だが、depth ゲートを測る perf bench (makeBenchPositions=PERF_DECK、トラップ未セット) は TT 有効ゆえ回復を測定可能。**トラップ局面の TT 全面有効化は S4d (trapValueDelta を board 由来の EvalFeature 化し digest スタレネス解消後)**。
- **テスト追加 (B-1 を捕捉)**: §13.5 R-3(d) は key 差のみ検証で B-1 を素通しする。**「同一 board・同一 trap defId に異経路で到達した 2 ノードの leaf score 一致」を検証する cardDigest 整合テスト**を追加 (trap 無しノードは一致、trap 有りは TT skip を確認)。

#### [MAJOR] M-1/M-2: boardHash 維持規則の確定 + promote-drop テスト
- **確定規則 (§13.2 を単一規則化)**: **`action.kind==="move" && boardChangedBeyondMove===false` のみ incremental `updateHash(parentBoardHash, parentState, action.move, childState)`、それ以外 (move で boardChangedBeyondMove=true / draw / playCard 全般) は `computeHash(childState.gameState)` 全量**。XOR 手番トグル案は削除 (誤りの温床)。updateHash に渡すのは `action.move` (original、promote:true) でよい — dest 駒種は child board 由来で導出される (`search.ts:154/179`) ため no_promote 発火で promote が落ちても child board と一致 (PASS 実証済)。cardState 変化 (no_promote 発火の trap clear / mark add / mark follow、`move-effects.ts:88-128`) は毎ノード full `computeCardFold` が吸収。
- **テスト追加**: R-14 (incremental=full 一致) に **「no_promote マーク/トラップで promote が落ちる通常 move」「auto-draw 発火 move (drawProgress が AUTO_DRAW_INTERVAL 到達で deck→hand)」** を必須ケースとして追加 (最も壊れやすい)。

#### [MEDIUM] 反映
- **MED-1 (hand count 表サイズ)**: `HAND_CARD_KEYS[player][defId][count]` の count 上限を `DECK_TOTAL_MAX` (=30、card-system-config 由来) で定数化 (`MAX_HAND_CARD_COUNT`)、表を `[0..MAX]` 確保。マジックナンバー禁止 (AGENTS 10)。境界超過は防御 (到達しない想定だが明示)。同様に mark fold は squareIndex 0..80、drawProgress 0..AUTO_DRAW_INTERVAL、deck length 0..DECK_TOTAL_MAX、mana 0..MANA_CAP で表サイズ確定。
- **MED-2 (TT key 空間の非混在)**: world request は move-only negamax を呼ばない (`findBestMove:559` 分岐で保証) ため boardHash-only key (move-only) と boardHash^cardFold key (world) が同一 TT で混在しない。§13.4 に不変条件として明記 + `findBestMoveWorld` の `ctx.tt.newSearch()` で世代隔離。将来 move-only 併用時の衝突注意コメント。
- **MIN (mate ply / lo 分布)**: mate score は move-only と同じ無調整で一貫 (quiescence qDepth 基準含む、既存忠実 port)。card-zobrist キーは `randomUint32` (zobrist.ts と同) で lo 下位ビットにランダム性を確保 (index 衝突 = R-9 回避)。

#### 見落とし反映 (テスト)
- **spectatorMode=true アサート**: lastTurnStartedAt=evalIrrelevant は spectatorMode=true 前提。world 探索の applyTurnAction が常に `{spectatorMode:true}` であることをテストで pin (回帰防止)。
- **double_move fold 予約の強い TODO**: CardGameState に doubleMove フィールドが無く型網羅ガードが効かないため、S4c-1d 着手時の doubleMove fold 漏れ = 即誤 hit。card-zobrist.ts / tt-fold-policy.ts に強い TODO を残す。

#### サブ分割への反映
- S4c-2a に cardDigest 整合テスト (B-1 捕捉) を追加。S4c-2b に promote-drop / auto-draw の R-14 テスト + trap ノード TT skip の確認を追加。

### 13.9 S4c-2 実装完了 + bench 結果 (2026-06-13)
- **S4c-2a `af4481e`**: card-zobrist.ts (computeCardFold) + correctness テスト18件 (fold 区別 / evalIrrelevant 無視 / CARD_STATE_FOLD_POLICY 網羅性ガード)。
- **S4c-2b `797e404`**: negamaxWorld/findBestMoveWorld に TT 配線 (boardHash 引数 + probe/store + ttMove ordering)、boardHash incremental/全量規則、SearchStats ttProbes/ttHits、**trap ノード TT skip (B-1)**、R-14 テスト3件 (incremental===full、通常/取り/成り/打ち/auto-draw)。test:ci 650。

#### depthCompleted 回復 (bench BENCH_WORLD=1、RUNS=2、TT 有):

| 難易度 | bolt-on baseline | S4c-1 (TT無) | S4c-2 (TT有) | ゲート (before−15%) | 判定 |
|---|---|---|---|---|---|
| beginner | 3 | 2.89 | 2.89 | ≥2.55 | ✅ |
| intermediate | 5.33 | 4.0 | 4.44/4.33 | ≥4.53 | ⚠️ −16.7% (僅か下) |
| advanced | 5.78 | 4.67 | **5.11** | ≥4.91 | ✅ |
| expert | 6.0 | 4.67 | **5.33** | ≥5.1 | ✅ |

- **TT で depth 回復確認**: advanced/expert (P1 対象) は棋力ゲート達成。intermediate は僅か下 (−16.7%) だが、TT 全面有効化 (S4d で trap ノードも) + selector 校正 (S4e) で改善余地。
- **card% は依然 ~0%** (engagement 下駄=決定A 未実装 + generic bench fixture が真にカード有利でない)。**card% 70% 達成は S4d/S4e の engagement 下駄 + EvalFeature マター**。
- **活性化はまだ延期**: depth は回復したが card% が bolt-on (57%) を下回る (= 決定A「カードを使わせる」に反する) ため、route flag は OFF 据え置き。**S4d (EvalFeature + trapValueDelta board 由来化で B-1 解消 = trap ノード TT 解禁 + 既知バグ精算) → S4e (engagement 下駄 + selector 校正 + 最終 bench) で card% を引き上げ、depth + card% 両立を確認してから活性化**。

## 14. S4d 実装計画 (concrete、2026-06-13、EvalFeature 本配線 + 既知バグ精算 + engagement 下駄)

S4d = epic §6 item 7 (iv) の評価寄与を world 探索の leaf に**本配線**し、§6 7.5 の既知負債6件を精算し、決定A の engagement 下駄を world root に載せる。目的は **(1) card% を bolt-on (57%) 以上 (advanced/expert ≥70% 目標、§6) へ引き上げ**、**(2) no_promote の幻成り/符号逆/満額評価を根絶し棋力 correctness を上げる**、**(3) trapValueDelta を board 由来化して trap ノードの TT を解禁し depth をさらに回復**すること。S4c-2 同様 flag OFF で production 不変を保ったまま world 経路を強化し、活性化判断は S4e の最終 bench へ。

### 14.0 ゴール / 非ゴール
- **ゴール**: (1) no_promote per-piece modifier を `evaluate` の leaf に配線 (computeMaterial / evaluatePromotionThreats への引数追加)。(2) `noPromoteMarkCountDelta` + `NO_PROMOTE_MARK_COEFFICIENT` をフィールドごと削除 (符号逆バグ消滅)。(3) 幻成りを quiescence 生成 (captureGen / getSearchLegalMoves) でも排除 (negamaxWorld 主系統は S4a 済)。(4) trapValueDelta を board 由来 leaf EvalFeature 化 → trap TT skip を撤去し誤 hit ゼロを維持。(5) 残負債精算 (L0→L2 型 / digest.manaCap / DEAD_MANA cap比率化)。(6) world root に engagement 下駄 (難易度別、bounded-loss)。
- **非ゴール**: selector M/K/budget 校正 + engagement 係数の最終校正 (= S4e)。double_move 統合 (= S4c-1d)。route flag 活性化 (= S4e で net-positive 確認後)。lifecycle (v) の宣言化 (epic 7.2(v)、no_promote follow/cleanup のインライン→registry 移行は将来要素の受け皿で S4d 必須でない。本段は per-piece eval の (iv) に集中、(v) は S5+ park)。movement 系 status (v1 スコープ外、epic 7.4)。

### 14.1 設計の核心: board 由来 slice を leaf に届ける CardDigest enrichment
epic 7.2(iv)1「リーフ毎 Set 構築は禁止: マーク空なら fast path コストゼロ、非空時のみ slice 参照変化で lookup 再構築しノード帯同」を満たす機構。

- **現状**: `evaluate(state, variant, cardDigest)` は `evaluateCardDigest(cardDigest)` を加算するのみ。cardDigest は **global scalar** (manaDelta/handValueDelta/drawProgressDelta/deadMana) と **stale な trapValueDelta** を持つ。マーク情報は leaf に物理的に届かない (W-1 root スカラー)。
- **S4d**: CardDigest に **board 由来 slice の参照を帯同**する 2 フィールドを追加 (実体は cardState slice 参照を流用、毎ノード再構築しない):
  - `noPromoteMarks: { sente: PieceMark[]; gote: PieceMark[] } | null` — マーク空 (両者 length 0) は `null` で fast path 化 (現状ほぼ常時)。`updateCardDigest` が `marksChanged` 検知時のみ参照差し替え。**★M1 B-1 反映: 変化検知は length 比較でなく `prev.noPromoteMarks.sente !== new.noPromoteMarks.sente || ...gote` の参照比較必須** — follow (`moveNoPromoteMark`) は length 不変・position 変化・新参照ゆえ length 比較では検知漏れ → stale marks が per-piece eval 誤評価 + (computeCardFold は position fold なので) TT 誤 hit を生む。`add/remove/moveNoPromoteMark` は全て新参照を返す (effects.ts:30-72) ため参照比較で過不足なし。
  - `trap: { sente: CardId | null; gote: CardId | null }` — defId のみ (cheap、fold-stable)。`updateCardDigest` が `trapChanged` 検知時のみ差し替え。**stale な `trapValueDelta` スカラーは削除** (B-1 の根本原因)。
- **leaf 算出 (board 由来)**: `evaluate` は `state` を持つため、cardDigest に帯同した slice から **leaf で board 依存値を算出**する:
  - per-piece modifier: `computeMaterial(state, variant, marks?)` / `evaluatePromotionThreats(state, player, variant, marks?)` に marks を渡す。marks=null/undefined は fast path (= standard byte 等価、現状の card-shogi マーク無し局面も等価)。
  - trap value: `evaluate` 内で trap defId が非 null なら `getCardValue(defId, state, player)` を leaf で算出して加算 (board 由来 = 同 board+trap → 同値 = TT 安全)。これが trapValueDelta board 由来化の本体。
- **コスト**: マーク空 + trap 無しの leaf (bench PERF_DECK の大多数) は fast path で**現状と同コスト**。マーク有り leaf は marks lookup (≤2 個は O(m) インライン比較、epic 7.2(iv)1)。trap 有り leaf のみ getCardValue (kingExposure/promotionThreat board scan) が増えるが、trap 局面は探索全体の一部 + TT 解禁の depth 回復で相殺。
- **global scalar は据置**: `evaluateCardDigest` は mana/hand/draw/deadMana の global scalar を引き続き加算 (S3 まで通り)。trapValueDelta と noPromoteMarkCountDelta のみ撤去し、それぞれ board 由来 leaf 算出 / per-piece modifier へ移行。
- **evaluateWithBreakdown 整合**: computeMaterial/evaluatePromotionThreats のシグネチャ変更は debug 用 `evaluateWithBreakdown` にも適用 (marks 未渡で fast path = 構造共有維持、epic 7.2(iv)1 「転記2箇所を作らない」)。

### 14.2 サブ段分割 (revert 粒度・レビュー容易性・依存順)
低リスク負債 → correctness (幻成り/eval) → TT 解禁 → engagement の順。各段 lint→typecheck→test:ci→build + standard byte 不変 + flag OFF production 不変。

- **S4d-1 (低リスク負債精算、現行挙動不変)**: ① L0→L2 型逆依存解消 (`world-kernel.ts:49` の `TurnAction` import を ai/turn/types から中立 location へ昇格)。② `digest.manaCap` を `MANA_CAP` 定数焼き込み → `cardState.manaCap` 読みに是正 (現行 cap=20 で値不変)。③ `DEAD_MANA_THRESHOLD=16` 定数 → `manaCap × DEAD_MANA_RATIO(0.8)` の動的算出に是正 (現行 cap=20 で 16 不変)。全て **現行値で挙動不変** → card-digest 等価性テスト + byte 不変 gate で pin。④ top-K selector とセンチネル0価値カードの飢餓回避規約 (epic 7.5⑥) は S4d-5 (engagement) と密結合のため S4d-5 へ寄せる。
- **S4d-2 (幻成り quiescence 排除、correctness)**: `getSearchLegalMoves` / `getCaptureMovesForSearch` / `getPromotionMovesForSearch` に optional `marks?: PieceMark[]` を追加し、マーク駒は promote:true を生成しない (mustPromote マスは promote:false 置換 = dead 許容 D-I、moves.ts S4a と同セマンティクス)。quiescenceWorld にマークを帯同 (negamaxWorld の `world.cardState.noPromoteMarks[player]` 由来)。**quiescence 内マーク追従 = stale 許容**を明文化 + テスト pin (applyMoveForSearch は board-only でマーク非追従。quiescence は浅い戦術探索ゆえ moved-mark の stale は稀。epic 7.2(iv)1 の「stale 許容を明文化+テスト pin」を採用、from/to 追従は v1 非実装)。
- **S4d-3 (per-piece no_promote eval + 符号逆消滅、最重要 correctness)**: §14.1 の CardDigest noPromoteMarks 帯同 → `computeMaterial`/`evaluatePromotionThreats` per-piece modifier。`noPromoteMarkCountDelta` + `NO_PROMOTE_MARK_COEFFICIENT` フィールドごと削除。card-digest.test 4 箇所 (L275/286/316/532) 追従。
- **S4d-4 (trapValueDelta board 由来化 + trap TT 解禁)**: §14.1 の CardDigest trap defId 帯同 → `evaluate` leaf で getCardValue 算出。`trapValueDelta` スカラー削除 + `computeTrapValueDelta` 撤去。TT trap-skip ゲート (search.ts 2 箇所: negamaxWorld L977-978 + findBestMoveWorld L1184) 撤去 → trap 局面でも TT 有効化。`search-world.test.ts` の trap-skip 回帰ガード更新 + 誤 hit ゼロ再検証 (異経路・同 board・同 trap → 同 leaf score を pin)。
- **S4d-5 (engagement 下駄、card% の主ドライバ)**: world root の card/draw スコアに使用促進ボーナス (難易度別、bounded-loss)。センチネル0価値カードの飢餓回避規約 (epic 7.5⑥) を selector 上界に組込み。card% 再 bench。**係数の最終校正は S4e**。

> 依存: S4d-3/S4d-4 は §14.1 の CardDigest enrichment を共有する。enrichment 自体は S4d-3 で先に導入し (noPromoteMarks)、S4d-4 で trap フィールドを追加する形が revert 粒度的に素直 (各段で独立に test green)。S4d-1/S4d-2 は enrichment 非依存で先行可。

### 14.3 各サブ段の concrete 設計 (file-level)

#### S4d-1 (負債精算)
- `src/lib/shogi/ai/turn/types.ts`: `TurnAction` 型を中立 location (例 `src/lib/shogi/kernel/turn-action-types.ts` 新規、または `cards/types.ts`) へ移し、ai/turn/types は re-export。world-kernel は中立 location から import (L0→L2 逆依存解消)。**型のみの移動 = 実行時影響ゼロ**、全 import 追従。
- `cards/digest.ts`: `computeCardDigest`/`updateCardDigest` の `manaCap` を `cardState.manaCap` 読みに (L82/L223)。
- `cards/heuristics.ts`: `DEAD_MANA_THRESHOLD=16` 定数 → `DEAD_MANA_RATIO=0.8` 定数 + `deadManaThreshold(manaCap)` ヘルパ。`evaluateDeadManaPenalty` は digest.manaCap × ratio で算出 (digest に manaCap があるので追加引数不要)。
- ゲート: card-digest.test 等価性 + evaluate-equivalence byte 不変。

#### S4d-2 (幻成り quiescence)
- `ai/legal-moves.ts`: `getSearchLegalMoves(state, player, variant, cardState?)` に optional cardState を追加し `getFullLegalMoves(state, player, variant, cardState)` へ透過 (S4a 対応の getFullLegalMoves を活用)。
- `ai/captureGen.ts`: `getCaptureMovesForSearch`/`getPromotionMovesForSearch` に optional `marks?: PieceMark[]`。マーク判定は moves.ts `isNoPromoteLocked` と同ロジック (座標一致)。マーク駒は (a) capture: promote:true 変種を生成せず promote:false のみ (mustPromote マスも promote:false=dead 許容)、(b) promotion gen: マーク歩/香は生成スキップ (成れない=quiet move ゆえ quiescence 対象外)。
- `ai/search.ts` quiescenceWorld: `marks?: { sente: PieceMark[]; gote: PieceMark[] }` 引数追加 (両者、capture-drop と手番側生成の両方に要る)。negamaxWorld が `world.cardState.noPromoteMarks` を渡す (L1003 の quiescenceWorld 呼出)。in-check 分岐の getSearchLegalMoves にも手番側 marks を渡す。**★M1 M-3 反映: stale でなく `O(m)` follow 追従**: quiescenceWorld の各再帰遷移で、move.from が手番側 marked 座標一致なら mark を move.to へ更新 / capture で相手 marked 駒が消えたら drop (m≤2 で割当ゼロ、新 marks は再帰へ渡す)。これで quiescence 内でも幻成り判定が正しく追従し復活しない。follow が複雑なら stale 許容 + 実害 cp 実測へ fallback (D-3)。
- ゲート: no-promote-mark-moves.test に quiescence 生成ケース (capture-promote / promotion-gen のマーク排除 + follow 後の追従) 追加。standard 経路 (marks 未渡) byte 不変。

#### S4d-3 (per-piece eval)
- `cards/digest.ts`: CardDigest に `noPromoteMarks: { sente: PieceMark[]; gote: PieceMark[] } | null` 追加。`noPromoteMarkCountDelta` 削除。`computeCardDigest`/`updateCardDigest` で marks 空→null / 非空→参照帯同。**★M1 B-1: `marksChanged` を参照比較に変更** (length-only 廃止)。`evaluateCardDigest` から `noPromoteMarkCountDelta * NO_PROMOTE_MARK_COEFFICIENT` 行削除。heuristics.ts の `NO_PROMOTE_MARK_COEFFICIENT` 削除。
- `evaluators/material.ts`: `computeMaterial(state, variant, marks?)`。**per-piece modifier #1**: マーク駒は成り潜在価値を永久喪失 → `value(promotesTo)−value(type)` の一定割合 `NO_PROMOTE_MATERIAL_DISCOUNT_RATIO` を減価 (sign 付き)。**[オープン論点 D-1、§14.4]** 係数既定値・S4d採否。
- `evaluators/promotion-threat.ts`: `evaluatePromotionThreats(state, player, variant, marks?)`。**per-piece modifier #2**: opponent のマーク駒は成り不能ゆえ phantom 脅威を**全除去** (penalty 加算スキップ)。これが「相手マーク駒の成り脅威割引」の本体 (correctness 明確、係数不要)。
- **★M1 MED-2: lookup 挿入点と fast path の固定** (Set 構築禁止、≤2 は O(m) インライン):
  - material.ts:39 駒ループ内 — `marks` 未渡 (undefined/null) なら従来パス。渡時のみ `isMarked(marks[piece.owner], row, col)` (O(m) 線形) で true なら減価加算。
  - promotion-threat.ts:46 `if (inPromotionZone)` 前 — opponent 駒が `isMarked(marks[opponent], row, col)` なら penalty 加算を continue で skip。
  - `isMarked(arr, row, col)`: `arr` 未渡/空は即 false (fast path)、それ以外 `arr.some(m=>m.row===row&&m.col===col)` (m≤2 で実質 O(1)、新規 Set 割当なし)。
- `evaluate.ts`: `evaluate`/`evaluateWithBreakdown` が cardDigest.noPromoteMarks (null=fast path) を computeMaterial/evaluatePromotionThreats へ渡す。marks=null/undefined は両関数とも未渡=現状ロジック (= standard byte 等価 + card-shogi マーク無し局面も等価)。
- ゲート: card-digest.test 追従 (削除は **~17 箇所**=`grep -n noPromoteMarkCountDelta` 全ヒット、MED-3) + per-piece eval ケース追加。evaluate-equivalence (standard、marks 無し) byte 不変。新規 per-piece eval 単体 (マーク歩の脅威除去 / material 減価方向 / fast path 等価)。**★M1 MED-4: 自マーク局面で「マーク多いほど自分に不利」方向を pin する決定的テスト** (符号逆回帰 anchor、専用 marks fixture 新規)。

#### S4d-4 (trap board 由来化 + TT 解禁)
- `cards/digest.ts`: CardDigest に `trap: { sente: CardId|null; gote: CardId|null }` 追加。`trapValueDelta` + `computeTrapValueDelta` 削除。`evaluateCardDigest` から `value += digest.trapValueDelta` 削除。
- `evaluate.ts`: `evaluate` が cardDigest.trap の非 null defId に対し `getCardValue(defId, state, player)` を leaf 算出 (sente=+ / gote=−、card-spec-server)。variant card-shogi ガード。
- `ai/search.ts`: negamaxWorld の `ttEnabled` (L977-978) と findBestMoveWorld の `rootTtEnabled` (L1184) の trap 条件を撤去 → 常時 TT 有効。computeCardFold は trap を既に fold 済 (S4c-2a) ゆえ key 一意性は維持。
- `ai/cards/digest.ts` updateCardDigest: trap defId 帯同に変更 (trapChanged 検知は既存)。
- **★M1 M-2 (bolt-on 整合)**: bolt-on `evaluateActionWithLookahead` (search.ts:1934、flag OFF production) も共有 `evaluate` を通るため、trap 帯同 + leaf 算出で意図通り動くことを確認。**flag-OFF production の card-shogi trap 評価が root スカラー→leaf 由来へ変わる** (= D-5 のスコープ判断対象、standard は不変)。`evaluate-action.test.ts:431` / `perf-bench-card-usage.test.ts:164` の trapValueDelta 依存箇所を追従更新。
- ゲート: `search-world.test.ts` trap-skip 回帰ガードを「trap 局面でも TT 有効 + 誤 hit ゼロ」に置換。R-14 拡張 (trap 局面 incremental=full hash + 異経路・同 board・同 trap → 同 leaf score)。trap 局面 bench で depth 回復確認。

#### S4d-5 (engagement 下駄)
- `ai/search-context.ts`: SearchContext + CreateSearchContextOptions に `engagementMargin?: number` (cp、難易度別)。
- `ai/engine.ts`: `ENGAGEMENT_PARAMS: Record<Difficulty, number>` (例 advanced/expert に正値、beginner/intermediate は noise が支配的ゆえ 0 or 小)。worldPathActive 時のみ ctx へ注入。
- `ai/search.ts` findBestMoveWorld: root 選択 (L1252-1300) で **bounded-loss tie-break**: 全 rootActionScores の bestScore に対し、`score ≥ bestScore − engagementMargin` を満たす card/draw アクションがあれば、その中で最良を bestAction に採用 (= 最大 engagementMargin cp の損失上限で「僅差ならカード」)。**暴発防止**: 損失は engagementMargin で bound (tadasute 安全網と二重)。noise/nearEqual (beginner/intermediate) と排他 or 合成順序を明確化 (engagement → nearEqual → addNoise の順、または engagement は nearEqual の card 版として統合)。**[オープン論点 D-2、§14.4]**。
- センチネル0価値カード飢餓回避 (epic 7.5⑥): selectBranchCandidates の card top-K で getCardValue=0 のカード (解除カード等、価値が探索で創発) が常に枝刈りされる問題 → per-piece modifier 由来の復元価値を O(marks) で機械算出し選別上界に加える。**S4d 時点では該当カード未実装ゆえ規約コメント + テスト雛形のみ** (実害は将来カードで顕在化)。
- ゲート: card% bench (BENCH_WORLD=1) で advanced/expert card% 上昇を観測。depth 非退化確認。係数最終校正は S4e。

### 14.4 既知の設計判断・オープン論点 (M1 / ユーザー確認対象)
- **D-1 (per-piece material 減価の係数)**: epic 7.2(iv)1 は「マーク駒の成り上昇分 `value(promotesTo)−value(type)` 減価」を規定。全額減価はマーク歩を負価値化し不当 (歩は成れなくても base 100cp の価値を保つ)。**推奨 = 小さい割合 `NO_PROMOTE_MATERIAL_DISCOUNT_RATIO` (既定 0.1〜0.15 程度) × (promotesTo−type)** で「永続的に成り潜在を失った構造的ハンデ」を表現。**★M1 MED-1 訂正: modifier #1 (自駒 material) と modifier #2 (`evaluatePromotionThreats` は opponent のみ走査) は対象駒の所属が排他で二重計上は構造的に発生しない**。係数を控えめにする根拠は「二重計上回避」ではなく「成れない歩が base 価値を保つ / 構造的ハンデの妥当な cp 表現」。**既定値と「material 減価を S4d で入れるか S4e 校正へ回すか」をユーザー確認**。modifier #2 (相手マーク駒の脅威全除去) は correctness 明確ゆえ S4d 確定。
- **D-2 (engagement 下駄の機構と難易度適用範囲)**: bounded-loss tie-break (推奨) vs 加算ボーナス。難易度別 engagementMargin の適用範囲 (advanced/expert のみか、全難易度か)。**★M1 M-1 反映: engagementMargin はタダ捨て閾値未満に bound 必須** (world 経路は card 採用時 blunder guard を skip し、探索内 tadasute は深ノード move-only で root card に届かないため margin が唯一の損失上限)。margin < 歩 100cp 級 (目安 BLUNDER_GUARD_TIE_MARGIN=150 未満) で「駒1枚以上損する card」を構造的に排除。採用 card 適用後の簡易 hanging-piece sanity check 併用も S4e で要否判断。noise/nearEqual との合成順序 = engagement→nearEqual→addNoise。**機構・bound・適用方針をユーザー確認** (決定A=多少損でも使わせる、は確定済。係数値は S4e 校正)。
- **D-3 (quiescence マークの follow vs stale)**: **★M1 M-3 反映: 推奨を stale 許容から `O(m)` follow 追従へ格上げ**。quiescenceWorld の各遷移で from が marked 座標一致なら mark を to へ更新 / capture で marked 駒消滅なら drop (m≤2 で割当ゼロ)。stale は marked 駒が quiescence 内で動いた後に幻成り復活する方向問題を残すため。follow が重ければ stale 許容 + 実害 cp 実測を fallback (定性判断で close しない)。**ユーザー確認は不要レベル (follow 推奨で進める)、M1 で follow 実装の複雑度を実装時に再評価**。
- **D-4 (TurnAction 型の中立 location)**: 新規 `kernel/turn-action-types.ts` か既存 `cards/types.ts` か。**推奨 = kernel 配下** (L0 が所有、ai/L2 が consume の正しい依存方向)。M1 MIN-2: 新 location が `cards/types` (CardId) を import する形ゆえ循環 (kernel→cards→ai) 不発を型グラフで確認。14 importers 追従 (型のみ=実行時影響ゼロ)。
- **★D-5 (新規・最重要、M1 M-2 由来): S4d の eval 改変は flag-OFF production (bolt-on) の card-shogi 評価も変える**: `noPromoteMarkCountDelta` 削除 (`evaluateCardDigest` 改変) と trapValueDelta board 由来化 (`evaluate` 改変) は、bolt-on `evaluateActionWithLookahead` (flag OFF でも live = 現 production) が共有する `evaluate`/`evaluateCardDigest` を通る。よって **S4c までの「flag OFF production 完全不変」DoD は S4d では成立しない** (standard variant は variant ガードで byte 不変だが、card-shogi の現 production 評価は符号逆バグ修正等で変わる)。**ユーザー確認**: ① 現 production (bolt-on) に S4d の eval 修正を即時反映してよいか (符号逆バグ等は早期修正の価値あり) / ② world cutover (S4e 活性化) まで bolt-on を凍結し eval 改変を world 専用 leaf wrapper に閉じ込めるか (epic「転記2箇所禁止」と相反、複雑度増)。**推奨 = ①** (bolt-on は S4 で deprecate 予定 + 符号逆は明確なバグ。DoD を「standard byte 不変 + card-shogi flag-OFF 評価は S4d で意図的改善」へ改訂)。

### 14.5 リスク (§5 に S4d 固有を追加)
- **R-S4d-1 (eval 改変による棋力回帰)**: noPromoteMarkCountDelta 削除 + per-piece 化は card-shogi の評価を変える (意図的、§1)。マーク無し局面 (bench PERF_DECK 大多数) は noPromoteMarks=null で**評価不変**であることを確認 (fast path)。マーク有り局面のみ評価変化。→ bench depth 非退化 + マーク局面の方向性 (自マーク=不利, 相手マーク=有利) を符号テストで pin。
- **R-S4d-2 (trap TT 誤 hit 再発)**: trapValueDelta を board 由来化したことで「同 board+同 trap defId → 同 leaf score」が成立する前提。getCardValue が純粋 (gameState のみ依存、Explore 確認済) ゆえ成立するが、computeCardFold が trap defId を fold 済 (S4c-2a) であることと併せて誤 hit ゼロを R-14 拡張テストで pin。**digest の他フィールドに board 依存が残っていないか M2 で全 7→6 フィールド再精査** (trapValueDelta 削除後、残りは全 board 非依存のはず)。
- **R-S4d-3 (quiescence マーク帯同コスト + trap leaf コスト)**: marks 非空時の captureGen O(m) lookup + follow 追従がホットパス。マーク空 fast path で現状コスト維持を確認。trap 局面 leaf の getCardValue は board O(81) 走査 (MIN-3) → **bench nodes/s は trap 局面比率込みで計測**し、TT 解禁の depth 回復が leaf コスト増を上回ることを確認。
- **R-S4d-4 (engagement 暴発)**: bounded-loss で損失上限を保証。bench で「明確に負ける手をカードで指す」事例が出ないか sanity check (tadasute 安全網 + margin bound)。

### 14.6 検証ゲート + テスト計画
- 各段 lint→typecheck→test:ci→build。**standard variant byte 不変** (marks/trap は variant.id==="card-shogi" ガード + marks 未渡 fast path = computeMaterial/promotion-threat/getSearchLegalMoves/captureGen 現状等価)。**★D-5 反映: card-shogi の flag-OFF production (bolt-on) 評価は S4d で意図的に改善** (符号逆/trap 精度) — S4c までの「flag OFF 完全不変」は standard に限定し、card-shogi flag-OFF は「意図的改善 + bolt-on 経路テスト/bench で検証」へ DoD 改訂 (ユーザー D-5 承認前提)。
- S4d-1: card-digest 等価性 + evaluate-equivalence byte 不変 (manaCap/DEAD_MANA は現行値不変)。TurnAction 移設は型のみ=全 importer typecheck green。
- S4d-2: no-promote-mark-moves.test に quiescence 生成 (capture-promote / promotion-gen) のマーク排除 + follow 追従ケース。standard byte 不変。
- S4d-3: **card-digest.test の `noPromoteMarkCountDelta` 全ヒット (~17 箇所) 追従** (MED-3) + per-piece eval 単体 (マーク歩脅威除去 / material 減価方向 / fast path 等価) + **符号反転方向 pin テスト (MED-4、専用 marks fixture)**。evaluate-equivalence (standard) byte 不変。
- S4d-4: search-world.test trap-skip ガード置換 + R-14 trap 拡張 (incremental=full + 異経路同score)。**bolt-on 経路テスト追従: `evaluate-action.test.ts:431` / `perf-bench-card-usage.test.ts:164` の trapValueDelta 依存更新** (M-2)。trap bench depth 回復。
- S4d-5: card% bench (BENCH_WORLD=1) で advanced/expert card% 観測 (目標帯 ≥70% は S4e 校正後)。depth 非退化。
- **bench (BENCH_WORLD=1) 総合**: S4c-2 比で (a) depth 維持/向上 (trap TT 解禁で intermediate -16.7% 改善余地)、(b) card% 上昇、(c) nodes/s・TT hit-rate を SearchStats で記録 (退行切り分け、epic 7.6)。

### 14.7 ロールバック
S4c-2 と同様、各段は flag OFF (route 未配線) で dormant。world 経路の eval 改変は world 探索のみ到達 (production bolt-on は無影響)。問題時は該当段コミット revert。CardDigest enrichment は additive (marks=null/trap 既存 defId)。

### 14.8 M1 マイルストーン1レビュー反映 (S4d 計画策定直後、2026-06-13、AGENTS.md ルール8)
単一 general-purpose agent (adversarial、Issue #109 観点取得 + digest/evaluate/material/promotion-threat/search world/captureGen/card-spec-server/world-kernel/card-zobrist/関連テストを Read/grep 実証、44 tool uses) で §14 をレビュー。**判定 = 条件付き承認**。骨格 (CardDigest enrichment による board 由来 slice の leaf 配線 / trap board 由来化→TT 解禁 / 5 サブ段) は実コード整合・file:line も概ね正確と確認。下記を反映する。

#### [BLOCKER] B-1: `marksChanged` length-only で follow-move の position 変化を検知できず staleness 二重不整合
- **問題**: §14.1 は「参照比較で marks 変化検知」と書くが、現状 `updateCardDigest.marksChanged` (digest.ts:212-216) は **length 比較のみ**。no_promote follow (`moveNoPromoteMark`、effects.ts:67 `.map` で新参照・length 不変・position だけ変化) を検知できず、(a) per-piece eval が **旧座標の stale marks** を見て誤評価、(b) `computeCardFold` は marks を **position fold** (card-zobrist.ts:118) ゆえ TT key は正しく変わるのに digest の marks は stale → **同 TT key に異 score = 誤 hit** (S4d-4 で trap-skip を外す文脈で致命)。
- **反映 (S4d-3 必須)**: §14.3 S4d-3 に「`marksChanged` を **参照比較** (`prev.noPromoteMarks.sente !== new...sente || ...gote`) へ変更」を明示。`add/remove/moveNoPromoteMark` は全て新参照を返す (effects.ts:30-72) ため参照比較で過不足なく検知。R-14 系に「follow-move (length 不変・position 変化) で marks 参照更新 + TT key と digest 整合」テストを必須追加。§14.1 にも反映済 (下記)。

#### [MAJOR] M-1: engagement 下駄が root card 採用時に blunder guard をバイパス (world tadasute は深ノード move-only で root card に届かない)
- **問題**: world 経路は `bestAction.kind!=="move"` で `usingCardAction=true` (engine.ts:354) → blunder guard skip (engine.ts:433 `!usingCardAction`)。engagement の bounded-loss tie-break は「margin cp 損する card を best にする」設計ゆえ、その card がタダ捨てでも guard が効かない。§14.3 の「tadasute 安全網 + margin bound で二重」は **world 探索内 tadasute が深ノード move-only ゆえ root card に届かない**点を見落とし。
- **反映 (S4d-5)**: engagementMargin を **タダ捨て閾値 (最小 PIECE_VALUES=歩 100cp 級、BLUNDER_GUARD_TIE_MARGIN=150 を上界の目安) 未満に bound** することを D-2 に明記 (margin < 100cp なら「駒1枚以上損する card」は構造的に採用不可)。加えて採用 card/draw 適用後局面に簡易 hanging-piece sanity check を通す案も M1 で検討 (S4e 校正で要否判断)。noise/nearEqual との合成順序 (engagement→nearEqual→addNoise) を明記し addNoise が engagement bestAction を上書きする経路 (search.ts:1285-1291) を整理。

#### [MAJOR] M-2 / D-5: bolt-on (`evaluateActionWithLookahead`) = flag-OFF production が共有 `evaluate`/`evaluateCardDigest` を通るため、S4d の eval 改変は flag-OFF production の card-shogi 評価も変える
- **問題**: §14 は「flag OFF production 不変」を DoD に置くが、(i) `noPromoteMarkCountDelta` 削除は `evaluateCardDigest` 改変、(ii) trapValueDelta board 由来化は `evaluate` 改変で、**いずれも bolt-on `evaluateActionWithLookahead` (search.ts:1934、flag OFF でも live = 現 production) が共有**する。よって S4d の eval correctness 修正は **flag-OFF production の card-shogi 評価を意図せず変える**。さらに `evaluate-action.test.ts:431` / `perf-bench-card-usage.test.ts:164` が trapValueDelta 文言・挙動依存で赤化する。
- **反映 (新オープン論点 D-5、ユーザー確認必須)**: **S4d の DoD を「standard variant は byte 不変、card-shogi flag-OFF production 評価は S4d で意図的に改善 (符号逆/trap 精度)」へ修正する必要がある**。これは大きなスコープ判断 — 「現 production (bolt-on) に符号逆バグ修正等を即時反映してよいか / world cutover まで bolt-on を凍結するか」をユーザーに確認 (§14.4 D-5)。**反映**: §14.6 ゲートに「bolt-on `evaluateActionWithLookahead` が新 leaf trap/per-piece で意図通り動くことを確認 + `evaluate-action.test.ts`・`perf-bench-card-usage.test.ts` の trapValueDelta 依存追従」を追加。standard variant byte 不変は維持 (marks/trap は variant.id==="card-shogi" ガード)。

#### [MAJOR] M-3: quiescence stale の実害は「方向」問題 (marked 駒が quiescence 内で動くと幻成り復活)、定性主張で close しない
- **問題**: §14.4 D-3 の「stale 許容」は規模 (稀) のみで方向を評価していない。quiescence は capture/promotion を読むため、marked 駒が動いた後に旧座標基準で「marked でない駒」として成り価値込み read = 幻成り復活。
- **反映 (S4d-2、D-3 改訂)**: **推奨を「stale 許容」から「O(m) follow 追従」へ格上げ**。quiescenceWorld の各遷移で move の from が marked 座標と一致なら mark を to へ更新 / capture で marked 駒消滅なら drop (m≤2 で O(m)、割当ゼロ)。epic 7.2(iv)1 も follow を許容。stale より correctness が高く実害ゼロ化。コスト微増は bench で確認。実装が重ければ stale 許容 + 実害 cp 実測を fallback (M1 要求の「定性で close しない」を満たす)。

#### [MEDIUM] 反映
- **MED-1 (D-1 論拠訂正)**: material 減価 (modifier #1 = 自駒) と promotion-threat 割引 (modifier #2 = `evaluatePromotionThreats` は opponent のみ走査、promotion-threat.ts:29/36) は **対象駒の所属が排他で二重計上は構造的に発生しない**。D-1 の係数根拠を「二重計上回避」から「成れない歩が base 価値を保つべき / 構造的ハンデの cp 表現」へ訂正 (§14.4 D-1 改訂済)。
- **MED-2 (lookup 挿入点の具体化)**: §14.3 S4d-3 に marks lookup の挿入点 (material.ts:39 駒ループ内 / promotion-threat.ts:46 `inPromotionZone` 前) と marks=null fast path (lookup 生成自体スキップ、Set 構築禁止、≤2 は O(m) インライン) を擬コードで固定 (反映済、下記 §14.3)。
- **MED-3 (test 追従カウント訂正)**: card-digest.test の `noPromoteMarkCountDelta` 参照は **~17 箇所** (L138/165/243/275/283/286/295/316/332/482/497/532/539/738/753/767/781)。§14 の「4 箇所」を訂正し `grep -n noPromoteMarkCountDelta` 全ヒットを追従対象に (§14.6 反映)。
- **MED-4 (符号反転の方向テスト)**: 現 `+noPromoteMarkCountDelta×30` (自マーク=有利の符号逆) → per-piece 化で自マーク=不利へ符号反転。§14.6 S4d-3 ゲートに「自マーク局面で『マーク多いほど自分に不利』方向を pin する決定的テスト」を必須化 (epic 7.1 符号逆の回帰 anchor)。bench fixture が marks を含むか未確認ゆえ専用 marks fixture を新規追加前提。

#### [MINOR] 反映
- **MIN-1/MIN-2 (TurnAction 移設)**: `world-kernel.ts:49` の `import type TurnAction` のみ実依存 (move-effects はコメントのみ)。移設時 14 importers の追従に注意 (型のみ=実行時影響ゼロ)。新 location が `cards/types` (CardId) を import する形ゆえ循環 (kernel→cards→ai) 不発を型グラフで確認 (D-4)。
- **MIN-3 (trap leaf コスト)**: getCardValue は board O(81) 走査を trap 局面の leaf 毎に行う。§14.5 R-S4d-3 の bench nodes/s 計測に trap 局面比率込みを明記 (反映済)。

#### PASS 確認 (反証して問題なしと確定)
- **B (trap TT 解禁の誤hitゼロ)**: `getCardValue`→valueModel は gameState のみ依存・経路非依存 (card-spec-server.ts:164/203/316)、computeCardFold は trap を defId fold 済 (key 一意)、trapValueDelta 削除後の digest 残フィールド (mana/hand/draw/deadMana) は全 board 非依存 = trap-skip 撤去の前提成立。**ただし B-1 の marks staleness が別経路の誤hit を残す**ため B-1 反映が前提。
- **F (revert 独立性)**: S4d-3 (marks 帯同) → S4d-4 (trap 帯同追加) は enrichment additive で順序妥当。S4d-1/S4d-2 は enrichment 非依存で先行可。
- **G (file:line)**: search.ts L977-978/L1184/L1252-1300、digest.ts L82/L223、world-kernel.ts:49、getFullLegalMoves=moves.ts:479 すべて実コード一致。
