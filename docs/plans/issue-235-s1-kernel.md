# Issue #235 S1: L0 ルール/状態カーネル統合 — 実装計画 (実装着手前)

> 親 doc (epic 単一情報源): `docs/plans/issue-235-card-shogi-ai-redesign.md` (§3 L0 / §8.5 rollback / §8.3 DP-1〜7)。
> 本 doc は S1 (= L0 カーネル統合 refactor) の**実装計画**。AGENTS.md ルール8 マイルストーン1 (実装着手前レビュー) の対象。
> ブランチ `refactor/#235-s1` (origin/main `1185067` 起点、worktree `.claude/worktrees/issue-235-s1`)。

## 0. ゴールと非ゴール
**ゴール**: カード将棋のルール/状態遷移を単一権威 `applyTurnAction(world, action)` に集約し、reducer (UI) と AI 探索が**同一ロジック**を呼ぶ構造にする (epic P4 解消の第一歩)。
**非ゴール (S1 では触らない)**: 探索コア (S4)、カードフレームワーク registry (S2)、ValueModel (S3)、相手モデル (S5)。standard variant は byte-level 不変。

## 1. 中核戦略 — 「再実装せず抽出して委譲」(reuse, not rewrite)
reducer の純粋ゲームロジック (`makeMoveWithEffects` reducer.ts:239 / `applyTurnEndEffects` の cardState 部 :447 / `finalizeDoubleMoveCardConsumption` :666 / CONFIRM_PLAY_CARD の効果適用 :1207) は**既に大半が純粋**。これらを**新規 `world-kernel.ts` モジュールに抽出 (lift) し、reducer・AI 双方が import して委譲**する。ロジックを**書き換えず再利用**することで振る舞いを構造的に保存し、デグレリスクを最小化する (S1 最大の technical risk への対策)。

## 2. 設計テンション (要レビュー) — kernel atomicity vs reducer 演出フェーズ
reducer はカード/ドローを **CONFIRM (効果適用、演出前) → COMMIT (flip + turn-end、演出後)** に分割し、間でフライト/王手崩し演出を駆動する。一方 AI / property test は **atomic な 1 遷移**を要する。両立のための設計:
- **二層構造**: kernel は (a) 純粋 building-block 関数群 (`applyMoveLogic` = lift した makeMoveWithEffects / `advanceDrawProgress` = applyTurnEndEffects の cardState 部 / `applyCardEffectLogic` / `finalizeDoubleMoveLogic`) と、(b) それらを合成する atomic `applyTurnAction` の 2 層で提供。
- **reducer**: 演出フェーズ構造は維持しつつ、各フェーズが (a) の同一 building-block を呼ぶ → **関数レベルで single-authority** (演出は reducer 側、ロジックは kernel 側)。
- **AI / headless / property test**: (b) `applyTurnAction` を atomic に呼ぶ。
- → 「単一権威」は building-block レベルで達成。applyTurnAction は building-block を演出抜きで合成したもの = reducer の演出フェーズ合成と**同じロジック経路**になり、property test で等価検証できる。

## 3. WorldState 型 (L0)
```ts
interface WorldState {
  gameState: GameState;          // 盤 + 持ち駒 + currentPlayer + status (手番は gameState.currentPlayer)
  cardState: CardGameState;      // mana/manaCap/hand/deck/graveyard/trap/drawProgress/noPromoteMarks
  doubleMove: DoubleMoveState | null;  // 二手指し継続状態 {active, movesLeft, cardInstance, cardCost} (DP-2 マルチ ply)
}
```
- `cardState` 型は既存 `CardGameState` をそのまま使う (pendingCard/lastTurnStartedAt フィールドを含むが、**kernel は読み書きしない** = DP の must-not-match。pendingCard は UI 確認用で kernel には confirmed action が渡る、lastTurnStartedAt は spectator/決定論化で扱う)。
- `doubleMove` は reducer の `state.doubleMove` と同型 (active/movesLeft/cardInstance/cardCost)。AI 既存 `AiTurnState.doubleMove` (active/movesLeft のみ) は kernel 型へ統合。
- WorldState は不変更新 (純粋)。

## 4. applyTurnAction 仕様
```ts
function applyTurnAction(
  world: WorldState,
  action: TurnAction,                 // move / draw / playCard (move/draw/playCard)
  opts?: { spectatorMode?: boolean },  // DP-4 決定論化 (早指し無効化)
): { world: WorldState; events: GameEvent[]; turnEnded: boolean }
```
アクション別 (DP-1〜7 準拠、§8.3.2 の per-action property が仕様):
> **注**: `action` の playCard は TurnAction union の単一メンバ + `defId` dispatch (types.ts:19-22)。下記 modifyBoard/setTrap/double_move は新 union メンバではなく defId 分岐。新メンバを増やさない (疎結合・余分コード回避)。
> **currentPlayer flip 規約 (DP-2、SSOT §8.3.2 転記)**: 「ターン終了 = currentPlayer 反転」は applyTurnAction が一元決定。ただし **double_move 2手目は `applyMoveLogic` (applyMove) が既に opponent へ flip 済**のため、kernel の turnEnded=true は**再 flip を伴わない** (reducer.ts:692 の pendingPlayCardOpponent=null による flip 抑止と等価)。double_move 1手目は applyMove の flip を**戻して** turnEnded=false (ターン継続、reducer.ts:821 相当)。
- **move**: `world.doubleMove` から mode 決定 (null→normal / movesLeft 2→double_move_first / 1→double_move_second)。`applyMoveLogic` (reuse makeMoveWithEffects) で盤・trap発火・noPromoteMarks・manaCharge を適用。
  - normal: turnEnded=true (currentPlayer は applyMove で flip 済) + `advanceDrawProgress`。
  - double_move_first: turnEnded=false・flip 戻し (currentPlayer を元の手番に戻す)・**advanceDrawProgress 呼ばない** (ターン継続) ・check_break defer (DP-7)。movesLeft 2→1。1手目で詰み成立 (status≠active) 時は即 finalize (下記)。
  - double_move_second: defer check_break 発火 → `finalizeDoubleMoveLogic` で遅延消費 (consumeNormalCard + cardPlayEvent) + doubleMove=null + turnEnded=true (再 flip なし) + `advanceDrawProgress` 1回。
- **draw**: deck先頭→hand末尾 / mana -= DRAW_COST / flip + `advanceDrawProgress` (DP-1: drawProgress は turn-end で +1、5到達で reset+auto-draw)。turnEnded=true。
- **playCard:modifyBoard** (pawn_return/piece_return/double_pawn): **reducer.ts:1249-1293 と同一の direct-apply 経路を reuse** (`applyPawnReturn`/`applyPieceReturn`/`applyDoublePawn` を直接呼ぶ。`simulateCardEffect` は使わない — returnedPieceInfo と removeNoPromoteMark を落とすため誤り)。盤変更 + `consumeNormalCard` (mana-=cost, hand→graveyard) + **returnedPieceInfo を cardPlayEvent.returnedPiece に載せる** + pawn/piece_return 後に **removeNoPromoteMark** (reducer.ts:1266/1284) → flip + advanceDrawProgress。turnEnded=true。
- **playCard:setTrap** (no_promote/check_break): `applyTrapSet` (hand→trap, **graveyard 不変** DP-3) + mana-=cost → flip + advanceDrawProgress。turnEnded=true。
- **playCard:double_move**: doubleMove フラグ set のみ (mana/hand/graveyard **不変** = 遅延消費 DP-2)。turnEnded=false。

## 5. 抽出マッピング (どの reducer ロジックを kernel へ)
| reducer 現在地 | kernel 抽出先 | 備考 |
|---|---|---|
| `makeMoveWithEffects` (:239) | `applyMoveLogic(world, move, mode, opts)` | ほぼそのまま lift。CardShogiGameStateInternal 依存なし (gameState+cardState のみ) → WorldState 化容易 |
| `applyTurnEndEffects` (:447) の cardState 部 (drawProgress/deck/hand) | `advanceDrawProgress(cardState, gameState, player) → { cardState, events }` | **新規実装** (reducer 版は UI 結合のため再利用不可)。drawProgress +1、5到達∧deck非空で 0 reset + auto-draw (deck先頭→hand, drawEvent{source:auto} を events に)。**非再帰・1回のみ** (DP-1)。UI flag (isDrawing/pendingDrawPlayer。selectedSquare clear は reducer 演出側責務で advanceDrawProgress の対象外) は **reducer が S1d で返り値 events (auto drawEvent) を読んで event-driven にセット** (kernel は cardState+events のみ返す) |
| `finalizeDoubleMoveCardConsumption` (:666) の consumeNormalCard+event 部 | `finalizeDoubleMoveLogic(world, dm)` | isPlayingCard/pendingPlayCardOpponent flag は reducer に残す |
| CONFIRM_PLAY_CARD (:1207) の効果適用部 | `applyCardEffectLogic(world, action)` | pendingCard/演出 flag は reducer に残す |
| currentPlayer flip (MAKE_MOVE/COMMIT_* に散在) | applyTurnAction 内に集約 | 「ターン終了で flip」を kernel が一元管理 |

reducer 側は抽出後、各フェーズで kernel 関数を呼び **UI state (eventLog append / animation flag / selectedSquare / pendingCard / undoSnapshot) のみ自前管理**。

## 6. 移行段階 (S1a〜d、各段で不変ゲート green を維持) — **epic SSOT §8.5.2 準拠 (マイルストーン1レビュー反映)**
> **重要訂正**: 初版は S1a に「reducer を委譲へ refactor」を含めていたが、これは epic SSOT §8.5.2 の定める staging (S1a=additive 新規モジュールのみ / reducer 薄ラッパ化=S1c / cutover=S1d 単一コミット隔離) と矛盾し、最大リスクの production rewire を property 等価 green より前に前倒しして rollback 第2層 (cutover 隔離) の前提を壊す。SSOT 通り **S1a は production (reducer/AI) 完全不変**に訂正。
- **S1a (本計画の主対象)**: `world-kernel.ts` を**新規モジュールとして追加** = WorldState + building-block (applyMoveLogic/advanceDrawProgress/applyCardEffectLogic/finalizeDoubleMoveLogic) + atomic applyTurnAction。**production (reducer/AI) は完全不変** (例外: 純粋関数 `makeMoveWithEffects` 等を kernel から再利用するため reducer.ts に `export` を**付与するのみ**の振る舞い不変変更は許容。reducer の呼出経路・ロジックは一切変えない)。**property-based 等価テスト新設** (現 reducer 経路 vs 新 applyTurnAction の独立2実装比較、§8.3.4)。既存 reducer.test/undo-policy.test/effects.test 全 green 維持。
  - **reuse 方針**: `makeMoveWithEffects` は gameState+cardState+move+options のみ依存し reducer の他 state フィールドに隠れた依存を持たない (レビューで確認) ため reducer.ts から `export` して kernel が import 再利用 (rewrite 回避)。※ 厳密には純粋関数ではなく `Date.now()` に依存する (早指しボーナス isFastMove 判定 + イベント at) が、この非決定性は spectatorMode=true (fastMove 無効化) と at 射影除外で制御済 (§7 DP-4)。`applyTurnEndEffects` は UI state 結合のため**そのコア (drawProgress/deck/hand 変換) を kernel に新規実装** (`advanceDrawProgress`)、reducer 側は S1a/S1c では不変 (S1d で advanceDrawProgress へ委譲)。両者の等価は property test で担保。
- **S1b**: AI 探索が `useKernelSearch` フラグ (既定 OFF) 裏で applyTurnAction 経由に切替可能化 + `AiTurnState.doubleMove` の kernel 型統合 + double_move cardState 近似 (current-rules.ts:114) 解消。OFF で既存挙動完全保持。bench で旧経路と depthCompleted/カード使用率比較。
- **S1c (lean 方式、2026-06-07 ユーザー確定で shadow-assert 不採用)**: `makeMoveWithEffects` (+ `MakeMoveMode` 型) を reducer.ts から新規 lib モジュール `src/lib/shogi/kernel/move-effects.ts` へ**物理移設のみ**。reducer は移設先から import して**従来どおり直接呼ぶ** (呼出経路・ロジック・関数本体は 1 行も変えない)。これにより world-kernel (lib) → reducer (hooks) の暫定逆依存 (層違反) を解消する。**挙動完全不変・純粋リファクタ**。
  - **shadow-assert は廃止**: S1a の property-based 等価テスト (reducer dispatch ≡ applyTurnAction を 180 seed×40 ply + targeted で検証済) が等価担保の主目的を達成済のため、throwaway な二重計算コードを production reducer に入れない。
  - **reducer の薄ラッパ化 (各演出フェーズが kernel building-block を呼ぶ委譲) は S1c から S1d へ移動**。S1c では reducer ロジックは無改変。
  - **等価ゲート**: 物理移設のみのため lint/typecheck/test:ci 全 green (特に reducer.test/undo-policy.test/effects.test/world-kernel-equivalence.test/kernel-search-equivalence.test) + build green の再現が純粋移設の証跡。
- **S1d (cutover、単一 git-revert 可コミット)**: ① reducer の `applyTurnEndEffects` (cardState 部) / `finalizeDoubleMoveCardConsumption` / `CONFIRM_PLAY_CARD` 効果適用部を kernel building-block (`advanceDrawProgress` / `finalizeDoubleMoveLogic` / `applyCardEffectLogic`) へ**委譲 (薄ラッパ化)**、inline 重複除去 + UI flag (isDrawing/pendingDrawPlayer 等) を返り値 events から event-driven セット。`applyCardEffectLogic` は現状 private のため export 要。② AI: `useKernelSearch` 既定 ON。
  - **S1d 等価ゲート (M1 レビュー反映)**: S1c と異なり S1d は reducer のオーケストレーションを変える (inline → 委譲 + flag の event-driven 化)。S1a property test + reducer.test/undo/effects/S1b 特性化に加え、**演出オーケストレーション (drawProgress→isDrawing/pendingDrawPlayer 変換、check_break defer 順序、二手指し finalize タイミング) を直接突く統合テストを S1d DoD に含める** (ゲーム状態スナップショット比較だけでは演出 flag の順序・defer/trigger タイミングを捕捉できないため)。挙動は意図的に等価 (UI=reducer.test、AI 評価は DP-1 lazy drawProgress 等で微変=bench 監視)。rollback 第2層: `git revert` 対象。

## 7. property-based 等価テスト (S1a、§8.3.4 + DP-1〜7)
- **framework (依存追加なし)**: fast-check は package.json 未導入 + AGENTS.md §7 (パッケージ追加は要確認) のため**使わない**。PoC-3 と同じ **hand-rolled seeded PRNG (mulberry32) + 手書き generator** で実装 (vitest のみで完結、決定的・再現可能)。
- **generator**: seeded WorldState から各ステップで合法 TurnAction (`getFullLegalMoves` + canDraw?draw + `getCardActions`) を seeded PRNG 選択。reducer 経路 (BEGIN→[SELECT]→CONFIRM→COMMIT / DRAW→COMMIT / MAKE_MOVE を**プログラム的に dispatch**) と applyTurnAction の両方に同一 action 適用。double_move は複合列展開。reducer は現状不変 (S1a) のため、これは**独立2実装 (既存 reducer vs 新 kernel) の等価検証**になる (= 「委譲で自明」ではなく真の regression guard)。
- **決定論化 (DP-4)**: spectatorMode=true 固定 (早指しボーナス無効 = fastMove=false 確定)。event の `at` (Date.now()) は射影 (projectEvents/stripAt) で除外するため **Date.now() stub は不要** (S1a part2 実装で確定。当初案の fake clock は採用せず)。
- **射影 (DP-1〜7)**: must-match 12 (mana/manaCap/hand[順序]/deck[順序]/graveyard[順序]/trap/noPromoteMarks[集合 DP-5]/drawProgress + board zobrist + turnEnded + events[kind+ドメイン射影, at除外, manaChargeEvent除外 DP-4])。must-not-match (pendingCard/lastTurnStartedAt/演出flag/UI) は捨象。
- **assertion**: 各適用後 deep-equal / 保存則 hand+deck+graveyard+trap (DP-3) / drawProgress 5到達で reset+auto-draw / double_move 1手目 turnEnded=false で currentPlayer 不変 / events 順序一致。
- **seed エッジケース**: 自動ドロー境界(4→5) / 山札空 / manaCap飽和 / 両者異種trap / double_move中 check_break defer→2手目発火 / double_move 1手目詰み / 捕獲駒の no_promote マーク削除 / 終局手後 turn-end スキップ。
- **位置づけ**: reducer が building-block 委譲なら reducer 経路 == applyTurnAction はほぼ自明だが、**flip / turn-end 合成の orchestration 差**を検出する regression guard (atomic 合成 vs 演出フェーズ合成の一致確認)。

## 8. DP-1〜7 遵守マップ
- DP-1 drawProgress: `advanceDrawProgress` が reducer semantics (遅延+条件 reset+auto-draw)。AI 旧 immediate+1 (applyActionForLookahead) は S1b でカーネル委譲時に解消。
- DP-2 double_move: applyTurnAction がマルチ ply (1手目 turnEnded=false / 2手目 finalize 遅延消費)。
- DP-3 保存則: setTrap は hand→trap (graveyard 不変)、通常カードは hand→graveyard。
- DP-4 決定論化: opts.spectatorMode (fastMove=false) + event `at` を射影除外 (Date.now stub 不要) + manaChargeEvent を events 射影除外。
- DP-5 noPromoteMarks: 集合一致。
- DP-6 manaCap: 不変 (kernel 内代入なし)。
- DP-7 check_break: applyCheckBreak が getCheckingPieces (直接王手駒のみ)。double_move_first は defer。

## 9. feature-flag + rollback (epic §8.5 準拠、lean 反映)
- flag `useKernelSearch` (AI、既定 OFF)。**reducer 側 shadow-assert は不採用** (lean、S1a property test が等価担保の主目的を達成済のため)。reducer の等価は移設の純粋性 (S1c) + 全テスト green + S1d 委譲時の reducer.test/undo/effects/演出統合テストで担保。
- rollback 3層: フラグ OFF / S1d cutover commit を `git revert` / reducer.test+undo+effects+property を blocking gate。
- standard byte-level 不変ゲート。

## 10. リスク
- **R-S1-1 抽出時の暗黙依存見落とし**: makeMoveWithEffects/applyTurnEndEffects が CardShogiGameStateInternal の他フィールドに暗黙依存していないか精査 (applyTurnEndEffects は selectedSquare 等を触るが cardState 変換と分離可能なことを確認済)。→ property test + 既存 test で担保。
- **R-S1-2 演出フェーズ分割との不整合**: §2 の二層設計で両立。CONFIRM/COMMIT の中間状態 (pendingCard/animation) は kernel 対象外を明示。
- **R-S1-3 AI 評価系の数値変化**: DP-1 で AI の drawProgress semantics が変わる (immediate→lazy) → cardDigest 経由の評価が微変。S1b で bench 監視、棋力ゲートで検出。
- **R-S1-4 二手指し orchestration の複雑性**: finalize の pendingPlayCardOpponent re-flip ロジック (reducer.ts:692) を kernel の turnEnded 決定に正しく移植。property test の double_move エッジケースで担保。

## 11. S1a DoD (additive のみ・production 不変)
- [x] `world-kernel.ts`: WorldState + building-block + applyTurnAction 実装 (新規ファイル) — part1 commit `29d1e1e`
- [x] reducer.ts: `makeMoveWithEffects` 等の `export` 付与のみ (振る舞い不変、呼出経路・ロジック不変) — part1
- [x] property-based 等価テスト新設・green (現 reducer 経路 vs 新 applyTurnAction の独立2実装比較、DP-1〜7 + エッジケース、**hand-rolled seeded generator = fast-check 等の依存追加なし**) — part2: `src/lib/shogi/kernel/__tests__/world-kernel-equivalence.test.ts` (16 件: ランダム harness 180 seed×40 ply + targeted 15)
- [x] reducer.test / undo-policy.test / effects.test 全 green (不変ゲート = production 不変の証跡) — test:ci 528 passed
- [x] lint / typecheck / test:ci / build green — part2 完了時点で全 green
- [x] standard variant byte-level 不変 (kernel は card-shogi 専用、standard は kernel 非経由)
- [x] **reducer の薄ラッパ化・AI 配線は含めない (S1c/S1b へ隔離)** — additive のみ維持

## 12. マイルストーン1レビュー反映 (2026-06-07、AGENTS.md ルール8)
本計画初版を 3観点 adversarial workflow (#109 観点 + reducer 実コード照合) でレビューし、以下を反映:
- **[最重要] S1a スコープを epic SSOT §8.5.2 へ整合** (§6/§11): 初版は reducer rewire を S1a に前倒ししていたが、SSOT は S1a=additive 新規モジュールのみ・reducer 薄ラッパ化=S1c・cutover=S1d 単一コミット隔離。rollback 第2層の前提を守るため production 不変に訂正。
- **modifyBoard を direct-apply に訂正** (§4): `simulateCardEffect` は returnedPieceInfo / removeNoPromoteMark を落とすため誤り。reducer.ts:1249-1293 と同一の `applyPawnReturn`/`applyPieceReturn`/`applyDoublePawn` 直接呼出を reuse。
- **DP-2 double_move の flip 抑止を明文化** (§4): 2手目は applyMove で flip 済 → kernel turnEnded=true は再 flip しない (reducer.ts:692 等価)。doubleMove=null タイミング・1手目詰み finalize を明記。
- **advanceDrawProgress を {cardState, events} 返却に確定** (§5): UI flag は reducer が S1c で event-driven セット。非再帰1回 (DP-1)。
- **property test は hand-rolled seeded generator** (§7): fast-check 依存追加を回避 (AGENTS.md §7)。reducer 不変ゆえ独立2実装の真の等価検証。
- **AI doubleMove 型統合・近似解消は S1b へ隔離** (§6): S1a の WorldState.doubleMove は reducer 由来 {active,movesLeft,cardInstance,cardCost} に限定。
- **playCard は単一 union メンバ + defId dispatch** (§4 注): 新 union メンバを増やさない。
- 妥当と確認: 中核戦略 (抽出して委譲)・二層構造・DP-1〜7 射影・check_break reuse・feature-flag+多層 rollback・evaluateGameEnd 共有。
- 着手前提: S0 design doc はユーザー承認済 (2026-06-07、epic §8.6)。本 worktree に epic SSOT を co-locate 済 (design ブランチ merge)。

## 13. マイルストーン2レビュー反映 (実装後、2026-06-07、AGENTS.md ルール8)
S1a part2 (property-based 等価テスト) 実装完了時点で、5観点 adversarial workflow (#109 観点 + 実コード照合 + 計装 coverage probe、16 agents) を実施。**16 findings → high/medium 11 件を独立検証 = 全件 confirmed (refuted/uncertain 0)**。指摘は「計画 §8.3.4 必須エッジのうち**終局 (status≠active) 系がランダム harness でも targeted でも未踏**」に収束。下記をすべて反映:
- **[high] 通常 move 終局の turn-end スキップ**: 固定盤面 (head-gold 詰み) で詰ます手を適用し、`advanceDrawProgress` の status≠active no-op (drawProgress 境界 4 でも reset/auto-draw しない) と status/winner/flip 等価を pin。
- **[high] double_move 1手目詰みの即 finalize** (world-kernel.ts:258-274): 1手目で詰む固定盤面で、flip 戻し抑止・カード遅延消費 (hand→graveyard, mana-=5, cardPlayEvent)・drawProgress スキップを reducer 経路と等価 pin。
- **[medium] DP-5×カード**: pawn_return で戻した駒の no_promote マーク削除 (removeNoPromoteMark) を pin。
- **[medium] DP-7**: double_move 中の check_break が 1手目で defer (トラップ残置)・2手目で発火 (王手駒捕獲・トラップ消費・trapTriggerEvent) する複合列を pin。捕獲駒の no_promote マーク削除も pin。
- **[medium] 王手中 double_move (checkUsage=unconditional)**: 王手中の double_move 開始 + RELAXED 1手目 (自玉王手のまま) → 2手目で解消、を等価 pin (王手中カード orchestration / RELAXED 1手目の双方をカバー)。
- **[low] OBS4-5**: ランダム harness の doubleMove 同期チェックに cardInstance.instanceId / cardCost 比較を追加 (遅延消費パラメータの一致を直接 pin)。
- **[low] OBS5-3**: deprecated `mana_up` 分岐 (kernel/reducer 両在) の等価を targeted で pin しデッドカバレッジ解消。
- **[low] F-3 (doc)**: 本計画 §4/§8 の「Date.now() stub」記述を実態 (stripAt による at 射影除外 = stub 不要) に訂正。
- 結果テスト: ランダム harness 180 seed×40 ply + targeted 15 = 計 16 件 green。test:ci 528 passed / build green。

## 14. S1c (lean = makeMoveWithEffects 物理移設) DoD
挙動完全不変・純粋リファクタ。reducer ロジックは無改変 (委譲は S1d)。
- [ ] `src/lib/shogi/kernel/move-effects.ts` 新設: `MakeMoveMode` 型 + `makeMoveWithEffects` 関数を reducer.ts から**本体 1 行も変えず**移設・export。import は全て lib 層 (types/board/moves/rules/variants/cards/effects/定数)。hooks 依存ゼロ。
- [ ] reducer.ts: `MakeMoveMode`/`makeMoveWithEffects` 定義を削除し `@/lib/shogi/kernel/move-effects` から import。makeMoveWithEffects 専用だった import (`evaluateGameEnd` / `MANA_PER_TURN` / `MANA_FAST_BONUS` / `FAST_THRESHOLD_MS` / `applyCheckBreak` / `applyTrapClear` / `addNoPromoteMark` / `moveNoPromoteMark`) を削除。**`removeNoPromoteMark` (reducer.ts:1268/1286 で使用) / `AUTO_DRAW_INTERVAL` (applyTurnEndEffects で使用) は削除しない**。6 呼び出し箇所 (reducer.ts MAKE_MOVE/CONFIRM_PROMOTION) はシグネチャ同一でコード本体無変更。
- [ ] world-kernel.ts: makeMoveWithEffects の import 元を `@/hooks/card-shogi/reducer` → `@/lib/shogi/kernel/move-effects` に変更 + ヘッダコメントを「S1c で物理移設・逆依存解消済」に更新。
- [ ] lint 0err / typecheck exit0 / test:ci 全 green (S1b 完了時点と同値) / build green = 純粋移設の証跡。
- [ ] 直接ユニットテストの追加は不要 (property-based 等価 + reducer.test で十分。将来 move-effects.ts に意味的変更が入った時点で追加検討)。
- [ ] shadow-assert は不採用 (S1a property test が等価担保の主目的を達成済のため、§6 S1c / §9 参照)。reducer ロジックは無改変ゆえ二重計算コードを入れる価値が小さい。

## 15. S1c マイルストーン1レビュー反映 (計画直後、2026-06-07、AGENTS.md ルール8)
S1c (lean) 計画を 4観点 adversarial workflow (deps/behavior/tests/doc-ssot、#109 観点 + 実コード照合、44 agents、22 件 confirmed) でレビュー。**総合判定: 着手可 (計画を覆す欠陥ゼロ)**。過半は「計画の正しさを実証する肯定的指摘」。下記を反映:
- **[事実訂正] makeMoveWithEffects は純粋関数ではない**: behavior 観点の high「純粋ゆえ安全」は事実誤認 (reducer.ts:384/407 で `Date.now()` 依存)。ただし非決定性は spectatorMode + at 射影で制御済のため移設は安全。本計画 §6 reuse 方針の「純粋」表現を訂正済。実装時は spectatorMode/at 射影の契約を 1bit も変えない (メモ化禁止)。
- **[スコープ訂正] doc/コメント精度**: 旧 doc の「S1c=薄ラッパ化+shadow-assert」記述を lean (S1c=物理移設のみ、委譲=S1d、shadow-assert 廃止) に上書き (§5/§6/§9)。world-kernel.ts:8-11/41 ヘッダコメントも S1c 完了版に更新する。
- **[S1d へ反映] テスト十分性の論理飛躍**: 「world-kernel-equivalence green = S1c 移設の絶対証拠」は S1c (純粋移設) では成立する (reducer ロジック無改変ゆえ全テスト green で十分) が、レビューが懸念した「演出 flag の event-driven 化の検証不足」は **S1d の懸念**。S1d DoD に演出オーケストレーション統合テストを含める旨を §6 S1d 項に明記済。なお shadow-assert 再導入は lean 決定により行わない。
- 妥当と確認: 物理移設可・循環依存なし・import 整理範囲確定・import パス更新は world-kernel.ts のみ・tsconfig 変更不要・tree-shaking 影響なし・baseline (test:ci 539 passed/build green) 再現で純粋移設担保。

## 16. S1 完了宣言 + S2 引き継ぎ (S1d cutover 完了時、2026-06-07)
S1d cutover (詳細計画: `docs/plans/issue-235-s1d-cutover.md`) 完了をもって **S1 (L0 カーネル統合) 全段 (S1a/S1b/S1c/S1d) 完了**。
- **S1 完了の定義 (達成済)**:
  - L0 カーネル (`world-kernel.ts` applyTurnAction + building-block / `move-effects.ts` makeMoveWithEffects) が
    reducer (UI) と AI 探索の **単一権威** として採用済 (P4 二重実装解消)。
  - production 振る舞いは UI=等価 (reducer.test + 演出統合テスト)、AI=DP-1 lazy drawProgress / base mana charge の
    意図的既知差分のみ (move 間順位不変、move vs card/draw 選好のみ作用、S3 再校正前提・ユーザー承認済)。
  - 等価担保: world-kernel-equivalence (180 seed×40 ply + targeted 15) / kernel-search-equivalence / reducer.test /
    undo-policy.test / effects.test 全 green。bench で棋力退化なし実測 (cardRate 4/4、action OFF==ON、d4==d4)。
  - rollback: 単一 cutover コミット `git revert` + AI は route.ts の `useKernelSearch: true` 削除で OFF 復帰。
- **S2 (L1 CardSpec registry) への引き継ぎ**:
  - L0 が export する building-block (`applyTurnAction` / `advanceDrawProgress` / `finalizeDoubleMoveLogic` /
    `applyCardEffectLogic` / `makeMoveWithEffects`) が S2 の土台。
  - `applyCardEffectLogic` は現状 effectId switch (trap/mana_up/pawn_return/piece_return/double_pawn) のハードコード。
    S2 で単一 `CardSpec.effect.apply` registry に supersede 予定 (= 本 switch は S2 で CardSpec 駆動へ置換される暫定 bridge)。
  - 新カード追加は S2 完了までは AGENTS.md「カード将棋: 新規カード追加時のチェックリスト」+ applyCardEffectLogic の
    switch 追記が必要 (S2 で registry 化されると 1 スキーマで自動追従)。
