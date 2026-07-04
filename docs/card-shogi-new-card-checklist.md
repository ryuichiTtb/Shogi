# カード将棋: 新規カード追加時のチェックリスト

> このチェックリストは `AGENTS.md` から分離した参照ドキュメント。カード将棋 (card-shogi variant) に新カードを追加する作業時に必ず目を通すこと。

カード将棋で新しいカードを `CARD_DEFS` に追加するとき、以下を確認する。共通基盤の挙動 (待った・DB 保存・AI ガード等) は基本的に**ヘルパで自動的に正しく動く**ようになっているが、新しい横断的概念を導入するときは更新が必要。

**Why:** 過去に「二手指し (#82) 追加時に `待った` 制約が破綻」「同種類の event 追加で複数箇所に判定ロジックが分散しデグレ」など、共通基盤のクロスカット制約を考慮し忘れたバグが繰り返し発生したため。

**How to apply (実装者向け):**

1. **カード定義** (`src/lib/shogi/cards/definitions.ts`)
   - `CardDefinition` の必須フィールドをすべて埋める
   - `status` は新規実装中なら `"preparing"`、検証用見本なら `"draft"`、本実装完了後は `"active"`
   - `useConditionDescription` は `CARD_USE_CONDITIONS` に登録した条件と整合させる
   - **`checkUsage` (王手中の使用可否) を必ず明示** (Issue #82)。判断指針:
     - **大前提**: 自分の手番開始時、王手中なら必ず1手で回避できる手が存在する (詰みなら手番が回らない)
     - `"forbidden"`: そのカード効果が王手回避になり得ない (盤上駒退避系・盤面に作用しないカード・トラップ)
     - `"conditional"`: 通常の1手の一部パターンでのみ王手回避になる (合駒系)。target ありなら動的判定が動く
     - `"unconditional"`: 通常の1手分以上の選択肢を提供する (= 必ず1手回避手を取れる。例: 二手指し)
     - トラップカードは原則 `"forbidden"`
     - 詳細: Issue #82 のコメント「王手時カード使用可否の検討観点」を参照

2. **効果適用関数** (`src/lib/shogi/cards/effects.ts`)
   - target ありカードは `applyXxx` を実装し、`simulateCardEffect` の switch にも追加
   - `isValidCardTargetSquare` で対象マスの妥当性判定を実装 (王手中の使用条件含む)
   - target なしカード (盤面を変えないもの) はデフォルト動作で OK

3. **reducer 効果分岐** (`src/hooks/card-shogi/reducer.ts` の `CONFIRM_PLAY_CARD`)
   - `def.effectId === "..."` の分岐に新カード処理を追加
   - 1 ターンに複数 ply 消費するカード (二手指し系) は `state.doubleMove` パターンを参考に

4. **横断制約の確認** (このチェックリストの本丸)
   - **新たな event kind を追加する場合**:
     - `src/lib/shogi/cards/types.ts` の `GameEvent` ユニオンに追加
     - **`src/hooks/card-shogi/undo-policy.ts` の `isCardOpEvent` を更新**
       (待った可否判定で漏れなく block されるように)
   - **複数 ply のカード (= 自分のターンで 2 つ以上 `moveEvent` を発行する) を追加する場合**:
     - `getUndoScope` (undo-policy.ts) は同色連続を 1 ターン扱いで自動対応
     - `state.doubleMove` のような明示的な「ターン継続中」フラグを reducer に持つこと
     - DB 保存スキップ (`src/hooks/use-card-shogi-game.ts` の save useEffect) も該当フラグを考慮

5. **AI / 探索側の更新** (Issue #193 / PR1a で追加)
   - **新カードが AI 側 `getLegalActions` で候補生成に含まれる**ように `src/lib/shogi/ai/turn/current-rules.ts` (or PR1d で追加される `action-generator.ts`) を更新
     - PR1a 時点では move-only のため自動的にスキップされるが、PR1d で playCard 候補生成が入るときに必要
   - **新カードが評価関数 (cardDigest) に影響する場合** は `src/lib/shogi/ai/cards/digest.ts` の `CardDigest` interface に該当フィールドを追加 (PR1d 段階で構造を整備)
   - **新カードの価値を `evaluateCardDigest` に係数として追加** (PR1d 以降):
     - 例: 新カードが「相手の駒を取る」効果なら、PIECE_VALUES と整合する単位 cp で価値を表現
   - **AI fixture に新カードの基本ケースを追加**: `src/lib/shogi/ai/__tests__/card-digest.test.ts` / `action-generator.test.ts` (PR1d 期から運用) に該当カードの動作確認を 1〜2 ケース追加
   - **bench fixture に新カード使用局面を追加** (棋力影響を測定): `perf-bench.test.ts` に新カード保有の midgame 局面を含めて、新カード追加前後で `depthCompleted` ±10% 以内であることを確認
   - **影響なしの場合 (= 効果が単発で AI が探索に組み込めない種類)** は本節に「該当なし」と PR コメントで明記すれば足りる

6. **テスト**
   - `npm run test:ci -- src/hooks/card-shogi/__tests__/undo-policy.test.ts` が緑であることを確認
   - 新カードの効果関数のユニットテストを `effects.test.ts` に追加
   - 1 ターン複数 ply 系の場合は reducer 統合テストも追加

7. **prisma seed**
   - `ALL_CARD_DEFS` 経由で自動的に Card マスタ・DeckEntry・PlayerCardCollection に投入される
   - 既存ローカル DB に反映するには `npm run db:seed` を実行
