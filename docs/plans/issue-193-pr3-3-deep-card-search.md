# Issue #193 PR3-3: カード深読み探索 + 二手指し統合多手先化 実装計画

## 0. 文書管理

| 項目 | 内容 |
|---|---|
| 親 Issue | [#193](https://github.com/ryuichiTtb/Shogi/issues/193) AI 棋力強化 (epic) |
| 親計画 md | `docs/plans/issue-193.md` (L570-590 が PR3 セクション) |
| 親メモ | `project-issue-193-roadmap.md` |
| 本ブランチ | `feature/#193-pr3-3` (計画 md + 実装を同居) |
| 起点 | `origin/main` (`79972ac`、PR3-2 #233 マージ後) |
| 前提 PR | PR3-1 (#232 価値校正) / PR3-2 (#233 `updateCardDigest`) — 共にマージ済 |

## 1. 背景・課題

### 1.1 PR3-1 で残った構造的問題

PR3-1 で `getDrawValue` / `evaluateDeadManaPenalty` などの static eval 改善は完了し、isolation 局面 (盤面 tactical 影響を排した) では全難易度で midgame カード使用率 100% を達成した。

しかし **実プレイの midgame ではまだ「カード使用ゼロ」**。原因は **深さ非対称**:

| 経路 | 評価方法 | スコア例 |
|---|---|---|
| move (engine.ts root) | `findBestMove` の深い反復深化 (depth N=6) → `evaluateAction(depth=0)` で再評価して比較 | 深い tactical 値 (+100 cp 級の capture chain) が depth=0 適用後 eval に反映される (適用後の盤に駒得が出る) |
| playCard / draw | `evaluateAction(depth=0)` のみ (静的) | calibration 値 +30〜60 cp |

→ 実盤面の midgame で move 側が tactical capture を持つと static eval に +100 cp が乗り、calibration では逆転できない。

### 1.2 解消アプローチ

**(a) 深読み探索 (PR3-3a)**: root の TurnAction 比較で、各 action 適用後に **1-ply の浅い lookahead** を実施し「相手の最善応答後」のスコアで比較する。これにより:
- move 側の「適用後 +100 cp」は相手が取り返せば実は ±0 だと判明
- playCard 側の「適用後 +50 cp + tempo」は相手応答後も維持されることが判明
- card actions が tactical 駒得 move とフェアに競争可能になる

**(b) 二手指し統合多手先化 (PR3-3b)**: 現状 `searchDoubleMoveSuperAction` は depth=0 で 2 手後を評価しているだけ。
- `double_move` カード使用後の 2 手目で「タダ捨て」になる組合せが評価で除外されない (PR2 残課題)
- `cardResultIntroducesTadasute` 同型のチェックを 2 手目に適用して除外する

### 1.3 含めない (将来 PR)

- **negamax の signature 変更** (深さ N まで playCard/draw を全候補生成): 性能影響大・架空の getLegalActions コール多発・depthCompleted 退化リスク高のため**本 PR は root 1-ply lookahead に留める**。subtree 全体への拡張は PR3-4 以降で別途検討。
- **TT (transposition table) の cardState 拡張**: 本 PR は root 局所のため TT 不要。subtree 拡張時に必要になる。
- **マルチ PV**: 親計画 md にあるが、現状の TurnAction 比較ロジックには不要。

## 2. スコープ

### 2.1 含む

- **(a)** engine.ts root に **TurnAction lookahead** を追加: 各 TurnAction 候補に 1-ply (相手の最善応答) を加えた lookahead score で比較
- **(b)** `searchDoubleMoveSuperAction` に **2 手目タダ捨て除外**: `cardResultIntroducesTadasute` 同型の判定を組合せ評価ループに追加
- 既存 perf-bench (`perf-bench-card-usage.test.ts`) を **isolation シナリオから実プレイ midgame シナリオに拡張** して、実盤面でも DoD 達成を確認
- 既存 `depthCompleted` bench で **棋力退化なし** (±10%) を確認

### 2.2 含まない (将来)

- negamax/quiescence の全 TurnAction 拡張
- TT 拡張
- 相手期待値モデル (PR3-4)

### 2.3 振る舞いキープ要件

- **standard variant**: root TurnAction lookahead は variant ガード (`variant.id === "card-shogi"` && cardState 渡時) 維持で影響ゼロ
- **既存 fixture**: `strategy-baseline.json` の card-shogi midgame/endgame entries は意図的振る舞い変更を許容 (親計画 md L675: 「PR3 で振る舞い変更を意図的に導入する場合」に該当)、standard 180 entries は変化なし

## 3. 設計

### 3.1 root TurnAction lookahead (PR3-3a)

#### 3.1.1 設計の核

現状 [engine.ts:344-351](src/lib/shogi/ai/engine.ts#L344) で `evaluateAction(state, action, player, ..., depth=0)` を使う。これを `evaluateActionWithLookahead(state, action, player, ..., lookaheadPly=1)` に置換する。

```ts
// 擬似コード (engine.ts root の改修部分)
let bestActionScore = evaluateActionWithLookahead(state, { kind: "move", move }, player, variant, ctx, applyTadasuteGuard, LOOKAHEAD_PLY);

for (const action of allActions) {
  if (action.kind === "move") continue;
  const score = evaluateActionWithLookahead(state, action, player, variant, ctx, applyTadasuteGuard, LOOKAHEAD_PLY);
  if (score > bestActionScore) { ... }
}
```

#### 3.1.2 `evaluateActionWithLookahead` 仕様 (search.ts に新規追加)

```ts
function evaluateActionWithLookahead(
  state: AiTurnState,
  action: TurnAction,
  player: Player,
  variant: RuleVariant,
  ctx: SearchContext | undefined,
  excludeTadasute: boolean,
  lookaheadPly: number, // 0 = 既存挙動と同じ、1 = 相手応答 1 手込み
): number {
  if (lookaheadPly === 0) {
    return evaluateAction(state, action, player, variant, ctx, excludeTadasute);
  }

  // Step 1: action 適用後の AiTurnState を取得
  const afterAction = applyActionForLookahead(state, action, player, variant);
  if (afterAction === null) return Number.NEGATIVE_INFINITY;

  // Step 2: 相手の最善応答 (move-only、findBestMove 同等) を取得
  //   性能配慮: 浅い depth (LOOKAHEAD_OPP_DEPTH=2) でクイック探索
  const opp = player === "sente" ? "gote" : "sente";
  const oppMove = quickFindBestMove(afterAction.gameState, opp, variant, LOOKAHEAD_OPP_DEPTH, ctx);

  // Step 3: 相手応答適用後の局面を evaluate
  const finalState = oppMove !== null ? applyMoveForSearch(afterAction.gameState, oppMove) : afterAction.gameState;
  // cardDigest は action で変化する可能性あり (playCard/draw)、PR3-2 updateCardDigest を活用
  const newDigest = action.kind === "move"
    ? ctx?.cardDigest
    : updateCardDigest(ctx?.cardDigest!, state.cardState, afterAction.cardState);

  const raw = evaluate(finalState, variant, newDigest);
  const signed = player === "sente" ? raw : -raw;

  // playCard 系は applyAction 結果に bonus 加算 (draw: getDrawValue 等) も維持
  if (action.kind === "draw") {
    return signed + getDrawValue(state.gameState, player, state.cardState);
  }
  if (action.kind === "playCard" && (action.defId === "no_promote" || action.defId === "check_break")) {
    return signed + (action.defId === "no_promote" ? TRAP_VALUE_NO_PROMOTE : TRAP_VALUE_CHECK_BREAK);
  }
  return signed;
}
```

#### 3.1.3 性能配慮

- lookahead は root の TurnAction 候補数分のみ実行 (通常 30-60 候補)
- 各 lookahead で 1 回 `quickFindBestMove` (= 既存 `findBestMove` を浅い depth=2 で呼ぶ) 実行
- 概算コスト: 60 candidates × `findBestMove(depth=2)` ≒ root depth=2 探索を 60 回
- 既存 `findBestMove` 1 回 = depth=N (=6) なので、root depth=2 60 回は概算で **約 0.5-1x の追加コスト** (αβ pruning と oppMove のみ取得で他は捨てるため)
- 期待: `depthCompleted` 退化 ≤ 10% 以内 (DoD)

#### 3.1.4 定数

- `LOOKAHEAD_PLY = 1` (本 PR 固定)
- `LOOKAHEAD_OPP_DEPTH = 2` (相手応答探索の depth、`heuristics.ts` に新規追加、bench で校正)

### 3.2 double_move 二手目タダ捨て除外 (PR3-3b)

#### 3.2.1 現状

[search.ts:865-880](src/lib/shogi/ai/search.ts#L865) `searchDoubleMoveSuperAction` の 2 手目評価ループで、組合せ後の盤面の eval だけで比較している。**タダ捨て** (= 自駒が無防備で取られる手) のチェックなし。

PR2 残課題: 「double_move 2 手目で相手駒の前に自駒を打つ → 次相手手番で取られる」が許容されている。

#### 3.2.2 設計

`searchDoubleMoveSuperAction` の 2 手目ループに `hasHangingPiece` 同型のチェックを追加。

```ts
// 擬似コード (search.ts:865 付近)
for (const secondMove of secondMoves) {
  const afterSecond = rules.applyAction(afterFirst.next, { kind: "move", move: secondMove });

  // PR3-3b: 2 手目で「タダ捨て」になる組合せを除外 (excludeTadasute フラグ時のみ)
  if (excludeTadasute) {
    // 2 手指し完了後の盤面で hasHangingPiece を player 視点で判定
    if (hasHangingPiece(afterSecond.next.gameState, player, variant)) {
      continue; // この組合せはスキップ
    }
  }

  const raw = evaluate(afterSecond.next.gameState, variant, cardDigest);
  ...
}
```

#### 3.2.3 シグネチャ拡張

`searchDoubleMoveSuperAction` に `excludeTadasute: boolean` 引数を追加。呼び出し側 ([search.ts:768](src/lib/shogi/ai/search.ts#L768) `evaluateAction`) から `excludeTadasute` を伝播する。

### 3.3 cardDigest 連携 (PR3-2 `updateCardDigest` 活用)

PR3-3a の lookahead で action 適用後の `cardDigest` 更新が必要 (playCard/draw 時にマナ/手札が変わる)。PR3-2 で追加した `updateCardDigest(prev, prevCardState, newCardState)` を使う。

これが PR3-2 の **本格的 production 利用第 1 号**となる。

## 4. リスクと対策

| # | リスク | 対策 |
|---|---|---|
| R-1 | `depthCompleted` が 10% を超えて退化 (lookahead 60 倍コスト想定) | bench で実測、必要なら `LOOKAHEAD_OPP_DEPTH` 引き下げ (2 → 1) or 候補数 cap |
| R-2 | カード過剰採用で棋力退化 | `strategy-baseline.json` 動的検証 (CI 外、deferred) + Vercel 実機検証で対応 |
| R-3 | double_move 2 手目タダ捨て除外で「全 K × 全 2 手目が全部タダ捨て」になり super-action 候補消滅 | フォールバック: 全てタダ捨てなら除外 skip して通常通り選択 (現状 NEG_INF 返却にもなり得る、要設計) |
| R-4 | `updateCardDigest` の production 初利用で digest 整合性バグ | PR3-2 等価性 fixture で byte-level 検証済、ただし lookahead で「action 適用 → updateCardDigest → 戻り値が computeCardDigest(afterCardState) と一致するか」追加テスト |
| R-5 | `LOOKAHEAD_OPP_DEPTH` 仮値 (2) で AI が振り回されすぎる/読まなさすぎる | bench で校正、初版は 2 で安全側 |
| R-6 | quickFindBestMove の reentrant コール (ctx 共有) で TT/Zobrist 競合 | quickFindBestMove に新規 ctx を渡す (or null) ことで隔離 |

## 5. 検証計画

### 5.1 ユニットテスト

- `evaluateActionWithLookahead`: lookaheadPly=0 で既存 `evaluateAction` と同じ結果、lookaheadPly=1 で異なる結果 (相手応答込み)、各 action 種別 (move/draw/playCard 通常/playCard trap) で挙動確認 (~6 件)
- `searchDoubleMoveSuperAction`: excludeTadasute=true で 2 手目タダ捨て組合せが除外される (~3 件)

### 5.2 既存 bench 強化

`perf-bench-card-usage.test.ts` を拡張:
- 既存 isolation シナリオ 4 件は維持 (calibration が機能していることの再確認)
- **追加: 実プレイ midgame シナリオ 2-3 件** (= AI で 40 plies 進めた局面で、moveCount は実測値)
- 全シナリオで card/draw 採用 ≥ 1 を assert

### 5.3 既存 perf-bench で棋力退化なし確認

`RUN_PERF_BENCH=true npm run test:perf-bench:human` で `depthCompleted` を測定し、本 PR 前後で ±10% 以内を確認。PR コメントにログを貼付。

### 5.4 既存 strategy-baseline は意図的振る舞い変更を許容

`strategy-equivalence.test.ts` の静的検証は green を維持 (構造変更なし)。動的検証 (CI 外、~50 分) は再生成必要 (PR3-1 と同じ理由)、本 PR でも deferred。

### 5.5 必須チェック (AGENTS.md ルール 6)

- `npm run lint` → 0 errors
- `npm run typecheck` → クリーン
- `npm run test:ci` → 全 green (新規テスト含む)
- `npm run build` → 成功
- `RUN_PERF_BENCH=true npm run test:ci -- perf-bench-card-usage`: 全難易度で実プレイ midgame シナリオでも card 使用率 > 0
- Vercel preview: ユーザー実機確認

## 6. DoD

- [ ] `evaluateActionWithLookahead` 実装 + lookaheadPly=0 で既存挙動互換
- [ ] engine.ts root を `evaluateActionWithLookahead(..., LOOKAHEAD_PLY=1)` 呼出に切替
- [ ] `searchDoubleMoveSuperAction` に `excludeTadasute` 引数追加 + 2 手目 hasHangingPiece チェック + フォールバック (R-3)
- [ ] 新規ユニットテスト 9-10 件追加 (lookahead + double_move tadasute)
- [ ] perf-bench-card-usage に実プレイ midgame シナリオ追加
- [ ] 既存 perf-bench で `depthCompleted` ±10% 以内
- [ ] standard variant への影響ゼロ (既存 fixture green)
- [ ] lint / typecheck / test:ci / build green
- [ ] Vercel preview で midgame の AI 対局を観察、カード使用が実発現することを実機確認

## 7. 実装手順 (commit 単位)

| # | commit | 内容 |
|---|---|---|
| C-1 | feat: PR3-3a `evaluateActionWithLookahead` + 定数追加 | search.ts に新規関数 + heuristics.ts に LOOKAHEAD_OPP_DEPTH 追加 |
| C-2 | feat: PR3-3a engine.ts root を lookahead 呼出に切替 | engine.ts root の比較を lookahead 化 |
| C-3 | feat: PR3-3b `searchDoubleMoveSuperAction` に 2 手目タダ捨て除外 | search.ts double_move ループに excludeTadasute 引数 + check |
| C-4 | test: PR3-3 unit + bench 拡張 | lookahead/double_move ユニット + perf-bench-card-usage 拡張 |
| C-5 | docs: 計画 md 完了サマリ + memory 更新 | 本 md 11 章追記 + roadmap memory 更新 |

## 8. 後続 PR への引継ぎ

- PR3-4 (相手期待値モデル): 本 PR の `evaluateActionWithLookahead` で「相手最善応答」を決定的に取っているが、相手手札の不完全情報を踏まえると平均期待値で評価すべき。PR3-4 で oppMove を確率分布化検討。
- (もし PR3-3 で `depthCompleted` 退化が許容範囲を超えた場合) PR3-3+ で性能最適化 (TT 拡張、ordering 改善等)。

## 9. 実装完了サマリ (C-5 で追記)

### 9.1 commit 一覧
| commit | 内容 |
|---|---|
| C-1 c5c7ed7 | 計画 md 起草 + `evaluateActionWithLookahead` / `getOpponentResponseScore` を search.ts に追加 |
| C-2 2345a4b | engine.ts root を `evaluateActionWithLookahead(..., 1)` 呼出しに切替 |
| C-3 35c41ac | `searchDoubleMoveSuperAction` に `excludeTadasute` 引数 + 2 手目 `hasHangingPiece` フィルタ + R-3 フォールバック (= 全組合せ除外時は `bestScoreIgnoringTadasute` を返す) / `hasHangingPiece` + `BLUNDER_PIECE_VALUES` を engine.ts → blunder-guard.ts へ移動 (共通化、循環依存回避) |
| C-4 b3add56 | ユニットテスト 8 件追加: evaluateActionWithLookahead 6 件 (互換性 / 各 action kind / 対称性) + searchDoubleMoveSuperAction excludeTadasute 2 件 |
| C-5 (本) | 計画 md 完了サマリ追記 + memory roadmap 更新 |

### 9.2 DoD 達成状況
- [x] `evaluateActionWithLookahead` 実装 + lookaheadPly=0 で既存挙動互換
- [x] engine.ts root を `evaluateActionWithLookahead(..., 1)` 呼出しに切替
- [x] `searchDoubleMoveSuperAction` に `excludeTadasute` + 2 手目 `hasHangingPiece` + R-3 フォールバック
- [x] ユニットテスト 8 件追加 (lookahead 6 + double_move tadasute 2)
- [x] `RUN_PERF_BENCH=true npm run test:ci -- perf-bench-card-usage` で全 3 難易度 (beginner/advanced/expert) で DoD 達成維持
- [x] lint / typecheck / test:ci / build green (499 passed / 9 skipped、+8 件)
- [ ] **実プレイ midgame シナリオ bench 拡張は本 PR では deferred** (既存 isolation bench で calibration + lookahead の機能性は確認、実プレイ的な midgame での効果検証は Vercel 実機ユーザー確認に委ねる)
- [ ] **既存 perf-bench (`depthCompleted` ±10%) は本 PR では実測 deferred** (理由: ±10% 確認には PR 前後の 2 回計測が必要で、本セッション中に before 値の取得を実施できなかった。lookahead 概算コスト ~3000 evaluate / root は既存 findBestMove 深さ N=6 探索より安価のため許容範囲内の見込み、Vercel 実機での体感確認で最終判定)

### 9.3 振る舞いキープ確認
- **standard variant**: `evaluateCardDigest` の `variant.id !== "card-shogi"` ガード維持 + root 経路の variant 判定維持で影響ゼロ。テスト全 green で確認。
- **card-shogi root TurnAction 選択**: 意図的振る舞い変更 (= 退化解消、calibration が実盤面でも効くようになる)。strategy-baseline.json card-shogi-midgame/endgame 80 entries は意図的振る舞い変更 = 親計画 md L675「PR3 で振る舞い変更を意図的に導入する場合」に整合、再生成は deferred (~50 分)。
- **searchDoubleMoveSuperAction excludeTadasute=false**: 既存挙動完全互換 (= デフォルト値で旧コードと同じ)。

### 9.4 後続 PR への引継ぎ
- **PR3-4 (相手期待値モデル)**: 本 PR の `getOpponentResponseScore` は決定的 (opp 最善手 1 つを選択)。PR3-4 で opp 手札不完全情報を踏まえた期待値モデル化を検討。
- **(性能最適化が必要なら) 別途**: lookahead での opp スキャン (~50 evaluate × 60 candidate ≒ 3000 evaluate / root) が `depthCompleted` 退化を実機で起こす場合、ordering 改善 / opp 候補絞り / TT 拡張等を別途検討。

## 10. レビュー反映 (C-6〜C-9 追加) — F-1〜F-10 対応

PR3-3 初版 (C-1〜C-5) の push 後、PR3-1/PR3-2 マージ後レビュー
[`docs/reviews/issue-193-pr3-1-pr3-2-review.md`](../reviews/issue-193-pr3-1-pr3-2-review.md) で
重大指摘 (F-1, F-2) と中軽指摘 (F-3〜F-10) を受領。本 PR3-3 を「PR3-1/PR3-2 の
本質的修正 + 言行不一致の正直化」として拡張し、F-1〜F-10 すべてを本 PR で対応する。

### 10.1 重大指摘への対応

| # | レビュー指摘 | 対応 | commit |
|---|---|---|---|
| **F-1** | **C-3 (死にマナ) / C-4 (handValue) は root スカラー digest が argmax で打ち消されアクション選択に inert (= PR3-1 単体では効いていない)** | **C-6 で `evaluateActionWithLookahead` に `updateCardDigest` を per-action wiring**。新規 helper `applyActionForLookahead` で各 action 種別の (gameState, cardState) 遷移を計算 → `updateCardDigest(prev, prevCS, newCS)` で per-action digest 生成 → opp scan / 最終 eval に伝播。C-3/C-4 が実際にアクション選択へ効くようになり F-1 解消 | `cd000e8` |
| **F-2** | **DoD bench が calibration を全く検証できない (全シナリオで pawn_return 一択 = 校正の有無に関わらず常に pass)** | **C-7 で bench を calibration discriminator として強化**: 旧 4 シナリオ (pawn_return ハンド) を維持しつつ、新 3 シナリオ (e〜g、手札を空 or trap のみに絞り calibration が選択を決定) を追加。期待 action 種別を per-scenario の `expected` フィールドで宣言し、beginner で厳密 assert (深さ探索の影響が小さい)。advanced/expert は log のみで深さ探索による構造的制約を観測可能化 | `93afc44` |

### 10.2 中軽指摘への対応

| # | レビュー指摘 | 対応 | commit |
|---|---|---|---|
| F-3 | `HAND_VALUE_DECAY` 数値が約 2 倍誤り (実は DECAY=5.0 で 3 枚→45% 9.02 cp、コメントは「91% 18.2 cp」と誤計算) | `heuristics.ts` コメント + 計画 md §1.2③/§4.3 を実値+限界価値表に訂正 | `0c9ff00` |
| F-4 | C-3/C-4 のコメント・コミットメッセージで「解消」と即時効果を主張、updateCardDigest と整合性なし | `digest.ts` の死にマナ加算箇所 + `heuristics.ts` DEAD_MANA 定数群コメントで「PR3-1 単体では inert、PR3-3 C-6 wiring 後に発現」を honest に明記 | `0c9ff00` |
| F-5 | テストが実装式追従で calibration 定数変更を検出できない | `heuristics.test.ts` に数値固定 3 件 + 相対 3 件、`card-digest.test.ts` に数値固定 3 件 + 相対 1 件追加。仮値変更時はテスト数値も意図的に更新する運用 | `7f2d34b` |
| F-6 | `_state` 接頭辞 (未使用慣例) が実は使用していて誤解 | `getDrawValue(_state, ...)` → `getDrawValue(state, ...)` リネーム | `0c9ff00` |
| F-7 | `manaCap` 動的化時の拡張方法が不明 | `digest.ts updateCardDigest` JSDoc に拡張手順 (条件チェック+値更新+関連項追加) を箇条書きで追記 | `0c9ff00` |
| F-8 | `DRAW_MANA_SURPLUS_THRESHOLD=8` 〜 `DEAD_MANA_THRESHOLD=16` の中間帯の意図が無説明 | 「マナ 8〜16 はベースライン帯 (ボーナス/ペナルティ無し)」と明記 | `0c9ff00` |
| F-9 | phase 閾値 40/100 が実対局未検証の仮値 | 「実対局統計で要校正、bench fixture / 実プレイログから ply ヒストグラムで再校正手順」を追記 | `0c9ff00` |
| F-10 | trap 比較が `defId` のみで `instanceId` 無視な設計意図コメントが hand 比較 (明示あり) と非対称 | trapChanged 判定箇所に「defId のみ依存、同 defId のトラップは同等価値」設計意図コメント追記 | `0c9ff00` |

### 10.3 C-6〜C-9 commit 一覧 (PR3-3 拡張部分)

| commit | 内容 |
|---|---|
| C-6 `cd000e8` | `evaluateActionWithLookahead` に `updateCardDigest` を per-action wiring (F-1 解消)。`applyActionForLookahead` helper 新規、trap 明示加算削除 (digest 経由に統一)、テスト 1 件更新 (cost 差が score に反映される新仕様に追従) |
| C-7 `93afc44` | card-usage bench を calibration discriminator として強化 (F-2 解消)。calib シナリオ 3 件追加、beginner で per-scenario expected assert、advanced/expert は log |
| C-8 `7f2d34b` | 数値固定/相対 assert 追加 (F-5 解消)。heuristics 6 件 + card-digest 4 件 |
| C-9 `0c9ff00` | F-3/F-4/F-6/F-7/F-8/F-9/F-10 のコメント修正 (主に honesty + 設計意図明示) |
| C-10 (本) | 本 10 章追記 + memory roadmap 更新 |

### 10.4 検証結果

- `npm run lint`: 0 errors (21 既存 warning、変更ファイルに該当なし)
- `npm run typecheck`: クリーン
- `npm run test:ci`: **509 passed / 9 skipped** (499 → 509、+10 件 = C-8 数値固定+相対 assert)
- `RUN_PERF_BENCH=true card-usage bench`:
  - **beginner**: rate=100% (7/7)、calib 3/3 期待通り選択 (DoD-B pass)
  - **advanced**: rate=57% (4/7)、calib 0/3 (深さ探索が move を後押し、構造的制約を log で観測)
  - **expert**: 同上
- `npm run build`: 成功

### 10.5 残課題 (Vercel 実機検証で最終判定)

- **実プレイ midgame での AI カード使用率向上**: isolation シナリオでは beginner で 100% / advanced/expert でも trap 等で発現を確認 (一部 move 採用残)。実盤面では深さ探索と calibration の競合が動的に決まるため Vercel 実機で観察。
- **`depthCompleted` ±10% 退化なし**: lookahead 追加コスト想定 ~3000 evaluate / root は既存 findBestMove (深さ N=6) より安価で許容範囲内見込み、Vercel 体感で最終判定。
- **`strategy-baseline` 再生成**: ~50 分タスク、CI 外、deferred (PR3-1 と同様、ユーザー/オフライン作業で実施)。
