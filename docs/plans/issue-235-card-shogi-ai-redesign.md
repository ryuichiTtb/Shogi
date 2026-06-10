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
| **P2** | カード価値が内容非依存のスカラー圧縮 | `CardDigest` 7フィールド (`digest.ts:34`、PR3-1 で `manaAbsolute`(死にマナ) 追加) = mana/手札枚数/draw/trap有無。各カードが盤面を何 cp 改善するか・局面/コスト依存値を持たない。トラップは固定 (`TRAP_VALUE_*`) |
| **P3** | 相手手札の隠れ情報モデルが皆無 | `cardState.hand[opponent]` が完全透視 (`state.ts` serialize、AI も参照可)。eventLog は AI に渡らず DB 非永続。相手デッキ構成は初期化後破棄 |
| **P4** | ルール/状態の二重実装と分離 | 権威 `reducer.ts` (makeMoveWithEffects/applyTurnEndEffects/二手指し/トラップ遅延) と AI 側 (`current-rules.ts`/`action-generator.ts`/`search.ts`) が独立再実装。`GameState`(盤) と `CardGameState`(マナ・手札) も分離し都度手動同期 |
| **P5** | カード追加が9〜13箇所横断の手作業 | 新カード1枚で types/definitions(+CARD_USE_CONDITIONS)/effects/reducer/undo-policy/digest+heuristics/action-generator/test/seed を手動更新 (実測 11〜13 touch point)。`effectId` 族別 switch が散在 |
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
- leaf 評価 = 盤面評価 (既存 evaluators 7成分) + **ValueModel 集約** (内容・局面依存) + **汎用評価拡張基盤 (EvalFeature registry) の拡張寄与** (状態異常 no_promote の per-piece 評価を最初の具体例に、将来要素を宣言的に差し込める。§6 item 7)。子ノードで digest 更新 (P1/P6/P7 解消)。
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
7. **汎用評価拡張基盤 (EvalFeature registry、2026-06-10 ユーザー要件追加。3観点 adversarial 検証 (code-fit 事実検証 / 性能・レイヤリング / 将来拡張性ストレステスト) 反映済)**: カード将棋は今後のエンハンスで新要素 (状態異常・新資源・盤面持続効果等) が追加され続ける。**新たな評価基準が出るたびに探索/評価コードを場当たり改修するのではなく、ゲーム要素が触れる接面を標準化し宣言的に差し込める基盤を S4 で構築する**。最初の具体例 = 状態異常 `no_promote` (成り無効化マーク: 取られる/駒戻し系で手駒復帰しない限り**永久に成れない**) の移行。

   **7.1 現状の確認済みギャップ (2026-06-10、全件実コード file:line で confirmed)**:
   - 探索木 (negamax `search.ts:323` / quiescence `search.ts:236`) は `GameState` のみ伝播 (`applyMoveForSearch` は盤+持ち駒のみ)。cardDigest は root スカラー定数 (W-1) → **リーフに「この駒は成れない」情報が物理的に届かない**。
   - リーフ評価が満額評価: マーク駒も `PIECE_VALUES` 満額 (`material.ts:39-49`)、自分が封じた相手大駒も満額の成り脅威 (`promotion-threat.ts:23-65` のファントム脅威、rook=150 等)。
   - **符号逆バグ**: `move-effects.ts:127` はマークを**封じられた被害者本人**の配列に積む (`noPromoteMarks[p]` = p 自身の成れない駒) のに、`digest.ts:135-137` は「自マーク多=有利」と +30cp/個 加算 = **自駒が封じられるほど AI が有利と誤評価** (#193 PR1d-4 由来)。
   - **幻の成り手 (事実確定)**: 着手生成3面 (`moves.ts` 幾何生成 / `legal-moves.ts:25-31` 透過 wrap / `captureGen.ts` 独自生成) + `applyMoveForSearch` の無条件成り適用 + 手順序付けの成り優遇 (`scoreMove` +50000 / `scoreMoveForOrdering` +200) が**全て mark-blind** → AI はマーク駒の幻の成り (と金 +500cp 級) を探索内で満額で読み、root 採用後に `move-effects.ts:88-90` の silent block (promote:false 矯正) で**読み筋と実盤面が乖離**する。
   - 派生: **armed (未発動) no_promote トラップ越しの成り**も探索は無視 (成り矯正+マーク付与+トラップ消費が読みに入らない)。
   - **UI/kernel のルール意味論分裂 (新発見)**: マーク駒の mustPromote マス (歩香の最奥段等) 進入は、UI (`reducer.ts:400` フィルタ) では選択不可・kernel (silent block) では不成進入 = 行き所のない駒、と挙動が割れている → **§11 D-I (ユーザー判断)**。

   **7.2 基盤設計 = 5接面の標準化** (新ゲーム要素はこの5接面に触れる。各接面に宣言点を1つずつ用意し、漏れを型+テストで強制検出):
   - **(i) 状態表現 (L0)**: 状態 slice を WorldState (`CardGameState`) に追加 (既存パターン、例 noPromoteMarks)。
   - **(ii) 状態伝播 + TT fold (L0/L2)**: S4 の WorldState 搬送探索に乗せ、**TT fold ポリシーを slice ごとに型強制で宣言**: `Record<keyof CardGameState, "fold" | "evalIrrelevant">` — 新 slice を追加すると fold 方針を書くまでコンパイルが落ちる (宣言忘れ = silent TT 誤ヒット、を型レベルで排除。「全 slice が fold or 宣言済除外」unit test も DoD)。fold 実装 = **slice 参照変化検知 + slice fold 全量再計算** (updateCardDigest パターン流用、各 slice O(small)。純 XOR 差分宣言より堅牢)。mana/drawProgress は毎 ply 変化する path-length 関数のため明示 excluded 可 (fold すると異深度 transposition が全滅し正確性向上は僅少)。マーク/トラップ/doubleMove は合法手・評価を実際に変えるため fold 必須。hand fold は **defId 多重集合**で正規化 (instanceId 混入は等価局面の transpose を永久に殺す)。**check_break 発火等「move 以外の盤面変更」ノードは incremental updateHash でなく盤面 hash 全量再計算でゲート** (kernel 戻り値 `triggeredCheckBreak` 等で検知。カード/発火ノードは稀でコスト許容 — これを欠くと incremental hash が silent に狂い TT が汚染される)。
   - **(iii) 行動生成 (二分 — 解決層を明確に分離)**:
     - ① **合法性制約 (L0)**: 「指せない」を変える状態異常 (将来の凍結系等) は WorldState-aware な着手生成 (L0 単一 predicate) に実装し、**kernel 終局判定・reducer/UI・AI 探索の三者が同一関数を共有** (三重実装分裂の構造的防止。探索内詰み判定と実ルールの乖離も防ぐ)。no_promote の成り可否 predicate もここに置き、UI フィルタ (`reducer.ts:400`) と統一。
     - ② **探索内 transform (L2)**: no_promote の幻成り対策。生成3面 (root `getLegalActions` / `getSearchLegalMoves` / `captureGen` 2関数) で「マーク駒の promote:true → **promote:false 置換** + 既存不成変種と重複時 drop」。**除去ではない** (mustPromote マスで「探索: 移動不可 / 実盤面: 不成で可能」の逆乖離が生じるため)。生成段置換なら手順序付けの幻成り優遇も自動是正される (後段フィルタ方式は順序付けに幻成りが残るため不採用)。
     - **armed トラップ越しの成りは①②の対象外**: 違法ではなく「結果が異なる」手 (トラップを意図的に消費させる価値すらある) → (ii) の WorldState×`makeMoveWithEffects` 遷移が捕捉する。
   - **(iv) 評価寄与 (L2 リーフ、3寄与型を単一 registry で合成)**:
     1. **per-piece modifier (状態異常型)**: 駒単位の価値/脅威修正。no_promote = マーク駒の成り上昇分 (`value(promotesTo) − value(type)`) 減価 + 相手マーク駒の成り脅威割引 (ファントム脅威除去)。実装は `computeMaterial` / `evaluatePromotionThreats` への引数追加 (debug 用 `evaluateWithBreakdown` と構造共有し転記2箇所を作らない)。**リーフ毎 Set 構築は禁止**: マーク空なら fast path コストゼロ (現状ほぼ常時)、非空時のみ slice 参照変化で lookup 再構築しノード帯同、マーク≦2 は O(m) インライン比較で割当ゼロ。quiescence 内のマーク追従は from/to 一致時のみ O(m) 追従、または stale 許容を明文化+テスト pin (曖昧にしない)。
     2. **global scalar (資源・経済型)**: mana/手札/drawProgress 等。**既存 CardDigest = この型のランタイムキャッシュとして一本化** (item 3「子ノードで digest 更新」は registry 駆動 `updateCardDigest` として実装、**二重機構を作らない**)。per-node 割当は per-ply 事前確保バッファで回避 (毎ノード新オブジェクトは ~100万割当/手で GC 負荷)。**`noPromoteMarkCountDelta` フィールド + `NO_PROMOTE_MARK_COEFFICIENT` は per-piece modifier 移行と同時に完全削除** (符号バグはフィールドごと消滅 = ユーザー決定の吸収方針。残すと二重計上)。
     3. **option value (盤上持続オブジェクト型)**: トラップ option value (S3 valueModel = この型として接続済)。
     - **リーフはデータ駆動** (新規関数呼び出しゼロ: digest スカラー加算 + nullable lookup 参照のみ)。registry の間接呼び出しは root セットアップ/slice 遷移時に限定 = JIT/inline 阻害を構造的に排除。
   - **(v) lifecycle (L0)**: 状態の付与・追従・消滅・時限を宣言化: `{ attachedTo: "piece"|"square"|"player", onPieceMoved: "follow"|"stay", onPieceCaptured: "remove"|"stay", onTurnEnd?: "tick"|null }`。kernel は `makeMoveWithEffects`/`applyTurnAction` の固定点で全 slice の宣言を一括実行。**現行 no_promote のインライン (move-effects.ts:109-127 の follow/capture-cleanup) を最初の移行例**とする。時限効果 (Nターンで消滅)・マス付着効果 (駒に追従しない) はこの接面で吸収 (ECS から借りるのはこの宣言型 lifecycle のみ。フル ECS 化は immutable spread + JSON serialize + イベント駆動 undo の現アーキと相性が悪く不採用)。

   **7.3 L1 接続 (CardSpec 宣言スロット)**: CardSpec に `statusEffect` (**意味論のみ**宣言、例 `{ kind: "no_promote", blocksPromotion: true }`) + `validTargets?: (world: CardWorldView, player) => CardTarget[]` (状態異常解除カード (#82 実在候補) 等「cardState を見るターゲット列挙」対応 — 現 `isValidCardTargetSquare` は GameState 止まりで宣言だけでは差し込めない) を追加。**cp 係数は ai 側 registry に置く** (L1 に cp を書くと cards→ai 逆流 or 駒価値テーブル4重化 [material/moves/ORDER_PIECE_VALUES に既に3つ]。S3 D-KS=C「cards は moves/variants プリミティブのみ」を維持)。シグネチャは `CardWorldView` ベース (型循環回避 D1-1 踏襲)、S2d ESLint client 境界の対象に新スロットも含める。

   **7.4 基盤が買うもの (正直な2階層定義 — オーバープロミス防止)**:
   - **(A) 既存 status 概念を再利用する新カード** = spec 宣言のみで (i)〜(v) 自動追従 (例: 別の駒/条件で no_promote を付与する新カード)。
   - **(B) 新しい status 概念の導入** = slice/lifecycle/fold/eval/targeting/selector の **6点は実装が必要**。基盤の価値は「コードゼロ」ではなく「**接面の宣言漏れを型 (fold 強制 Record・exhaustive check) とテストで構造的にゼロにする**」こと。(B) の6点チェックリストは S4 完了時に AGENTS.md「新規カード追加時のチェックリスト」へ反映。
   - **スコープ外 (v1 明示)**: 駒の利き/動きを変える movement 系 status は registry v1 対象外 (movement 前提が moves/captureGen/攻撃判定/評価に全域分散。`resolveEffectivePieceDef(piece, statusMarks)` 解決層の新設 = 別 epic 規模。導入時は §11 に新規判断事項として起票)。
   - 将来要素ストレステスト済: 状態異常解除カード=(iv)1+7.3 validTargets / 凍結系=(iii)① / 駒強化バフ=価値は(iv)1・movement はスコープ外宣言 / マス付着オーラ=(v) attachedTo:"square" / 動的マナ上限=(iv)2+下記負債③④ / 時限効果=(v) onTurnEnd:"tick"。

   **7.5 同時精算する既知負債 (S4 スコープ)**: ① `noPromoteMarkCountDelta` 符号逆バグ (フィールド削除で消滅) ② 幻の成り手 (7.1、(iii)②で解消) ③ `digest.manaCap` が cardState 非参照で定数 `MANA_CAP` 焼き込み (`digest.ts:82` — 動的マナ上限構想の前提是正。現行値では挙動不変) ④ `DEAD_MANA_THRESHOLD=16` の cap 比率化 (cap×0.8、cap 変動時の誤発火防止) ⑤ `world-kernel.ts:49` の TurnAction 型 ai/ import (L0→L2 型逆依存) を kernel/中立 types へ昇格 ⑥ top-K selector とセンチネル0価値カードの接続規約 (「探索で価値が創発する」解除カード等が候補選別で飢餓しない — per-piece modifier 定義から復元価値を O(marks) で機械算出し選別上界に使う)。

   **7.6 性能ゲート**: depthCompleted ±10% (§12) に加え、S4 bench に **nodes/s・TT hit-rate カウンタ**を追加 (退行時に fold 起因か eval 起因かを切り分け可能にする)。

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
| **S4** | feature | L2 TurnAction 単一探索 + TT 拡張 + **汎用評価拡張基盤** **(最重要)** | card-shogi 専用 TurnAction-negamax (standard 温存)。zobrist cardState 拡張・誤hit対策 (fold 型強制)。selector(M/K/budget)。double_move 木統合。**EvalFeature registry (§6 item 7: 5接面標準化 + 状態異常 no_promote per-piece 評価を最初の具体例に + 符号バグ/幻成り/既知負債6件の同時精算、2026-06-10 ユーザー要件)**。**S4a で実エンジンに selector を載せ M/K 再校正 → before-baseline 比 depthCompleted ±10%** (PoC-1 は same-engine 比で枝刈り余地を確認済、production 絶対比は S4a 実測) + カード使用率改善 |
| **S5** | feature | L3 相手モデル/期待値読み (超上級) | OpponentModel (ベイズ残り手札)。eventLog 伝播+永続化。相手ノード確率分岐+閾値枝刈り。超上級のみ。フェアネス (手札非透視) を test 固定。**依存 (blocking): eventLog 永続化は #193 PR1e の DB schema と協調が前提 → S5 着手条件に PR1e completion を明記** |
| **S6** | chore+feature | 仕上げ・新カード運用確立 | テンプレ化された追加フロー (AGENTS.md 更新)。phase 別レアリティ上限 config 化。exhaustive fixture。Phase A カードを新フローで1枚追加し工数・品質実証 |

> 段の粒度はトレードオフ (critique 弱点)。S4 が大きすぎる場合は **S4a 基礎探索 + S4b 最適化/校正** に分割する (PoC 結果で判断)。

---

## 8. S0 詳細 (今の作業 = PoC-first で de-risk)

critique が「方向性は正当だが理想像、PoC で実現性を先に確定すべき」と強く推奨。S0 を以下に特化。**PoC はすべて `feature/#235-poc-{n}` 独立ブランチで実装し main へマージしない (S0 完了時に破棄)。production コードは S0 では一切変更しない。** 各 PoC は seed 固定 fixture で決定的に自動計測する。

### 8.1 設計 doc 確定
本ファイル + adversarial verify + ユーザーレビュー (= 現在地)。

### 8.2 before-baseline 計測・固定 (completeness-3)
- **対象**: canonical main (`1185067`) の (a) `perf-bench.test.ts` depthCompleted(avgDepth)/nodes/elapsedMs (全4難易度・代表 midgame fixture、実装済)、(b) `perf-bench-card-usage.test.ts` カード使用率 (全4難易度 = 中級含む)。
  - **S0 是正**: `perf-bench-card-usage.test.ts` は現状 `["beginner","advanced","expert"]` のみで **intermediate が欠落**していた (PR3-3-2 レビューの「中級未測定」指摘点)。S0 で intermediate を追加 (test-only・AI 挙動不変)。
- **scope**: S0 before-baseline は **depthCompleted / nodes / card-usage の三軸**に限定。`(c) rootMoveScore 等の棋力スコア指標`は現 bench に未実装のため **S0 scope 外** (PoC-1 以降で必要に応じ `findBestMoveWithStats` の `SearchStats` を拡張)。
- **方法 (確定、standalone tsx 方式)**: 計測ハーネス `scripts/measure-baseline-235.ts` を `npx tsx` で実行し全4難易度を 3 回計測・中央値で集約。`findBestMoveWithStats` を**直接呼び**、bench fixture (`makeBenchPositions()` 9 局面 / `makeScenarios()` 7 シナリオ) のロジックを再現する。
  - **vitest parse 方式を採らない理由 (前セッションの教訓)**: ① `perf-bench.test.ts` は `test()` に timeout 未指定 (vitest 既定 5000ms) のため intermediate/advanced/expert が timeout 失敗し計測値が欠落、② vitest は合格テストの `console.log` を既定で非表示にするため値が回収不能。よって vitest 非依存の standalone tsx ハーネスで全難易度を確実計測する。
  - design ブランチ `feature/#235-design` は canonical main (`1185067`) からの **doc/script/test-only 差分**で `src/` の探索コードは同一 → design worktree での計測 = canonical main の計測 (commitSHA は計測時の HEAD を記録)。
- **保存先**: `docs/bench-results/issue-235-before-baseline.json` (commit)。以降の全段 DoD は本ファイル比で判定。**注意**: depthCompleted は time-budget 探索のため計測機 CPU 性能に依存 → 各段/PoC の ±10% 比較は同一機・同一条件で取得する。
- **計測結果 (2026-06-06、commit `414981d`、3 run median)**:

  | 難易度 | avgDepth | avgNodes | avgMs | card 使用率 |
  |---|---|---|---|---|
  | beginner | 3.00 | 2,263 | 133 | **100%** (7/7) |
  | intermediate | 5.33 | 30,877 | 1,371 | **100%** (7/7) |
  | advanced | 5.78 | 48,634 | 2,269 | **57%** (4/7) |
  | expert | 6.00 | 63,918 | 2,834 | **57%** (4/7) |

  - **再現性**: per-position depthCompleted は 3 run 間でほぼ同一 (expert で一部局面が 6↔7 の微ジッタのみ) → ±10% バンド判定に十分な安定性。
  - **示唆 (再設計の動機の実証)**: 深い move-only 探索が支配する **advanced/expert で calibration discriminator 3 シナリオ (空手札+マナ余剰/トラップのみ/終盤空手札) が全て `move` に倒れ、card 使用率 100%→57% に低下**。これは P1 (深さ非対称) + P2 (カード価値スカラー圧縮) の帰結であり、L2 単一探索木 + L1 ValueModel で是正すべき構造的非対称が定量化された。pawn_return 4 シナリオは盤面 delta が大きく全難易度で card 採用。

### 8.3 PoC-0 ルール等価 property 仕様確定 (completeness-2 / S1 前提) — **確定 (2026-06-06)**

S1 (L0 カーネル統合) の「振る舞い完全等価」を担保する **property list** を確定。reducer の全遷移面を網羅精読 (PoC-0 workflow: 7 面並列読み + 統合 + 敵対的 3 観点レビュー、11 agents) し、3 レビュアーが収束した high 論点を以下 **DP-1〜DP-7** の設計判断で解決済 (= S1 着手前の正本)。

**source-of-truth = reducer 経路** (recon 確定): AI 側 `current-rules.ts` の `applyAction` は move/double_move のみ実装 (draw/playCard は `throw`)。S1 カーネル `applyTurnAction` が一致させる正本は **reducer 経路** (`makeMoveWithEffects` reducer.ts:373 / `applyTurnEndEffects` :447 / double_move 遅延 finalize :670 / trap 遅延発火 :277-358)。

#### 8.3.1 等価フィールド分類 (must-match / must-not-match)
- **must-match (12)**: `CardGameState` の {mana, manaCap, hand, deck, graveyard, trap, noPromoteMarks, drawProgress} + 盤面 (board 駒種/owner/promoted + capturedPieces + currentPlayer + status + zobrist) + turnEnded (= currentPlayer 反転の射影) + events 列 (kind + ドメインフィールド射影、`at` timestamp 除外)。
  - **hand / deck / graveyard**: instanceId 列として**順序込み一致** (draw=末尾 append reducer.ts:1088、consumeNormalCard/applyTrapSet=filter 除去 effects.ts:455/419、いずれも stable)。
  - **trap**: `{instanceId,defId,owner}` 値一致 (両プレイヤー独立スロット)。
  - **noPromoteMarks**: → **DP-5 で {row,col} 集合一致に確定**。
- **must-not-match (= 射影から除外)**: `pendingCard` (UI 確認/ターゲット選択の中間状態、適用完了後は null)、`lastTurnStartedAt` (Date.now() 起点・DB 往復で null・早指し判定用)、`isDrawing`/`pendingDrawSource`/`isPlayingCard`/`pendingPlayCardOpponent`/`isCheckBreakAnimating` (演出オーケストレーション flag)、`selectedSquare`/`legalMoves` 等 UI 状態、`undoSnapshots`/double_move スナップショット (UNDO 層責務)、全 event の `at` (Date.now())。

#### 8.3.2 アクション別 property (事前→事後) 要点
- **move (通常)**: board=applyMove / mana[player] += 1 (+1 早指し、DP-4 で fastMove=false 固定) clamp / noPromoteMarks=取得駒マーク削除+自駒 from→to 追従 (drop 型は不変) / drawProgress は applyTurnEndEffects 経由 (DP-1) / 相手 trap 発火時のみ trap[opp]=null + trapTriggerEvent / turnEnded=true。
- **draw (手動)**: 事前=deck 非空 ∧ mana≥DRAW_COST(2) ∧ 自手番 ∧ 非王手。deck 先頭 pop→hand 末尾 append (instanceId 保持) / mana -=2 / drawProgress は DP-1 / events=[drawEvent{source:manual}] / turnEnded=true。
- **playCard:modifyBoard (pawn_return/piece_return/double_pawn)**: board=effect 適用 / hand=使用カード除去 (+返却駒を持ち駒加算) / mana -=cost / **graveyard=使用カード末尾 append** / noPromoteMarks=対象マスのマーク削除 (pawn/piece_return) / events=[cardPlayEvent{returnedPiece}] / turnEnded=true。
- **playCard:setTrap (no_promote/check_break)**: trap[player]=設定 / hand=除去 / mana -=cost / **graveyard=不変 (DP-3)** / events=[trapSetEvent] (cardPlayEvent ではない) / turnEnded=true。王手中は checkUsage='forbidden' で BEGIN 拒否。
- **double_move (DP-2、マルチ ply)**: CONFIRM=doubleMove フラグ set のみ (mana/hand/graveyard **不変**=消費遅延) / 1手目=board 変化・mana チャージなし・drawProgress 加算なし・currentPlayer 反転戻し (turnEnded=false)・check_break は defer / 2手目=board 変化・defer check_break 発火・finalize で consumeNormalCard (mana-=cost, hand→graveyard, cardPlayEvent) (turnEnded=true)。
- **turnEnd (applyTurnEndEffects 共通基盤)**: drawProgress[player]=current+1、`next≥AUTO_DRAW_INTERVAL(5) ∧ deck 非空` で 0 reset + 自動ドロー (deck pop→hand append, drawEvent{source:auto}) **1 回のみ (非再帰、DP-1)** / mana/manaCap/trap/noPromoteMarks/graveyard 不変 / 終局後 (status≠active) は全スキップ。

#### 8.3.3 解決済み設計判断 (openQuestions → 確定。S1 実装の入力)
- **DP-1 (drawProgress、最重要)**: カーネルは **reducer セマンティクス (遅延+条件付き)** を正本とする。`applyTurnAction` は手番終了時に `applyTurnEndEffects` 相当で drawProgress を +1 し、5 到達 ∧ deck 非空でのみ 0 reset + 自動ドロー 1 回。AI 既存経路 `applyActionForLookahead` の「全 action 即時 +1・reset なし」(PR3-3 C-12 近似) は**カーネルが S1 で解消する既知の差異** (継ぎはぎの近似を正す = 再設計の効用)。等価テストは reducer semantics で assertion 固定。
- **DP-2 (double_move スコープ)**: カーネルは double_move を **マルチ ply アクション** (`isTurnTerminating` で 1手目 turnEnded=false) として **applyTurnAction 内に統合**。消費は 2手目 finalize に遅延 (reducer 準拠)。現 AI の別系統 `searchDoubleMoveSuperAction` は S4 で単一探索木に吸収 (= double_move 特別扱い廃止、§6)。PoC-0 等価テストでは CONFIRM→move→move→finalize の複合列として検証。
- **DP-3 (保存則)**: カード総数保存則は **hand+deck+graveyard+trap スロット = 一定**。通常カード=hand→graveyard、トラップ=hand→trap[player] (graveyard に入らない)。素朴な hand+deck+graveyard 保存則は trap を取りこぼすため、経路別に assertion を分ける。
- **DP-4 (決定論化)**: 等価テストは **spectatorMode=true 固定 + Date.now() を固定 clock に stub**。これで早指しボーナス無効 (fastMove=false 確定) かつ event `at` 再現。**manaChargeEvent は events 射影から除外し、mana 値一致で代替検証** (演出寄りイベント + fastMove 依存を避ける)。
- **DP-5 (noPromoteMarks)**: 等価は **{row,col} 集合一致** (reducer の配列順は push/filter/map の実装由来の人工物で意味的不変量でない)。
- **DP-6 (manaCap)**: 現状 **不変** (reducer 内代入なし、`mana_up` は deprecated)。must-match に定数として含める。**将来カードで manaCap 動的化する場合は本 property list を更新する** (§11 D-F と連動、要 guard)。
- **DP-7 (check_break 発火範囲)**: `applyCheckBreak` は `getCheckingPieces` で**発動時点で直接王手している駒のみ**除去し、開き王手 (遮蔽が破れて露出) は次手番に委ねる。カーネルもこの「直接王手駒のみ」を再現 (board.ts `getCheckingPieces` 実装を S1 で再確認)。

#### 8.3.4 property-based テスト設計 (S1 で実装、本 doc が雛形仕様)
- **generator**: seed 済み WorldState から、各ステップで現手番の合法 TurnAction (`getFullLegalMoves` + `canDraw`?draw + `getCardActions`) を列挙 → seeded PRNG で 1 つ選択 → reducer 経路 (BEGIN→[SELECT]→CONFIRM→COMMIT / DRAW→COMMIT / MAKE_MOVE) と カーネル `applyTurnAction` の両方に同一 action を適用。double_move は複合列に展開。10〜40 手 × 数百〜数千 seed。**決定論化=DP-4**。
- **射影 (equivalenceProjection)**: §8.3.1 の must-match 12 を抽出 (hand/deck/graveyard=順序込み、noPromoteMarks=集合、events=kind+ドメイン射影 `at` 除外、manaChargeEvent 除外)、must-not-match を捨象。比較は「アクション適用完了後の安定状態」のみ (中間 phase は比較しない)。
- **assertion**: 各適用後に両経路の射影が deep-equal / mana∈[0,manaCap] / 保存則 (DP-3) / trap 発火後 trap[opp]=null ∧ trapTriggerEvent / drawProgress 5 到達で 0 reset + deck-1/hand+1 / turnEnded=false 手 (double_move 1手目) で currentPlayer 不変 / events 射影列順序一致 (特に double_move の [move,move,(trapTrigger),cardPlay])。
- **seed すべきエッジケース**: 自動ドロー発火境界 (drawProgress=4→5)、山札空ドロー禁止、manaCap 飽和、両者異種トラップ同時保有、double_move 中の check_break defer→2手目発火、double_move 1手目で詰み成立、捕獲駒の no_promote マーク削除、pawn_return/piece_return での removeNoPromoteMark、終局手直後の turnEnd スキップ、double_pawn で持ち駒歩 1 枚→配置後 0。
- **不変ゲート併用**: reducer.test/undo-policy.test/effects.test green を S1 全コミットで維持。
- **provenance**: 機械可読 property map 全文 (フィールド別 reducer 引用 + 3 レビュアーの gap 指摘) は PoC-0 workflow 出力に保存。本 §8.3 はその確定要約 = S1 実装の直接仕様。実テストは applyTurnAction カーネル新設と同時に S1 で author (現時点ではカーネル不在のため runnable test は作らない = dead code 回避)。

### 8.4 PoC (実現性ゲート) — 合否基準を operationalize
- **PoC-1 探索枝刈り (R-1 最大リスク)**: 独立 PoC で `selectBranchCandidates(actions, depth, M, K)` (move 上位M + card 上位K + draw) を試作し、難易度別 `M/K/budget` を振って depthCompleted を計測。
  - **合否バンド**: **同一プロトタイプ内 move-only control 比** (bare-αβ の engine 効率交絡を相殺) で **±10% 以内=合格** / ±10〜20%=要再試行 / ±20% 超=不合格 → フォールバック: (i) S4 目標を「depthCompleted −X% 許容 + カード使用率 +Y%」へ再定義、(ii) **S4 を S4a(基礎探索)/S4b(最適化・校正) に分割**、(iii) カード深掘りを playCard のみ・浅 budget に限定。**before-baseline (production) 絶対比は bare-αβ プロトタイプでは到達不可 (ALL=production の 64-67%) のため fidelity 参照に留め、production ±10% は S4a で実エンジンに selector を載せて再検証する** (PoC-1 adversarial verify 反映)。
  - 起点参考: parked C-2 実測「フル盤面 budget=3 ≈ 130万 evaluate (枝刈りなし)」。枝刈りで K=1〜2 がどこまで圧縮できるかを表で提示。
- **PoC-2 ValueModel (R-5)**: `pawn_return`(modifyBoard 型) と `check_break`(setTrap 型) の `valueModel(world, player)` を試作。検証=「簡潔な関数で内容・局面依存値付けが可能か / 条件分岐が増殖しないか」。trap は「相手が trigger を踏む確率 × 被害 cp」の期待値関数の実現性を確認。**modifyBoard 型と setTrap 型の両系統**をカバー (単一カード種では不足、PoC-2 拡張)。
- **PoC-3 TT cardState ハッシュ (R-2)**: cardState 6要素を fold した 32-bit hash を試作し、(a) 衝突率 (b) 既存 move-only TT のヒット率悪化 を小規模盤面で測定。card-aware ノードの保守的 store 方針の妥当性も確認。

### 8.4.5 PoC 実測結果 + adversarial verify (2026-06-06、結論)
3 PoC を独立ブランチ (`feature/#235-poc-{1,2,3}`) で実装・実測し、結果と私 (実装者) の解釈を **4 観点 adversarial workflow** で検証。下記は**指摘 (mustFix 4) を是正・honest caveat を反映した確定結論**。生データは `docs/bench-results/issue-235-poc{1,2,3}.json`、コードは各 poc ブランチ。

| PoC | 結論 | 実測の核心 |
|---|---|---|
| **PoC-1 探索枝刈り (R-1)** | **CONDITIONAL PASS** | 同一プロトタイプで move-only(ALL)/ top-M(TOPM)/ +card(CARD) を切替計測。**同一 M=10 での card on/off (CARD-M10-K2 vs TOPM-10) = 91-97%** → カード追加 (K=2+draw) の純コストは **3-9% (±10%内)**。move-cap M が深さの主レバーで、TOPM が ALL 比 120-125% と深く読める余裕も確認。**→ 分岐爆発 (R-1) は制御可能**。ただし下記 caveat により production 絶対 ±10% は S4a で再検証。 |
| **PoC-2 ValueModel (R-5)** | **PASS (構造的実現性)** | modifyBoard 型 (eval差分) と setTrap 型 (P_trigger×E_damage) の **2 関数で 5 カード全実測被覆**。check_break が安全玉 **-25cp** / 露出玉 **+230cp** と局面依存に変動 (固定 `TRAP_VALUE_CHECK_BREAK=80` を脱却)。pawn_return/piece_return/double_pawn も局面で変動。**→ 固定スカラーの内容・局面依存化は簡潔関数で実現可能**。 |
| **PoC-3 TT hash (R-2)** | **PASS (board+fold次元)** | cardState (mana/手札種別カウント/trap/drawProgress) を XOR fold した hash で、Part A: 同一盤面×64 cardState を board-only=1個 (誤ヒット) → card-aware=64個 (分離)。Part B: 15,159 distinct states で **衝突 0 / 断片化 1.001 (再現確認済)**。TT_SIZE 不変 = メモリ影響なし。**→ board+fold 次元の誤ヒットは解消可能**。 |

**adversarial verify 反映 (mustFix 是正済)**:
- PoC-1 合否基準を「same-engine control 比 ±10%」に明文訂正 (§8.4 / §7 S4 行 / §12)。doc 旧記述「before-baseline 比 ±10%」は bare-αβ では測れないため fidelity 参照に降格、production ±10% は S4a へ。
- PoC-3 を seeded deck (シャッフル排除) + DP-1 auto-draw reset 化し再現性確保。「誤ヒット完全解消」→「board+fold次元の解消」に限定 (deck 順未 fold)。
- PoC-2 に piece_return 実測を追加 (claim を実測に整合)。

**honest caveats (S4 以降の前提)**:
1. **PoC-1 fidelity**: プロトタイプは bare-αβ (TT/LMR/quiescence/LMR 非搭載) で ALL 絶対深さ (advanced/expert ≈ 3.9) は production before-baseline (5.78/6.0) の **64-67%**。same-engine 比は交絡相殺として妥当だが、**production の LMR/TT が既に soft 枝刈りするため M/K 最適値が同値転移する保証はない** → **S4a で実エンジンに selector を載せ M/K を再校正してから S4 粒度・目標を確定** (PoC-1 結論は「枝刈り余地が存在する」まで)。
2. depthCompleted は time-budget 探索で計測機 CPU 依存 → ±10% 比較は同一機・同一条件で取得 (§8.2)。
3. **PoC-2 係数は仮値**: setTrap 係数 (E_damage/P_min/max/SAFETY_*) は PoC 仮値で、-25↔+230 の差は係数選択に依存。本採用値は **S3 bench 校正**まで未確定。no_promote の trigger は自玉露出度を流用しており (check_break は妥当)、相手成り脅威指標への分離を S3 検討。「局面依存になった」ことは棋力向上の証明ではない (S3 bench で別途評価)。valueModel の per-target eval コストは selection で bounded 化要 (PoC-1 と同じ selector コスト論点)。
4. **PoC-3 deck 順未 fold**: 同一 fold・異 deck の 2 状態は同一 TT エントリ → draw 後に分岐が異なる残存誤ヒット。S4 で card-aware ノードの保守的 store (depth 制限/verify 強化) で対応。fragmentation 1.001 は random playout が transposition を過小サンプリングした下界で、実探索では上がりうる → S4 で TT instrument 搭載探索で実測。
5. **baseline calibration e/f/g** は AI が move に倒れる「再設計の動機の実証 (regression indicator)」であり control 値ではない。S1 改善後の before/after 比較では canonical main が e/f/g で本来取るべき手を別途固定し、改善と baseline 不具合解消の交絡を避ける。

### 8.5 S1 リスク準備 — rollback + feature-flag 設計 (completeness-12)
L0 統合 (reducer/AI が単一カーネル `applyTurnAction` に委譲) は最大の technical risk のため、段階統合・test isolation・差し戻し手順を S0 で確定する。

#### 8.5.1 feature-flag 設計 (additive + 影 + 段階切替)
- **カーネルは既存経路を消さず additive に新設**。最終 cutover まで production の振る舞いは旧経路が支配。
- **AI 探索側**: config フラグ `useKernelSearch` (既定 OFF) で「既存 engine」⇔「カーネル委譲 engine」を切替。OFF = PR3-3 完了時点の振る舞い完全保持。card-shogi のみ対象、standard は分岐に入れない。
- **reducer (UI) 側 (2026-06-07 lean 改訂で shadow-assert 不採用)**: カーネルを reducer の**実装裏側**に置き、reducer は薄いラッパに後退する方針は維持。ただし移行中の **shadow-assert モードは廃止**。理由: S1a の property-based 等価テスト (reducer dispatch ≡ applyTurnAction を数千局面で検証済) が等価担保の主目的を達成済で、throwaway な二重計算コードを production reducer に入れる価値が小さいため。reducer の薄ラッパ化 (各演出フェーズが kernel building-block を呼ぶ委譲) は S1d cutover で一括実施し、等価は property test + reducer.test/undo/effects + 演出オーケストレーション統合テストで担保する。
- **standard variant**: カーネル分岐に一切入れず byte-level 不変 (§12 不変ゲート)。

#### 8.5.2 段階統合 (S1a〜S1d、各段で不変ゲート green) — **S1 全段完了 (2026-06-07)**
> **S1 完了**: S1a/S1b/S1c/S1d すべて完了・push 済。L0 カーネルが reducer/AI の単一権威として採用済 (P4 解消)。
> 完了の定義・S2 引き継ぎは `docs/plans/issue-235-s1-kernel.md §16` を正本とする。次段 = S2 (L1 CardSpec registry)。
1. **S1a**: `WorldState` 型 + `applyTurnAction` を**新規モジュールとして追加** (production 未配線)。§8.3.4 の property-based 等価テストを同時に author し green 化。reducer.test/undo-policy.test/effects.test は不変。
2. **S1b**: AI 探索を `useKernelSearch` フラグ裏で配線 (既定 OFF)。bench で旧経路と depthCompleted/カード使用率比較。
3. **S1c (lean 改訂)**: `makeMoveWithEffects` (+ `MakeMoveMode`) を reducer.ts → 新規 lib モジュール `src/lib/shogi/kernel/move-effects.ts` へ**物理移設のみ** (reducer は import して従来どおり直接呼ぶ、ロジック無改変)。world-kernel (lib) → reducer (hooks) の暫定逆依存を解消。**挙動完全不変・純粋リファクタ**。shadow-assert は廃止。reducer.test/undo-policy.test/effects.test/property 等価テスト green を維持。
4. **S1d (cutover)**: 等価テスト + bench green 確認後に単一コミットで ① reducer を kernel building-block へ委譲 (薄ラッパ化、shadow-assert なし) ② 既定をカーネルへ flip (AI: `useKernelSearch` ON)。S1c で reducer ロジックは未変更のため、reducer 振る舞いを変える cutover は本段に隔離される。等価は property test + reducer.test/undo/effects + 演出オーケストレーション統合テストで担保。

#### 8.5.3 rollback 手順 (多層)
- **第1層 (無コード)**: 不具合時は **フラグを OFF に戻すだけ**で旧経路へ即時復帰 (S1d 後も flag は残置)。
- **第2層 (git)**: S1a/S1b は additive (新規ファイル + フラグ既定 OFF)、S1c は production 振る舞い不変の純粋リファクタ (関数の物理移設のみ、reducer ロジック無改変)。production 振る舞いを変える cutover は **S1d の単一コミットに隔離** → `git revert <S1d-cutover>` で旧経路復帰。各コミットは atomic・reversible。
- **第3層 (test gate)**: reducer.test/undo-policy.test/effects.test + property-based 等価テストを cutover の blocking gate に。1 つでも赤なら cutover しない。
- **test isolation**: 等価テストは旧 reducer 経路 vs カーネル経路を同一ランダム TurnAction 列で並走し must-match 射影 (§8.3.1) を deep-equal 比較。DP-1〜7 を seed 済みエッジケースで固定。

> **AI 評価系との整合 (DP-2 由来の留意)**: double_move をカーネルのマルチ ply に統合する際、現 AI の `searchDoubleMoveSuperAction` / cardDigest 近似 (cost を digest 側で扱う) との整合は S1b/S4 で個別調整する。S1 の等価ゲートは **reducer 経路との一致**を担保し、AI 評価系の数値変化は bench (棋力ゲート) で別途監視する。

### 8.6 S0 完了の定義 (DoD)
- [x] before-baseline 計測完了・`docs/bench-results/issue-235-before-baseline.json` に保存 (§8.2、2026-06-06)
- [x] PoC-0 property list 確定 (§8.3、DP-1〜7 + property-based テスト設計、workflow 11 agents)
- [x] PoC-1/2/3 完了・各合否判定 (§8.4.5、adversarial verify 反映: PoC-1 CONDITIONAL PASS / PoC-2・3 PASS)
- [x] S1 実装計画 + rollback 手順を doc 化 (§8.5、feature-flag + 段階統合 S1a〜d + 多層 rollback)
- [x] PoC 結果に基づき S4 を S4a/S4b 分割確定 (§8.4.5 / §7 S4 行)。S2-S6 の数値目標は各段 plan doc で operationalize (本 epic doc はアーキ + S0 確定層)
- [x] **本設計 doc 確定 = ユーザー承認済 (2026-06-07)**。S0 PoC de-risk をユーザー承認 (「承認とします」)、S1 着手指示を受領。レビュー依頼コメントは不要との指示。AGENTS.md ルール8 マイルストーン2 (実装後レビュー相当) は adversarial workflow で実施済。

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
| **D-I** | no_promote マーク駒の mustPromote マス進入のルール正解 (2026-06-10 発見、§6 item 7.1) | 現状 **UI と kernel で意味論が分裂**: UI (`reducer.ts:400` フィルタ) = 進入不可 (マーク歩の最奥段行きは唯一の生成手 promote:true がフィルタされ選択不能)、kernel (`move-effects.ts:88-90` silent block) = 不成進入 = **行き所のない駒**が成立。**推奨 = (a) 進入自体を非合法化** (本将棋の「行き所のない駒」原則と整合し UI 現挙動を正とする。kernel/着手生成も WorldState-aware predicate (§6 7.2 (iii)①) で統一)。代替 (b) = 不成進入許容 (kernel 現挙動を正とし UI フィルタを緩める)。S4 (iii) 実装前にユーザー確認 |

---

## 12. 検証方針 (de-risk ゲート)

- **S0 PoC ゲート**: PoC-1/2/3 の結果で「実現可能か」を判定。±10% が無理なら目標棋力 or 段粒度を見直し (理論でなく実測で決める)。
- **不変ゲート**: 全段で standard variant byte-level 不変 + reducer/undo/effects テスト不変。
- **棋力ゲート**: depthCompleted ±10% (PoC は same-engine control 比で確認、S4a で実エンジン→before-baseline 絶対比を再校正)。多面指標 (棋力 variance / phase別カード使用率 / undo 堅牢性) も併用 (critique 指摘、単一指標を避ける)。
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
- **S0 recon 反映 (2026-06-06)**: 設計 doc のコード参照を canonical main (`1185067`) で網羅再検証 (6 エージェント)。P1〜P7・#193 引き継ぎ資産は全て verified、parked 用語 (`evaluateActionDeep`/`scanOpponentResponse`/`cardSearchBudget`) は main に不在を確認。軽微訂正: ① `CardDigest` は 6→**7 フィールド** (`manaAbsolute`、§1 P2)、② カード横断は 9→**実 11〜13 箇所** (§1 P5)、③ `perf-bench-card-usage` に **intermediate を追加** (欠落是正、§8.2)、④ rootMoveScore は **S0 scope 外** = 三軸に確定 (§8.2)、⑤ PoC-0 等価の source-of-truth は **reducer 経路** (AI 側 `current-rules` は draw/playCard 未実装=throw、§8.3)。

- **S0 PoC 実装 + adversarial verify 反映 (2026-06-06)**: before-baseline 計測 (§8.2) + PoC-0 property list workflow (§8.3、11 agents、DP-1〜7) + PoC-1/2/3 独立ブランチ実装・実測 (§8.4.5) を完了し、PoC 結果と実装者解釈を 4 観点 adversarial workflow で検証。high 指摘 4 件を是正: ① **PoC-1 合否基準を「same-engine control 比 ±10%」に訂正** (旧「before-baseline 比」は bare-αβ で測定不可、production 絶対比は S4a へ。§8.4/§7/§12)、② PoC-3 を seeded deck + DP-1 auto-draw reset 化し再現性確保 + 「board+fold次元の解消」に限定 (deck 順未 fold)、③ PoC-2 に piece_return 実測追加、④ honest caveat (bare-αβ fidelity 64-67% / PoC-2 係数仮値 / PoC-3 deck順・transposition 過小サンプリング / baseline calibration は regression indicator) を §8.4.5 に明記。検証 synthesis 判定: **S1 着手は条件付きで正当化可** (3 大リスク R-1/R-5/R-2 が方向として実現可能、S1 は探索コア S4 と独立に着手可)。S4 は PoC-1 の production 転移を S4a で再検証してから粒度確定。

> 残 medium/low (各段 DoD の数値バンド詳細等) は S0 PoC 確定後に各段の plan doc で operationalize する方針 (本 epic doc はアーキ + 決定 + S0 を確定する層)。棄却なし (43/43 確定だが検証は寛容傾向のため、本反映は実装影響のある指摘に重点)。

---

## 付録: 調査の根拠 (10 agents)
本 doc は「8領域の現状調査マップ + 設計提案 + 敵対的検証」の統合。各領域の patchSeams/visionGaps と提案の coreProblems/phasedPlan、critique の gaps/feasibilityConcerns/recommendations を反映済。詳細ログは session workflow 出力に保持。
