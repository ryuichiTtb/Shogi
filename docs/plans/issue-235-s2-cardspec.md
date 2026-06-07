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
- [ ] **S2a**: CardSpec/EffectSpec 型 (multiPly は effect 外 / onTrigger optional stub) + 7 カード registry data (`card-spec.ts` = meta-only client-safe / `card-spec-server.ts` = 関数)。registry SSOT helper (`getActiveCards`/`getPlayableCards`/`getValidCardIds`) 定義。`ALL_CARD_DEFS = registry 由来` の re-export で seed bit-identical 互換。CardId 手書きユニオン維持 + 全7枚 exhaustiveness property test。CARD_USE_CONDITIONS の `(world,player)` シグネチャ統一 (現3引数の cardState 未使用) を同梱。
- [ ] **S2a 特性化テスト** (§9 A6): meta subset 一致 / effect.apply を各 modifyBoard カードで複数 board×player×target fixture で現 applyXxx と構造一致 / eventKind 派生規則 / useCondition・checkUsage・valueModel を複数 snapshot で現行一致。
- [ ] **S2b**: applyCardEffectLogic の effectId switch → spec.effect.apply dispatch へ置換 (consumeNormalCard・event 構築・sideEffect removeNoPromoteMark は dispatcher 汎用処理)。**trap trigger (move-effects インライン) には触れない (Route B、DP-7 保全)**。bench 棋力退化なし。
- [ ] **S2c**: isCardOpEvent を spec.eventKind 導出 / action-generator 候補生成を registry クエリ / checkUsage を spec 参照。族別 switch 排除。
- [ ] **S2d**: 旧 CARD_DEFS/CARD_USE_CONDITIONS 重複の一本化・デッドコード除去。serialize 境界是正 (ESLint で Client→server import 禁止)。
- [ ] **S2e**: CardSystemConfig 集約 (値は不変)。
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
