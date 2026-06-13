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
