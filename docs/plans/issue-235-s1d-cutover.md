# Issue #235 S1d: cutover (reducer 委譲化 + AI useKernelSearch 既定 ON) — 実装計画

> 親 doc: `docs/plans/issue-235-card-shogi-ai-redesign.md` (§3 L0 / §8.5 rollback / §8.3 DP-1〜7)。
> S1 計画: `docs/plans/issue-235-s1-kernel.md` (§6 S1d / §14 S1c DoD)。S1b: `issue-235-s1b-ai-wiring.md`。
> ブランチ `refactor/#235-s1` (S1a/S1b/S1c 完了済、最新 commit `f5464c0`)。
> 本 doc は AGENTS.md ルール8 マイルストーン1 (実装着手前レビュー) の対象。

## 0. 位置づけ・ゴール / 非ゴール
S1 (L0 カーネル統合) の最終段 = **cutover**。S1a で新設し S1c で逆依存解消した L0 カーネル building-block
を、reducer (UI) と AI の **既定経路** に採用する。S1 の rollback 設計上、production 振る舞いを変える
変更は本段の **単一コミット**に隔離する (`git revert` で旧経路復帰、epic §8.5.3 第2層)。

**ゴール**:
1. reducer の inline ロジック 3 箇所を S1a kernel building-block へ**委譲** (二重実装解消、P4):
   - `applyTurnEndEffects` の cardState 変換部 → `advanceDrawProgress`
   - `finalizeDoubleMoveCardConsumption` の consume+event 部 → `finalizeDoubleMoveLogic`
   - `CONFIRM_PLAY_CARD` の効果適用 switch → `applyCardEffectLogic`
2. UI flag (isDrawing/pendingDrawPlayer/pendingDrawSource/selection clear, isPlayingCard/pendingPlayCardOpponent)
   は building-block の**返り値 events を読んで reducer が event-driven にセット** (kernel は cardState/events のみ返す)。
3. AI: `useKernelSearch` を**既定 ON** 化 (DP-1〜7 を production 探索に適用)。

**非ゴール (S1d では触らない)**:
- L1 CardSpec registry (S2) / ValueModel 値付け (S3) / L2 TurnAction 単一探索・TT 拡張 (S4) / L3 相手モデル (S5)。
- 評価係数の再校正 (S3)。S1d の AI 評価の微変 (DP-1 lazy drawProgress 等) は bench で監視のみ、再校正しない。
- 新カード追加・カード仕様変更。

## 1. 設計の核 = 二層構造 (building-block / atomic) の使い分け
kernel は二層:
- **building-block** (`advanceDrawProgress` / `finalizeDoubleMoveLogic` / `applyCardEffectLogic`): 効果適用のみ。
  flip も turn-end も**しない**。reducer の各演出フェーズ (CONFIRM/COMMIT を分割保持) から呼ぶのに適合する。
- **atomic** (`applyTurnAction`): 効果 + flip + turn-end を 1 遷移で合成。AI / headless から呼ぶ。

reducer は演出フェーズ (CONFIRM_PLAY_CARD で効果適用 + isPlayingCard=true、COMMIT_PLAY_CARD で flip + turn-end)
を**維持したまま**、各フェーズ内で building-block を呼ぶ。→ atomic ではなく building-block を採用するのが正しい。
flip / turn-end タイミング (演出完了後) は reducer が引き続き制御する (UX 不変)。

## 2. 等価性の根拠 (なぜ委譲で挙動が変わらないか)
- **event shape**: `CardInstance = {instanceId, defId}` (owner なし) を確認済。reducer の cardPlayEvent
  `instance: pending.instance` と kernel `{instanceId, defId}` は deep-equal。trapSetEvent も TrapInstance
  `{instanceId, defId, owner}` で一致。target/returnedPiece/capturedPieces も両経路で構造一致。
- **S1a property test が実証済**: `world-kernel-equivalence.test.ts` (180 seed×40 ply + targeted 15) が
  reducer dispatch 経路 vs applyTurnAction の cardState/gameState/events (projectEvents=at 除外) 完全一致を
  検証済。applyTurnAction は building-block を合成しているため、**building-block 単位の出力も reducer inline と等価**。
  → 委譲は「実証済の等価ロジックへの置換」であり挙動不変 (UI)。
- **drawProgress (DP-1)**: advanceDrawProgress は reducer applyTurnEndEffects と同一 semantics
  (status≠active で no-op / +1 / 閾値到達∧deck非空で 0 reset + auto-draw 1回)。

## 3. 詳細委譲マッピング (reducer 編集)
### 3-1. applyTurnEndEffects (reducer.ts:246-293) → advanceDrawProgress 採用
```
const { cardState, events } = advanceDrawProgress(state.cardState, state.gameState, player);
// status≠active なら events=[]・cardState 不変 → state そのまま (現 no-op と等価)
const autoDraw = events.find(e => e.kind === "drawEvent" && e.source === "auto");
// cardState 反映 + eventLog append
// autoDraw あり → isDrawing=true / pendingDrawPlayer=player / pendingDrawSource="auto" + selection clear
// autoDraw なし → cardState (drawProgress) 反映のみ (flag 不変)
```
- 注意: status≠active 時に reducer は現状 `return state` (eventLog も触らない)。advanceDrawProgress も events=[]
  なので append なし・flag セットなし。完全一致を保つこと。
- 注意: auto-draw 時の selection clear (selectedSquare/selectedHandPiece/legalMoves/forbiddenMateMoves=空) は
  reducer 責務として維持 (現 274-278 と同一)。

### 3-2. finalizeDoubleMoveCardConsumption (reducer.ts:465-493) → finalizeDoubleMoveLogic 採用
```
const kernelDm = { active: dm.active, movesLeft: dm.movesLeft, cardInstance: dm.cardInstance, cardCost: dm.cardCost };
const { cardState, events } = finalizeDoubleMoveLogic(state.cardState, kernelDm);
// events 空 (consume 失敗) → return state (現 475-479 防御と等価)
// events あり → cardState 反映 + eventLog append + isPlayingCard=true + pendingPlayCardOpponent=null
```
- cardPlayEvent の instance は kernelDm.cardInstance = dm.cardInstance (同一) → 一致。

### 3-3. CONFIRM_PLAY_CARD 効果適用 switch (reducer.ts:1033-1182) → applyCardEffectLogic 採用
- `applyCardEffectLogic` は現状 **private** → **export 化**が必要 (world-kernel.ts)。
- selectTarget 遷移 (1015-1023) と double_move 分岐 (1093-1130) は reducer に残す:
  - double_move は building-block 対象外 (UI snapshot preFirstMoveState/preCardState/mateInOneAvailable を持つため)。
    applyCardEffectLogic も double_move を扱わない (applyTurnAction 側で別扱い)。整合。
- trap/mana_up/pawn_return/piece_return/double_pawn は applyCardEffectLogic に委譲:
```
const action = { kind: "playCard", defId: pending.instance.defId, cardInstanceId: pending.instance.instanceId, target: pending.target };
const world = { gameState: state.gameState, cardState: state.cardState, doubleMove: null };
const applied = applyCardEffectLogic(world, action, player);
if (!applied) return state;  // 不正 (王手未解除等) = 現 return state と等価。check guard は kernel 内蔵
// applied.gameState/cardState/event を採用、pendingCard=null、selection clear、isPlayingCard=true、pendingPlayCardOpponent=opponent
```
- 注意: applyCardEffectLogic は内部で `pendingCard` を持たない (world.cardState は state.cardState から)。
  reducer は適用後 `nextCardState = { ...applied.cardState, pendingCard: null }` で pendingCard クリアを維持。
  (kernel の cardState は pendingCard を変更しないので明示クリア要。現 1145-1148 と等価)
- 注意: check guard (現 1137-1141) は applyCardEffectLogic 内 (world-kernel.ts:204-209) に内蔵済 → 二重不要、kernel に委譲。
- event は applied.event を採用 (cardPlayEvent/trapSetEvent、returnedPiece 込み)。現 reducer 生成と deep-equal。

## 4. AI: useKernelSearch 既定 ON 化
### 4-1. 既定値の変更方法 = **案B 採用 (M1 決定)**
- ~~案A (engine 既定 `?? true`)~~ は不採用。理由 (M1 A-3): `perf-bench.test.ts` / `perf-bench-spectator.test.ts` /
  `perf-bench-card-usage.test.ts` は useKernelSearch 未指定で engine 既定に依存しており、`?? true` 化で
  **暗黙 ON へ反転**し計測 baseline がサイレントドリフトする (テストは存在チェックのみで fail しない)。
- **採用 = 案B**: `engine.ts:203` は `options.useKernelSearch ?? false` のまま維持。**production 入口
  (`route.ts` ai-move) で `useKernelSearch: true` を明示渡し**。
  - 利点: production のみ ON 化、default 依存の test/bench は OFF baseline 不変、rollback は route の 1 行削除。
  - **要確認**: production の AI 入口が route.ts ai-move 以外にあれば (spectate 等) そこにも付与。grep で findBestMoveWithStats の全 production 呼出を確認すること。

### 4-2. spectatorMode × useKernelSearch = **選択肢 (i) 採用 (M1 決定)**
- **決定: AI 探索 kernel 経路は常に spectatorMode=true 相当で呼ぶ** (探索は仮想局面評価 = 決定論化が正しい)。
- 根拠 (M1、4 観点収束 + コード照合):
  - AI 探索は**仮想局面の評価**であり、wall-clock 早指しボーナス (時刻依存) は探索の意味論上無意味かつ非決定的。
    spectatorMode=true はこの **早指しボーナス (MANA_FAST_BONUS) のみを無効化**する。
  - ctx.spectatorMode (案ii) のままだと production (spectator=false) で探索ノード間の mana ボーナスが wall-clock
    依存になり非対称・非決定。spectatorMode=true 固定でこれを構造的に解消する (game-level spectator から独立)。
- **MANA_PER_TURN の OFF/ON 非対称 = 意図的既知差分 (棋力退化ではない、M2 A-2 で精査)**:
  - OFF 近似 `applyActionForLookahead` は move に mana を一切付けない (drawProgress+1 のみ)。
  - ON (`move-effects.ts` makeMoveWithEffects) は move に base `MANA_PER_TURN` を付与 (spectatorMode=true で
    fast bonus は 0)。よって spectatorMode=true でも **ON は move に base mana を charge する点で OFF と異なる**。
  - **棋力退化に当たらない理由**: root の同一プレイヤーの兄弟 move 同士は全て同じ +MANA_PER_TURN オフセットを
    受けるため move 間の argmax 順位は不変。差が出るのは **move vs draw/playCard** の選好のみで、これは
    DP-1 lazy drawProgress と同じ「ON が production 等価方向の既知差分」(kernel-search-equivalence.test.ts:130-132、
    係数再校正は S3、ユーザー承認済 2026-06-07)。bench でも全シナリオで action 選択 OFF==ON 一致を実測。
- **実装**: search.ts の ON 経路 (applyTurnActionForLookahead / searchDoubleMoveSuperActionKernel 内の
  applyTurnAction 呼出、現 ctx.spectatorMode を渡す箇所 ≈ 972/985/1007/1029/1284) を **spectatorMode: true 固定**に変更。
  ctx.spectatorMode はゲームレベルの観戦判定であり、探索 lookahead の決定論化とは別概念として分離する。
  kernel-search-equivalence.test.ts は ON を spectator=true で回しているため本変更で破綻しない。

## 5. UI flag event-driven 化の網羅 (M1 レビュー反映: 演出統合テスト)
event-driven にセットする flag と発火 event の対応:
| flag | 発火条件 (event/結果) | セット箇所 |
|---|---|---|
| isDrawing / pendingDrawPlayer / pendingDrawSource="auto" | advanceDrawProgress が auto drawEvent を返す | applyTurnEndEffects |
| selection clear (auto-draw 時) | 同上 | applyTurnEndEffects |
| isPlayingCard / pendingPlayCardOpponent | applyCardEffectLogic 成功 / finalizeDoubleMoveLogic 成功 | CONFIRM_PLAY_CARD / finalize |
- selectedSquare clear 等は advanceDrawProgress の責務ではなく reducer 演出側の責務 (kernel は触らない)。

## 6. 演出オーケストレーション統合テスト (S1d DoD、M1 反映)
ゲーム状態スナップショット比較 (property test) では捕捉できない**演出 flag の順序・タイミング**を直接突く:
1. **drawProgress→isDrawing 変換**: 閾値到達 move で applyTurnEndEffects 後に isDrawing=true/pendingDrawSource="auto"、
   閾値未到達で flag 不変、を reducer dispatch で pin。
2. **check_break defer 順序**: double_move 中の check_break が 1手目 defer / 2手目発火し、isCheckBreakAnimating が
   正しいタイミングで立つ (委譲後も順序不変)。
3. **double_move finalize flag 遷移**: 2手目完了で finalize→isPlayingCard=true→COMMIT_PLAY_CARD で flip しない
   (pendingPlayCardOpponent=null 経路)、drawProgress+1。
4. **CONFIRM_PLAY_CARD→COMMIT_PLAY_CARD**: 通常カードで isPlayingCard=true/pendingPlayCardOpponent=opponent →
   COMMIT で flip + drawProgress+1。
- 既存 reducer.test に該当ケースがあれば再利用、不足分を追加。

## 7. 検証ゲート
1. lint 0err / typecheck / test:ci 全 green (reducer.test/undo/effects/world-kernel-equivalence/kernel-search-equivalence)。
2. **bench** (`perf-bench-kernel-search.test.ts`、RUN_PERF_BENCH=true): cutover 前後で depthCompleted /
   カード使用率 / アクション選択を比較。棋力退化 (depthCompleted -10% 超 or カード使用率の有意低下) がないこと。
   - bench は **spectator=true 固定**で OFF vs ON を測定。**decision (i) により production の ON 探索は内部
     spectatorMode=true 固定**のため、spectator=true 測定が production-equivalent (game-level spectator から独立)。
     M1 A-4 の「production (spectator=false) で wall-clock variance」懸念は decision (i) が**構造的に解消**済
     (探索 lookahead が game-level spectatorMode を参照しない) なので、spectator=false の別 run は不要。
   - **実測結果 (2026-06-07)**: advanced/expert ともに cardRate OFF=4/4→ON=4/4、全 8 シナリオで action 選択
     OFF==ON 一致、depthCompleted d4==d4 (move-only 探索は本変更非影響)。ON は modest overhead (時間制限内)。
     → 棋力退化なし。
   - 既存 `perf-bench.test.ts` は engine 既定 OFF (案B) のため無改変で OFF baseline を維持 (サイレントドリフトなし)。
3. build green。
4. **rollback 確認**: 本コミットを `git revert` すれば旧経路に戻ることを diff で確認 (単一コミット隔離)。

## 8. リスク
- **R-1 演出 flag の順序差**: 委譲で flip/turn-end タイミングがズレると UI 演出 (ドロー/カード/王手崩し) が暴れる。
  → §6 統合テスト + reducer.test で担保。building-block は flip/turn-end しないため演出制御は reducer 維持。
- **R-2 AI 評価の暴れ (spectatorMode)**: §4-2。production で ON にした際の wall-clock 依存。→ M1 で決定 + bench 監視。
- **R-3 applyCardEffectLogic export の波及**: private→export で他からの誤用リスクは低 (純粋関数)。world-kernel の
  既存 import 経路に影響なし。
- **R-4 eventLog の DB 永続化差**: event shape が deep-equal なので DB save 内容不変 (CardInstance 確認済)。
- **R-5 stale コメント**: 委譲で不要化する reducer コメント (旧 inline 説明) を残骸として残さない。

## 9. rollback (epic §8.5.3)
- 第1層: AI は `useKernelSearch` を OFF に戻す (engine 既定 `?? false`)。
- 第2層: S1d コミットを `git revert` (単一コミット隔離、reducer 委譲も AI 既定も一括復帰)。
- 第3層: reducer.test/undo/effects/property/演出統合テスト を blocking gate。

## 10. S1d DoD
- [ ] applyCardEffectLogic を export 化 (world-kernel.ts:146) — **実装初手の blocking 前提** (M1 A-1)。
- [ ] applyTurnEndEffects は reducer wrapper のまま内部を advanceDrawProgress 委譲 (全 call site 不変)。finalizeDoubleMoveCardConsumption → finalizeDoubleMoveLogic、CONFIRM_PLAY_CARD 効果 switch → applyCardEffectLogic 委譲、inline 重複除去。
- [ ] UI flag を返り値 events から event-driven にセット (§5)。auto-draw 時の selection clear は reducer 責務として維持 (コメントで §3-1 参照、M1 B-5)。
- [ ] AI: route.ts で useKernelSearch: true 明示 (案B、M1 A-3)。production 入口が他にあれば全付与。
- [ ] AI: search.ts ON 経路を spectatorMode=true 固定 (選択肢 i、M1 A-2)。
- [ ] 演出オーケストレーション統合テスト追加 (§6、M1) + auto-draw selection-clear assertion (M1 B-5)。
- [ ] finalizeDoubleMoveCardConsumption に currentPlayer flip 済前提の assert/コメント (M1 B-4)。
- [ ] lint/typecheck/test:ci/build green + bench で棋力退化なし。bench は spectator=true/false 両方で ON/OFF 比較 (§7、M1 A-4)。
- [ ] 単一 git-revert 可コミットに隔離。
- [ ] stale コメント除去 (除去対象: applyTurnEndEffects/finalizeDoubleMoveCardConsumption/CONFIRM_PLAY_CARD の旧 inline 説明、M1 A-5)。
- [ ] (別軽微コミット) UNDO_DOUBLE_MOVE_FIRST / CANCEL_DOUBLE_MOVE の演出 flag を UNDO と対称化 (M1 B-1、live bug ではないが防御強化)。

## 11. M1 マイルストーン1レビュー反映 (計画直後、2026-06-07、AGENTS.md ルール8)
5観点 adversarial workflow (delegation-fidelity/animation-orchestration/ai-cutover/test-bench-adequacy/scope-rollback-doc、48 agents、28 confirmed) でレビュー。**総合判定: 着手可 (計画を覆す欠陥なし、決定保留 2 点を確定)**。反映:
- **[決定] spectatorMode = 選択肢 (i)** (§4-2): 探索 kernel 経路は常に spectatorMode=true。OFF 近似が mana ボーナス無のため (i) が整合 (4 観点収束 + コード照合確認)。
- **[決定] 既定 ON = 案B** (§4-1): 案A は default 依存 bench の baseline サイレントドリフトを招くため不採用。route.ts 明示渡しに変更。
- **[反映] export applyCardEffectLogic** を実装初手の blocking 前提として DoD 先頭に。
- **[反映] bench spectator=false 追加** (§7): (i) 採用で wall-clock variance が消えることを確認。
- **[反映] 演出統合テスト具体化** (§6) + selection-clear assertion + finalize 前提 assert (B-4/B-5)。
- **[派生] UNDO_DOUBLE_MOVE_FIRST/CANCEL の flag 対称化** (B-1): live bug ではない (該当窓で isDrawing/isPlayingCard は構造上 false) が、cutover で flag を event-driven 化する機に UNDO と対称化。別軽微コミットで対応。
- 妥当と確認: 二層構造の building-block 採用 (atomic 誤用回避)・event shape deep-equal・委譲マッピング・単一 revert コミット隔離・rollback 3層。

## 12. M2 マイルストーン2レビュー反映 (実装後、2026-06-07、AGENTS.md ルール8)
5観点 adversarial workflow (delegation-correctness/ai-cutover-correctness/animation-ui/deadcode-imports/scope-rollback-doc、71 agents、32 confirmed) でレビュー。**総合判定: 安全に commit 可 (コード欠陥ゼロ)**。委譲3点・event-driven flag・import 削除9件 (デッドコードなし)・B-1 対称リセットすべて正しいと確認。反映:
- **[記録訂正 = commit 前必須] MANA_PER_TURN 非対称の正確化** (A-1/A-2): §4-2/§7 を訂正。spectatorMode=true は早指しボーナスのみ無効化。ON は move に base MANA_PER_TURN を charge し OFF 近似は付けない = 意図的既知差分だが move 間順位は不変 (move vs card/draw 選好のみ作用、S3 再校正前提・承認済)。bench は spectator=true 固定 (decision i で production-equivalent)、spectator=false 別 run は decision i が variance を構造解消するため不要。
- **[反映] S1 complete 宣言 + S2 引き継ぎ** を s1-kernel.md §16 に追記 (S1d push 後)。memory / epic SSOT にも S1d 完了記録。
- **[後追い可] 任意改善**: COMMIT_PLAY_CARD eventLog 逆走査の不変条件コメント (既存 #82/#130 ロジック)、CONFIRM_PLAY_CARD invalid-target 失敗テスト、bench spectator=false の回帰 pin。いずれも commit を阻害せず後追い。
- 妥当と確認: 単一 revert 可能 (5ファイル、route.ts:1行 + reducer 委譲)、case B で baseline 不変、棋力退化なし実測。
