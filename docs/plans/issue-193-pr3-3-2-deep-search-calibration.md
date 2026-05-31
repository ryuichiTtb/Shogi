# Issue #193 PR3-3 派生 (PR3-3-2): 深さ N まで calibration 波及 実装計画

## 0. 文書管理

| 項目 | 内容 |
|---|---|
| 親 Issue | [#193](https://github.com/ryuichiTtb/Shogi/issues/193) AI 棋力強化 (epic, OPEN 維持) |
| 親計画 md | `docs/plans/issue-193.md` (L572「TurnAction を深さ N まで」が本 PR の元設計) |
| 直前 PR 計画 | `docs/plans/issue-193-pr3-3-deep-card-search.md` (§1.3 で本 PR を deferred と明記) |
| 直前 PR レビュー | `docs/reviews/issue-193-pr3-1-pr3-2-review.md` (F-1〜F-10、本 PR も同等の慎重さで) |
| 起点 | `origin/main` = `1185067` (PR #234 マージ後) |
| ブランチ | `feature/#193-pr3-3-2` |
| worktree | `.claude/worktrees/issue-193-pr3-3-2` |
| 本 md ステータス | **計画起草 + adversarial verify 反映済 (実装着手前、ユーザーレビュー待ち)** |

> #193 自動クローズ注意: コミット/PR で `fix: #193` 形式を使わない(GitHub クローズキーワード)。`feat:` は安全。PR 本文は `Refs #193`。

---

## 1. 背景・課題

### 1.1 PR3-3 完了後も残る構造的非対称

PR3-3 (#234) で **root の 1-ply lookahead** (`evaluateActionWithLookahead`) + `updateCardDigest` per-action wiring (F-1 解消) を実装し、root のアクション比較は以下になった:

```
engine.ts root (card-shogi):
  move = findBestMove(...)                    ← 深さ N=6 反復深化 negamax。MOVE-ONLY
  allActions = getLegalActions(isRoot=true)   ← move + draw + playCard
  各 action を evaluateActionWithLookahead(lookaheadPly=1) で評価:
    自 action 適用 → 相手 1-ply 最善応答スキャン (getOpponentResponseScore) → eval
  最高スコアの action を採用
```

**比較時点では move も card も 1-ply lookahead で揃っている**。しかし非対称が残る:

| 候補 | 探索の深さ | 帰結 |
|---|---|---|
| `move` | **深さ N=6 で事前選抜**された最善手を、比較時に 1-ply 再評価 | 6 手先まで読んで「戦術的に最も得する手」が選ばれている。1-ply 再評価でも材料得が残る |
| `playCard` / `draw` | **常に 1-ply のみ**。深い follow-up は読まれない | 「カードを使って 2〜3 手かけて組み立てる」価値が捕捉されない。1-ply の calibration tempo だけで move と競争 |

→ 実プレイ midgame で move 側が戦術的駒得を持つと、deep search で裏打ちされた move の 1-ply 値が card の calibration 値 (+30〜60cp) を上回り続ける。PR3-3 §10.4 実測でも **advanced/expert は calib 0/3**(beginner のみ 100%、深さ探索の影響が小さいため)。

**根本原因**: カード行動が「自分の続く手番(2手目以降)で開花する価値」を持つのに、探索木がそれを **自分側でしか深掘りしていない move にしか与えていない**。カード行動も同じ深さで読めば公平に競争できる。

### 1.2 本 PR の目標

**探索木の「自分(探索プレイヤー)の手番」で、深さ budget K まで TurnAction(move + draw + playCard)を候補に含めて深掘りする。** これにより:

- カード使用後の自分の続く手番までの価値が探索で捕捉される
- move とカード行動が **同じ自分側深さ**で比較される
- 実プレイ midgame の advanced/expert でカード使用率が 0 にならない(構造的解消)

親計画 md L572「TurnAction を root だけでなく深さ N までカード使用候補に組み込む」の直接実装であり、PR3-3 §1.3 が「性能影響大・depthCompleted 退化リスク高」として明示的に deferred した項目。**PR3 系で最もハイリスク・高リターン。**

### 1.3 ユーザーに確認したい上位の設計判断 (§9 詳細)

adversarial verify の結果、着手前に **本当にこの規模の探索改修が最適レバーか**を確認したい(§9 P-A〜P-C):
- **より安価な代替**: `evaluateActionWithLookahead` の `lookaheadPly` を 1→2/3 に増やすだけで改善しないか。
- **PR3-4 先行**: 相手期待値モデル(隠れ情報)を先にやる方が棋力寄与が大きくないか。
- **MVP の深さ**: K=1(自分の次の手番 1 段)で実プレイ改善が観測できるか。

本計画は「(C) 深さ N 波及」を実装する前提で MVP を最小リスク化したものだが、上記は**実装着手前にユーザー判断を仰ぐ**。

---

## 2. スコープ

### 2.1 含む

- **自分ノードの card-aware 深掘り探索** (新規 `evaluateActionDeep`): 探索プレイヤーの手番で深さ budget K(初期 1)まで playCard/draw/move を候補生成し、`applyActionForLookahead` + `updateCardDigest` で遷移して再帰評価。
- **相手応答は既存 1-ply scan を維持**(`getOpponentResponseScore` 拡張、**negamax/TT 非経由**)。相手のカード使用はモデル化しない(隠れ情報 = PR3-4)。
- **bench で depthCompleted ±10% 退化なしを実測**、K 値を段階校正(before-baseline を先取得)。
- card-usage discriminator bench を「深掘り下でも calibration が card を選ばせる」検証に拡張。

### 2.2 含まない (将来 PR)

- **相手応答の deep negamax 化 / 相手のカード使用モデル化**(隠れ情報・explosion・TT 分離が必要)→ PR3-4 (相手期待値モデル) / 性能最適化 PR。
- **card-aware ノードへの TT 導入**(cardDigest hash キー)→ 上記 deep 相手読みとセットで別 PR。
- **double_move の深掘り再帰統合** → 将来(MVP は root super-action 経路のみ)。
- **マルチ PV** / **NNUE** → 親計画 md / PR6。

### 2.3 振る舞いキープ要件

- **standard variant**: `variant.id !== "card-shogi"` で card-aware 経路に一切入らない。既存 negamax/findBestMove/TT と byte-level 同一。
- **既存 move-only negamax / quiescence / TT / killer / history / null-move / LMR**: 一切変更しない(`evaluateActionDeep` は新規関数で、core negamax を呼ぶのは初手 move 選定の findBestMove のみ、従来通り)。
- **strategy-baseline.json**: card-shogi の探索結果は意図的に変わる。再生成は deferred(~50 分、CI 外、ユーザー/オフライン)。standard 部分は不変を維持。

---

## 3. 設計

### 3.0 設計判断サマリ (adversarial verify 反映 — 詳細 §10)

計画初版に Workflow adversarial verify(5観点→敵対的裏取り、62 確定指摘、うち critical 5)を実施。**MVP 設計を以下に確定**:

| 判断 | 内容 | 解消した指摘 |
|---|---|---|
| 相手応答 = **既存 1-ply scan 維持**(negamax 非経由) | deep 相手読みは採らない | T1 相手最善局面取得問題が消失 / T2 深さ未決が解消 / **T3 TT に触れず誤キャッシュ hazard 原理的に発生せず** / 概算と整合 |
| card 深掘り = 自分 TurnAction を **budget K 再帰** | getDrawValue は **action 評価ごと 1 回**(再帰に伝播させない) | T4 二重加算解消 |
| **double_move は MVP 再帰から除外** | root super-action 経路維持 | T5 doubleMove スレッド回避 |
| 符号 = **全レベル player 視点** | 反転は scan 内 1 箇所のみ | T8 符号混線解消 |
| candidate 生成 = **新規 `getCardAwareActions`** | `getLegalActions` の isRoot ゲートは触らない | T6 ゲート波及解消 |
| K = 定数 `DEEP_CARD_SEARCH_BUDGET`(初期 1) + **before-baseline 先取得** | C-2 で K=0 の depthCompleted を記録 | T9/T12 |

### 3.1 アルゴリズム (確定版)

新規 `evaluateActionDeep` は既存 `evaluateActionWithLookahead` の **budget 再帰版**。相手応答は `getOpponentResponseScore` を `{score, oppState}` 返却に拡張した `scanOpponentResponse`(`evaluate` 直呼び、**TT 非経由**)に統一する。**戻り値は全レベル player 視点(player 有利が +)**:

```
evaluateActionDeep(state, action, player, variant, ctx, excludeTadasute, budget):
  if action==playCard && defId=="double_move":
    return searchDoubleMoveSuperAction(...)               // MVP: 深掘り再帰に含めず委譲 (T5)
  applied = applyActionForLookahead(state, action, player)   // {gameState, cardState} | null
  if !applied: return -Inf
  if excludeTadasute && 通常カードのタダ捨て検知: return -Inf  // 既存 evaluateActionWithLookahead 同型
  newDigest = card-shogi ? updateCardDigest(prevDigest, state.cardState, applied.cardState) : undefined

  // 相手 1-ply scan: 最善応答スコア(player 視点)とその局面を返す。evaluate 直呼び・TT 非経由
  {oppScore, oppState} = scanOpponentResponse(applied.gameState, player, variant, newDigest)

  // draw encouragement は「この action が draw のときだけ」1 回。再帰結果 best には子の bonus が
  // 既に含まれるため親で再加算しない (T4)
  selfBonus = (action==draw) ? getDrawValue(state.gameState, player, state.cardState) : 0

  if budget <= 0 || variant.id !== "card-shogi" || oppState==null:
    return oppScore + selfBonus

  // budget 残存 → 相手 1 手後 (= 自分の次の手番) で再び自分の TurnAction を深掘り。
  // 不変条件: 現行ルール「1 action = 1 turn」ゆえ相手 1 手後 oppState.currentPlayer===player。
  //          assert で明示し、崩れたら深掘りせず oppScore を返す安全弁 (T2/T7)。
  nextState = { gameState: oppState, cardState: applied.cardState, doubleMove: null, isRoot: false }
  best = oppScore
  for a in getCardAwareActions(nextState, player, variant):     // move + draw + playCard (double_move 除外)
    best = max(best, evaluateActionDeep(nextState, a, player, variant, ctx, excludeTadasute, budget-1))
  return best + selfBonus
```

**ポイント:**
- **getDrawValue は再帰の外で 1 回だけ**(`selfBonus`)。子の draw bonus は `best` に内包されるため親で再加算しない(T4 解消)。
- **`scanOpponentResponse`** = 既存 `getOpponentResponseScore`(search.ts L1091)を `{score, oppState}` 返却に拡張(argmin を達成した oppMove で進めた局面を保持)。**negamax/TT を一切呼ばない**ため新規 correctness 面は局所(T1/T3 解消)。
- deep move-only negamax(`findBestMove`)は **初手 move 候補の選定にのみ**使われ続ける(従来通り、不変)。深掘りは「自分の手を K 段、各段の相手応答は 1-ply」。
- `budget=0` で `evaluateActionDeep` は既存 `evaluateActionWithLookahead(lookaheadPly=1)` と**同一スコア**を返す(後方互換、§5.1 で test)。

### 3.2 candidate 生成 — 明示ヘルパ (isRoot 流用しない、T6)

- 深掘り自分ノードの candidate は **新規 `getCardAwareActions(state, player, variant)`**(move 全列挙 + `canDraw` なら draw + `getCardActions` の playCard、**double_move 除外**)。
- **`getLegalActions` の `isRoot` ゲートは変更しない**。root の既存呼出と深掘りの新規呼出を別関数にすることで、production の move-only 探索(`findBestMove → getSearchLegalMoves`、getLegalActions 非経由)に一切波及しないことをコード構造で保証(実コード確認済: `getSearchLegalMoves` は `getLegalActions` を呼ばない)。

### 3.3 TT — MVP では非関与 (誤キャッシュ hazard 消失、T3)

- `scanOpponentResponse` / 深掘り再帰は `evaluate()` 直呼びで **TT を probe/store しない**。→ **MVP では「同一盤面・異 cardDigest」を TT に書く経路が存在せず、誤キャッシュは原理的に起きない**。
- TT を使うのは従来通り `findBestMove`(初手 move 選定、card-shogi/standard 共通)のみ。ここは cardDigest=root scalar 固定(PR1d 以来不変)で従来挙動と同一。
- **将来 deep 相手読みを入れる場合のみ** TT 分離が必要 = その PR で対応。汚染シナリオと対策コスト試算は §10 P-1 に記録(`new TranspositionTable()` = 4M 配列で生成コスト/メモリ大、枝ごと生成は非現実的 → cardDigest を 32-bit hash 化して `hashLo ^ digestHash` キーが本命)。

### 3.4 符号規約 (sente 絶対 ↔ player 視点、T8)

`evaluate` は sente 絶対(sente 有利が +)。符号反転は `scanOpponentResponse` 内の `ourScore = player==="sente" ? raw : -raw` の **1 箇所のみ**。`evaluateActionDeep` は全レベルで player 視点を返す(既存 `getOpponentResponseScore`/`evaluateActionWithLookahead` と同規約)。再帰中 player は探索プレイヤーで固定。

### 3.5 double_move (MVP 除外、T5)

深掘り再帰の candidate から除外し、root の `double_move` は既存 `searchDoubleMoveSuperAction`(C-11/C-12 で cardState/drawProgress 整合済)で評価。`applyActionForLookahead` が doubleMove を返さない(L1000)現状と整合。深掘り内統合は将来(§8)。

### 3.6 depth budget K / 性能 / フォールバック

- **コスト試算 (1-ply opponent 前提、T2 整合)**: K=1 で root candidate(move 1 + card ~5-15 + draw)各に相手 1-ply scan(~80-100 evaluate)。budget 残で各 card-aware action の次段 candidate(~80-100)× 相手 1-ply scan。概算 root あたり追加 ≈ 候補数² オーダー ≈ 数千〜1.x 万 evaluate/root。`findBestMove`(深さ 6 の数十万 node)に対し相対的に小さい見込みだが**実測必須**。
- **K 定数集約**: `DEEP_CARD_SEARCH_BUDGET`(初期 1)を `heuristics.ts` に定義(マジックナンバー禁止、T12)。
- **before-baseline ゲート (T9)**: C-2 で K=0(現状経路)の `depthCompleted` を fixture で記録 → C-3 以降の比較基準に(PR3-3 で before 値未取得だった反省)。
- **deadline 打ち切り (T10)**: `ctx.deadlineAt`/`shouldStop` 超過時は深掘りを打ち切り、**既に findBestMove が選定済の move にフォールバック**(部分結果でなく確定済 move を使うため安全)。
- **±10% が K=1 で未達なら**(T9): K 据え置き / 深掘り candidate を上位 M 手(`scoreMoveForOrdering`)に絞る / playCard のみ深掘り(move は深掘りしない)を C-5 で検討。

---

## 4. リスクと対策

| # | リスク | 対策 | 検証 |
|---|---|---|---|
| R-1 | TT 誤キャッシュ | **MVP は TT 非経由で hazard 消失**(§3.3)。deep 相手読み導入時に再評価 | 同一 board・異 cardDigest で eval が混ざらない unit test(回帰防止) |
| R-2 | explosion で depthCompleted 退化 | 1-ply opponent 維持 + K 段階 + deadline 打ち切り + 自分ノード限定分岐 | perf-bench.test.ts ±10%(before-baseline 比、RUN_PERF_BENCH) |
| R-3 | wiring 漏れ(PR3-3 で 6 high 検出) | Workflow 4 並列 adversarial verify を計画前(済)・push 前に必須 | adversarial verify |
| R-4 | standard variant 影響 | `evaluateActionDeep` は card-shogi 限定 entry。core negamax/TT 不変 | standard 探索結果 byte-level 不変 test |
| R-5 | candidate ゲートの波及 | `getCardAwareActions` 新設、`getLegalActions`/`getSearchLegalMoves` 不変 | move-only fixture 不変確認 |
| R-6 | drawProgress/mana/hand 整合崩れ | `applyActionForLookahead`(C-12 production 等価)再利用 | digest 等価性 + 遷移 unit test |
| R-7 | getDrawValue 二重加算 | selfBonus を再帰外 1 回(§3.1) | draw→相手→自 draw で二重計上しない test |
| R-8 | 再帰停止 / 自分ノード不変条件崩れ | 「1 action=1 turn」を assert、崩れたら深掘りせず返す | 再帰深さ上限 + 停止 test |

---

## 5. 検証計画

### 5.1 ユニットテスト
- `evaluateActionDeep`: **budget=0 で既存 `evaluateActionWithLookahead(1ply)` と一致**(後方互換)。budget>0 で深掘りが効くケース。再帰停止(budget 消費・deadline)。
- **getDrawValue 1 回加算**(R-7): draw→相手応答→自 draw のシナリオで二重計上しないこと。
- **符号規約**(R-3/T8): sente/gote 対称で同条件なら符号整合。
- **TT 非関与**(R-1): card-aware 経路で ctx.tt の store 回数が増えないこと(回帰防止)。
- **standard variant**(R-4): card-aware 経路に入らず探索結果不変。
- `scanOpponentResponse`: `getOpponentResponseScore` と score 一致 + oppState が argmin の局面。

### 5.2 既存 bench 強化 (calibration discriminator)
- `perf-bench-card-usage.test.ts` に「深掘り下で calibration が card を選ばせる」シナリオ追加。beginner で厳密 assert、advanced/expert は深掘り後の使用率を log。**閾値 assert は K 確定後に数値固定**(PR3-3 の flaky 反省から、非決定性のある難易度では log 主体)。

### 5.3 depthCompleted 退化なし (before-baseline 必須)
- **C-2 で K=0 の depthCompleted を fixture で記録**。C-3 以降は同 fixture で ±10% 以内を実測(`RUN_PERF_BENCH=true`)。超過なら §3.6 の絞り込み。

### 5.4 strategy-baseline
- card-shogi は意図的変更を許容、再生成は deferred(ユーザー/オフライン)。standard 部分は `strategy-equivalence.test.ts` で不変維持。

### 5.5 必須チェック (AGENTS.md ルール6)
各段階で `npm run lint` → `typecheck` → `test:ci` → `build`。bench は別途 `RUN_PERF_BENCH=true`。

---

## 6. DoD

- [ ] 実プレイ相当 midgame fixture で advanced/expert のカード使用率が 0 でない(深掘りで改善を bench 観測。**数値目標は K 確定後に設定**)
- [ ] `depthCompleted` 退化 ±10% 以内(before-baseline 比、K 確定値で実測)
- [ ] standard variant byte-level 不変
- [ ] getDrawValue 二重加算なし / 符号整合 / TT 非関与(unit test green)
- [ ] 全 test:ci green + build green
- [ ] Workflow adversarial verify(実装後、5観点)で検出 high/critical を全件解消(med は対応 or 明示的に defer 記録)
- [ ] デッドコード/マジックナンバーなし(K は定数集約)

---

## 7. 実装手順 (commit 単位)

| commit | 内容 | 検証 |
|---|---|---|
| **C-1** | 本計画 md 起草 + Workflow adversarial verify + 指摘反映 + push + #193 レビュー依頼(= 本ステップ、**ユーザーレビューで停止**) | docs |
| **C-2** | 土台: `scanOpponentResponse`(getOpponentResponseScore 拡張) + `getCardAwareActions` + `DEEP_CARD_SEARCH_BUDGET` 定数 + **K=0 before-baseline depthCompleted 記録**。`evaluateActionDeep` の budget=0 後方互換実装 | unit + typecheck + bench(K=0) |
| **C-3** | card-aware 深掘り本体(K=1)。engine.ts root を `evaluateActionDeep` 呼出に切替。**TT 非関与・符号・getDrawValue 1回・再帰停止**を実装 + unit test(R-1/R-4/R-7/R-8) | unit + bench(K=1) ±10% |
| **C-4** | discriminator bench 拡張 + calibration regression unit + standard 不変 fixture | test:ci |
| **C-5** | K=1→2(→3)校正 / 未達なら絞り込み。double_move 深掘り扱い最終確定(MVP 除外を明文化) | perf-bench 実測 |
| **C-6+** | Workflow adversarial verify(実装後、5観点)→ 検出 high/critical 解消 | adversarial + 全 build |
| **C-last** | 計画 md 完了サマリ + memory roadmap 更新 | docs |

> 注: TT 対策を独立 commit にしない(MVP は TT 非関与のため)。これにより「本体 C-3 と TT 対策 C-4 の順序で誤キャッシュが出る」初版の段階分割リスク(指摘 D-3)も解消。

---

## 8. 後続 PR への引継ぎ

- **PR3-4 (相手期待値モデル)**: 本 PR の相手応答は決定的 1-ply scan。相手手札不完全情報の期待値化 + **deep 相手読み**(その際に TT 分離 = cardDigest hash キーが必要)。
- **double_move の深掘り再帰統合**: `applyActionForLookahead` の doubleMove 返却対応 + 再帰内 super-action 展開。
- **K のさらなる拡張**: MVP で K が小さく留まる場合の発展。

---

## 9. 未決事項・ユーザーレビュー論点

**着手前にユーザー判断を仰ぐ上位論点(§1.3):**
- **P-A (代替レバー)**: `evaluateActionWithLookahead` の `lookaheadPly` を 1→2/3 に増やすだけで実プレイ改善しないか先に試すべきか(本 PR より遥かに安価・低リスク)。
- **P-B (PR3-4 先行)**: 相手期待値モデルを先にやる方が棋力寄与が大きくないか。本 PR の「自分側だけ深掘り(相手 1-ply)」は相手の妙手を見落とす非対称を残す。
- **P-C (MVP の深さ)**: K=1 で実プレイ改善が観測できる見込みか。観測できないなら本 PR の費用対効果が薄い。

**実装内で確定する論点(adversarial verify で要再検証):**
- **P-1 (TT)**: MVP は TT 非関与で hazard 消失を確認したが、将来 deep 相手読み時の TT 分離方式(cardDigest hash キー)の設計メモを §3.3 / §10 に残す。
- **P-2 (探索時間)**: card 深掘りで思考時間が伸びる場合、難易度別 timeLimit との整合(deadline 打ち切りで吸収できるか)。
- **P-3 (絞り込み)**: ±10% 未達時、深掘り candidate を上位 M 手に絞る方式の M 値。

---

## 10. レビュー反映 (計画初版 → adversarial verify、62 確定指摘)

計画初版に Workflow 5観点 adversarial verify を実施(70 agents、64 raw → 62 確定、critical 5 / high 38 / medium 14)。重複統合した核心テーマと対応:

| テーマ | 重大度 | 指摘 | 本計画での対応 |
|---|---|---|---|
| T1 相手最善局面の取得が未定義 | critical | negamax は score のみ返す(A-1, correctness-oppstate) | **相手 1-ply scan 維持**で局面を自前保持(§3.0/§3.1)→ 問題消失 |
| T2 相手応答深さ未決 ↔ explosion 概算矛盾 | critical | 本文「deep negamax」vs 概算「1-ply」(performance-B1a, P2) | **1-ply scan に確定**(§3.0/§3.6)→ 概算と整合 |
| T3 TT 誤キャッシュ対策不足 | critical | clean TT コスト/汚染シナリオ未記述(TT-1, correctness-1) | **MVP は TT 非経由 → hazard 原理消失**(§3.3)。将来策を §10 に記録 |
| T4 getDrawValue 二重加算 | critical | 再帰で複数回加算(getdrawvalue-duplication-9) | **selfBonus を再帰外 1 回**(§3.1)+ test(§5.1) |
| T5 doubleMove スレッド欠落 | high | applyActionForLookahead が doubleMove 捨てる(A-3) | **MVP 再帰から除外**(§3.5) |
| T6 ゲート解放の enforce/波及 | high | isRoot 流用の強制方法不明(CORRECTNESS-1, D-8) | **新規 getCardAwareActions**、getLegalActions 不変(§3.2) |
| T7 自分ノード/budget 制御が暗黙 | medium | 「1 action=1 turn」依存(A-2) | assert + 安全弁明示(§3.1/R-8) |
| T8 符号規約混線 | high | sente 絶対↔player 視点(sign-convention-11) | **全レベル player 視点**、反転 1 箇所(§3.4) |
| T9 ±10% 実現性 / before 値 | high | K=1 でも厳しい・before 未取得(performance-B2, scope-staging-2) | **before-baseline を C-2 ゲート化** + 未達時絞り込み(§3.6/§5.3) |
| T10 打ち切りフォールバック未定義 | high | 部分結果の定義なし(performance-B3) | **findBestMove の確定 move にフォールバック**(§3.6) |
| T11 設計代替/PR3-4 先行 | high | より安価なレバー検討(design-alt-1/2/3) | **§1.3/§9 P-A〜P-C でユーザー判断を仰ぐ** |
| T12 K 定数集約 / DoD 具体 / 数値目標 | medium | マジックナンバー・成功指標(governance-defs-8, governance-1) | K 定数化、DoD に数値目標を K 確定後設定(§6) |

> 棄却した指摘 2 件 + medium/low の詳細は workflow 出力に記録。最重要の転換: **「相手応答を deep にしない」一手で T1/T2/T3 を同時解消**し、本 PR の correctness リスクを大幅に下げた。
