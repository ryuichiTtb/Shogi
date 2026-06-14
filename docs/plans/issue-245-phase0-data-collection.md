# Issue #245 フェーズ0 実装計画: 学習用棋譜データ収集

- **Issue**: #245「カード将棋AI 学習型評価エンジン基盤」(epic, OPEN)
- **ブランチ**: `feature/#245-phase0-data`(worktree `.claude/worktrees/issue-245`、origin/main `5bd334d` 起点)
- **スコープ**: フェーズ0 = **学習用棋譜データ収集の機構**のみ。NN学習・符号化・推論はフェーズ1以降(本計画の対象外)。
- **ユーザー決定(2026-06-14)**:
  1. スキーマ = **専用テーブル新設**(TrainingGame / TrainingSample)
  2. CPU対CPU = **ヘッドレス自己対戦バッチ生成もフェーズ0で作る**
  3. 作業場所 = **Worktree**

---

## 0. 背景と現状(調査確定事項)

### 現状の永続化(`prisma/schema.prisma` / `src/app/actions/game.ts`)
- `Game`(対局1行): メタ + `boardState`(GameState全体) + `cardState`(CardGameState全体)。**いずれも最新の1スナップショットのみで、毎手上書き**。
- `GameMove`(1手1行、インクリメンタル): `moveData`(Move) + `notation`。`@@unique([gameId, moveNum])`。
- シリアライズ関数 `serializeGameState`(board.ts) / `serializeCardState`(cards/state.ts)は完備・ロスレス。

### 確定した2つの欠落
1. **各手番のカード状態が残らない**: `GameMove` は駒の手のみ。各手時点の `cardState` は保存されず(`Game.cardState` は最終版だけ)。`eventLog`(`GameEvent[]`=カード使用/ドロー/トラップ履歴)は**メモリのみ・DB非永続**。
2. **CPU対CPU対局が保存されない**: 観戦モードは `createSpectatorGameState()` が**DB行を作らない揮発モード**、`useDbPersistenceGuard` が全DB書き込みをskip。

### ヘッドレス自己対戦の実現性(調査結論)
- 既存に「1局フルループ」は無いが、**純粋関数部品は完備・React/DB非依存**:
  - `applyTurnAction(world, action, {spectatorMode})`(`kernel/world-kernel.ts:262`): TurnAction(move/draw/playCard)を `WorldState`(`{gameState, cardState, doubleMove}`)へ1遷移で純粋適用。内部で `applyMove`(history追記)+ `evaluateGameEnd`(終局判定)を実行 → **適用後の `world.gameState.status`/`winner` が終局時に確定**。戻り値 `{world, events, turnEnded, boardChangedBeyondMove}`(`events`にドロー結果等)。
  - `findBestMoveWithStats(gameState, player, difficulty, CARD_SHOGI_VARIANT, {cardState, useKernelSearch:true, spectator:true})`(`ai/engine.ts:196`): **production同等(bolt-on)AI**。戻り値 `{move, action: TurnAction|null, stats}`。
  - `getWorldLegalActions(world, variant, expandCards)`(`ai/search.ts:772`): 合法TurnAction生成(参考)。
  - `evaluateGameEnd`(`rules.ts:114`): 終局判定(checkmate/stalemate/repetition/impasse)。
- **注意点**:
  - 手数上限 `SPECTATOR_MAX_MOVES=200`(`ai/strategy/spectator-override.ts:17`)は **kernelに組み込まれていない → ドライバのループ条件に自前で入れる**(超過は winner="draw")。
  - `applyMoveForSearch`(board.ts:126、bench等で使用)は status="active"固定・history非追記 = **終局検出不可。フル対局には使わず `applyTurnAction` を使う**。
  - 乱数: デッキシャッフルは Fisher-Yates + `Math.random`(`cards/state.ts:49`、シード無)。ドロー自体は山札先頭=決定的。AIノイズは beginner/intermediate のみ(advanced/expert は決定論)。→ **各手番でcardStateスナップショットを保存すれば(ply0のcardStateに初期山札順が入る)、乱数に依存せず局面遷移を完全再現可能**。

---

## 1. 設計方針

### 1.1 データモデル(新設2テーブル)

```prisma
/// 学習用「1試合」= 人間対局 or 自己対戦。教材のメタ + 勝敗ラベルの単一情報源。
model TrainingGame {
  id               String           @id @default(cuid())
  source           String           // "human" | "self_play"  (将来 "spectate")
  variantId        String           @default("card-shogi")
  // 両者の素性(humanなら null。学習データ品質フィルタ用)
  senteDifficulty  String?
  senteCharacterId String?
  goteDifficulty   String?
  goteCharacterId  String?
  humanColor       String?          // "sente" | "gote" | null(self_play)
  deckSpecSente    Json?            // デッキ構成(card-shogi)
  deckSpecGote     Json?
  // 結果ラベル(単一情報源。サンプルへは非正規化しない=join で取る)
  winner           String?          // "sente" | "gote" | "draw" | null(中断)
  finalStatus      String           @default("active") // GameStatus
  moveCount        Int              @default(0)
  // データ来歴(弱いAI由来データを誤って高品質扱いしないため)
  engineVersion    String?          // 例: git短縮hash / "bolt-on"
  sourceGameId     String?          // human時、元 Game.id への参照(任意・トレース用)
  createdAt        DateTime         @default(now())
  samples          TrainingSample[]

  @@index([source])
  @@index([createdAt])
}

/// 学習用「1決定点」のスナップショット(局面 + カード状態 + 採用行動 + 手番)。
model TrainingSample {
  id             String       @id @default(cuid())
  trainingGameId String
  trainingGame   TrainingGame @relation(fields: [trainingGameId], references: [id], onDelete: Cascade)
  plyIndex       Int          // 0始まり。記録した決定の通し番号(move/card/draw 含む)
  moveCount      Int          // その時点の gameState.moveCount(駒手数。card/drawでは据置=同値が並ぶ)
  sideToMove     String       // "sente" | "gote"(この局面で行動する側)
  boardState     Json         // serializeGameState(行動前の局面)
  cardState      Json         // serializeCardState(行動前のカード状態)
  action         Json         // 採用した TurnAction { kind:"move"|"draw"|"playCard", ... }
  events         Json?        // 適用で生じた GameEvent[](ドロー結果等。再現/監査用、任意)
  createdAt      DateTime     @default(now())

  @@index([trainingGameId])
}
```

**設計判断**:
- **勝敗を `TrainingSample` に非正規化しない**: `TrainingGame.winner` を単一情報源とし、エクスポート時に join。理由 = (a) 冗長排除(AGENTS規約)、(b) 人間対局は手ごとにインクリメンタル保存され勝敗は終局時確定 → 非正規化すると全サンプルへの finalize UPDATE(書き込み増幅)が必要になる。join はバッチ(学習データ抽出)時のみで性能上問題なし。
- **サンプル意味論 = 「行動する側が見た局面(行動前)+ 採用行動」**: value学習(局面→評価)にも policy学習(局面→手)にも素直。自己対戦は自然にこの形(各ループ反復=1 TurnAction)。
- **粒度**:
  - **自己対戦**: 決定点粒度(move/card/draw すべて1サンプル)。ヘッドレスなので低コストで全決定を記録。
  - **人間対局**: フェーズ0は**駒手粒度**(`saveCardShogiMove` フック)を基本とする。同ターン内のカード使用/ドローは次サンプルの `cardState` に反映される。要件1(ユーザー実戦棋譜を学習投入)は駒手粒度の局面+勝敗で充足。決定点粒度への拡張はフェーズ1の改善余地(本計画§5「設計論点」で M1 に諮る)。
  - 両者は同一スキーマ。`action.kind` で種別判別。自己対戦に intra-turn サンプルが多い非対称は許容・文書化。
- **`engineVersion`**: 弱いAI自己対戦を高品質データと誤認しないためのフィルタキー。学習品質に直結。

### 1.2 データシンク(保存先)
- **正準ストア = `TrainingGame`/`TrainingSample` テーブル**(ユーザー決定)。
- **人間対局**: 既存の card-shogi 保存経路にフックし、DBへ直接記録。
- **自己対戦**: 既定は **JSONL ファイル出力**(`--sink jsonl`、Neon非依存・どこでも実行可・大量生成向き)。`--sink db` で直接DB書き込みも可。`scripts/import-training-jsonl.ts` で JSONL → DB 取り込み。
  - **理由**: 自己対戦をNeonへ直書きするのは「DB変更」= rule 5 で都度確認が必要。JSONL既定なら実験的生成をDB副作用なしで回せ、migration適用前でも生成開始できる。DBへの確定は import で明示実行。

### 1.3 共通モジュール(疎結合)
- `src/lib/shogi/training/` を新設(フレームワーク非依存・純粋):
  - `types.ts`: `TrainingSampleData` / `TrainingGameData` の型(DB行とJSONLの共通形)。
  - `serialize.ts`: `buildTrainingSample(world, action, ...)`(`serializeGameState`/`serializeCardState` 再利用)。
  - `sink.ts`: `TrainingSink` インターフェース(`appendGame(gameData, samples[])`)。実装 = `JsonlSink`(Node fs)/ `DbSink`(server action 経由)。
- 人間対局・自己対戦・(任意)観戦が**同一の serialize/sink を共有** → 重複排除・疎結合(#109観点)。

---

## 2. 作業分解(段階コミット、単一ブランチ `feature/#245-phase0-data`)

| 段階 | 内容 | 主な変更 | ゲート |
|---|---|---|---|
| **P0-1** | スキーマ + client再生成 | `schema.prisma` に2テーブル追加、`npm run db:generate`(Prisma client `src/generated/prisma` 再生成)。**※本リポジトリは `prisma db push` 運用で `migrations/` は不在(M1 B-1)。手書きmigrationは作らない。DBへの `db push` 適用は rule 5 でユーザー明示確認** | lint/typecheck/build(DB適用は別途指示) |
| **P0-2** | 収集コア(共通モジュール) | `src/lib/shogi/training/{types,serialize,sink}.ts` + 単体テスト | lint/typecheck/test/build |
| **P0-3** | 人間対局キャプチャ | `src/app/actions/game.ts`(TrainingGame作成/サンプル記録/終局finalize)+ hook配線 + envフラグ + テスト | 全ゲート |
| **P0-4** | ヘッドレス自己対戦生成 | `scripts/selfplay-245.ts`(driver)+ `scripts/import-training-jsonl.ts` + driver単体テスト | 全ゲート |
| **P0-5**(任意) | 観戦対局のDB保存 | spectator経路で training capture 有効化(P0-2/P0-3再利用) | 全ゲート |
| **P0-6** | エクスポート/点検 | `scripts/export-training.ts`(件数・サンプル抽出・join勝敗)最小 | lint/typecheck/test |

- 自己対戦(P0-4)が CPU対CPU データ生成を満たすため、**P0-5 は任意**(観戦UIからの収集が欲しい場合のみ)。
- 各段階完了時に意味のある単位でコミット(日本語・なぜ重視・末尾 Co-Authored-By)。

### P0-4 ドライバ骨格(確定済の部品で構成)
```ts
// scripts/selfplay-245.ts (tsx 実行、React/DB非依存)
function playOneGame(deckSpec, difSente, difGote, engineVersion) {
  let world = {
    gameState: createInitialGameState(CARD_SHOGI_VARIANT),
    cardState: createInitialCardState(deckSpec),   // Math.random シャッフル
    doubleMove: null,
  };
  const samples = [];
  // 終局検出の主経路は status!=="active"(applyTurnAction が手適用後に確定)。
  // SPECTATOR_MAX_MOVES は import(マジックナンバー禁止, M1 NIT-3)。
  while (world.gameState.status === "active" && world.gameState.moveCount < SPECTATOR_MAX_MOVES) {
    const player = world.gameState.currentPlayer;
    const r = findBestMoveWithStats(world.gameState, player,
      player === "sente" ? difSente : difGote,
      CARD_SHOGI_VARIANT, { cardState: world.cardState, useKernelSearch: true, spectator: true });
    if (!r.action) break;                          // 補助: 真に合法手ゼロ(=既に終局)
    samples.push(buildTrainingSample(world, r.action, player)); // 行動前(pre)スナップショット
    const applied = applyTurnAction(world, r.action, { spectatorMode: true });
    world = applied.world;                          // 終局判定込み
  }
  const winner = world.gameState.status === "active" ? "draw" : (world.gameState.winner ?? "draw");
  return { gameMeta: {...}, samples, winner, finalStatus: world.gameState.status };
}
// CLI: --games N --sente expert --gote expert --deck <spec> --sink jsonl|db --out file.jsonl
```

---

## 3. 必須チェック(rule 6)
各ソース変更段階で `npm run lint` → `typecheck` → `test:ci` → `build`(毎回 `cd <worktree>` 明示)。doc/testのみ段階は build 省略可。

## 4. リスク・性能・デグレ(#109観点)
- **デグレ**: 人間対局キャプチャは既存トランザクションに **+1 INSERT**(既に1 INSERT+1 UPDATE/手)。盤面/カード状態JSONは数KB → 無視できる増分。**envフラグ(`ENABLE_TRAINING_CAPTURE`)で完全に切替可能**にし、既存対局フローへの侵襲を最小化。失敗時は対局保存を巻き込まない(キャプチャ失敗を握り潰す or 別トランザクション)。← M1で確認。
- **UI/UX**: クライアント変更なし(キャプチャはサーバ側 server action 内)。PC/モバイル描画・ラグ・発熱への影響ゼロ(#109のUX観点 = 該当なしと明記)。
- **性能(自己対戦)**: 純メモリ + バッチ書き出し。DB往復なし(JSONL)。`applyTurnAction`/`findBestMoveWithStats` は既存ホットパスと同じ計算量。
- **ストレージ**: 履歴を持つため `Game.boardState`(最新のみ)とは重複が出るが、それが収集の目的。将来 圧縮/カラムナ書き出しで最適化(フェーズ2)。phase0では過剰index回避(`trainingGameId`/`source`/`createdAt` のみ)。
- **再現性**: 各サンプルのcardStateに山札順が入り、actionも記録 → 乱数(シャッフル/ノイズ)に依存せず再現可能。
- **保守性/疎結合**: serialize/sink を共通モジュール化し人間/自己対戦/観戦で共有。core gameplay(reducer/kernel)は無改変(applyTurnAction を呼ぶだけ)。

## 5. 設計論点(M1で諮る / ユーザー判断含む)
1. **人間対局の粒度**: 駒手粒度(最小侵襲)で良いか、決定点粒度(カード/ドローも個別サンプル)まで踏み込むか。→ 推奨: phase0は駒手粒度、phase1で拡張。
2. **キャプチャ失敗の扱い**: 同一トランザクション(失敗で対局保存も巻き戻る=安全だが対局UXに影響)vs 別トランザクション/握り潰し(対局保存を絶対に妨げない)。→ 推奨: 後者(キャプチャは best-effort)。
3. **自己対戦の既定シンク**: JSONL 既定 + 任意DB で良いか(rule 5 のDB副作用回避)。→ 推奨: JSONL既定。
4. **envフラグ既定値**: `ENABLE_TRAINING_CAPTURE` を本番でON/OFFどちらにするか(要件1=ユーザー棋譜必須 → 既定ON案。ただし migration適用前はテーブル不在でエラー → 適用後にON)。
5. **TrainingGame.winner finalize のタイミング**: 終局(resign/checkmate/手数上限)で UPDATE。中断対局(active のまま放置)は winner=null のまま = 学習除外。これで良いか。

## 6. マイルストーン(rule 8)
- **M1(本計画直後)**: 単一 general-purpose agent で #109 観点レビュー → 本書へ反映。
- **M2(実装完了時)**: 単一 general-purpose agent でレビュー。
- **M3(マージ前)**: 同上 + ユーザー確認。
- マージ/PR/Issueクローズ/DB(Neon)適用は **明示指示まで実行しない**(rule 1/5)。

## 7. スコープ外(フェーズ1以降)
- NN符号化設計・小型NN学習・World探索評価への差替・推論速度最適化(NNUE/WASM/MCTS)。
- 大量自己対戦の定期再学習ループ、クラウドGPU運用。
- boardHash lookup / opening book(#193 PR1e系)との統合。

---

## 8. M1レビュー反映(2026-06-14、単一 general-purpose agent / Issue #109 観点)

**総合判定: 条件付き承認(要修正)** → 下記反映で着手可。技術的前提1〜7は概ね「正」、5(マイグレーション運用)のみ要修正。

### BLOCKER(反映済 = 本書を更新)
- **B-1 マイグレーション運用**: `prisma/migrations/` は**不在・履歴ゼロ**で、本リポジトリは `prisma db push`(`package.json` の `db:push`/`db:generate`)運用。手書き migration.sql は drift/baseline 不整合を招く誤前提。→ **P0-1 を `db:generate` + `db push`(適用は要ユーザー確認)へ修正済**(§2)。migration 運用への移行が必要なら別 Issue。
- **B-2 pre/post 取り違え**: `saveCardShogiMove` は手適用**後(POST)**に発火し post 局面 + 適用済 move が渡る。計画の「行動前(pre)」を既存フック点では取れず、自己対戦(pre)と意味論が逆転。→ **人間対局キャプチャは `saveCardShogiMove` 同梱をやめ、dispatch(reducer呼出)直前に「行動前 world + これから指す action」を採る専用キャプチャを `use-card-shogi-game` に1つ追加**(§1.3 の共通 `buildTrainingSample(world, action)` をそのまま再利用=自己対戦と完全対称)。§1.1「粒度」/§2 P0-3/§3/§5-1 はこの方式に読み替える(本節が優先)。

### MAJOR(実装時に確定)
- **M-1 テーブル不在で対局保存を壊す穴**: 人間対局キャプチャは**既存 `$transaction` に同梱しない**。**別経路 + best-effort(catch で握り潰し+console.error、対局保存を絶対に妨げない)**を確定。`ENABLE_TRAINING_CAPTURE` 既定 **OFF**、`db push` 適用後に明示 ON(二重ガード)。
- **M-2 deckSpec 記録元**: 人間対局では `Game` に deckSpec 非保存。phase0 は `TrainingGame.deckSpecSente/Gote` を**人間側 null 許容**で可(過剰要件化回避)。自己対戦は CLI 指定 deckSpec を記録。
- **M-3 非決定性の文言**: 「**再生は決定的**(各サンプルに cardState=山札順 + action を保存ゆえ乱数源非依存で局面遷移列を完全再現)。ただし **生成自体は beginner/intermediate で非決定**(AIノイズ・シャッフルが `Math.random`、シード無)」と切り分けて明記。

### MINOR / NIT(実装時に反映)
- **NIT-1**: `GameEvent` の `at`(=`Date.now()`)は再現性を汚すため、`events` 保存時に剥がす or 「再現には使わない」と注記。
- **NIT-2**: 抽出で `plyIndex` ソートを使うなら `@@index([trainingGameId, plyIndex])` 複合を検討(任意)。
- **NIT-3**(反映済): driver の 200 は `SPECTATOR_MAX_MOVES` を import(§2 skeleton 修正済)。
- **NIT-4**(反映済): 終局検出の主経路は `status!=="active"`、`!r.action` は補助とコメント明記(§2 skeleton 修正済)。
- **package.json**: P0-4/P0-6 で `selfplay`/`import-training`/`export-training` スクリプトを追加(`tsx` 実行)。

### 設計論点5項目の確定(M1回答に基づく)
1. **粒度**: phase0 は駒手粒度で可(B-2 解決が前提)。決定点粒度拡張は `persistCardShogiState` 経路で将来容易。
2. **キャプチャ失敗**: **別経路 + best-effort(握り潰し)**を確定(M-1)。同梱トランザクションは投了棋譜まで巻き戻すため不可。
3. **自己対戦シンク**: **JSONL 既定**(rule 5 のDB副作用回避)+ `import-training-jsonl.ts` で明示確定。
4. **envフラグ既定**: **phase0 は既定 OFF**、`db push` 適用後に明示 ON。
5. **winner finalize**: 終局時 UPDATE・中断は null で学習除外。**finalize フックは投了(`saveCardShogiResign`)と詰み(`saveCardShogiMove` の status 反映)の両経路に置く**(片方漏れで winner=null 量産を防ぐ)。

### 検証済の技術的前提(M1)
`applyTurnAction`(world-kernel.ts:262, move経路のみ evaluateGameEnd・draw/playCardはstatus据置=正)/ `findBestMoveWithStats`→`{move,action,stats}`(engine.ts:196, route.ts は `useKernelSearch:true`・`useTurnActionSearch` OFF=bolt-on)/ serialize系・createInitial系/ `$transaction`構造(game.ts:227)/ client出力 `src/generated/prisma`/ `SPECTATOR_MAX_MOVES`非kernel組込/ tsx `@/`解決 — いずれも実コードで確認済。
