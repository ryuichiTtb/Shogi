# Issue #245 派生: 検証デバッグ機能 (相手手札表示 + エンジン選択 + 盤デザイン既定)

> ユーザー指示 (2026-07-05): 学習 AI の Preview 検証を効率化する 3 機能。
> ①相手 (CPU) 手札のデバッグ表示 (ON/OFF トグル) ②CPU エンジン選択 (旧版 bolt-on / 新版 NN world) を
> 対 CPU 戦・観戦の両方で (例: 龍王(旧) vs 龍王(新) の観戦) ③盤デザイン既定をダーク02 (実装済)。
> 着手前 rule-8 M1 レビュー対象。**production (env `ENABLE_LEARNED_EVAL` 未設定) の AI 挙動はバイト不変が絶対条件**。

## 1. 現状事実 (調査済 2026-07-05、単一調査 agent / 実コード照合)

| # | 事実 | 出典 |
|---|---|---|
| G1 | 相手手札データは client に完全にある (`cardState.hand[aiColor]`)。裏面表示は純粋に視覚処理 (`faceDown`)。表示箇所は 3 つ: タブレット相手ゾーン / モバイル上端バー (stack) / PC サイドパネル | `card-shogi-game.tsx:1220-1224,1488-1496,1682-1690,2230-2233` |
| G2 | `HandArea` は `faceDown?: boolean` を既に持ち、表面描画は自分手札と共通の `CardView` | `hand-area.tsx:12,110-141` |
| G3 | 観戦は `playerColor:"sente"` 固定で、**先手 CPU の手札は既に表向き** (非対称)。後手のみ裏面 | `spectate/page.tsx:86` |
| G4 | statusBar に既存トグル前例 (ミュートボタン `Button size="icon" variant="ghost"`) | `card-shogi-game.tsx:1606-1636` |
| G5 | AI request 経路: `use-card-shogi-game.ts:131-239` (観戦は同一 useEffect が両サイド発行、difficulty 分岐 139-143、params 組立 166-177) → `use-ai-request.ts:38-51` → route `validateBody` (85-124、cardState/spectatorMode は silent ignore 流儀) | 各所 |
| G6 | route の `LEARNED_EVAL_ENABLED` (env) がモデルロード/両フラグ/NN ログの 3 箇所を一括制御 | `route.ts:49,213-217,257-258,264-274` |
| G7 | 対 CPU 戦の設定は `match-setup.tsx` → `createGame(...)` → DB gameConfig JSON → `game/[id]/page.tsx` が再構成 | `actions/game.ts:86-95,114` |
| G8 | 観戦の設定 UI は `spectate/page.tsx` (CharacterPicker ×2、difficulty/difficultyB → gameConfig 83-93) | 同 |
| G9 | 観戦は DB 非保存・訓練キャプチャも観戦除外 (`spectatorMode` return)。棋譜=揮発 eventLog (`CardShogiHistory`)。**統計的な旧vs新戦績は CLI `winrate-245.ts` が本命**、観戦 UI は 1 局ずつの目視向け | `use-card-shogi-game.ts:365,381` |
| G10 | `/dev` ページ群は NODE_ENV ゲートなしで production 公開の前例。対 CPU 専用アプリ (対人なし) ゆえ手札公開の実害は自己責任のみ | `src/app/dev/` |

## 2. 設計

### 2.1 機能A: 相手手札表示トグル
- `card-shogi-game.tsx` に `revealOpponentHand` state + statusBar に目アイコントグル (ミュート隣、G4)。
- 3 箇所の `faceDown` を `!revealOpponentHand` 化。**モバイル stack は reveal 時 `layout="horizontal"` に切替** (stack のままだと重なって見えない)。
- 全モード (対 CPU/観戦) で使用可。production にも出す (G10 前例 + 対 CPU 専用ゆえ実害なし、既定 OFF)。

### 2.2 機能B: エンジン選択
- 型 `EngineId = "legacy" | "learned"` を `variants/types.ts` に追加。`GameConfig` に `engine?/engineB?` (difficultyB と同型)。
- **配線** (difficulty/difficultyB と完全同型): `use-card-shogi-game.ts` で `effectiveEngine` 導出 (観戦: sente→engine, gote→engineB ?? engine) → `AiMoveRequestParams.engine` → route `validateBody` (不正値 silent ignore) → **`wantsLearned = LEARNED_EVAL_ENABLED && body.engine !== "legacy"`** で G6 の 3 箇所を置換。
- **既定 (未指定)**: env に従う = env ON なら learned (現 Preview 挙動の後方互換)、`"legacy"` 指定時のみ旧版へ。**production (env OFF) は param が何であれ bolt-on 固定 = バイト不変** (構造的安全)。
- **UI**:
  - 観戦 (`spectate/page.tsx`): 各サイドの設定に「エンジン: 旧版/新版」選択を追加 → gameConfig へ。
  - 対 CPU 戦 (`match-setup.tsx` → `createGame` 引数 + gameConfig JSON + `game/[id]/page.tsx` 透過): 同一 UI。
  - **対局画面にエンジンラベル表示** (観戦で「どちらが旧/新か」分かるように。難易度表示の隣等)。
  - production では UI は出るが効かない (route が無視)。UI に「(Preview のみ有効)」注記。
- **モデルロード**: `wantsLearned` 時のみ `ensureLearnedModelLoaded` (冪等)。legacy request では動的 import 自体走らない。NN ログ (0 で warn) も `wantsLearned` ゲートへ移動 (legacy で誤 warn 防止)。
- **戦績**: 連戦集計は今回スコープ外 (統計は `winrate-245.ts` CLI が本命、G9)。観戦は目視 + 既存棋譜 (CardShogiHistory) + エンジンラベルで足りる。

### 2.3 機能C: 盤デザイン既定 (実装済)
`DEFAULT_BOARD_LAYOUT_ID: "light-2"→"dark-2"` (`user-preferences.ts:9`)。保存済み設定は不変。

## 3. 変更ファイル一覧

| ファイル | 変更 |
|---|---|
| `src/lib/user-preferences.ts` | C: 既定 dark-2 (済) |
| `src/components/game/card-shogi/card-shogi-game.tsx` | A: reveal state+トグル+faceDown 3 箇所。B: SerializableGameConfig に engine/engineB + エンジンラベル |
| `src/lib/shogi/variants/types.ts` | B: EngineId + GameConfig.engine/engineB |
| `src/hooks/ai/use-ai-request.ts` | B: params.engine |
| `src/hooks/use-card-shogi-game.ts` | B: effectiveEngine 導出 + params |
| `src/app/api/ai-move/route.ts` | B: body.engine validate + wantsLearned 置換 3 箇所 |
| `src/app/spectate/page.tsx` | B: engineA/B 選択 UI + gameConfig |
| `src/components/home/match-setup.tsx` + `src/app/actions/game.ts` + `src/app/game/[id]/page.tsx` | B: 対 CPU 戦のエンジン選択 + gameConfig JSON 透過 |

## 4. テスト計画
1. route: env OFF で engine param が何であれ両フラグ未伝播 (production バイト不変、最重要)。env ON + engine="legacy" で bolt-on / 未指定・"learned" で world+NN。validateBody 不正値 silent ignore。
2. use-card-shogi-game: 観戦時 sente/gote で engine/engineB が正しく分岐 (既存 difficultyB テストと同型)。
3. bridge/表示: reveal トグルで faceDown が反転 (可能なら)。手動確認: モバイル reveal 時 horizontal、ドローフライト演出との整合。
4. full gate (lint/typecheck/test:ci/build)。

## 5. リスク (#109)
- **最大 = route の書き間違いで production 挙動変化** → `wantsLearned` を必ず `LEARNED_EVAL_ENABLED &&` で括る (構造的安全) + テスト 1 で pin。
- 機能A は表示のみ (探索/reducer 無関係)。ドローフライト演出 (faceDown 前提) との整合は目視。
- 学習エンジンの人間対局が訓練キャプチャに混入する来歴問題 (engineVersion=SHA でエンジン種別不明) は別スコープ (申送り)。

## 6. M1 レビュー反映 (2026-07-05、単一 general-purpose agent / #109、実コード照合)

**判定: CHANGES_REQUIRED → 反映済で着手可**。中核 (§2.2 `wantsLearned = LEARNED_EVAL_ENABLED && body.engine !== "legacy"` の 3 箇所置換) は**実コード照合で production バイト不変が構造的に成立と確認・承認** (env OFF では param の値/有無/不正に関わらず現行同値、engine.ts の `?? false` で書き間違い耐性も有)。G7 のみ訂正 (gameConfig は自動透過せず getGame/page/game-layout の明示再構成 + リマッチ別経路)。反映:

| # | 指摘 | 反映 |
|---|---|---|
| M-1 | reveal で faceDown 分岐を抜けると `data-hand-area` が消え、相手ドローフライトが画面中央下へフォールバック着地 (演出崩壊) | 相手手札 3 箇所を `<div data-hand-area>` ラッパーで**常時**マーキング (reveal 非依存、own 側には付けない) |
| M-2 | 対 CPU 戦「もう一局」は `use-rematch.ts` → `/api/create-game/route.ts` の**別経路**で engine が失われる | 両ファイルを §3 一覧に追加 (RematchConfig + validate + createGame 透過) |
| M-3 | PC (xl) は statusBarContent 非描画 (~2030 に別実装ミュート) → トグルが出ない | xl ヘッダーにもトグル配置 |
| M-4 | モバイル reveal 時 horizontal は幅破綻 (バーに overflow なし + shrink-0) | reveal 時ラッパーを `flex-1 min-w-0` 化し HandArea 内蔵 overflow-x-auto に委ねる |
| m-1 | モバイル/PC の相手手札は `currentMana=0` で全カードグレーアウト誤表示 | reveal 時は `cardState.mana[aiColor]` を渡す |
| m-2/m-3 | `game-layout.tsx` 重複型 + `getGame` 明示再構成が一覧漏れ | §3 一覧に追加 |
| m-4 | route にテスト基盤なし | `resolveEngineFlags(learnedEnabled, engine)` を純関数に切り出しユニットで pin (validateBody の engine 正規化含む) |
| m-5 | production で「出るが効かない」UI | 注記「(Preview のみ有効)」方式を採用 (NEXT_PUBLIC 追加は見送り=ユーザー単独利用) |
| m-6 | learned エンジン対局が訓練キャプチャへ無標識混入 | **gameConfig.engine 明示指定対局はキャプチャ skip** (1 条件、教材純度の安全弁) |
| m-7/n-1〜3 | 相手ドローフライトは faceDown 固定据置 (目視項目) / reveal カードの hover / reveal は非永続・既定 OFF | 実装時に確認・明記 |

**追加スコープ (dm 診断)**: route の `[learned-eval]` ログに **bestAction 種別 + doubleMove ペア有無**を追記 (実機で「エンジンが dm を選んだか・搬送されたか」を Vercel ログで確定できるように)。二手指し不使用調査 (2026-07-05 実測: ローカルは sente/gote 両視点で dm 正常選択・搬送、マナ<5 は候補外=仕様) の実機切り分けが目的。
