このファイルは、本リポジトリで作業する全 AI エージェント (Claude Code / Codex CLI / Cursor / Aider 等) が遵守する**ガバナンス・ルール**を定める。セッションや AI モデルが変わっても**絶対の前提**として適用される。

---

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

## 絶対ルール

各ルールは「本文 / Why / 適用」で構成する (新規ルールも同形式 →「ルールの追加・更新フロー」)。

### 1. PR作成・マージ・Issueクローズは明示的指示まで禁止
PR作成・マージ (`gh pr merge`)・Issueクローズ (`gh issue close`) は、ユーザーの明示指示まで**絶対に実行しない**。
- **Why:** ユーザーは変更を自分で確認してからマージ・クローズしたい。事前確認なしは信頼を損なう。
- **適用:** コード変更完了後はブランチを push して止まり「確認後に指示を」と伝える。「対応して」「Issue#XX 対応して」だけでは実行しない。**唯一の例外** = ユーザーが「PR・マージ・クローズまで」と一連で依頼した場合。

### 2. メイン作業は専用ブランチ / 軽微な派生修正は同居可
main への直接 commit・push 禁止。メイン Issue は専用ブランチで進める。対応中に見つけた**軽微な派生修正** (関連バグ・lint・小 UI 微調整) は別 Issue を起こさず同ブランチに同居させ、メイン Issue のコメントに「派生で対応した内容」として記録する。
- **Why:** main には検証済みのみマージしたい。修正ごとに Issue を立てると一覧が膨張し検索性が落ちる。コメント記録でトレーサビリティと Issue 数抑制を両立。
- **適用:**
  - 開始前に `git branch -a` で既存確認。対象 Issue 用ブランチがあれば用途をユーザーに確認し Yes のときのみ切替。なければ新規作成 (命名はルール3)。
  - 派生修正の判断: **軽微** (1〜2 ファイル / 独立レビュー可 / 非アーキ変更) → 同居+コメント記録。**大規模** (アーキ変更 / 別レビュアー要 / 影響独立) → 別 Issue+別ブランチ。迷えば確認。
  - main マージはルール1 に従い指示まで実行しない。
  - **例外:** ガバナンス変更 (AGENTS.md / `.claude/settings.json` 等) は重要度が高く、専用 Issue+専用ブランチで分離する (governance flow、末尾「ルールの追加・更新フロー」)。

### 3. ブランチ命名規則
`{prefix}/#{Issue番号}` または `{prefix}/#{Issue番号}-{slug}` 形式。

| prefix | 用途 |
|---|---|
| `feature/` | 新機能追加・機能拡張 |
| `fix/` | バグ修正 |
| `refactor/` | 振る舞いを変えないコード整理・責務分離・命名変更 |
| `chore/` | 上記以外の雑務 (依存更新・設定・CI 等) |

- 例: `feature/#69` / `fix/#42` / `refactor/#100` / `chore/#5`。
- 1 Issue を段階分割するときは `{prefix}/#{Issue番号}-{slug}` (slug = 英小文字+ハイフン、例 `cleanup`/`memo`/`split`)。親 `feature/#{番号}` を base に派生 PR を出し、最後に親→main 統合 PR でもよい。
- **Why:** prefix で変更の性質、Issue 番号でトレーサビリティ、slug で段階粒度を表す。
- **適用:** prefix に迷えば確認。Issue に紐づかない作業は Issue を先に作成。

### 4. 新規ブランチは origin/main を起点にする
ローカル main でなく必ず `origin/main` から切る。
- **Why:** 他作業で origin/main が先行していると、ローカル main は古く、他 PR の変更を欠いてデグレに見える状態が起きる (実例 #77)。
- **適用:** 作成前に `git fetch origin` → `git checkout -b {prefix}/#{Issue番号} origin/main`。既存ブランチに切替えた場合も `git fetch && git merge origin/main` で最新取込 (または確認)。

### 5. 破壊的操作・公開操作は事前確認
以下は**必ず確認してから**実行。許可は当該 1 回限り (同種も都度確認)。
- **破壊的:** ファイル/ブランチ削除 (`rm -rf` / `git branch -D`)、`git reset --hard`、`git push --force`、DB 変更、プロセス kill、commit amend・履歴改変。
- **公開・共有:** `git push` (特に main・共有ブランチ)、PR/Issue コメント、Slack/メール送信、外部サービス送信。
- **Why:** 取り返しのつかない作業喪失・意図しない情報流出のリスク。
- **適用:**
  - 操作内容と影響範囲を示してから確認を求め、明示許可の範囲のみ実行。
  - 自動承認/拒否は `.claude/settings.json` に集約 (変更はルール更新フロー従う)。
  - **破壊的カテゴリは settings.json で allow にしてあり、本ルール (必ず確認) が唯一の安全網**。明示指示なしの実行は違反。
  - 公開カテゴリ (`git push origin main` / `gh issue close` / `gh pr close`) は auto-deny 維持 (ルール1・2 と二重化)。Issue 専用ブランチへの通常 push はルール6 の確認済み範囲。

### 6. 専用ブランチは push まで行う (Vercel 確認のため)
実装・検証・commit 完了後、明示の「push しない/止めて」がなければ作業ブランチを origin に push して止まる。
- **Why:** 動作確認は Vercel プレビューで行う。未 push だとユーザーの確認導線が途切れる。
- **適用:** 可能な範囲で型チェック・テスト・表示確認 → 意味ある単位で commit → `git push origin {branch}` → ブランチ名・commit・検証内容を伝えて止まる。main 直接 push 禁止。push 先が共有/用途曖昧/未確認変更混在なら事前確認。PR・マージ・クローズはルール1。

### 7. コミット・PR・Issue 運用
- **コミット:** 意味ある単位で分割 (機能追加とリファクタを混ぜない)。日本語。「なぜ」重視 (背景・意図・原因・対策)。1 行で足りねば本文に背景/原因/対策/検証。フック skip 禁止 (`--no-verify` は明示時のみ)。
- **PR:** タイトル 70 字以内。本文に Summary と Test plan。関連 Issue 番号 (例 `Closes #69`)。
- **Issue:** タイトル簡潔 (目安 30 字以内、名詞句)。詳細 (背景・目的・スコープ・受入条件) は本文。種別ラベル (`governance`/`bug`/`enhancement` 等)。
- **Why:** レビュー容易性と履歴追跡性。長いタイトルは一覧で読みづらく文脈把握が遅れる。

### 8. 重要マイルストーンでの徹底レビュー
**①実装計画直後 (着手前) ②実装完了時 (commit・push 前) ③マージ前 (PR レビュー)** で必ず **Issue #109「共通レビュールール」** に基づき徹底レビューを行う。
- **Why:** 段階レビューで計画見落とし・品質低下・最終確認漏れを防ぐ。観点は #109 に一元化する (転記すると二重管理になり片方が陳腐化)。
- **適用:** 観点の正本は常に #109 を参照し、各到達時に `gh issue view 109` 等で最新取得。セルフ+必要に応じユーザーレビュー。指摘が全解消するまで次段に進まない。結果は PR/Issue/会話に明示。

### 9. 作業スペースは原則 Worktree / 完了後に削除
複数 Issue 並行が多く、メインでブランチ切替を続けると未コミット変更や別ブランチと競合しやすい。完了後の放置は古いブランチ滞留で混同・誤編集・肥大を招く。
- **Why:** 各 Issue を独立に保ち競合を避ける。完了済み残存は誤参照・誤編集の温床。
- **適用:**
  - *開始時:* worktree (`git worktree add`) かメインでのブランチ切替かをユーザーに確認。別件の未コミット変更がメインにあれば worktree 推奨。配置先既定 `.claude/worktrees/issue-{番号}`。
  - *完了時 (PR マージ+Issue クローズ後):* worktree 削除 (`git worktree remove`)・ローカルブランチ削除 (`git branch -d`)・origin ブランチ削除 (`git push origin --delete`)。削除はルール5 対象なので、対象一覧 (worktree path・local・origin) を提示し確認後に実行。

---

## 実装ガイドライン

絶対ルールが禁則を扱うのに対し、本セクションは**品質基準・進め方・報告形式**を定める。

### 1. 目的・成功条件
- **目的:** バグ修正 / 機能追加 / リファクタ / 大規模設計。常に「要件充足・非デグレ・最適実装」を満たす。
- **成功条件 (完了の定義、同時に満たす):** 要件充足 / 既存を壊さない (テスト緑) / PC・モバイル双方で UX 最適 / 多様な画面サイズ・アスペクト比に耐える共通基盤 / 性能・保守性・セキュリティ・デグレに問題なし / 類似バグ・対応漏れなし / デッドコード・マジックナンバー・過剰ハードコードなし / 計算量を意識し最小リソース / リッチ機能でもラグ・発熱・電池消耗を最小化。
- **適用:** 完了報告で各項目の確認結果を「最終報告テンプレート」(本節9) で提示。未充足は理由・次アクションを明示。

### 2. 技術スタック前提
TypeScript / Next.js / React、Prisma / PostgreSQL (Neon)、Vercel、pnpm (`pnpm-lock.yaml` 維持)、単一リポジトリ。
- **適用:** ライブラリ選定は上記適合性を先に検証。依存追加・更新は `pnpm add` / `pnpm update`。スタックに影響する変更 (依存追加・外部 API 等) は事前確認 (本節7)。

### 3. 実装方針
- 設計重視 (関連ソースを広く読み全体像を把握してから着手)。
- 優先度: **パフォーマンス >= 保守性 > 可読性**。最重要は UX (ラグ・ズレ・端末負荷・発熱・電池)。
- 冗長回避 (一元化・共通化、低計算量/低描画/低メモリ設計)。疎結合。
- NG: マジックナンバー・過剰ハードコード・不要分岐・デッドコード。
- **適用:** 設計案は計算量・描画・メモリで比較し上位採用。可読性のため分岐/抽象を増やすなら性能影響を必ず確認。

### 4. UI / UX 方針
PC・モバイル双方を最適化。モバイルは縦横・アスペクト比・性能差が大きいので単一端末前提にしない。破綻しないレスポンシブ (320px〜大画面で確認)。操作感・待ち時間・描画負荷・アニメ滑らかさも UX 品質。リッチ演出 (アニメ・音声) は負荷・電池・発熱・遅延を考慮し、低スペック向け軽量 fallback を設計に含める。

### 5. 意思決定優先順位
迷ったら **① UX 品質 → ② 性能 (計算量・描画・メモリ) → ③ 保守性 (共通化・疎結合) → ④ 既存仕様整合 (デグレ回避) → ⑤ 可読性** の順。下位を優先するときは上位に悪影響がないことを根拠付きで示す。

### 6. 必須チェック
ソース変更は順に: ① `npm run lint` ② `npm run typecheck` ③ `npm run test:ci` (`test` は watch なので自動用途は `test:ci`) ④ `npm run build`。
- **Why:** 早く落ちる順で無駄を減らす。build は Next + Prisma generate + waveform peaks を含むため最後に必ず通す。
- **適用:** 失敗は通るまで修正してから報告。解消不能なら原因・影響・対応案を明記。ドキュメントのみの変更は lint/typecheck 通過で代替 (build 省略可)。

### 7. 外部通信・機密情報
- **外部通信:** パッケージ追加・API・Web 検索・外部操作は原則禁止・都度確認 (目的・通信先・送受信データ・代替案を提示し承認を得る)。
- **機密:** `.env*`・鍵は読取/出力/コミット禁止。ログ・報告にトークンや接続文字列 (Neon URL) を出さない。必要時はダミー値+手順提示。`.env` は構造のみ確認。貼付時マスキング徹底。
- **Why:** 外部通信は情報流出・依存膨張・セキュリティリスク。機密は一度履歴に出ると取消困難 (force-push でも外部キャッシュに残りうる)。

### 8. コミュニケーション
日本語のみ。報告は理由・代替案・懸念・影響を含め詳細に。不明点は推測で進めず、着手前に「前提・想定動作・不明点」を明示し合意 → 途中で前提が崩れたら止めて再確認。

### 9. 最終報告テンプレート
完了報告は原則この形式 (軽微な変更は省略可。空欄は「該当なし」と明記し項目は残す):
```
### Summary — 実施内容の要約
### 変更内容 — ファイル別の変更 / 何を・どの要件に対応したか
### 設計判断 — なぜその実装か / 代替案比較 / 性能・保守性・UX の理由
### テスト結果 — 実行コマンドと成否 / 失敗は原因・影響・対応案
### パフォーマンス / UX 観点 — 計算量・描画・メモリ / モバイル負荷 / ラグ・発熱・電池 / PC・モバイル確認
### 残課題・次アクション — 未対応 / 改善余地 / ユーザー判断が要る点
```

### 10. 追加禁止事項
ルール1・5 と本節7 の禁止に加え: **①不明点を推測だけで進める ②根本原因を特定しない場当たり修正 ③デグレ確認なしの完了扱い ④不要コード・デッドコード・マジックナンバー・過剰ハードコードを残す**。該当しそうなら即、質問・調査・整理に切替える。

---

## カード将棋: 新規カード追加時のチェックリスト
`CARD_DEFS` に新カードを追加するとき確認する。共通基盤 (待った・DB 保存・AI ガード等) はヘルパで自動的に正しく動くが、新しい横断概念の導入時は更新が要る。
- **Why:** 過去「二手指し (#82) で待った制約破綻」「event 追加で判定が複数箇所に分散しデグレ」等、クロスカット制約の考慮漏れバグが繰り返したため。

1. **カード定義** (`src/lib/shogi/cards/definitions.ts`)
   - `CardDefinition` の必須フィールドを全て埋める。`status` = 実装中 `"preparing"` / 見本 `"draft"` / 完了 `"active"`。`useConditionDescription` は `CARD_USE_CONDITIONS` と整合。
   - **`checkUsage` (王手中の使用可否) を必ず明示** (#82)。前提 = 手番開始時に王手中なら必ず 1 手で回避できる手が存在。`"forbidden"` = 王手回避になり得ない (盤上駒退避系・盤面非作用・トラップ) / `"conditional"` = 一部パターンのみ回避 (合駒系、target ありで動的判定) / `"unconditional"` = 1 手分以上の選択肢 (例 二手指し)。トラップは原則 forbidden。詳細は #82 コメント。

2. **効果適用関数** (`src/lib/shogi/cards/effects.ts`)
   - target ありは `applyXxx` を実装し `simulateCardEffect` の switch に追加。`isValidCardTargetSquare` で対象マス妥当性 (王手中条件含む)。target なし (盤面非変更) は既定で可。

3. **reducer 効果分岐** (`src/hooks/card-shogi/reducer.ts` の `CONFIRM_PLAY_CARD`)
   - `def.effectId === "..."` 分岐に処理追加。1 ターンに複数 ply 消費 (二手指し系) は `state.doubleMove` パターン参照。

4. **横断制約の確認 (本丸)**
   - **新 event kind 追加時:** `src/lib/shogi/cards/types.ts` の `GameEvent` に追加 + **`src/hooks/card-shogi/undo-policy.ts` の `isCardOpEvent` を更新** (待った判定で漏れず block されるように)。
   - **複数 ply カード (1 ターンに `moveEvent` 2 つ以上) 追加時:** `getUndoScope` は同色連続を 1 ターン扱いで自動対応。`state.doubleMove` のような「ターン継続中」フラグを reducer に持つ。DB 保存スキップ (`use-card-shogi-game.ts` の save useEffect) も該当フラグを考慮。

5. **盤上背景色 (緑ハイライト) 制御の確認** (#242)
   - **要件仕様の段階で定義:** 「使用後どの盤上マスを緑 (直前アクション) にするか」を UX 観点で決める。原則「見た目が変化した盤上マス」を緑にしパッと見で作用箇所が分かるように (旧実装はカード移動で緑が出ず視認不可だった = #242)。
   - **単一情報源:** 緑は reducer の `lastActionHighlights` (`CardShogiGameStateInternal`)。各遷移の `GameEvent` から `highlightSquaresForEvents` が導出し、UI へは ShogiBoard の `lastMoveSquares` prop で渡る (`moveHistory` 末尾だけでは表せないカード由来の盤面変化に対応)。
   - **判断指針:** `cardPlayEvent` に square ターゲットを載せる型 (歩戻し/駒戻し/二歩指し) → 自動で緑 (対応不要) / 複数マス作用・target 無で特定マス変更・新 event で盤面変更 → `highlightSquaresForEvents` の分岐拡張 / 駒を除去し持駒化 (王手崩し系) → `trapTriggerEvent.capturedPieces` 等で除去位置 (既存分岐でカバー) / 盤面非変更 (mana_up・トラップセット) → 不要 (直前の緑を保持) / 複数 ply (二手指し) → 各手の軌跡を蓄積 (reducer の `doubleMove` 分岐)。
   - `handPiece` ターゲットは盤上マスでないため対象外。同一マス重複は `highlightSquaresForEvents` 側で dedupe 済。
   - **テスト:** 盤上を変えるカードは reducer 統合テストで `next.lastActionHighlights` が作用マスを含むことを 1〜2 ケース固定 (例 `reducer.test.ts` の #242 群)。影響なし (盤面非変更) は「該当なし」と PR コメントに明記。

6. **AI / 探索側の更新** (#193 / PR1a)
   - 新カードが AI の `getLegalActions` 候補に含まれるよう `src/lib/shogi/ai/turn/current-rules.ts` (or PR1d の `action-generator.ts`) を更新 (PR1a は move-only で自動 skip、PR1d の playCard 候補生成で必要)。
   - 評価関数 (cardDigest) に影響するなら `src/lib/shogi/ai/cards/digest.ts` の `CardDigest` にフィールド追加 + `evaluateCardDigest` に価値を係数で追加 (PIECE_VALUES と整合する cp 単位)。
   - AI fixture (`card-digest.test.ts` / `action-generator.test.ts`) に 1〜2 ケース、bench fixture (`perf-bench.test.ts`) に新カード保有 midgame を追加し `depthCompleted` ±10% 以内を確認。
   - 影響なし (単発で探索に組めない種類) は「該当なし」と PR コメントに明記。

7. **テスト**
   - `npm run test:ci -- src/hooks/card-shogi/__tests__/undo-policy.test.ts` が緑。効果関数のユニットテストを `effects.test.ts` に追加。複数 ply 系は reducer 統合テストも追加。

8. **prisma seed**
   - `ALL_CARD_DEFS` 経由で Card マスタ・DeckEntry・PlayerCardCollection に自動投入。既存ローカル DB 反映は `npm run db:seed`。

---

## ルールの追加・更新フロー
新たな問題・改善が出たら本ファイルをこの手順で更新する:
1. **Issue化** (`governance` ラベル、追加/変更したいルールと理由)
2. **ブランチ作成** (`{prefix}/#{Issue番号}`、prefix はルール3)
3. **AGENTS.md 更新** (本文・Why・適用 をセットで記述)
4. **PR作成・レビュー** (通常フロー)

各ルールには必ず **①本文** (何をすべき/すべきでないか)・**②Why** (理由・背景。将来のエッジ判断に必要)・**③適用 (How to apply)** (手順・適用範囲・例外) を記載する。
