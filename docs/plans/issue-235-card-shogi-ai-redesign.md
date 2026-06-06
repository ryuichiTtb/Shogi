# Issue #235: カード将棋 AI 土台再設計 — 設計ドキュメント (単一情報源)

> 本ドキュメントはカード将棋 AI 土台再設計の **単一情報源 (single source of truth)**。
> 多エージェント徹底調査 (10 agents) + 設計提案 + 敵対的検証の統合結果。各段階の実装はここを参照する。

## 0. 文書管理

| 項目 | 内容 |
|---|---|
| epic Issue | [#235](https://github.com/ryuichiTtb/Shogi/issues/235) カード将棋AI 土台再設計 |
| 親 (AI強化 epic) | [#193](https://github.com/ryuichiTtb/Shogi/issues/193) — 探索・評価再設計部分を本 epic が引き取る |
| 共通レビュー観点 | [#109](https://github.com/ryuichiTtb/Shogi/issues/109) |
| 起点 | `origin/main` = `1185067` |
| 本 doc ブランチ | `feature/#235-design` (worktree `.claude/worktrees/issue-235-design`) |
| ステータス | **S0 起草中 (実装着手前、adversarial verify + ユーザーレビュー待ち)** |

> #193/#235 自動クローズ注意: コミット/PR で `fix: #193` 形式を使わない (GitHub クローズキーワード)。`feat:` は安全、PR 本文は `Refs`。

---

## 1. 背景・現状 (なぜ土台から作り直すか)

現状の card-shogi CPU は「**強い通常将棋エンジン (move-only negamax + αβ/TT/killer/history/LMR/quiescence) を不変に保ち、カードを root に薄く後付け**」した二重構造。多エージェント調査で確認した根本問題:

| # | 根本問題 | 実体 (path) |
|---|---|---|
| **P1** | 探索の深さ非対称・二重探索 | move は深さN本物探索 (`search.ts:322` negamax)、card/draw は `engine.ts` root の別系統 (`evaluateActionWithLookahead`、`search.ts:1115`) が並走。相手応答は常に move-only 1-ply (`getOpponentResponseScore`)。※ parked ブランチ `feature/#193-pr3-3-2` は本経路を `evaluateActionDeep`(budget再帰)に拡張済だが未マージ・本再設計で L2 に吸収 |
| **P2** | カード価値が内容非依存のスカラー圧縮 | `CardDigest` 6スカラー (`digest.ts:34`) = mana/手札枚数/draw/trap有無。各カードが盤面を何 cp 改善するか・局面/コスト依存値を持たない。トラップは固定 (`TRAP_VALUE_*`) |
| **P3** | 相手手札の隠れ情報モデルが皆無 | `cardState.hand[opponent]` が完全透視 (`state.ts` serialize、AI も参照可)。eventLog は AI に渡らず DB 非永続。相手デッキ構成は初期化後破棄 |
| **P4** | ルール/状態の二重実装と分離 | 権威 `reducer.ts` (makeMoveWithEffects/applyTurnEndEffects/二手指し/トラップ遅延) と AI 側 (`current-rules.ts`/`action-generator.ts`/`search.ts`) が独立再実装。`GameState`(盤) と `CardGameState`(マナ・手札) も分離し都度手動同期 |
| **P5** | カード追加が9箇所横断の手作業 | 新カード1枚で types/definitions(+CARD_USE_CONDITIONS)/effects/reducer/undo-policy/digest+heuristics/action-generator/test/seed を手動更新。`effectId` 族別 switch が散在 |
| **P6** | TT が cardState 非対応 | `zobrist.computeHash` は GameState のみ。同一盤面・別 cardState で誤キャッシュ |
| **P7** | 時間軸価値が反映されない | PR3-3 C-6 で root の 1-ply lookahead は per-action digest 更新済 (`updateCardDigest`) だが、**深部 negamax/quiescence ノードは root scalar digest 固定**。「N手後に自動ドロー発火」「相手が王手なら check_break 価値UP」等の多手 (N>1) 時間軸価値を捕捉不可 |

> **参照スナップショット**: 上表の path/関数は canonical main (`1185067`、PR3-3 マージ済) 時点。`evaluateActionDeep`/`scanOpponentResponse`/`cardSearchBudget` は parked ブランチ `feature/#193-pr3-3-2` のみの拡張で main には無い (混同回避)。

**実測の裏付け** (parked ブランチ `feature/#193-pr3-3-2` C-2/C-3、main 未マージ): 深掘り (`evaluateActionDeep` budget=1) を入れると、上級でカード使用が 57%→0% に**悪化**。深く読むほど「move-now + card-later ≈ card-now + move-later」で同点化し move を優先 = カードを後回し。これは「カードを一律・固定で粗く評価」している (P2) ことの帰結であり、継ぎはぎの深掘りでは解決しない。**S0 で before-baseline を canonical main (PR3-3) 上で改めて計測**し、PR3-3 単体のカード使用率を基準にする (この 57%→0% は parked 深掘りの結果であり main の現状ではない)。

---

## 2. ビジョン (再設計のゴール = ユーザー要件)

1. **カードのカタログ/データモデル化**: どんなカードがあり何ができコストいくらか等のコア情報を CPU 理解可能な単一構造化データ/フレームワークに。新カード追加・調整はそこを更新するだけ (工数削減・品質担保・テンプレ化)。
2. **自分・相手の手札を踏まえた判断** (相手手札は隠れ情報)。
3. **メタ認知/推測**: 相手の使用履歴 → 残りに何があり得ないか。ランク別投入上限 → 既使用枚数から残り推定。
4. **カード込みの多手読み**: カード使用・ドロー・駒移動を同列に多手先まで探索。各カードを内容・コスト・局面依存で正しく値付け。
5. **ルール改修/新カード/調整のたびに土台から見直せる構造** (継ぎはぎ修正を脱却)。
6. **重要部分のデータモデル化・フレームワーク化・テンプレート化で将来エンハンスに強く**。

---

## 3. 目標アーキテクチャ (4層)

カード将棋を「駒+マナ+手札カード+トラップ+ドローを含む単一世界状態上の**不完全情報ゲーム**」として再定義し、4層に再編する。

### L0 — ルール/状態カーネル (単一権威)
- **`WorldState` = `GameState`(盤) + `CardGameState`(マナ/手札/山札/墓地/trap/drawProgress/noPromoteMarks/lastTurnStartedAt) を統合した不変更新可能な純粋状態。**
- 唯一の遷移関数 `applyTurnAction(world, action, rules): { world, events, turnEnded }`。**reducer (UI) も AI 探索もこの同一カーネルを呼ぶ** (P4 解消)。reducer は薄い UI ラッパに後退。
- 既存 `TurnRules` 抽象 (`turn/types.ts`) をカーネルの差替点に活用。`isTurnTerminating` で二手指し等のマルチ ply を表現。
- **ビジョン⑤** を満たす: ルール改修は L0 の遷移定義1箇所。

### L1 — カードフレームワーク (宣言 + ハンドラ登録)
- 各カードを単一 **`CardSpec`** に集約し registry 登録 (詳細 §4)。
- 新カードは `CardSpec` を1つ書くだけで効果適用・候補生成・undo判定・AI値付け・seed が registry 経由で自動追従 (P2/P5 解消)。
- **ビジョン①⑥** を満たす。

### L2 — 不完全情報探索エンジン (TurnAction が一級市民)
- move/draw/playCard を区別しない**単一の探索木**。negamax を `WorldState × TurnAction` に拡張し、αβ/TT/killer/history/LMR/quiescence をカード込みで効かせる (詳細 §6)。
- leaf 評価 = 盤面評価 (既存 evaluators 7成分) + **ValueModel 集約** (内容・局面依存)。子ノードで digest 更新 (P1/P6/P7 解消)。
- **ビジョン④** を満たす。

### L3 — 相手モデル/メタ認知 (不完全情報)
- **`OpponentModel`**: 相手の公開デッキスペック (レアリティ別枚数 + `RARITY_MAX_PER_DECK`) + 使用履歴 (eventLog) + ルール上限 → **相手残り手札のカード別存在確率**をベイズ推定 (詳細 §5)。
- 探索の相手ノードで期待値 minimax。**手札の中身は覗かない (フェア)**。
- **ビジョン②③** を満たす。超上級で有効化 (= 旧 PR3-4)。

### 横断
`WorldState`/`CardSpec`/`ValueModel`/`OpponentModel` はすべてデータモデル化・テンプレート化。ルール改修・新カード・調整は「スキーマ値編集 + bench 校正」で完結。standard variant の扱いは §11 D-B で決定。

---

## 4. カードデータモデル/フレームワーク (L1 詳細)

### 現状の分散 (1カードが6ファイル以上に散在)
`definitions.ts` CARD_DEFS (メタ) + `CARD_USE_CONDITIONS` (関数) + `effects.ts` applyXxx 群 + `digest.ts`/`heuristics.ts` (固定係数) + `action-generator.ts` (候補) + `undo-policy.ts` isCardOpEvent + reducer CONFIRM 分岐。CardId は手書きユニオン (`types.ts`)。

### 目標: 単一 `CardSpec` registry
```
interface CardSpec {
  meta: { id, kind: 'normal'|'trap', name, icon, cost, rarity, phase, status, relatedIssues };
  targeting: 'none'|'ownPiece'|'enemyPiece'|'square'; // 将来 'multiTarget'
  effect: EffectSpec;          // 判別共用体 (下記)
  useCondition?: (world, player) => boolean;          // = CARD_USE_CONDITIONS 内包 (サーバ専用)
  checkUsage: 'forbidden'|'conditional'|'unconditional';
  valueModel: (world, player, opp?: OpponentModel) => number; // cp、内容・局面・コスト依存 (P2 解消)
  eventKind: GameEventKind;    // undo-policy.isCardOpEvent を registry から自動導出
}
type EffectSpec =
  | { type: 'modifyBoard'; apply: (world, player, target) => WorldState | null }   // pawn_return/piece_return/double_pawn
  | { type: 'setTrap'; trigger: 'promotion_declared'|'check_declared'; onTrigger: (world)=>WorldState } // no_promote/check_break
  | { type: 'multiPly'; plies: number }                                            // double_move
  | { type: 'modifyResource'; mana?: number; draw?: number };                      // mana_up 等
```
- `simulateCardEffect`/applyXxx/reducer CONFIRM 分岐をこの `effect.apply` 一本に統合 (P5 解消)。
- **CPU 理解可能性**: AI は registry を単一窓口にクエリ (cost/targeting/effect種別/valueModel)。族別 switch を排除。
- **テンプレ化**: `EffectSpec.type` 別の雛形 (modifyBoard/setTrap/multiPly/modifyResource) を用意。新カードは type 選択 + パラメータ埋めで雛形生成 (ビジョン⑥)。
- **CardId**: registry から codegen で型生成 or branded string + ランタイム registry (§11 D-D で方式決定)。
- **serialize 境界**: 関数を持つ registry はサーバ専用、Client へは `meta` のみ送る (現 `CARD_USE_CONDITIONS` 分離の理由を踏襲)。
- **系統定数**: `RARITY_MAX_PER_DECK` / マナ定数を `CardSystemConfig` として registry 近傍に集約し phase 別バージョニング可能化 (§11 D-F)。

### 移行方針 (critique R3)
**完全置き換えでなく段階移行**: 新規カード (Phase A 以降) のみ `CardSpec`、既存7カードは当面 legacy wrapper で旧構造を包む → 新 schema の成功を実証してから既存カード移植。一括移植の工数とデグレリスクを分散。

---

## 5. 相手モデル / メタ認知 (L3 詳細)

### 現状: 皆無
`cardState.hand[opponent]` 完全透視、negamax は盤面のみ、eventLog は AI 非伝播・DB 非永続、相手デッキ構成は破棄。`RARITY_MAX_PER_DECK` (`deck-rules.ts`: common/rare=無制限, super_rare=10, epic=4) はデッキ編成時のみ参照。

### 目標 OpponentModel
**情報源パイプライン (新設が前提):**
1. **eventLog の AI 伝播 + 永続化**: cardPlayEvent/drawEvent に turn/timestamp 付与、`ai-move/route.ts` で cardState と共に engine へ。`GameMove.moveData` か独立テーブル (#193 PR1e と統合、§11 D-E)。
2. **相手デッキ公開スペックの伝播**: 対局開始時に相手デッキの「レアリティ別枚数 + 上限」を AI へ (**手札の中身は渡さない = フェア**)。

**推定エンジン (ベイズ的):**
- 初期分布 = 相手デッキ公開スペックから各カードの保有確率の事前分布。
- 逐次更新: eventLog から「使用済/墓地 = 確定除外」「ドロー = 未知1枚追加 (山札残で条件付け)」「ランク上限から残り可能枚数を制約」を反映し `P(opponent holds card c)` を維持。
- **軽量近似** (critique R7): 全分布保持はメモリ過大。(a) カード別 marginal 確率 + (b) 主要脅威カード (check_break/double_move) の保有確率のみ精密保持。

**探索への組込み (S5、超上級):**
- L2 探索の相手ノードで相手の playCard/draw を確率重みで分岐し期待値 minimax。例「相手が check_break を p% 持つなら自分の王手プランの期待値を割引」。
- **αβ が期待値ノードで効かない既知課題** → 上位脅威カードのみ branch + 確率閾値枝刈り。S0 PoC で実効性を実測 (critique F5/R7)。
- 低〜中難易度は OpponentModel を使わず弱さ維持、超上級のみ有効化。

### フェアネス (critique R10, §11 D-H)
現状 AI が相手手札を透視している構造的不公正 (`digest.handValueDelta` も相手手札枚数使用) を是正。AI が使うのは「公開スペック + 履歴 + ルール上限」からの確率推定のみ。**遮断の時期**は D-H で決定。

---

## 6. 探索コア (L2 詳細)

### 目標: カード込み多手読み単一探索木
1. **単一探索木**: negamax を `WorldState × TurnAction` に一般化。各ノードの候補 = `getLegalTurnActions(world, player)` = 全 move + (許可深さで) draw + playCard。move/draw/playCard を同列に最大化 → 「カード使う→相手応答→自分の続き→…今は安全だからドロー」を同じ木で多手評価。
2. **ターン制御**: `turnEnded` フラグで二手指し等の同色マルチ ply を player 反転抑止 (現 super-action を木に統合、`double_move` 特別扱い廃止)。
3. **評価**: leaf = 盤面評価 (既存7成分) + ValueModel 集約。子ノードで cardState 遷移ごとに digest 更新 (P7 解消)。
4. **TT**: zobrist を cardState 込みに拡張 (`hashLo ^ digestHash`、mana/手札カウント/trap/drawProgress を 32-bit ハッシュ化)。同一盤面・異 cardState の誤 hit 解消 (P6)。card-aware ノードは保守的 store。
5. **爆発抑制** (最重要、critique F4/R5): ノード分岐を **move 上位 M (`scoreMoveForOrdering`) + カード候補 top-K + draw** に selector で絞る。難易度別 maxDepth/budget/M/K で棋力差。深さ予算超過は findBestMove 既定 move へフォールバック (既存 deadline 流用)。**S0 PoC で「±10% を実現する M/K/budget が存在するか」を先に確定** (C-2 実測 budget=3≈130万 evaluate を起点)。
6. **相手カード**: 既定は相手 move-only (性能安全)。超上級のみ OpponentModel の確率分布で相手 playCard/draw を期待値展開 (S5)。

### 移行戦略 (critique R9, F6)
一気に置換せず: (a) card-shogi 専用 TurnAction-negamax を既存 move-only negamax と**並走** (standard は触らない) → (b) bench で depthCompleted/棋力を旧経路と比較 → (c) 優位確認後に engine root 統合切替。standard は当面既存 negamax 温存 (二重保守期限は §11 D-B)。

---

## 7. 段階計画 (S0〜S6)

各段で Issue #109 観点レビュー3マイルストーン (計画直後/実装後/マージ前)、standard byte-level 不変、bench ゲートを適用。ブランチは `feature/#235-{slug}` を `origin/main`/親ブランチ起点、worktree 分離。

| 段 | prefix | ゴール | 主要 DoD |
|---|---|---|---|
| **S0** | docs/chore | 設計確定 + before-baseline + **PoC de-risk** | 本 doc 確定 / 現状の棋力・性能・全難易度カード使用率を before 計測 / PoC: (a)探索枝刈り±10%可否 (b)ValueModel 1-2カード試作 (c)TT cardState ハッシュ衝突/ヒット率 → **「実現可能か」を判定** |
| **S1** | refactor | L0 状態/ルールカーネル統合 | `WorldState`+`applyTurnAction` 新設、reducer/AI がカーネル委譲。reducer.test/undo-policy.test/effects.test 不変 (property-based 等価)。standard byte-level 不変 |
| **S2** | refactor+feature | L1 カードフレームワーク化 | `CardSpec` registry + EffectSpec。既存7カード移植 (legacy wrapper 経由の段階移行可)。CardId codegen。effects/reducer分岐/undo を registry 駆動 |
| **S3** | feature | L1 内容依存値付け | ValueModel でカードを局面・コスト依存に。固定係数 (TRAP_VALUE_* 等) 脱却。digest は集約キャッシュへ。bench で旧評価比較・校正 |
| **S4** | feature | L2 TurnAction 単一探索 + TT 拡張 **(最重要)** | card-shogi 専用 TurnAction-negamax (standard 温存)。zobrist cardState 拡張・誤hit対策。selector(M/K/budget)。double_move 木統合。before-baseline 比 depthCompleted ±10% + カード使用率改善 |
| **S5** | feature | L3 相手モデル/期待値読み (超上級) | OpponentModel (ベイズ残り手札)。eventLog 伝播+永続化。相手ノード確率分岐+閾値枝刈り。超上級のみ。フェアネス (手札非透視) を test 固定。**依存 (blocking): eventLog 永続化は #193 PR1e の DB schema と協調が前提 → S5 着手条件に PR1e completion を明記** |
| **S6** | chore+feature | 仕上げ・新カード運用確立 | テンプレ化された追加フロー (AGENTS.md 更新)。phase 別レアリティ上限 config 化。exhaustive fixture。Phase A カードを新フローで1枚追加し工数・品質実証 |

> 段の粒度はトレードオフ (critique 弱点)。S4 が大きすぎる場合は **S4a 基礎探索 + S4b 最適化/校正** に分割する (PoC 結果で判断)。

---

## 8. S0 詳細 (今の作業 = PoC-first で de-risk)

critique が「方向性は正当だが理想像、PoC で実現性を先に確定すべき」と強く推奨。S0 を以下に特化。**PoC はすべて `feature/#235-poc-{n}` 独立ブランチで実装し main へマージしない (S0 完了時に破棄)。production コードは S0 では一切変更しない。** 各 PoC は seed 固定 fixture で決定的に自動計測する。

### 8.1 設計 doc 確定
本ファイル + adversarial verify + ユーザーレビュー (= 現在地)。

### 8.2 before-baseline 計測・固定 (completeness-3)
- **対象**: canonical main (`1185067`) の (a) `perf-bench.test.ts` depthCompleted/nodes (全4難易度・代表 midgame fixture)、(b) `perf-bench-card-usage.test.ts` カード使用率 (**全4難易度 = 中級含む**)、(c) 代表局面の棋力指標 (rootMoveScore 等)。
- **方法**: `RUN_PERF_BENCH=true` で 3 回計測し中央値。
- **保存先**: `docs/bench-results/issue-235-before-baseline.json` (commit)。以降の全段 DoD は本ファイル比で判定。

### 8.3 PoC-0 ルール等価 property 仕様確定 (completeness-2 / S1 前提)
S1 (L0 カーネル統合) の「振る舞い完全等価」を担保する **property list** を S1 着手前に固定:
- 等価対象: `applyTurnAction` 後の `WorldState` が既存 reducer 経路と {盤面 zobrist, mana, hand 構成, deck, graveyard, trap, drawProgress, noPromoteMarks, turnEnded, events 列} で一致。
- 等価が**許容されない**箇所 (演出 flag・タイムスタンプ等) を明示。
- 検証手段: reducer.test/undo-policy.test/effects.test を不変ゲート + property-based (ランダム局面列で reducer 経路 vs カーネル経路の状態一致)。

### 8.4 PoC (実現性ゲート) — 合否基準を operationalize
- **PoC-1 探索枝刈り (R-1 最大リスク)**: 独立 PoC で `selectBranchCandidates(actions, depth, M, K)` (move 上位M + card 上位K + draw) を試作し、難易度別 `M/K/budget` を振って depthCompleted を計測。
  - **合否バンド** (before-baseline 比、複数 run の統計): **±10% 以内=合格・S4 着手** / ±10〜20%=要再試行 (M/K 再調整) / **±20% 超=不合格** → フォールバック: (i) S4 目標を「depthCompleted −X% 許容 + カード使用率 +Y%」へ再定義、(ii) S4 を S4a(基礎探索) / S4b(最適化・校正) に分割、(iii) カード深掘りを playCard のみ・浅 budget に限定。
  - 起点参考: parked C-2 実測「フル盤面 budget=3 ≈ 130万 evaluate (枝刈りなし)」。枝刈りで K=1〜2 がどこまで圧縮できるかを表で提示。
- **PoC-2 ValueModel (R-5)**: `pawn_return`(modifyBoard 型) と `check_break`(setTrap 型) の `valueModel(world, player)` を試作。検証=「簡潔な関数で内容・局面依存値付けが可能か / 条件分岐が増殖しないか」。trap は「相手が trigger を踏む確率 × 被害 cp」の期待値関数の実現性を確認。**modifyBoard 型と setTrap 型の両系統**をカバー (単一カード種では不足、PoC-2 拡張)。
- **PoC-3 TT cardState ハッシュ (R-2)**: cardState 6要素を fold した 32-bit hash を試作し、(a) 衝突率 (b) 既存 move-only TT のヒット率悪化 を小規模盤面で測定。card-aware ノードの保守的 store 方針の妥当性も確認。

### 8.5 S1 リスク準備 (completeness-12)
S0 完了条件に「S1 実装計画 + rollback 手順 + feature-flag 設計レビュー完了」を含める (L0 統合は最大の technical risk のため、段階統合・test isolation・差し戻し手順を先に用意)。

### 8.6 S0 完了の定義 (DoD)
- [ ] 本設計 doc 確定 (adversarial verify 反映 + ユーザー合意)
- [ ] before-baseline 計測完了・`docs/bench-results/issue-235-before-baseline.json` に保存
- [ ] PoC-0 property list 確定
- [ ] PoC-1/2/3 完了・各合否判定 (特に PoC-1 の ±10% 実現可否で S4 粒度・目標値を確定)
- [ ] S1 実装計画 + rollback 手順を doc 化
- [ ] PoC 結果に基づき S1-S6 の DoD/粒度/目標値を本 doc に確定反映

---

## 9. #193 との関係・引き継ぎ

`#193` (AI 棋力強化 epic) の **探索・評価エンジン再設計部分を本 epic #235 が引き取る**。

| #193 項目 | 状態 | 本 epic での扱い |
|---|---|---|
| PR3-1 校正 (getDrawValue/トラップ/死にマナ/handValue) | main マージ済 | **再利用** → L1 ValueModel の出発点 (内容・局面依存へ進化) |
| PR3-2 `updateCardDigest` | main マージ済 | **再利用** → L2 ノード別 digest キャッシュ |
| PR3-3 1-ply lookahead + 校正回帰テスト + honesty 修正 | main マージ済 | lookahead 機構は L2 に**置換**。テスト・修正は**継承** |
| PR2 evaluators 分割 / cardDigest (PR1d) | main マージ済 | **再利用** → L2 leaf 盤面評価 / ValueModel 集約キャッシュ |
| **PR3-3-2 深掘り** (`feature/#193-pr3-3-2`) | 進行中・逆効果 | **park** (L2 に吸収。マージしない、§11 D-A) |
| **PR3-4 相手期待値モデル** | 未着手 | **= L3 OpponentModel** に正式統合 (S5) |
| PR1e 棋譜DB schema | 未着手 | **連携** → L3 の eventLog/相手デッキ永続化と統合 (§11 D-E) |
| PR4 データ投入 / PR5 Vercel Pro / PR6 NNUE | 未着手 | #193 に**据え置き** (NNUE は将来 L1/L2 拡張点) |

捨てるのは「逆効果の深掘りパッチ (PR3-3-2)」のみ。校正・評価器・digest・相手モデルの意図はすべて新土台に乗る。

---

## 10. リスクと対策 (敵対的検証反映)

| # | リスク | 対策 |
|---|---|---|
| R-1 | **S4 候補爆発** (C-2 実測 budget=3≈130万 evaluate) | S0 PoC-1 で M/K/budget の±10%実現可否を**先に確定**。難易度別 selector。深さ予算超過は findBestMove 既定 move フォールバック。根拠なき「枝刈りで解決」を避ける |
| R-2 | **TT cardState 拡張の誤hit/メモリ/ヒット率低下** | S0 PoC-3 で衝突率・ヒット率測定。card-aware ノードは保守的 (upper) store。4M entries のメモリ予算 (Vercel) 再評価 |
| R-3 | **S1/S2 の広範囲リファクタでデグレ** (二手指し/トラップ遅延/undo/自動ドロー) | reducer.test/undo-policy.test/effects.test を不変ゲート。property-based で振る舞い完全等価検証 (property リストを S1 着手前に明文化、critique R2) |
| R-4 | **OpponentModel 誤推定で超上級が弱体化/不自然** | S0/PoC で小規模実証。主要脅威カードのみ精密の近似。bench で旧 expert と棋力比較必須 |
| R-5 | **ValueModel 校正難航・bench flaky 再来** | 決定的 unit test + sanity-only bench に分離 (PR3-3 C-13 方針踏襲) |
| R-6 | **standard variant 二重保守の恒久化** | §11 D-B で統合期限を明記。L0 カーネル設計時に standard 互換層/分岐層を明示 |
| R-7 | **工期の順序依存・長期化** | S0 で段粒度・DoD を確定。S4 を S4a/S4b 分割可能に。PoC で目標値を現実化 |
| R-8 | **フェアネス (相手手札透視) が S5 まで残る** | §11 D-H で早期遮断するか決定 |

---

## 11. 未決事項 (ユーザー判断、私の推奨つき)

| ID | 論点 | 推奨 |
|---|---|---|
| **D-A** | PR3-3-2 の扱い | **park** (マージしない)。深掘りは逆効果・L2 に吸収。確定済 (ユーザー Q1 回答で「新方針に乗せる」方針) |
| **D-B** | standard variant 最終形 | **当面は既存 negamax 温存 (card-shogi のみ新エンジン)**。対策: (1) L0 設計時に standard 互換層 interface を明示 (variant 駆動の条件分岐を集約)、(2) **S2-S3 完了時点で「standard 統合タスク」を評価 Issue 起票し S5-S6 着手条件に明記** (恒久二重保守の期限化)、(3) 全段 DoD に standard byte-level 不変を固定 (§12) |
| **D-C** | OpponentModel 精度・有効化難易度 | 主要脅威カードのみ精密 + 超上級のみ有効化 (= 旧 PR3-4)。上級含めるかは S5 bench で判断 |
| **D-D** | CardId/registry の codegen 方式 | branded string + ランタイム registry を既定 (ビルド複雑度低)。型安全が不足なら codegen を S2 で検討 |
| **D-E** | eventLog 永続化先 | #193 PR1e と統合し**独立テーブル** (遡及・分析・PvP 見据え)。DB schema 変更を伴うため S5 着手時に PR1e と協調 |
| **D-F** | レアリティ上限バージョニング | `CardSystemConfig` の config で runtime 切替 (DB schema 不変) を既定。頻繁な試験変更に強い |
| **D-G** | 移行のリスク許容度 | big-bang 不可。S0-S6 段階 + 各段 DoD (depthCompleted ±10%, カード使用率目標) を PoC 結果で確定 |
| **D-H** | フェアネス是正の時期 | S1-S2 中間で「相手手札を探索入力から早期遮断」を推奨。移行設計: (1) `anonymizeOpponentHand()` で探索入力から相手手札中身を除去 + 「AI が相手手札中身を入力に使わない」を assert する test fixture を先に作成、(2) 現評価の `handValueDelta` 等が相手手札枚数に依存する箇所を「公開情報 (枚数は可視) のみ」に整理し透視前提を段階的に剥がす |

---

## 12. 検証方針 (de-risk ゲート)

- **S0 PoC ゲート**: PoC-1/2/3 の結果で「実現可能か」を判定。±10% が無理なら目標棋力 or 段粒度を見直し (理論でなく実測で決める)。
- **不変ゲート**: 全段で standard variant byte-level 不変 + reducer/undo/effects テスト不変。
- **棋力ゲート**: before-baseline 比 depthCompleted ±10%。多面指標 (棋力 variance / phase別カード使用率 / undo 堅牢性) も併用 (critique 指摘、単一指標を避ける)。
- **フェアネス test**: AI が相手手札の中身を探索入力に使っていないことを test で固定 (S5、D-H 早期なら S1-S2)。
- **必須チェック** (AGENTS.md ルール6): 各段 lint→typecheck→test:ci→build。bench は `RUN_PERF_BENCH=true`。

---

## 13. 設計 doc adversarial verify 反映 (4観点 / 47 agents / 43 確定)

初稿に対し doc 検証 workflow (忠実性/決定/PoC充足/完全性) を実施し反映:
- **忠実性 (F-001 high)**: 初稿が parked ブランチ用語 `evaluateActionDeep`/`scanOpponentResponse`/`cardSearchBudget` を「現状」として参照していた誤りを訂正 → canonical main は `evaluateActionWithLookahead`/`getOpponentResponseScore` (§1 + 参照スナップショット明記)。
- **P7 明確化 (F-002)**: PR3-3 C-6 は 1-ply root で per-action digest 更新済、深部ノードは固定 = 多手時間軸が未捕捉、と正確化。
- **実測の出典 (F-015)**: 57%→0% は parked 深掘りの結果であり main の現状でない旨を明記、before-baseline を main で再計測 (§8.2)。
- **PoC 具体化 (PoC-1/完全性群)**: §8 を S0 として全面具体化 — PoC は独立ブランチ・production 不変、PoC-1 合否バンド (±10/20%) + フォールバック、PoC-0 property list、before-baseline 仕様 (保存先)、PoC-2 を modifyBoard+setTrap 両系統に拡張、S1 rollback 準備、S0 DoD 明文化。
- **決定補強 (D-B/D-H high)**: standard 統合の期限化 (S2-S3 で評価 Issue 起票)、フェアネス移行の具体手順 (anonymizeOpponentHand + test fixture)。
- **依存明記 (completeness-8)**: S5 が #193 PR1e (eventLog 永続化) に blocking 依存。

> 残 medium/low (各段 DoD の数値バンド詳細等) は S0 PoC 確定後に各段の plan doc で operationalize する方針 (本 epic doc はアーキ + 決定 + S0 を確定する層)。棄却なし (43/43 確定だが検証は寛容傾向のため、本反映は実装影響のある指摘に重点)。

---

## 付録: 調査の根拠 (10 agents)
本 doc は「8領域の現状調査マップ + 設計提案 + 敵対的検証」の統合。各領域の patchSeams/visionGaps と提案の coreProblems/phasedPlan、critique の gaps/feasibilityConcerns/recommendations を反映済。詳細ログは session workflow 出力に保持。
