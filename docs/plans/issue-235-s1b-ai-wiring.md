# Issue #235 S1b: AI 探索を useKernelSearch フラグ裏で applyTurnAction 経由に切替可能化 — 実装計画

> 親 doc: `docs/plans/issue-235-card-shogi-ai-redesign.md` (§3 L0 / §8.5)。S1 計画: `docs/plans/issue-235-s1-kernel.md` (§6 S1b)。
> ブランチ `refactor/#235-s1` (S1a part1/2 完了済 commit `668cb78`)。本 doc は AGENTS.md ルール8 マイルストーン1 (実装着手前レビュー) の対象。

## 0. ゴールと非ゴール
**ゴール**: カード将棋 AI 探索の **root カード/ドロー評価経路**を `useKernelSearch` フラグ (既定 OFF) 裏で L0 カーネル `applyTurnAction` 経由に切替可能化する。OFF は既存挙動を**バイト等価で完全保持**、ON は単一権威カーネルを通すことで DP-1〜7 を自動適用する。`AiTurnState.doubleMove` を kernel の `KernelDoubleMove` 型へ統合し、double_move cardState 近似を解消する。
**非ゴール (S1b では触らない)**: 深い negamax/quiescence の move-only ホットパス (cardState 非搬送のため kernel 化の意味なし)、TT の cardState ハッシュ拡張 (S4)、評価係数の再校正 (S3 ValueModel)、reducer 側 (S1c 物理移設 / S1d 委譲)、cutover で既定 ON 化 (S1d)、route.ts (S1d まで OFF 固定)。

> **S1d cutover の相互参照 (lean 改訂)**: 本 S1b の `useKernelSearch` 既定 ON 化は、reducer 側の kernel building-block 委譲 (薄ラッパ化、S1c の物理移設後に S1d で実施) と**同じ S1d 単一コミット**で同期 flip する。shadow-assert は不採用 (S1 計画 doc §9 / epic §8.5.1)。

## 1. スコープの精緻化 (recon 6観点 + 中核ファイル精読で確定)
kernel 経由化が効くのは **root のカード/ドロー評価 2 関数のみ**:
- `evaluateActionWithLookahead` (search.ts:1115) — move/draw/playCard(通常) の lookahead 評価。内部で `applyActionForLookahead` (search.ts:1000) を呼ぶ。
- `searchDoubleMoveSuperAction` (search.ts:834) — double_move の 2 手指し組合せ探索。`CurrentRules.applyAction` + 手動 cardState wiring (search.ts:857-883) を使う。

深い negamax (search.ts:540-721) は move-only で cardState を搬送しないため **OFF/ON とも `applyMoveForSearch` のまま不変**。engine.ts:295-344 の root カード採用ループは `evaluateActionWithLookahead` を ctx 経由で呼ぶだけなので**ループ本体は無改変**(フラグは ctx に相乗り)。

## 2. 中核原則 — 旧コード無改変で OFF 等価を構造保証
`applyActionForLookahead` / `searchDoubleMoveSuperAction` の手動 wiring / `CurrentRules.applyAction` の double_move 近似は **一切削除・改変しない** (= OFF 経路として丸ごと保持)。ON 経路は別実装を `ctx.useKernelSearch` で二分岐して**追加**する。旧コードに触れないため OFF のバイト等価が構造的に保証される (S1a と同じ additive 戦略)。

## 3. OFF と ON の差分 (= 「ON は production 等価への是正」の全列挙)
ON は `applyTurnAction` (= 本番 reducer と同一ロジック) を通すため、軽量近似の OFF とは下表の通り差が出る。**すべて「ON がより正確」方向**で、棋力影響は bench で測定・記録する (係数再校正は S3、ユーザー確認済 2026-06-07)。

| action | gameState 差 | cardState 差 |
|---|---|---|
| move | OFF=`applyMoveForSearch` (盤+flip のみ、status=active 据置)。ON=`makeMoveWithEffects` (盤+flip + **trap発火 + noPromote追従 + game-end status**) | OFF=drawProgress+1 のみ。ON=**manaCharge+1** + lazy drawProgress (DP-1: +1 or reset+auto-draw) + trap発火時 trap clear + lastTurnStartedAt クリア |
| draw | OFF=不変 (flip なし)。ON=**currentPlayer flip** (大半は評価不変*) | OFF=mana-2/hand+1/deck-1/drawProgress+1。ON=同左 + **lazy drawProgress** (境界で reset + auto-draw 2枚目) |
| playCard trap | OFF=不変。ON=**flip** (大半は評価不変*) | OFF=mana-cost/hand-1/trap set/drawProgress+1。ON=同左 + lazy drawProgress (境界 auto-draw) |
| playCard 通常 | OFF=`simulateCardEffect` (盤, flip なし、status 据置)。ON=`applyCardEffectLogic` (盤 via applyPawnReturn 等 [**盤面は OFF と同一**] + flip) | OFF=mana-cost/hand-1 (graveyard 追加なし)/drawProgress+1。ON=mana-cost/**hand→graveyard** (consumeNormalCard)/**noPromoteMarks: removeNoPromoteMark で対象マス削除** (OFF 不変)/lazy drawProgress |
| double_move | OFF=`CurrentRules.applyAction` 連鎖 (近似、status 据置)。ON=`applyTurnAction` 連鎖 (playCard→move→move)。**2手目/1手目が終局 (mate 等) なら ON は status セット** | OFF=手動 wiring (mana-5/hand-1/drawProgress+1、**graveyard なし**)。ON=**遅延 finalize で hand→graveyard** + lazy drawProgress + flip 戻し/抑止を kernel が一元処理 |

**評価スコアへの影響**:
- **board (駒配置)**: trap 未発火・非 modifyBoard の move、および全 modifyBoard カードでは OFF/ON 一致 (`simulateCardEffect` は kernel と同じ `applyPawnReturn` 等を呼ぶ)。trap (check_break/no_promote) が move で発火する局面のみ ON は盤が変わる (ON 是正)。
- **status / 終局スコア (OBS3-1)**: 着手後/2手目が終局 (checkmate/stalemate/repetition/impasse) になる局面で、ON は `evaluateGameEnd` が status をセット → `evaluate` が mate score (±100000) / draw (0) を返す。OFF は status=active のまま material 評価。→ **score 次元の差** (ON 是正)。
- **currentPlayer / tempo (OBS2-F1、訂正)**: 旧記述「evaluate は currentPlayer 非依存」は**誤り**。`evaluate` には currentPlayer 依存の tempo 項 (±15cp、evaluate.ts:73 付近) がある。通常経路では `getOpponentResponseScore` が opp 手を `applyMoveForSearch` で再 flip するため tempo は OFF/ON 一致するが、**terminal sub-case (oppMoves=0 = 相手が既に詰み/stalemate) で draw/playCard を打つ稀少局面**では `applied.gameState` の currentPlayer を直接 evaluate するため OFF(自分)/ON(相手) で tempo 符号反転 = 正味 ±30cp 乖離 (ON 是正 = 手番が相手に渡った正しい局面)。move/double_move は OFF/ON とも flip するため tempo 一致。
- **must-not-match (評価非影響、特性化 test で除外/分離)**: lastTurnStartedAt (ON move/draw でクリア)、moveCount (ON move で +1)、moveHistory/positionHistory (ON move で append)。digest にも oppScore にも効かない。

## 4. 実装方針 (additive・フラグ二分岐)
### 型統合 (S1b-0、M1 レビュー OFF-1/OFF-3/F-3 反映 = optional 化)
**[訂正]** 当初案は `AiTurnState.doubleMove` を `KernelDoubleMove` 同型 (cardInstance/cardCost **必須**) に拡張だったが、これは (a) current-rules.ts:93 (move 遷移 `{active,movesLeft:1}`) / :121 (double_move set) を typecheck で破壊、(b) double-move-search.test.ts / action-generator.test.ts の `{active,movesLeft}` リテラル代入を破壊、(c) OFF 経路に cardInstance/cardCost を補完すると `toEqual({active,movesLeft})` を runtime 破壊する。よって **optional 化**に変更:
- `AiTurnState.doubleMove` を `{ active: Player; movesLeft: 1|2; cardInstance?: CardInstance; cardCost?: number } | null` に拡張 (turn/types.ts:37-40)。**OFF 経路 (current-rules.ts:93/121) は無改変** (optional フィールドを省略するだけ = typecheck/toEqual/既存テスト完全保持、OFF バイト等価)。
- 変換 `aiTurnStateToWorldState` は narrowing で fallback 補完: `doubleMove === null ? null : { active, movesLeft, cardInstance: dm.cardInstance ?? {instanceId:"",defId:"double_move"}, cardCost: dm.cardCost ?? CARD_DEFS["double_move"].cost }`。
- **実害なし**: S1b の ON 経路 (searchDoubleMoveSuperAction) は root の AiTurnState (doubleMove=**null**) から開始し、kernel `applyPlayCardAction` (world-kernel.ts:351-364) が `cardInstanceId` + `CARD_DEFS[defId].cost` から `KernelDoubleMove` を**自動構築**するため、AI 側は cardInstanceId を実値で渡すだけでよい。converter の非 null fallback 分岐は型整合のための保険 (S1b 経路では到達しない)。
- これにより S1 計画 §6 の「AiTurnState.doubleMove 型統合」は optional 拡張 + converter bridge の形で達成 (literal 同型化は不要・破壊的なので不採用)。

### フラグ配線 (S1b-1)
- `CreateSearchContextOptions` + `SearchContext` (search-context.ts:39-62) に `useKernelSearch?: boolean` / `spectatorMode?: boolean` 追加 (既定 false)。`createSearchContext` で wiring。
- `FindBestMoveOptions` (engine.ts:111-143) に `useKernelSearch?: boolean` 追加。engine.ts:193-197 の `createSearchContext` 呼出に `useKernelSearch: options.useKernelSearch ?? false` / `spectatorMode: options.spectator ?? false` を渡す。
- ctx は既に findBestMove→evaluateActionWithLookahead→searchDoubleMoveSuperAction へ伝播済 = 新規スレッド経路不要。

### 変換ヘルパ + 通常 action の ON 経路 (S1b-2)
- `aiTurnStateToWorldState(state: AiTurnState): WorldState` 純粋関数 (gameState/cardState/doubleMove 直渡し、型統合済なら自明)。
- `applyTurnActionForLookahead(state, action, player, opts): { gameState; cardState } | null` 薄 wrapper: WorldState 構築 → `applyTurnAction(world, action, {spectatorMode})` → `{gameState: world.gameState, cardState: world.cardState}` を返す (戻り値型は `applyActionForLookahead` と同一 = 後段 updateCardDigest/getOpponentResponseScore に無改変で流れる)。冒頭に variant ガード (防御的)。double_move (defId) が来たら null (delegate、呼出側で分岐済のため通常到達しない)。
- `evaluateActionWithLookahead` (search.ts:1132): `const applied = ctx?.useKernelSearch ? applyTurnActionForLookahead(...) : applyActionForLookahead(...)` に二分岐。それ以外 (excludeTadasute / updateCardDigest / getDrawValue / oppScore) は無改変。

### double_move の ON 経路 (S1b-3)
`searchDoubleMoveSuperAction` に `ctx?.useKernelSearch` 分岐を追加:
- ON: `world0 = aiTurnStateToWorldState(state)` → `applyTurnAction(world0, {kind:"playCard", cardInstanceId, defId:"double_move"})` で `worldDM` (doubleMove set, turnEnded=false)。各 1手目 `applyTurnAction(worldDM, {kind:"move", move:first})` → `worldF`。各 2手目 `applyTurnAction(worldF, {kind:"move", move:second})` → `worldS` (turnEnded=true を assert) → `evaluate(worldS.gameState, variant, innerDigest)`。innerDigest は `updateCardDigest(prevDigest, state.cardState, worldS.cardState)` (kernel が cost 正確消費 + lazy drawProgress 済)。
- **1手目 mate 分岐 (R3、OBS3-1)**: ON では kernel が 1手目で詰みを検出すると gameOver 分岐 (world-kernel.ts:258-274) で **turnEnded=true** を返す (OFF の CurrentRules.applyAction は game-end 評価せず turnEnded=false で続行)。よって ON 経路は `if (worldF.turnEnded) { worldF.world.gameState を直接 evaluate して候補化し、2手目ループを skip }` を実装する (OFF と非対称だが ON 是正 = 1手目で詰めば 2手目不要)。1手目 turnEnded=false のみ 2手目ループへ。
- **cardInstanceId 取得 (OBS3-2)**: `state.cardState.hand[player].find(c=>c.defId==="double_move")?.instanceId` を取得し、**未発見 (undefined) なら ON 経路を early-return** (`NEG_INF` を返す = 候補生成 getCardActions で本来除外済の異常系)。`?? ""` の空文字 fallback は kernel consumeNormalCard が instanceId 不一致で null 化し OFF と非対称な mana/digest を生むため**使わない**。
- OFF: 既存の `CurrentRules.applyAction` + 手動 wiring を**完全保持** (cardInstanceId は OFF では不問 = L846 の空文字のまま)。
- 1手目候補の上位 K 絞り (DOUBLE_MOVE_TOP_K)・excludeTadasute・bestScoreIgnoringTadasute フォールバックは ON/OFF 共通ロジックとして維持。
- **caller (F-2)**: `searchDoubleMoveSuperAction` は `evaluateActionWithLookahead` (ply=1、production root 経由) と `evaluateAction` (ply=0、**production 未到達** = engine は ply=1 固定 engine.ts:316/329) の両方から呼ばれるが、関数本体を二分岐するため両 caller を自動カバー。ply=0 経路は production 未到達のため OFF 専用据置で問題なし。

### engine.ts (S1b-2 と同時)
`FindBestMoveOptions.useKernelSearch` を受領し ctx へ渡すのみ。root ループ本体 (engine.ts:316-343) は無改変。

## 5. 段階 (各段で不変ゲート green、OFF バイト等価維持)
- **S1b-0** 型統合 (optional 化): `AiTurnState.doubleMove` に `cardInstance?`/`cardCost?` 追加。current-rules.ts は無改変。ゲート: lint/typecheck/test:ci green。**実破壊検出対象 = `double-move-search.test.ts` / `action-generator.test.ts`** (= AiTurnState.doubleMove を行使、optional 化で無改変通過するはず)。strategy-equivalence/card-digest は doubleMove 非依存のため「型変更が無影響」確認用 (実破壊検出には不十分、OFF-2)。
- **S1b-1** フラグ配線: SearchContext / FindBestMoveOptions / createSearchContext。誰も ON にしない = production 完全不変。ゲート: typecheck/test:ci green。
- **S1b-2** 通常 action ON 経路: `aiTurnStateToWorldState` + `applyTurnActionForLookahead` + evaluateActionWithLookahead 二分岐。ゲート: 新規 unit/特性化 test で OFF vs ON の applied 差分が §3 の通りであることを pin。**board 一致は条件分岐 (F-5)**: trap 未発火 move / 全 modifyBoard カードは board(駒配置) 一致、trap 発火 move は board も ON 是正。currentPlayer は ON 是正(flip) として期待 (gameState 完全一致を期待しない)。cardState は mana(move:+1)/drawProgress(lazy)/graveyard(card:+1)/noPromoteMarks(通常カード:削除) を ON 是正方向として分離 assert。
- **S1b-3** double_move ON 経路: searchDoubleMoveSuperAction 二分岐。ゲート: turnEnded 不変条件 (2手目 true / 1手目は非終局で false・終局で true=OBS3-1) を ON で assert、固定盤面で double_move 後の gameState 一致 + cardState (cost 正確消費 = hand→graveyard) を pin。
- **S1b-4** 特性化 property test: OFF vs ON の applied state を seeded harness で比較し、§3 の差分**のみ**に収まることを pin。board(駒配置)一致を must-match、currentPlayer/status/mana/drawProgress/graveyard/noPromoteMarks/lastTurnStartedAt/moveCount/history は**既知 divergence として分離 assert** (zobrist 一致のみで合格としない、OBS3-1/OBS2-F1)。fixture に **trap 保持下の move / no_promote マーク済自駒の pawn_return / auto-draw 境界(drawProgress=4) / 終局手** を必ず含める (F-5/OBS3-1)。ユーザー方針: property test + bench 両方。
- **S1b-5** bench 比較: perf-bench-card-usage / perf-bench を OFF/ON 両値で回す。**主指標 = root カード評価フェーズの elapsedMs (OFF/ON 並記)** — depthCompleted は findBestMove 非改変ゆえ構造的に不変なので「kernel 切替が深い探索に無影響」の sanity 確認に留める (F-4)。カード使用率 (usedCardAction) も OFF/ON で記録。**公平性 (F-6)**: bench は spectatorMode=true (manaCharge 非決定性回避) + beginner 以外 (BEGINNER_TADASUTE_ALLOW_RATE の Math.random 回避) で測定。逸脱は**記録に留める** (係数再校正は S3、ユーザー確認済)。drawProgress=4 近傍 fixture で auto-draw 境界差を可視化。ゲート: lint/typecheck/test:ci/build green。

## 6. DP-1〜7 整合 (ON 経路)
ON は `applyTurnAction` を通すため DP-1 (lazy drawProgress + auto-draw)・DP-2 (double_move 遅延消費 + flip 抑止)・DP-3 (trap は graveyard 不変/通常は hand→graveyard)・DP-5 (noPromoteMarks 集合)・DP-7 (check_break) が自動適用。OFF は旧近似のまま (DP-1 immediate+1、double_move graveyard なし等) で **S1d cutover まで production 既定**。

## 7. リスクと対策
- **R1 OFF 破壊**: 旧コード無改変 + フラグ既定 OFF + variant ガード + doubleMove optional 化で構造保証。double-move-search/action-generator/strategy-equivalence/card-digest test を不変ゲート。
- **R2 ON 棋力変化** (DP-1 lazy / manaCharge / cost 正確消費 / 終局 mate score): bench で elapsedMs / カード使用率を測定・記録 (再校正は S3)。
- **R3 double_move turnEnded + 終局整合 (OBS3-1)**: ON 経路で 2手目 true を assert。1手目/2手目が終局 (mate 等) の場合 kernel gameOver 分岐 (world-kernel.ts:258) で turnEnded=true・status セットになる (OFF の CurrentRules.applyAction は game-end 評価せず status=active 据置)。ON 専用に「1手目 turnEnded=true なら その局面を評価して 2手目 skip」分岐を実装。終局 score 差 (mate ±100000) は特性化 test で既知 divergence として分離。
- **R4 性能 (F-4)**: ON の super-action は makeMoveWithEffects (重) を TOP_K×second 回呼ぶため OFF より遅い可能性。bench の **elapsedMs** で測定 (depthCompleted は findBestMove 非改変ゆえ不変=指標にならない)。逸脱は記録 (S1b は配線が目的)。
- **R5 戻り値型差**: `applyTurnActionForLookahead` wrapper で `{gameState,cardState}` に正規化。events は AI 評価不要 (盤面結果のみ使用) のため捨象。
- **R6 double_move cardInstanceId 異常系 (OBS3-2)**: ON で hand に double_move 不在なら consumeNormalCard が null 化し非対称。getCardActions で除外済だが防御的に early-return (NEG_INF)。`?? ""` 空文字 fallback は使わない。
- **R7 currentPlayer tempo terminal 乖離 (OBS2-F1)**: draw/playCard を「相手が既に終局」局面で打つ稀少 sub-case で tempo ±30cp 乖離 (ON 是正)。特性化 test で currentPlayer を ON 是正として分離 assert (gameState 完全一致を期待しない)。

## 8. 確定済の設計判断 (ユーザー確認 2026-06-07)
- **検証**: property test + bench **両方** (厚い検証)。
- **bench 逸脱時**: 測定・記録に留める (係数再校正は S3 へ)。
- route.ts は S1b で無改変 (test/bench からのみ ON、production は S1d まで OFF 固定)。
- スコープは root カード/ドロー評価 2 関数に限定 (深い探索の kernel 化・TT 拡張は S4)。

## 9. S1b DoD
- [x] `AiTurnState.doubleMove` に `cardInstance?`/`cardCost?` 追加 (optional 化、OFF 経路 = current-rules.ts 無改変、評価値不変)
- [x] `useKernelSearch` フラグ配線 (FindBestMoveOptions → SearchContext、既定 OFF)
- [x] `aiTurnStateToWorldState` (converter + fallback) + `applyTurnActionForLookahead` 追加、evaluateActionWithLookahead 二分岐
- [x] searchDoubleMoveSuperAction 二分岐 (ON = `searchDoubleMoveSuperActionKernel` = applyTurnAction 連鎖、1手目 mate 分岐・cardInstanceId 防御)
- [x] OFF vs ON 特性化 property test 新設・green (`kernel-search-equivalence.test.ts` 11 件: board 駒配置 must-match、currentPlayer/status/mana/drawProgress/graveyard/noPromoteMarks は既知 divergence 分離 assert、trap 発火 move/no_promote pawn_return/auto-draw境界/終局 move/double_move 1手目 mate fixture 含む)
- [x] bench で OFF/ON の **elapsedMs** (主) ・カード使用率を測定・記録 (`perf-bench-kernel-search.test.ts`、spectatorMode + advanced/expert で公平化、depthCompleted は sanity)
- [x] lint / typecheck / test:ci / build green、既存 double-move-search/action-generator/strategy-equivalence/card-digest/world-kernel-equivalence/reducer/undo/effects 全 green (OFF 不変ゲート)
- [x] standard variant 非経由 (二重ガード = useKernelSearch && variant.id==="card-shogi" + applyTurnActionForLookahead 冒頭ガード)

## 10. マイルストーン1レビュー反映 (実装着手前、2026-06-07、AGENTS.md ルール8)
S1b 計画初版を 4観点 adversarial workflow (15 agents) でレビューし、**14 findings → high/medium 11 件全 confirmed (refuted/uncertain 0)** を反映:
- **[high OFF-1/OFF-3/F-3] doubleMove 型統合を optional 化に訂正** (§4): 必須 cardInstance/cardCost は current-rules.ts:93 + 既存テスト + toEqual を破壊。optional + converter fallback で OFF 無改変・テスト無改変・OFF バイト等価を両立。
- **[high OBS3-1] 終局 score 差を明記** (§3/§5 S1b-4/§7 R3): 着手後/2手目が終局なら ON は status セット → mate score (±100000)/draw(0)。特性化 test で既知 divergence 分離、zobrist 一致のみで合格としない。
- **[high→med OBS2-F1/F-1] §3 脚注「evaluate は currentPlayer 非依存」を訂正**: tempo 項 ±15cp が currentPlayer 依存。terminal sub-case (draw/playCard) で ±30cp 乖離 (ON 是正)。currentPlayer は ON 是正として分離 assert。
- **[med OFF-2] S1b-0 ゲートのテスト列挙を是正** (§5): 実破壊検出は double-move-search/action-generator test。strategy/card-digest は doubleMove 非依存。
- **[med OBS3-2/R6] double_move cardInstanceId 防御** (§4 S1b-3): `?? ""` を廃し未発見なら early-return。
- **[med F-2] caller 明記** (§4 S1b-3): evaluateAction(ply=0) は production 未到達で OFF 据置、関数本体二分岐で両 caller カバー。
- **[med F-4] bench 主指標を elapsedMs に変更** (§5 S1b-5/§7 R4): depthCompleted は構造的不変。
- **[med F-5] board 一致を条件分岐 + noPromoteMarks 差を §3 に追加** (§3/§5 S1b-2): trap 発火 move は board も ON 是正、modifyBoard 通常カードは removeNoPromoteMark で noPromoteMarks 差。fixture に trap 保持 move / no_promote pawn_return を必須化。
- **[low] must-not-match に lastTurnStartedAt/moveCount/status 明記、bench 公平性 (spectator+非 beginner)** (§3/§5 S1b-5)。
- 妥当と確認 (欠陥なし): 旧コード無改変の additive 戦略、フラグ ctx 相乗り配線、通常 action の board 一致 (simulateCardEffect == applyPawnReturn)、turnEnded 不変条件 assert、変換 wrapper の戻り値正規化。

## 11. マイルストーン2レビュー反映 (実装完了時、2026-06-07、AGENTS.md ルール8)
S1b 実装を 4観点 adversarial workflow (9 agents) でレビューし、**10 findings → high/medium 5 件全 confirmed (refuted/uncertain 0)** を反映。OFF は無改変で健全・ON は S1a 検証済で正しいことを確認した上で、**指摘は全て「特性化 test が計画 DoD 必須の fixture を欠き、誤コメントで『カバー済』と主張」というカバレッジ + 記述の問題に収束** (medium、OFF/ON 自体は健全)。下記を反映:
- **[med S1b-M2-001/OBS3-T1/S1b-O4-1] trap 発火 move の divergence fixture を追加**: 相手 check_break 保持下で先手が王手する move を OFF/ON 比較し、ON は王手駒除去 + trap clear + 相手持ち駒化 (DP-7)・OFF は無視、を既知 divergence として pin。誤コメント (「targeted T1 でカバー」= 実際は T1 は非発火) を訂正。
- **[med OBS3-T2] 終局手 fixture を追加**: ① 通常 move で詰む局面で ON=status checkmate + evaluate 100000・OFF=status active + material 評価を pin。② double_move 1手目で詰む局面 (捕獲 mate で TOP_K=10 上位保証) で ON super-action が turnEnded=true 分岐を行使し mate score を採用することを pin。
- **[med OBS3-T3/S1b-O4-2] double_move test の役割を明示**: cardState 消費 (hand→graveyard/mana-5/lazy drawProgress) の正しさは S1a (applyTurnAction ≡ reducer DP-2) が担保済とコメント参照。S1b test は配線 smoke (turnEnded 不変条件で throw せず有限スコア) + 1手目 mate 分岐 pin に役割限定。
- **[low] header コメントを実 assert と整合** (status mate score / trap 発火 move の board を divergence 次元として明記)、terminal tempo ±30cp (S1B-ON-2) は §3/R7 文書化済で稀少 sub-case のため test 化見送り。
- 結果テスト: 特性化 11 件 (8 + trap発火 move/終局 move/double_move mate 3) green。test:ci green。
