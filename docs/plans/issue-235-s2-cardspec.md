# Issue #235 S2: L1 カードフレームワーク化 (CardSpec registry) — 実装計画

> 親 doc (epic SSOT): `docs/plans/issue-235-card-shogi-ai-redesign.md` (§3 L1 / §4 CardSpec/EffectSpec 詳細 / §7 S2 行 / §11 D-D)。
> 前段: S1 (L0 カーネル統合) 完了・PR #236 マージ済 (main `cad859c`)。S1 完了定義: `issue-235-s1-kernel.md §16`。
> ブランチ `refactor/#235-s2` (origin/main 起点)。本 doc は AGENTS.md ルール8 マイルストーン1 (実装着手前レビュー) の対象。

## 0. 位置づけ・ゴール / 非ゴール
S2 = L1 カードフレームワーク化。現状 1 カードが 6+ ファイルに分散 (definitions CARD_DEFS + CARD_USE_CONDITIONS +
effects applyXxx + digest/heuristics 係数 + action-generator 候補 + undo-policy isCardOpEvent + reducer/kernel 効果分岐)
している構造を、単一 `CardSpec` registry に集約する (P2/P5 解消)。

**ゴール**:
1. `CardSpec` 型 + `EffectSpec` 判別共用体 (modifyBoard/setTrap/multiPly/modifyResource) を定義し、**7 カード全てを CardSpec で表現**する registry を新設。
2. **効果適用を registry 駆動に統一**: kernel `applyCardEffectLogic` の effectId switch (S1d で集約済) を `spec.effect.apply` 一本へ置換 (P5 解消)。
3. **横断制約を registry から自動導出**: undo-policy `isCardOpEvent` / action-generator 候補生成 / checkUsage を CardSpec から導出し、族別 switch を排除。
4. CardId は **branded string + ランタイム registry** (§11 D-D 既定。型安全不足なら codegen を後続検討)。
5. serialize 境界維持: 関数を持つ registry はサーバ専用、Client へは `meta` のみ (現 CARD_USE_CONDITIONS 分離を踏襲)。

**非ゴール (S2 では触らない)**:
- **valueModel の内容依存値付け = S3** (S2 では valueModel フィールドを CardSpec に置くが、中身は現行 digest/heuristics の固定係数を呼ぶ薄いブリッジに留める。局面・コスト依存化は S3)。
- L2 TurnAction 単一探索 / TT 拡張 = S4。L3 相手モデル = S5。
- 新カード追加・カード仕様変更・マナ/レアリティ定数の値変更 (CardSystemConfig 集約は構造のみ、値は不変)。
- standard variant (カード非関与)。

## 1. 等価性の大前提 (挙動完全不変)
S2 は**振る舞いを変えない純粋リファクタ** (registry 経由でも現行と同一の効果・event・候補・undo 判定)。
- 既存テスト (reducer.test/undo-policy.test/effects.test/world-kernel-equivalence/kernel-search-equivalence/card-digest/action-generator) 全 green を**全コミットで維持**。
- bench で棋力退化なし (action 選択 / depthCompleted / cardRate)。
- 等価ゲート = 上記テスト群 + registry 出力 ≡ 現行関数出力の特性化テスト。

## 2. CardSpec スキーマ (epic §4 準拠、**M1 確定版**)
```ts
interface CardSpec {
  meta: CardMeta;                            // 関数なし = Client 送信可 (§9 A5)
  targeting: "none" | "ownPiece" | "enemyPiece" | "square";
  effect: EffectSpec;                        // 判別共用体 (CONFIRM 時の効果適用、下記)
  multiPly?: number;                         // M1: double_move 専用。effect 外の独立フィールド。
                                             //   遅延消費/flip 抑止/preFirstMoveState は reducer+kernel の
                                             //   既存 orchestration (KernelDoubleMove/finalizeDoubleMoveLogic)
                                             //   が担い、registry はメタデータ (plies) のみ保持。
  useCondition?: (world, player) => boolean; // = CARD_USE_CONDITIONS 内包 (サーバ専用)
  checkUsage: "forbidden" | "conditional" | "unconditional";
  valueModel: (gameState, player) => number; // S2 は現行 digest/heuristics 係数を呼ぶ薄い wrapper、S3 で局面依存化
  eventKind: GameEventKind;                  // undo-policy.isCardOpEvent を registry から導出 (§9 A6 派生規則)
}
// CardMeta = { id: CardId; kind: "normal"|"trap"; name; icon; cost; rarity; phase; status; relatedIssues? }
//   (description/detailDescription/useConditionDescription/addedAt は meta から除外 = §9 A6)
type EffectSpec =
  // modifyBoard: 盤面のみ変更 (持ち駒消費 consumeNormalCard と event 構築は dispatcher が汎用処理)。
  //   pawn_return/piece_return の removeNoPromoteMark 等の sideEffect は dispatcher の post-apply で処理 (§9 B3)。
  | { type: "modifyBoard"; apply: (gameState, player, target) => GameState | null } // pawn_return/piece_return/double_pawn
  // setTrap: set は registry 駆動 (applyTrapSet)。onTrigger は **S2 では未配線 stub** (型枠のみ、@deferred)。
  //   trap trigger (no_promote 成り抑止 / check_break 王手崩し) は move-effects.ts インライン温存 = Route B (§9 R-1)。
  | { type: "setTrap"; trigger: "promotion_declared" | "check_declared"; onTrigger?: (world) => WorldState }
  // modifyResource: mana_up 等。mana/draw のリソース変更を宣言的に。
  | { type: "modifyResource"; mana?: number; draw?: number }; // mana_up
```
- `meta` (関数なし) は Client 送信可。`effect.apply`/`useCondition`/`valueModel`/`onTrigger` (関数) は**サーバ専用モジュール `card-spec-server.ts` に物理分離** (§9 A5)。
- **multiPly は effect 共用体から除外** (M1 A1/A2)。double_move は applyCardEffectLogic 対象外でフラグセットのみ、遅延消費は finalizeDoubleMoveLogic という S1d 既存構造を維持し、registry はメタデータのみ持つ。
- **EffectSpec.type 別テンプレ**で新カードは type 選択 + パラメータ埋め (ビジョン⑥)。

## 3. 段階分割案 (S2a〜S2e、各段で等価ゲート green) — **M1 で妥当性検証**
S1 の a/b/c/d 同様、低リスクな additive → cutover の順で段階化:
- **S2a (additive、型 + registry skeleton)**: `card-spec.ts` 新設 = CardSpec/EffectSpec 型 + 7 カードの CardSpec データ (meta は CARD_DEFS から、effect は既存 applyXxx を包む薄い wrapper、valueModel は現行係数ブリッジ、eventKind/useCondition/checkUsage を移植)。**production 未配線**。registry 出力 ≡ 現行の特性化テスト新設。
- **S2b (effect 統一)**: kernel `applyCardEffectLogic` の effectId switch を `spec.effect.apply` 駆動へ置換 (modifyBoard/setTrap/multiPly/modifyResource)。reducer は S1d で既に applyCardEffectLogic 委譲済のため kernel 1 箇所の置換で UI/AI 両方に波及。等価ゲート green。
- **S2c (横断制約 registry 化)**: undo-policy `isCardOpEvent` を `spec.eventKind` 導出へ / action-generator 候補生成を registry クエリへ / checkUsage を spec 参照へ。族別 switch 排除。
- **S2d (cleanup)**: 旧 CARD_DEFS / CARD_USE_CONDITIONS / effects applyXxq の重複を registry へ一本化 (legacy 経路を撤去 or 薄い re-export 化)。デッドコード除去。CardId branded string 化。
- **S2e (config 集約)**: RARITY_MAX_PER_DECK / マナ定数を `CardSystemConfig` として registry 近傍に集約 (値は不変)。
- 注: §4 移行方針の「legacy wrapper で段階移行」は **7 カードを一括で CardSpec data 化 (S2a) しつつ、production 配線を S2b 以降で段階切替**することで工数とデグレリスクを分散する解釈。一括 data 化 vs カード単位 wrapper の是非は M1 で検討。

## 4. 現行構造の棚卸し (移植元マップ)
- `definitions.ts`: CardDefinition (id/kind/name/icon/cost/rarity/phase/status/effectId/targeting/relatedIssues/useConditionDescription/checkUsage) + CARD_DEFS (7枚) + CARD_USE_CONDITIONS (関数) + 定数 (MANA_CAP/DRAW_COST/AUTO_DRAW_INTERVAL/MANA_PER_TURN/MANA_FAST_BONUS) + RARITY 系。
- `effects.ts`: applyManaUp/applyPawnReturn/applyPieceReturn/applyDoublePawn/applyTrapSet/applyCheckBreak/applyTrapClear/consumeNormalCard/hasNoPromoteMark/addNoPromoteMark/removeNoPromoteMark/moveNoPromoteMark/getCheckEscapingSquares/hasSameKindTrapPlaced/simulateCardEffect/isValidCardTargetSquare。
- `kernel/world-kernel.ts`: `applyCardEffectLogic` (effectId switch、S1d で UI/AI 共通の効果適用権威) ← **S2b の主置換点**。
- `kernel/move-effects.ts`: makeMoveWithEffects (trap 発動 no_promote/check_break をインライン処理) ← setTrap.onTrigger との関係を S2b で整理。
- `undo-policy.ts`: isCardOpEvent ← S2c で eventKind 導出。
- `ai/turn/action-generator.ts` (or current-rules.ts): playCard 候補生成 ← S2c で registry クエリ。
- `ai/cards/digest.ts` / `heuristics.ts`: 固定係数 ← S2 は valueModel ブリッジで温存、S3 で置換。
- `types.ts`: CardId 手書きユニオン ← S2d で branded string + registry 導出。
- seed (`prisma`): ALL_CARD_DEFS 経由 ← registry から ALL_CARD_DEFS を導出して互換維持。

## 5. リスク (M1 確定方針を併記)
- **R-1 trap 発動の二系統 → Route B 確定 (M1)**: `setTrap` の **set のみ registry 化** (applyTrapSet)、**trigger (no_promote 成り抑止 / check_break 王手崩し) は move-effects.ts インライン温存**。理由: trigger は post-move 状態 (promote flag / isInCheck / double_move 遅延) と密結合で、`onTrigger:(world)=>WorldState` では applyCheckBreak の `capturedPieces` (effects.ts:369) を caller に返せず trapTriggerEvent を構築不能。完全 registry 化 (Route A) は move-effects 数百 LOC 改修 + DP-7 再検証を S2b に持ち込みリスク過大。`setTrap.onTrigger` は型枠のみ S2a で確保 (`@deferred`)、実配線は S3 新サブタスクへ。→ **P5 は 5/7 カードで解消、trap 2 枚は S3 へ正当に先送り**。
- **R-2 serialize 境界 → 現状の漏れを S2d で是正 (M1 訂正)**: 「現 CARD_USE_CONDITIONS 分離を踏襲」は**誤り**。現状 Client (card-view 等) / use-card-shogi-game が `isValidCardTargetSquare` 等の関数を直接 import しており分離は崩れている。S2 で `card-spec.ts` (meta-only / client-safe) と `card-spec-server.ts` (関数入り) を物理分離し、ESLint で `src/components/**`・`src/hooks/**` からの server import を禁止。registry の関数バンドルを Client に出さないことを厳格化 (是正は S2d)。
- **R-3 CardId → 手書きユニオン維持 (M1 から安全側に確定)**: M1 既定は「branded string + property-test safeguard」だが、**S2 では CardId 手書きユニオンを維持** (`Record<CardId, CardSpec>` で網羅検査を保持) を採用。理由: registry の価値 (効果/undo/候補の単一源) は CardId の型表現変更を要さず、branded string 化は compile-time 網羅検査を失う実害がある一方 S2 の機能的便益はゼロ。branded string / codegen は registry-derived ID が必要になった時点 (新カード運用 S6 等) で再検討 (park)。加えて registry 定義漏れ検出の property test (全7枚 `CARD_DEFS[id]!==undefined`) を CI 必須化。
- **R-4 valueModel ブリッジ → 採用 (M1、箱だけ作るは妥当)**: S3 で局面依存値付けを入れる interface 固定先として S2 で枠を置くのは合理的 (CardSpec を 2 度書き換え回避)。S2 の中身は現行 digest/heuristics 固定係数を呼ぶ薄い wrapper に厳格限定、シグネチャ `(gameState, player)=>number` を固定。
- **R-5 一括 data 化のデグレ → 一括採用 (M1)**: カード単位 wrapper は不採用。7 カード一括 CardSpec data 化 (S2a) + production 段階配線 (S2b〜) が工数コンパクト・rollback を S2b 単一に隔離・wrapper lifecycle 管理不要。特性化テスト (§6/§9 A6) で move-only 等価を担保。

## 6. 検証ゲート
各段で lint → typecheck → test:ci (全 green 維持) → build。S2b/S2c (production 配線変更) は bench (棋力退化なし) 追加。
registry 出力 ≡ 現行の特性化テストを S2a で新設し全段で維持。

## 7. rollback
各段 additive or 単一 cutover コミット隔離。S2b (effect 統一) が主たる production 配線変更 = `git revert` 対象。
registry は新規ファイルのため S2a は revert 安全。

## 8. S2 DoD (M1 確定反映)
- [x] **S2a** (完了・commit 予定): CardSpec/EffectSpec 型 (multiPly は effect 外 / onTrigger optional stub) + 7 カード registry data (`card-spec.ts` = meta-only client-safe / `card-spec-server.ts` = 関数)。registry SSOT helper (`getActiveCards`/`getPlayableCards`/`getValidCardIds`) 定義。CardId 手書きユニオン維持 + 全7枚 exhaustiveness property test。CARD_USE_CONDITIONS の `(world,player)` シグネチャ統一 (現3引数の cardState 未使用) を同梱。
  - **S2a 実装時の確定 (M2 反映、§10)**: 「`ALL_CARD_DEFS = registry 由来` re-export で seed bit-identical」は **S2d へ先送り** (seed.ts が CardMeta 非包含の `description`/`effectId` を必要とし、CardMeta subset から再構成不可)。S2a は **definitions.ts を SSOT 維持** + registry の meta を CARD_DEFS から射影 (`toCardMeta`)。helper は additive 提供のみ (consumer 切替は S2c/S2d)。
- [x] **S2a 特性化テスト** (§9 A6、完了 29件): meta subset 一致 / effect.apply を各 modifyBoard カードで複数 board×player×target fixture で現 applyXxx と構造一致 / eventKind 派生規則 / useCondition・checkUsage を複数 snapshot で現行一致 / valueModel は静的 stub の snapshot (現行に per-card valueModel は無く、本 stub の出力を pin)。
- [x] **S2b** (完了・commit 予定): applyCardEffectLogic の effectId switch → spec.effect.apply dispatch へ置換 (consumeNormalCard・event 構築・sideEffect removeNoPromoteMark は dispatcher 汎用処理)。**trap trigger (move-effects インライン) には触れない (Route B、DP-7 保全)**。bench 棋力退化なし (kernel-search OFF==ON 4/4・depth d4 同値、card-usage baseline 同値)。
  - **M2 (§11) で D1-1 解消済**: 当初案 (b) を採用し、`UseCondition`/`onTrigger` を card-spec-server の `import type { WorldState }` から **cards/ ローカル最小型 `CardWorldView` ({gameState, cardState})** に縮約。world-kernel が CARD_SPECS を value import する一方 card-spec-server は world-kernel を import しない = **型/runtime 循環なし**。WorldState/AiTurnState は構造的に CardWorldView へ代入可 (caller 不変)。
  - **汎用化の等価性 (§9 B3)**: modifyBoard は適用前の `pieceBefore = board[target]` 有無で returnedPiece + removeNoPromoteMark を条件発火。applyPawnReturn/applyPieceReturn は target に駒必須 (null時は早期 return) のため pieceBefore 常在 = 旧版の無条件呼び出しと一致。double_pawn は target 常に空 = 不発で旧版と一致 (M2 adversarial 検証で6カード全件確認)。
- [x] **S2c** (完了・commit 予定): isCardOpEvent を `CARD_OP_EVENT_KINDS` (registry 全カード eventKind の集合、client-safe) 導出へ / action-generator 候補生成を `CARD_SPECS` クエリ (cost/kind/useCondition/checkUsage/targeting) へ / checkUsage を spec 参照。族別ハードコード排除。reducer の checkUsage UI gate (client) は client/server 境界の論点があり **S2d 領域**として本段では CARD_DEFS のまま据置。
  - **申し送り対応済**: `isCardOpEvent` 導出時に **トラップ発動 `trapTriggerEvent` を別途合算** (CARD_OP_EVENT_KINDS は card 自身の eventKind のみ=別ライフサイクル)。`deriveEventKind` を card-spec.ts (client-safe) へ移し card-spec-server が import (重複定義解消)。検証: lint0err/typecheck/test:ci **573**(+2)/build/bench。M2 独立 adversarial で旧版と等価 (isCardOpEvent 全6 kind 真偽一致・action-generator 候補集合/順序同一)、§12 記録。
- [x] **S2d (slim、完了・commit 予定)**: serialize 境界是正 (ESLint で Client コンポーネント→card-spec-server import 禁止) + ID 一覧 consumer (deck.ts / merge.ts) を registry helper へ移行。**着手時調査で元計画 3 項目のうち 2 項目が不可/別 Issue と判明し scope 縮小 (§13、ユーザー承認済 "slim S2d")**:
  - ① `ALL_CARD_DEFS = registry 由来 re-export` → **対象外 (不可)**: `CardMeta` は説明文・effectId を意図的に除外するが seed (Card マスタ) とカタログ UI は full CardDefinition が必須。registry を full master 化する設計変更 (meta/spec 分離方針の見直し) が要るため見送り。`CARD_DEFS` は「カタログ/seed の master data 層」、registry は「behavior/spec 層 (meta は CARD_DEFS から射影)」として layered に共存 (データ重複なし)。
  - ② デッドコード除去 (`applyManaUp` 等) → **#80 の担当**: `definitions.ts:49` に「効果コード (applyManaUp) の最終撤去は #80」と明記。S2b で production 未参照化したが除去は #80 スコープ (effects.test のカバレッジ維持のため本段では残置)。
  - ③ serialize 境界 → **実施**: ESLint `no-restricted-imports` で `src/components/**` からの card-spec-server import を error 化 (probe で発火確認)。hooks (reducer 等) は world-kernel 経由で registry を必要とするため対象外 (Client 実行だが props serialize なし)。境界強制方式は `server-only` パッケージでなく eslint を採用 (reducer→world-kernel→card-spec-server の推移 import が成立しており `server-only` は Client build を壊すため不可)。
  - consumer 移行: deck.ts (VALID_CARD_IDS/playable/deprecated) と merge.ts (playable id) を `getValidCardIds`/`getPlayableCards` 経由へ (id/status のみ参照ゆえ移行可)。user-bootstrap/seed/cards-page は full CardDefinition 必要のため ALL_CARD_DEFS 維持。
- [x] **S2e (完了・commit 予定)**: CardSystemConfig 集約 (値は不変)。新規 `card-system-config.ts` (client-safe = 値のみ) に `CardSystemConfig` 型 + `CARD_SYSTEM_CONFIG` + フラット名前付き定数 10 件 (マナ/ドロー 7 + デッキ構築 3) を集約。`definitions.ts` は純 re-export、`deck-rules.ts` は内部利用のため import + re-export。**DECK_TOTAL_MAX/MIN も凝集性のため同梱 (ユーザー承認、§14)**。挙動完全不変・値 byte 等価。検証: lint0err/typecheck/test:ci 573/build。M2=セルフ + 独立 adversarial agent (§14)。
- [ ] valueModel は現行係数ブリッジ (中身は S3、構造のみ)。trap onTrigger は @deferred stub (実配線 S3)。
- [ ] 各段 lint/typecheck/test:ci/build green。段階順序 S2a→S2b→(S2c)→S2d→S2e (S2c/S2d は S2b 前提=revert 単独不可を §7 明記)。

## 9. M1 マイルストーン1レビュー反映 (計画直後、2026-06-07、AGENTS.md ルール8)
5観点 adversarial workflow (schema-coverage/staging-risk/trap-integration/serialize-cardid/scope-equivalence-doc、41 agents、26 confirmed) でレビュー。**総合判定: 計画は妥当・条件付き着手可**(アーキ不備の指摘ゼロ、全て「doc の明示不足/段階分割の詳細化」に収束)。本節で 6 決定を確定 = 反映済で S2a 着手可。

### 確定した主要設計判断 (c)
- **A1/A2 CardSpec スキーマ訂正** (§2 反映): (1) `multiPly` を effect 共用体から外し CardSpec 直下 `multiPly?: number` へ (double_move の遅延消費/preFirstMoveState は reducer+kernel の既存 orchestration が担い registry はメタのみ)。(2) `modifyBoard.apply` 返り値を `GameState|null` に (consumeNormalCard/event は dispatcher 汎用)。(3) `setTrap.onTrigger` は optional stub (@deferred)。(4) `modifyResource` 明示シグネチャ。
- **R-1 trap = Route B 確定**: set のみ registry 化、trigger はインライン温存。P5 は 5/7 解消、trap 2 枚は S3 へ先送り (capturedPieces を onTrigger で返せない構造的理由)。
- **R-5 一括 data 化採用**: 7 カード一括 (S2a) + 段階配線 (S2b〜)。カード単位 wrapper 不採用。rollback を S2b 単一隔離。
- **R-3 CardId 手書きユニオン維持** (M1 から安全側へ): branded string 化は網羅検査喪失の実害があり S2 便益ゼロのため見送り。registry は `Record<CardId,CardSpec>`。exhaustiveness property test を CI 必須化。branded/codegen は park。
- **R-4 valueModel ブリッジ採用**: S3 interface 固定先として枠を置く (中身は現行係数 wrapper)。

### 着手前に反映すべき必須事項 (a) — 本節で対応済
- **A5 serialize 漏れの訂正**: 「現状踏襲」は誤り (Client が関数を直 import = 分離崩れ)。`card-spec.ts`(meta) / `card-spec-server.ts`(関数) 物理分離 + ESLint 禁止ルール (是正は S2d)。§5 R-2 訂正済。
- **A6 特性化テスト仕様 + eventKind 派生規則を DoD 明記**: §8 反映。**eventKind 派生規則**: `mana_up/pawn_return/piece_return/double_pawn/double_move → "cardPlayEvent"` (double_move は finalize 時)、`no_promote/check_break(set) → "trapSetEvent"`、trigger は `"trapTriggerEvent"` (別ライフサイクル)。mana_up の発行 event は現 reducer を実測して合わせる。

### 実装時の注意 (b)
- **B1 S2b の trigger スコープ侵食防止**: S2b は applyCardEffectLogic 置換に限定、move-effects の trap trigger に触れない (DP-7 デグレ防止)。
- **B2 段階順序・revert 隔離**: S2a→S2b→(S2c)→S2d→S2e。S2c/S2d は S2b 前提で単独 revert 不可 (§7 明記)。CARD_USE_CONDITIONS の `(world,player)` 化は S2a 同梱可。
- **B3 sideEffect**: pawn_return/piece_return の removeNoPromoteMark は dispatcher の post-apply 条件呼び出し (registry に sideEffects 枠は足さない)。
- **B4 registry SSOT helper**: seed/orphan-guard/Client が ALL_CARD_DEFS を直読 → helper 経由へ S2c/S2d で切替、seed bit-identical test を S2d DoD。
- **B5 Client 防御レンダリング (派生軽微、同居可)**: card-view の `CARD_DEFS[id]` raw lookup は deprecate 時 NPE 懸念 → `if(!def) return <UnknownCard/>` を S2a/S2b で同居 (rule 2)。
- **B6 deferCheckBreak は外部維持**: double_move_first の trap defer は将来 onTrigger registry 化しても call site 外に残す (S3 申し送り)。

## 10. M2 マイルストーンレビュー (実装後、2026-06-07、AGENTS.md ルール8)

S2a 実装完了時点のレビュー。adversarial multi-agent workflow (6観点: equivalence / architecture / plan-conformance / additive-regression / test-quality / code-quality、各 finding を懐疑的に検証) を起動したが、**セッション上限により途中で打ち切り** (architecture 観点の検証のみ完走=確定2件、equivalence/additive-regression 観点と他観点の verifier・synthesis は未完)。打ち切り分は **main-loop セルフレビュー** で補完した (ルール8 のセルフレビュー軸)。検証実測: lint 0err / typecheck 緑 / test:ci **571 passed** (S1d 542 + 新規 29) / build 緑。production への registry import は **0件** (grep 確認 = 真に additive・未配線)。

### 総合判定
**S2a は commit/push 可 (high かつ S2a スコープ内の指摘ゼロ)**。確定 findings は 2 件で、いずれも **S2a スコープ外 (S2b/S2d 後段送り)** = S2a コード変更不要。doc への申し送りのみ実施 (§8 の各段 DoD に追記)。

### 確定 findings (adversarial 検証通過、両方とも後段送り)
- **D1-1 (architecture, medium → S2b)**: card-spec-server の `import type { WorldState }` は S2a では inert stub として最小・正当 (runtime 循環なし、`isolatedModules` で完全 erase)。ただし S2b で world-kernel が card-spec-server を value import すると **型レベル相互参照** が成立し、L1→L0 への型従属が目標アーキと逆向きになる。→ §8 S2b DoD に解消方針 (WorldState 下位移設 or ローカル最小型縮約) を S2b PR レビュー観点として追記済。
- **D1-2 (architecture, low → S2d)**: S2d 前提の ESLint 境界 (components/hooks → server import 禁止) が現 eslint.config に未整備。現状は `-server` 命名規約 + 物理分離のみで境界担保 (S2a は未配線のため挙動・安全性に影響なし)。→ §8 S2d DoD に「`server-only` パッケージは repo 既使用のため `import "server-only"` が最小コスト」を追記済 (検証者が原 finding の「server-only 未使用」の事実誤りを訂正)。

### セルフレビューで確認した未完観点 (問題なし)
- **等価性**: effect.apply は applyXxx の薄い wrapper (15 fixture deepEqual 緑) / eventKind 派生 (`deriveEventKind`) は world-kernel.ts:215-230 の発行 event と一致 (mana_up=cardPlayEvent / trap=trapSetEvent) / useCondition は現行3条件が cardState 未使用のため (world,player) wrap で等価 / meta・targeting・checkUsage は CARD_DEFS 射影。
- **additive/非デグレ**: production の registry import 0件 / card-view B5 ガード `faceDown || !def` は def 常時定義済のため挙動不変 / definitions.ts・ALL_CARD_DEFS・seed/deck/auth 経路は不変。
- **テスト品質**: 29件で成功/null/ピン/と金 unpromote/gote 対称/非square target/exhaustiveness/入力非依存を網羅。`trapTriggerEvent` の S2c 申し送りをコメント明記。
- **コード品質**: CARD_VALUE_BRIDGE は named const + 文書化 (ai/heuristics 同値だが上向き依存回避のため非 import、S3 で valueModel を SSOT 化し依存反転)。void パターンは world-kernel:350 前例と整合。未使用 export は特性化テストが exercise (デッドコードなし)。
- **計画適合**: M1 6決定すべて反映。逸脱 (ALL_CARD_DEFS re-export 先送り / meta を CARD_DEFS から派生 / valueModel ローカルブリッジ) は本 §10 / §8 で文書化・正当化済。

### 残課題 (S2a 後)
- セッション上限が解消した後 (任意)、打ち切った adversarial workflow を fresh 再実行して equivalence/additive 観点の独立検証を補強してもよい (現状はセルフレビュー + 29特性化テスト + grep で代替済)。

## 11. S2b M2 マイルストーンレビュー (cutover 実装後、2026-06-07、AGENTS.md ルール8)

S2b = `applyCardEffectLogic` を旧 effectId-switch から CardSpec registry の EffectSpec 駆動 dispatch へ置換する cutover (P5 解消、production 効果適用経路を registry 化)。reducer (S1d 委譲済) と AI (applyTurnAction) の単一権威を 1 箇所置換。

### 検証実測
- lint 0err / typecheck 緑 / test:ci **571 passed** (S2a と同数=デグレなし。等価ゲート world-kernel-equivalence / reducer / effects / kernel-search-equivalence / card-spec すべて緑) / build 緑。
- bench (RUN_PERF_BENCH): kernel-search advanced/expert **cardRate OFF=4/4 ON=4/4・action 選択 OFF==ON 一致 (piece_return/double_move/pawn_return)・depthCompleted d4==d4**。card-usage beginner 100%/intermediate 86%/advanced・expert 57% (baseline 同値)、registry 駆動の選択 (`playCard:board`/`playCard:trap`) 正常。**棋力退化なし**。

### 総合判定
**S2b は commit/push 可 (指摘ゼロ)**。独立 adversarial agent (general-purpose、27 tool uses) による等価性検証 = **cutover は旧版と byte 等価・発散点ゼロ (high/medium/low すべて 0)**。

### adversarial 検証で確認した等価性 (6カード全件)
- **dispatch マッピング**: effectId→effect.type / kind→eventKind が旧版と一致 (deriveEventKind = trap→trapSetEvent / 他→cardPlayEvent、trap は check_break/no_promote の 2 枚のみ)。
- **汎用化 (pieceBefore 方式)**: pawn_return/piece_return は applyXxx が target に駒必須 (null時早期 return) のため `ng` 非 null 時 pieceBefore 常在 → 旧版の無条件 returnedPiece + removeNoPromoteMark と一致。double_pawn は isDoublePawnLegalSquare で target 必ず空 → pieceBefore falsy で不発 (旧版一致)。不正 target は `apply` が null → pieceBefore 使用前に早期 return (旧版一致)。
- **mana_up modifyResource**: `Math.min(consumed.manaCap, consumed.mana+effect.mana=3)` = 旧 applyManaUp。**trap setTrap**: cost = spec.meta.cost = CARD_DEFS[id].cost、mana 直接減算 + applyTrapSet 経路同一、event instance owner 付与一致。**王手中ガード**: 完全一致。**double_move**: `!spec.effect` 防御 null (applyTurnAction が事前分岐で未到達、旧 `else return null` 等価)。

### D1-1 解消 (S2a M2 申し送りを本段で対応)
card-spec-server の `WorldState` 型依存を `CardWorldView` ({gameState, cardState}) に縮約 (案 b)。world-kernel→card-spec-server の value import 一方向のみ = 型/runtime 循環なし (grep 確認)。

### dead code 申し送り
`applyManaUp` (effects.ts) は本 cutover で production から未参照になるが、effects.test/reducer.test/equivalence (OBS5-3) のカバレッジ維持のため **除去は S2d**。

## 12. S2c M2 マイルストーンレビュー (横断制約 registry 化、実装後、2026-06-07、AGENTS.md ルール8)

S2c = 横断制約 (待った可否 / AI 候補生成) を CardSpec registry から導出する behavior-preserving refactor。
- **isCardOpEvent** (undo-policy.ts、client): 旧 4 条件ハードコードを `CARD_OP_EVENT_KINDS` (card-spec.ts で全カード eventKind を集約=client-safe Set) 導出 + manual drawEvent + trapTriggerEvent 別合算へ。
- **action-generator** (ai): CARD_DEFS/CARD_USE_CONDITIONS 個別参照を `CARD_SPECS[id]` クエリ (meta.cost/meta.kind/useCondition/checkUsage/targeting) へ統一。族別 switch 排除。
- **deriveEventKind**: server → card-spec.ts (client-safe) へ移設、card-spec-server は import (重複解消)。

### 検証実測
- lint 0err / typecheck 緑 / test:ci **573 passed** (S2b 571 + 新規 CARD_OP_EVENT_KINDS テスト 2) / build 緑。
- bench: kernel-search advanced/expert **cardRate OFF==ON 4/4・depth d4 同値** (決定的 bench=ロジック不変の確証)。card-usage は `cardCount>=1` sanity passed。**rate ログ変動 (beginner 86%/intermediate 100% 等) は退化ではない**: 当該 bench は C-13 で意図的に非決定化 (beginner addNoise=0.50 + wall-clock 時間予算) され strict per-scenario assert は flaky のため削除済、決定的 calibration 検証は `evaluate-action.test.ts` (test:ci に含まれ緑) へ移管済。

### 総合判定
**S2c は commit/push/マージ可 (指摘ゼロ)**。独立 adversarial agent 検証 = **旧版と挙動等価・発散点ゼロ (high/medium/low すべて 0)**。
- isCardOpEvent: 全 6 GameEvent kind で旧新真偽一致 (cardPlayEvent/trapSetEvent/trapTriggerEvent=true、manual drawEvent=true、**auto drawEvent=false**、moveEvent/manaChargeEvent=false)。CARD_OP_EVENT_KINDS = {cardPlayEvent, trapSetEvent} を全7カード deriveEventKind で確認。
- action-generator: 候補集合・yield 順序同一。spec.meta.cost/kind/checkUsage/targeting は CARD_DEFS 直写、spec.useCondition は CARD_USE_CONDITIONS を world.gameState/world.cardState へ委譲 (AiTurnState→CardWorldView 構造代入成立)。target 列挙は spec.meta.id=def.id で同一マス。
- 層/循環: undo-policy→card-spec (client-safe meta、関数非保持)、action-generator→card-spec-server (server) はいずれも正方向。新規循環なし。dead code (action-generator の CARD_DEFS/CARD_USE_CONDITIONS/CardDefinition) 除去済。

## 13. S2d (slim) レビュー (serialize 境界 + consumer 移行、実装後、2026-06-08、AGENTS.md ルール8)

着手前調査で元計画 S2d の 3 項目中 2 項目が不可/別 Issue と判明 → **ユーザー承認のもと slim S2d (③ 境界 ESLint + ID 一覧 consumer 移行) に縮小** (詳細は §8 S2d、判定理由は①不可②#80③実施)。

### 変更
- `eslint.config.mjs`: `src/components/**` からの `@/lib/shogi/cards/card-spec-server` import を `no-restricted-imports` で error 化 (serialize 境界の予防的強制)。hooks は対象外 (reducer→world-kernel 経由で必要、Client 実行だが props serialize なし)。
- `deck.ts` / `merge.ts`: ALL_CARD_DEFS 直読 → `getValidCardIds`/`getPlayableCards` (registry helper) 経由へ。deprecated = 全件 − playable で同値導出。

### 検証
- lint 0err / typecheck 緑 / test:ci (S2c 573 維持予定) / build。**境界ルールの実効性を負テストで確認**: `src/components/` 配下に card-spec-server を import する probe ファイルを置くと `no-restricted-imports` error が発火 (= no-op でない)、probe 削除済。
- consumer 移行は behavior-preserving: `getValidCardIds()` ≡ `ALL_CARD_DEFS.map(id)`、`getPlayableCards()` ≡ `ALL_CARD_DEFS.filter(status!=="deprecated")` (registry meta は CARD_DEFS 射影=同データ・同順)。deck の orphan-cleanup / merge の pristine 判定ロジックは不変。

### scope 外 (申し送り)
- ① ALL_CARD_DEFS 全廃: CardMeta に説明文/effectId を含める設計変更が前提 (meta/spec 分離見直し)。必要になれば別途検討。
- ② applyManaUp 等 dead code 除去: #80 (mana_up 効果コード最終撤去) のスコープ。
- 次: S2e (CardSystemConfig 集約、値不変)。 → **§14 で完了**。

## 14. S2e レビュー (CardSystemConfig 集約、実装後、2026-06-08、AGENTS.md ルール8)

S2e = カードシステムの散在定数を registry 近傍の `CardSystemConfig` に集約する **値不変の cosmetic refactor** (S2 最終段)。これで S2 (L1 フレームワーク化) の全段完了。

### 変更
- 新規 `src/lib/shogi/cards/card-system-config.ts` (client-safe = 関数を持たない値のみ): `CardSystemConfig` 型 (mana/draw/deck の 3 セクション) + SSOT オブジェクト `CARD_SYSTEM_CONFIG` + 後方互換のフラット名前付き定数 10 件を導出 export。確定経緯コメント (Issue #81/#130/#89、3→2 引き下げ理由、自動ドローのカウント規則等) を本ファイルへ集約保全。
  - 集約定数: `INITIAL_MANA` / `MANA_CAP` / `DRAW_COST` / `AUTO_DRAW_INTERVAL` / `MANA_PER_TURN` / `MANA_FAST_BONUS` / `FAST_THRESHOLD_MS` (旧 definitions.ts) + `DECK_TOTAL_MAX` / `DECK_TOTAL_MIN` / `RARITY_MAX_PER_DECK` (旧 deck-rules.ts)。
- `definitions.ts`: マナ/ドロー 7 定数を **純 re-export** (`export { ... } from "./card-system-config"`、ファイル内部で未使用ゆえ local binding 不要)。
- `deck-rules.ts`: デッキ 3 定数を **import + re-export** (validateDeckEntries が内部で RARITY_MAX_PER_DECK/DECK_TOTAL_MIN/MAX を使うため local binding が必要)。
- 派生修正 (同居、rule 2): 定数移設で stale 化した行番号参照コメント 3 件 (heuristics.ts:19-20 / digest.ts:37) を `card-system-config.ts` 参照へ更新 + 行番号ハードコードを除去 (今後のドリフト防止)。

### 設計判断
- **配置 = 別ファイル** (`card-spec.ts` への同居でなく): card-spec.ts は per-card meta、CardSystemConfig は system-wide config で別概念。関数を持たないため S2d の ESLint 境界 (components→card-spec-server 禁止) には抵触せず、Client から (definitions/deck-rules 経由で) 安全に参照可。
- **move + re-export 方式** (全 consumer 一括書換でなく): 既存 import (definitions 経由 29 / deck-rules 経由 3 ファイル) を一切壊さず churn 最小。値の SSOT は CARD_SYSTEM_CONFIG。
- **DECK_TOTAL_MAX/MIN 同梱** (ユーザー承認): 引き継ぎの明示スコープは RARITY_MAX_PER_DECK のみだが、同じデッキ構築上限で密接に関連するため deck セクションを完結させ凝集性を確保。値不変・追加リスクゼロ・phase 別バージョニングの目的に合致。
- **型保全**: INITIAL_MANA は旧 `Record<"sente"|"gote", number>` → `Record<Player, number>` (Player="sente"|"gote" で同一)、RARITY は `Record<CardRarity, number|null>` 維持。プリミティブはリテラル型→number 幅広化 (config 値として適切、依存 consumer なし=typecheck pass で裏付け)。

### 検証実測
- lint 0err (22 warning は既存・変更ファイル指摘ゼロ) / typecheck 緑 / test:ci **573 passed** (S2d 同数=デグレなし。DRAW_COST===2 / INITIAL_MANA 差 -1 / MANA_CAP / AUTO_DRAW_INTERVAL 挙動を直接 assert するテスト群が全緑=値等価の実証) / build 緑。

### 総合判定
**S2e は commit/push 可 (high/medium 指摘ゼロ)**。独立 adversarial agent (general-purpose) 検証 = **値 byte 等価・re-export 正当・全 consumer 解決・循環なし・型互換・ESLint 境界抵触なし・mutation 無害の 6 観点すべて発散点ゼロ**。唯一の指摘 (low: 他ファイルの行番号参照コメント 3 件のドリフト) は本段で修正済。

### S2 完了 → 次 = S3
S2e マージで **S2 (L1 カードフレームワーク化) 全段完了**。次の主段は **S3 (ValueModel の内容依存値付け = AI のカード価値評価を局面・コスト依存へ。現 valueModel は静的 stub)**。棋力直結のため bench 実測必須。epic doc §3 L1 / §11 + #193 PR3 系校正資産を参照。
