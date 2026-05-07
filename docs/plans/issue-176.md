# Issue #176 対戦相手CPUの思考時間短縮と将棋AI基盤改善計画

作成日: 2026-05-07

## 目的

Issue #176 では、対戦相手CPUの思考待ちが長く、5秒から10秒、まれに20秒近く待つことがある点を改善する。

達成したい状態は次の通り。

- どんなに遅くてもユーザー体感で最大5秒以内にCPUが着手する
- できれば平均1秒から3秒でCPUが着手する
- 速度改善によってCPUの棋力を落とさない
- むしろ探索・評価・時間管理を見直し、将棋AIとしての品質を底上げする
- 標準将棋とカード将棋の両方で、同じAI基盤を安全に使える
- PC/モバイルともにラグ、端末負荷、バッテリー消耗、発熱を悪化させない

## 調査から取り込む方針

今回の調査では、将棋AIの実用系と先端系を分けて整理する。

- 実用系の中心は、高速な alpha-beta 系探索、反復深化、置換表、静止探索、move ordering、厳密な時間管理、強い評価関数である
- Bonanza 系の重要な教訓は、探索だけでなく評価関数の学習・最適化が棋力に大きく効くこと
- YaneuraOu 系の重要な教訓は、USI、時間管理、置換表、NNUE、探索の細かな枝刈りを組み合わせた実用エンジン設計である
- dlshogi / AobaZero / AlphaZero 系の重要な教訓は、Policy/Value network と MCTS が強力である一方、モデル、学習、推論資源、配布サイズ、GPU/CPU負荷が大きく、今回のNext.jsアプリにそのまま入れるのは過大である
- #176 では外部エンジンや巨大モデルは導入せず、現行エンジンを modern alpha-beta engine として整え、将来 NNUE / trained evaluator / USI engine bridge に差し替え可能な境界を作る

参考情報:

- Computer shogi: https://www.sciencedirect.com/science/article/pii/S0004370201001576
- MMTO / Bonanza: https://www.jair.org/index.php/jair/article/view/10871
- YaneuraOu: https://github.com/yaneurao/YaneuraOu
- dlshogi: https://github.com/TadaoYamaoka/DeepLearningShogi
- AlphaZero paper: https://arxiv.org/abs/1712.01815
- AobaZero: https://github.com/kobanium/aobazero

## 現状認識

現行実装では、CPU着手は `src/app/actions/ai.ts` の Server Action 経由で `calculateAiMove` を呼び出している。

主な問題候補は次の通り。

- AI計算が Server Action 経由で、保存系 Server Action と直列化・待ち合わせし得る
- 標準将棋側にAI着手後の固定500ms待ちが残っている
- 探索の `timeLimitMs` はあるが、探索全体に厳密なdeadlineが貫通していない
- 静止探索や深い再帰の途中で時間超過しても、最後に完了した深さだけを採用する構造が明確でない
- 探索中の合法手生成が通常の `applyMove` 系コストを含んでおり、検索専用の軽量経路に寄せ切れていない
- post-search の blunder guard が、深い探索結果を静的安全判定で上書きし、戦術的な好手を潰す可能性がある
- 評価関数は手作業で強化されているが、責務分離やベンチ、棋力回帰fixtureが不足している
- 置換表は4M entries前提で、性能・メモリ・cold start・stats観点のレビューが必要

## 実装方針

通常経路ではサーバ側でAI計算を行う。モバイル端末で深い探索を常時実行すると、端末負荷、発熱、バッテリー消費、UI jank のリスクが高いためである。

一方で、Server Action 直呼びはやめる。AI計算はDB更新ではなく純粋な計算処理なので、専用 Route Handler に切り出し、保存処理との待ち合わせを避ける。

実装の基本方針は次の通り。

- `POST /api/ai-move` を追加し、AI計算専用入口にする
- Route Handler は `runtime = "nodejs"`、`maxDuration = 5` を明示する
- 内部探索deadlineは5秒ではなく、通信・JSON・React反映の余白を残すため最大4.0秒から4.3秒程度に抑える
- Server Actionの保存処理は従来通り非同期保存にし、AI計算とは独立させる
- 標準将棋とカード将棋のフックは共通のAIリクエストhelperを使う
- request id と AbortController で古い応答、待った後の応答、終局後の応答を無視する
- 通常経路が5秒近く詰まった場合に備え、最後のUX保険としてクライアント側に軽量な emergency fallback を用意する
- emergency fallback は深い探索をしない。合法手生成、即詰み確認、静的評価の1-ply程度に限定し、モバイル負荷を抑える
- 本Issueでは外部パッケージ、外部USIエンジン、YaneuraOuコード、dlshogi/AobaZeroモデル、DB schema変更は導入しない

## API設計

### 追加予定

`src/app/api/ai-move/route.ts`

```ts
export const runtime = "nodejs";
export const maxDuration = 5;
```

リクエスト概念:

```ts
type AiMoveRequest = {
  gameState: GameState;
  player: Player;
  difficulty: Difficulty;
  variantId: "standard" | "card-shogi";
};
```

レスポンス概念:

```ts
type AiMoveResponse = {
  move: Move | null;
  stats: {
    elapsedMs: number;
    depthCompleted: number;
    nodes: number;
    timedOut: boolean;
    usedBook: boolean;
    usedFallback: boolean;
  };
};
```

### セキュリティ・負荷対策

Route Handler はCPU負荷の高い公開入口になるため、次を必須にする。

- `POST` のみ許可
- `Content-Type: application/json` のみ受け付ける
- `Content-Length` または `request.text()` 後の文字数で上限を設ける
- `variantId`, `difficulty`, `player` は列挙値として検証する
- `gameState` は最低限の構造検証を行う
- 同一origin以外のリクエストを拒否する
- app session / guest session の確認を行う
- レスポンスに機密情報やDB情報は含めない

## 探索エンジン改善

### SearchContext の導入

探索全体で共有する context を追加する。

```ts
type SearchContext = {
  startedAt: number;
  deadlineAt: number;
  nodes: number;
  stopped: boolean;
  depthCompleted: number;
};
```

目的:

- `Date.now()` の散発チェックではなく、探索全体で同じdeadlineを参照する
- root、negamax、quiescence、legal move generation loop すべてで停止できる
- timeoutした探索深度の結果を採用せず、最後に完了した深さのbest moveを返す
- statsをRoute Handlerとベンチに返す

### 反復深化の採用ルール

- depth 1 から順に探索する
- 各depthが完全に終わった場合のみ `bestMove` を更新する
- depth途中でdeadlineに到達した場合、そのdepthの途中結果は採用しない
- `moveCount`、局面の合法手数、王手中かどうかに応じて探索予算を微調整する
- 合法手が1つしかない場合は即返す
- 序盤の定石手が合法なら即返す

### 静止探索の改善

- quiescence にも deadline と node budget を貫通させる
- 王手中は全合法手を探索するが、deadlineを優先する
- 非王手中は captures / promotions を中心にし、探索爆発を抑える
- timeout時は評価関数のstand-patを返すが、root側では未完了depthとして扱う

### 合法手生成の軽量化

探索専用の合法手生成を追加する。

候補:

- `src/lib/shogi/ai/legal-moves.ts`
- または `src/lib/shogi/moves.ts` に search 用 export を追加

要件:

- `applyMoveForSearch` を使う
- 通常の `getFullLegalMoves` と結果が一致する
- 打ち歩詰め、王手回避、成り、強制成り、打ち駒制約を落とさない
- UI用の通常合法手生成は不用意に変えない

## 評価関数・棋力改善

今回のゴールは、NNUEやMCTSを即導入することではなく、現行評価関数を将来差し替え可能な形へ整えつつ、明らかな悪手を減らすことである。

対応方針:

- `evaluate` 周辺に evaluator boundary を設ける
- 評価項目を material、piece-square、king safety、piece activity、hand value、promotion threat、piece safety に整理する
- post-search blunder guard は原則撤廃または tie-breaker 化する
- 深い探索結果を静的な安全判定だけで上書きしない
- 王手、詰み、王手回避、駒得、成り、玉安全をfixture化して回帰テストする
- 初級・中級のノイズは維持するが、上級・超上級では棋力低下につながるランダム性を入れない

## UI/UX改善

標準将棋:

- AI着手後の固定500ms待ちを撤廃する
- `saveMove` の失敗は `.catch` でログに落とし、AI応答やUIを止めない
- AI応答が古い局面に対するものなら無視する

カード将棋:

- 既存のドロー演出、カード使用演出、王手崩し演出、二手指し中のAIブロック条件は維持する
- `pendingCard`, `isDrawing`, `isPlayingCard`, `isCheckBreakAnimating`, `doubleMove` の制御を崩さない
- AI応答後の保存は既存の `useEffect` 保存導線と整合させる

共通:

- `isAiThinking` は「現在有効なAI requestが存在する時だけtrue」にする
- timeout / abort / stale response でthinkingが残り続けないようにする
- AIが即応した場合でもUIが破綻しないことを確認する
- モバイルでCPUを常用しない設計を維持する

## 実装ステップ

### Phase 0: ベースライン測定

- 現行 `calculateAiMove` の benchmark を取る
- standard / card-shogi、序盤 / 中盤 / 終盤、各difficultyで elapsed を記録する
- 20秒級が出る局面を可能な範囲で探索する
- 計測用スクリプトは `scripts/bench-ai.ts` などに置く

### Phase 1: AI呼び出し経路の分離

- `src/app/api/ai-move/route.ts` を追加する
- `AiMoveRequest` / `AiMoveResponse` / `SearchStats` の型を整理する
- 入力検証、同一origin確認、session確認、サイズ制限を入れる
- hooks から Server Action ではなく fetch helper を呼ぶ
- 標準将棋の固定500ms待ちを撤廃する

### Phase 2: deadline付き探索

- `SearchContext` を導入する
- `findBestMove` を stats付きで呼べるようにする
- root / negamax / quiescence にdeadlineを貫通させる
- timeout時は最後に完了したdepthのbest moveを返す
- ベンチで最大5秒以内を確認する

### Phase 3: 探索用合法手生成

- search専用legal movesを追加する
- 通常 `getFullLegalMoves` と一致するfixtureを作る
- `applyMoveForSearch` ベースにして、history / position serialization の不要コストを避ける
- 王手、打ち歩詰め、成り、打ち駒を重点的に確認する

### Phase 4: 評価関数と悪手抑制

- post-search blunder guard を見直す
- 評価関数の責務を整理する
- 王手、詰み、駒得、成り、玉安全のfixtureを追加する
- 超上級が明らかなタダ捨てや謎手を選びにくいことを確認する

### Phase 5: 検証

- targeted test を追加して先に回す
- `pnpm run lint`
- `pnpm run typecheck`
- `pnpm run test`
- `pnpm run build`
- benchmark script で平均1秒から3秒、最大5秒未満を確認する
- 必要に応じてVercel previewで実機に近い確認を行う

### Phase 6: #109レビュー

次のタイミングで Issue #109 の観点を再確認する。

- 実装計画確定後
- 実装完了後、commit / push 前
- 動作検証後、PR / merge 前

今回の計画作成時点で確認する観点:

- 要件充足: 最大5秒、平均1秒から3秒、棋力維持・向上を目的に含めている
- 非デグレ: 標準将棋とカード将棋の両方を対象にし、カード演出中のAIブロック条件を維持する
- 性能: deadline、search専用legal moves、benchmark、statsを計画に含めている
- UX: 固定待ち撤廃、stale response無視、thinking残留防止、モバイル常用CPU回避を含めている
- 保守性: Route Handler、request helper、SearchContext、Evaluator境界で責務分離する
- セキュリティ: AI計算APIの公開入口として、入力検証、同一origin、session、payload制限を含めている

## テスト計画

追加候補:

- `src/lib/shogi/ai/__tests__/search-deadline.test.ts`
- `src/lib/shogi/ai/__tests__/legal-moves.test.ts`
- `src/lib/shogi/ai/__tests__/engine-strength.test.ts`
- `src/app/api/ai-move/__tests__/route.test.ts`
- `src/hooks/__tests__/ai-request.test.ts`
- `scripts/bench-ai.ts`

検証シナリオ:

- 合法手が0件なら `move: null`
- 合法手が1件なら即返す
- 定石手が合法なら即返す
- timeoutしても最後に完了したdepthの合法手を返す
- timeoutした未完了depthの途中bestを採用しない
- 王手中は王手回避手だけ返す
- 打ち歩詰めを選ばない
- 成れる局面で成り/不成の候補を落とさない
- 上級/超上級で明らかな大駒タダ捨てを避ける
- 戦術的な駒捨てを post-search guard で誤って潰さない
- 標準将棋でAI着手後の固定500msが消える
- カード将棋でドロー/カード/トラップ演出中にAIが走らない
- 待った後の古いAI応答が適用されない
- timeout / abort / route error で `isAiThinking` が残らない

## 非スコープ

今回のIssueでは次を行わない。

- 外部USIエンジンの組み込み
- YaneuraOu / dlshogi / AobaZero のコード流用
- NNUEモデルの同梱
- GPU推論
- 自己対戦学習基盤
- Prisma schema変更
- 新規npmパッケージ追加
- UIデザイン刷新
- PR作成、merge、Issue close

## 完了条件

- #176 の要件に対して、CPU応答時間の上限と平均目標を満たす設計・実装になっている
- 棋力が明らかに落ちていないことをfixtureとベンチで確認できる
- 標準将棋とカード将棋の両方でAI応答が安全に動く
- 最大5秒超過、thinking残留、古い応答適用、演出中AI起動のデグレがない
- `pnpm run lint`、`pnpm run typecheck`、`pnpm run test`、`pnpm run build` の結果を報告できる
- 実装後はcommitし、作業ブランチをpushして止める
- PR作成・merge・Issue close は明示指示まで行わない
