# Issue #245 派生: AI 二手指し (double_move) の段階演出

> ユーザー要望 (2026-07-05): 相手 CPU が二手指しを使うと現状「カード+1手目+2手目」が一瞬で適用され、
> 何を指したか分からない。**カード中央表示 (専用音) → 1手目 → 適切な間 → 2手目** に段階化したい。
> **効果音は `狙撃銃をチャッと構える.mp3` を二手指し専用音として新設** (現状は汎用 card_play/刀の素振り)。
> 着手前 rule-8 M1 レビュー対象。**人間プレイの二手指しは無改変** (AI のみ)。

## 1. 現状事実 (調査済 2026-07-05、単一調査 agent / 実コード照合)

| # | 事実 | 出典 |
|---|---|---|
| P1 | AI の二手指しは bridge が `[BEGIN_PLAY_CARD, CONFIRM_PLAY_CARD, MAKE_MOVE(1), MAKE_MOVE(2)]` を返し、`use-card-shogi-game.ts:220` の `acts.forEach(dispatch)` で **同期一括 dispatch** → 1 レンダーにバッチ → 一瞬 | `ai-action-bridge.ts:44-57` / `use-card-shogi-game.ts:217-227` |
| P2 | 演出は eventLog 差分監視のキュー駆動オーケストレータ (deriveAnimationSteps → animationQueue → activateStep)。**moveEvent はステップ化されない** (Framer layout 任せ) ため、2 手が同一バッチだと同時ワープ | `card-shogi-game.tsx:1011-1093,780-1005` / `animation-steps.ts:69-70` |
| P3 | カード中央表示 = `CardPlayFlight` (`setPlayFlight` state)。cardUse ステップの `activateStep` で発火。AI 使用時も同経路 (`card-shogi-game.tsx:860-864`)。表示尺 `PLAY_TOTAL_MS≈1240ms` | `card-shogi-game.tsx:247-251,860-864,2365-2371` / `animation-constants.ts` |
| P4 | reducer は double_move の cardPlayEvent (と isPlayingCard=true) を **2手目完了時** (`finalizeDoubleMoveCardConsumption`) に push → **現状カード表示は「2手目の後」** | `reducer.ts:508-541,687-711` |
| P5 | カード使用音はカード種別非依存の共通音: `card_play`(piece-move) + `card_use_animation`(刀の素振りシュピン)。**double_move 専用音は未定義**。`狙撃銃をチャッと構える.mp3` はゲーム未使用 (dev 音チューナー候補のみ) | `card-shogi-game.tsx:792,821,829,862` / `manifest.ts` |
| P6 | AI effect の deps に currentPlayer/isPlayingCard/isDrawing/isCheckBreakAnimating。**段階 dispatch すると中間 state で AI effect が再評価される恐れ** (現状は同期一括ゆえ中間 state 不在で問題化せず) | `use-card-shogi-game.ts:131-248` |
| P7 | DB 保存は doubleMove!==null の間 skip / captureStep も保留。段階化で非 null 期間が延びるだけで整合維持。ただし途中終局・unmount 時のタイマー残 MAKE_MOVE の cleanup 要 | `use-card-shogi-game.ts:285,328,375-388` |

## 2. 設計 (AI 二手指しのみ、人間不変)

### 2.1 専用音 `double_move`
- `manifest.ts` の `SFX_FILES` に `double_move: "/sounds/音源/トラップセット/狙撃銃をチャッと構える.mp3"` 追加。
- `sound-overrides.ts` の `SfxEventKey` union / `SFX_EVENT_KEYS` / `SFX_EVENT_LABELS` の **3 箇所**に `double_move` 追加 (型網羅)。
- カード中央表示時、使ったカードが double_move (`defId==="double_move"`) なら `card_use_animation` の代わりに `double_move` 音を鳴らす。

### 2.2 段階実行 (時間差 dispatch)
`use-card-shogi-game.ts` の AI 応手で、`result.response.doubleMove` があるとき `acts.forEach` をやめ、**タイマー駆動の段階シーケンス**にする:
1. **カード中央表示 + 専用音** (1手目の前)。
2. `BEGIN_PLAY_CARD` + `CONFIRM_PLAY_CARD` + `MAKE_MOVE(move1)` を dispatch (1手目が Framer で動く)。
3. **間** (`DOUBLE_MOVE_STEP_GAP_MS ≈ 800ms`)。
4. `MAKE_MOVE(move2)` を dispatch (2手目が動く)。
- **カード表示の先出し方式** (M1 論点、下記いずれか — M1 で確定):
  - **案 X (component 反応)**: 段階シーケンスは hook が駆動しつつ、component が「AI の double_move 開始 (`state.doubleMove!==null && doubleMove.active===aiColor && movesLeft===2`)」を useEffect で検知し `setPlayFlight`+専用音。reducer の 2手目後 cardPlayEvent 由来のカード表示は **AI double_move では skip** (二重表示防止、ref フラグ)。
  - **案 Y (hook callback)**: hook options に `onAiDoubleMovePreview?(card)` を追加し component が setPlayFlight+音。同上 skip。
  - 案 X 推奨 (state 反応で疎結合、callback 追加不要)。
- **間の実装**: `setTimeout` を ref 管理し、unmount/終局/待った時に必ず clear (P7)。段階中は `isAiThinking=true` を維持し、完了時にまとめて false (P6 の AI 再発火防止)。

### 2.3 変更しないもの
- 人間の二手指し (DoubleMoveNotice バナー + 戻す/キャンセル) は無改変。
- reducer の double_move 消費タイミング (2手目完了) は無改変 (キャンセル可能性維持)。表示だけ前出し。
- 通常カード・トラップ・ドローの演出は無改変。

## 3. リスク (#109 / #222 演出バグ領域)

- **AI 再発火 (P6)**: 段階中 (1手目後 movesLeft=1) は currentPlayer が AI 側のまま。`isAiThinking=true` 維持 + 既存ガードで再発火を防ぐ。中間 state で AI effect が走らないことをテストで pin。
- **タイマー残 (P7)**: unmount/終局/待った時に段階タイマーを clear。stale ガード (game 差替え・abort)。
- **二重カード表示**: 先出し + reducer 2手目後 cardPlayEvent の二重を skip フラグで防ぐ。skip 漏れ/過剰 skip の両方を避ける。
- **#222 演出順序**: カード使用 → 王手 → トラップ の順序規約。二手指しで 2手目が王手/トラップ発火する複合ケースで check ステップ委譲が壊れないか (check_break ゴーストカバー `prepareCheckBreakCover` との干渉)。
- **保険タイマー**: 新規演出待ちに `CARD_USE_STEP_FALLBACK_MS` 相当の保険を張り手番永久ロック (#217 系) を防ぐ。
- **AI が両者の観戦モード**: 観戦で両 CPU が二手指しを使う場合も段階演出が正しく直列化されるか。

## 4. テスト計画
- bridge/hook: AI double_move で段階 dispatch が正しい順序・タイミングで走る (タイマー mock)。move2 が move1 の後に一定間隔で dispatch される。
- 中間 state で AI effect が再発火しない (isAiThinking 維持)。
- unmount/終局でタイマー clear (残 dispatch なし)。
- double_move 音が manifest/型に整合 (SfxEventKey 網羅)。
- 既存演出テスト (もしあれば) 緑維持。full gate。
- 手動確認: Preview で AI 二手指し → カード表示 (専用音) → 1手目 → 間 → 2手目 が見える。二重カード表示なし。

## 5. M1 論点
1. カード先出しの方式 (案 X component 反応 vs 案 Y callback)。二重表示 skip の実装 (ref フラグの置き場)。
2. 段階シーケンスを hook で持つか、演出オーケストレータ (component) に寄せるか。isAiThinking 維持と AI 再発火ガードの具体。
3. 間の秒数 (DOUBLE_MOVE_STEP_GAP_MS) と カード表示尺の関係。観戦モードの直列化。
4. double_move 音を「中央表示時のみ」か「card_play も置換」か。

## 6. M1 停止 → 段階実装 (2026-07-05)

**★M1 レビュー agent がハング (1h15m 出力なし) → 待たず実装、M2 で検証する方針にユーザー了承。**
演出は commit 密結合領域ゆえ、リスクを抑え **v1 (核心) を先行実装** し、card-first (v2) は分離:

### v1 (実装済): 1手目→間→2手目 の分離 + 確定音 + AI バナー抑制
- `use-card-shogi-game.ts`: AI の二手指し (doubleMove.move2 あり = acts 4 個) を **段階 dispatch** — `[BEGIN,CONFIRM,MAKE_MOVE(1)]` を即 dispatch → `DOUBLE_MOVE_STEP_GAP_MS=800ms` の間 → `MAKE_MOVE(2)`。段階中 `isAiThinking=true` 維持で AI effect 再発火防止。`doubleMoveTimerRef` を unmount で clear。1手目詰み (move2=null=acts 3 個)・通常カードは従来一括。
- `card-shogi-game.tsx`: activateStep の AI cardUse で **`defId==="double_move"` なら `card_use_confirm`** (サブマシンガンのボルトリリース=「使用する」ボタン音) を鳴らす (他カードは card_use_animation)。
- `card-shogi-game.tsx`: **DoubleMoveNotice を `doubleMove.active === playerColor` でガード** (段階化で AI 手番中に doubleMove 非 null になるが、人間向け「戻す/キャンセル」を AI 手番に出さない = 新規バグ防止)。
- ★結果: `move1 → 間 → move2 → カード中央表示(確定音)`。**カード表示は「2手目の後」** (reducer が cardPlayEvent を 2手目完了時に push する現設計のまま)。ユーザー要望の「カード先出し」は v2。
- ★検証: displayInCheck(過渡王手抑制)・deriveAnimationSteps(showCheck) は player 非依存で段階化に整合。full gate 緑 (test:ci 798)。**hook のタイマー logic は React テスト不安定ゆえ自動テスト無 → M2 + 実機で検証 (テスト gap)**。

### v2 (未実装・要 M1 相当の設計): カード先出し
- カード中央表示 (`CardPlayFlight`) は `onComplete` が finalizePlayCard(COMMIT_PLAY_CARD) を呼ぶ commit 密結合ゆえ、開始時に流用すると**早期 commit** の恐れ。→ **表示専用バナー** (commit 非連動の新規 state) を新設し、AI double_move 開始時に表示+確定音、2手目後の cardPlayEvent 由来カード表示を **skip** (step completion を fallback or 明示 completeStep)。skip 漏れ/過剰・step 未完了 (手番ロック #217) のリスクがあり慎重な設計要。ユーザー判断で着手。
