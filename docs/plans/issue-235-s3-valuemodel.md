# Issue #235 S3: L1 ValueModel 内容依存値付け — 実装計画

> 親 doc (epic SSOT): `docs/plans/issue-235-card-shogi-ai-redesign.md` (§3 L1/L2 / §4 ValueModel / §7 S3 / §8.4.5 PoC-2 caveat / §9 PR3 引き継ぎ / §12 棋力ゲート / §13 F-001 用語注意)。
> 前段: S2 (L1 CardSpec registry) 完了・PR #237〜#241 マージ済 (main `e955d47`)。S2 完了定義: `issue-235-s2-cardspec.md §8/§14`。
> ブランチ `feature/#235-s3` (origin/main 起点)。本 doc は AGENTS.md ルール8 マイルストーン1 (実装着手前レビュー) の対象。
> スコープ: ユーザー承認の **「絞込型」** (2026-06-10)。**M1 adversarial レビュー反映済 (§9)**。

## 0. 位置づけ・ゴール / 非ゴール
S3 = L1 ValueModel の内容依存値付け。**S0〜S2 は全て挙動不変の土台整備だったが、S3 は CPU の棋力 (カード選択) を実際に変える最初の段**。現状トラップ2枚の価値が固定係数 (`TRAP_VALUE_CHECK_BREAK=80` / `TRAP_VALUE_NO_PROMOTE=50`) で局面非依存。これを局面依存の ValueModel へ置換する。

**ゴール (絞込型、epic §7 S3 行)**:
1. **トラップの ValueModel を局面依存化**: PoC-2 実証済の `P_trigger × E_damage` モデルを `card-spec-server.ts` の valueModel に実装し、固定係数 `TRAP_VALUE_*` を脱却する。**対象カードは §9 D-NP の決定に従う** (check_break は確定、no_promote は指標問題があり要決定)。
2. **依存反転 (valueModel を SSOT 化)**: AI のトラップ評価を静的 `TRAP_VALUE_*` / `CARD_VALUE_BRIDGE` 参照から `spec.valueModel(...)` 経由へ cutover。`cards/ → ai/` 上向き二重定義 (S2 で温存) を解消。
3. **bench 校正**: PoC-2 仮係数 (E_damage / P_min / P_max / SAFETY_*) を bench + 決定的 unit test で本採用値に確定。棋力退化なし (§12 多面指標) を実証する。

**非ゴール (S3 では触らない、絞込型で確定)**:
- **盤面系カード (pawn_return / piece_return / double_pawn / double_move) のコスト依存値付け**: 現状 `CARD_VALUE_BRIDGE` で 0 値、盤面 eval / super-action 探索が間接捕捉。S4 (L2 単一探索) で自然吸収するため S3 では現状維持 (valueModel=0 は「別経路で捕捉=ここでは加算しない」のセンチネル、§5 L-3)。
- **digest 集約キャッシュ化** (epic §7): L2 探索木の子ノード digest 更新と密結合のため S4 へ。S3 は root per-action 経路 (`evaluateActionWithLookahead`) の現構造を維持。
- **trap onTrigger の registry 配線** (S2 R-1 `@deferred` stub): 効果適用 (capturedPieces 返却) の話で valuation とは別概念。S3 valuation には不要。別サブタスク (effect 完成) として分離・申し送り。
- **深い探索内のカード読み**: PR3-3-2 深掘りは逆効果 (advanced/expert 57%→0%) で **park 済 (epic §11 D-A)**。S3 は root 経路のみ、深掘り方向に進まない。
- **ValueModel 第3引数 `opp?`** (epic §4): 相手モデル = S5。
- L2 単一探索/TT = S4、L3 相手モデル = S5、新カード運用 = S6。

## 1. 挙動変化の整理 (S3 は意図的に棋力を変える)
S0〜S2 と異なり **S3b/c は意図的にカード価値評価を変える** (棋力向上狙い)。
- **UI / ゲームルール = 不変**: valueModel は AI 探索専用。reducer / world-kernel / ルール判定には非関与 (これらは effect.apply / useCondition を使うが valueModel は読まない)。
- **AI のカード選択 = 変わる**: トラップの価値が局面依存になり、安全玉では低く (使い渋り)、自玉露出時は高く (積極使用) 評価される。狙い = advanced/expert の構造的なカード使い渋り (57%) の一因である **P2 (価値スカラー圧縮)** を緩和する。
- **棋力ゲート (§6)**: depthCompleted ±10% + phase別カード使用率 + 決定的 unit test の相対順序。**「局面依存になった ≠ 棋力向上」** (epic §8.4.5 caveat 3) を踏まえ bench で別途実証する。

## 2. ValueModel スキーマ・呼び出し点 (S2 枠からの確定、M1 反映)
- S2 現状: `valueModel: (gameState: GameState, player: Player) => number` (静的 stub = `staticValueModel`、引数 void)。
- **S3 (絞込型): シグネチャ維持** `(gameState, player) => number`。
  - 理由: トラップ king-exposure モデルは `gameState.board` のみ必要 (cardState / mana 不要)。cost は `spec.meta.cost` で別途扱い、AI 側 mana 会計 (`applyActionForLookahead`) が既に反映するため valueModel はコストを引かない (gross 値を返す、§5 R-1 で二重計上回避)。epic §4 の `opp?` は S5、cardState 拡張は必要時に後段。最小シグネチャ churn。
  - valueModel は **gross なカード効果価値 (cp、player 視点の正値)** を返す。sente 絶対視点への符号付け (sente trap = +, gote trap = -) は **AI 呼び出し側 (digest 計算)** で行う。
- **呼び出し点 (M1 H-1/H-2 反映、最重要)**: 現 production のトラップ価値は `digest.trapPresence` (defId) を `evaluateTrapPresence` が `TRAP_VALUE_*` 固定値へ変換する間接経路。**digest は GameState を保持しないため、局面依存 valueModel を効かせるには digest 計算へ GameState を供給する**。S3b では `computeCardDigest` / `updateCardDigest` に **gameState を引数追加** し、トラップ項を `trapPresence` (defId) → **valueModel で算出した cp 値 `trapValueDelta`** へ置換する (§3 S3b、approach (i))。これにより「**既設トラップの持続価値も局面依存で保たれる**」(approach (ii) の「set 時1回加算+digest除去」は持続価値を失うため不採用、§9 H-1)。

## 3. 段階分割 (S3a〜S3c、additive→cutover、M1 反映)
S1/S2 同様、低リスクな additive → cutover の順:
- **S3a (additive、production 未配線)**:
  - **D-KS = C 確定 (§9)**: card-spec-server が `lib/shogi/moves` プリミティブ (`findKing` / `isSquareAttackedByFast` 等) で **自前の軽量 king-exposure 指標**を計算する (ai/ への上向き依存を作らない。`cards/ → moves` は `cards/effects.ts` で既に確立済の正方向依存)。
  - `card-spec-server.ts` の check_break valueModel を PoC-2 モデル (`P_trigger(自玉露出度) × E_damage`) で実装。no_promote は §9 D-NP の決定に従う (相手成り脅威指標を実装 or S4 送り)。mana_up (deprecated) / 盤面系4枚は現状値 (0 / 静的) 維持。
  - 特性化テスト: valueModel が局面で変動すること (安全玉 → 低 / 露出玉 → 高、PoC-2 カーブ -25↔+230 を自前指標で再現) を pin。`card-spec.test.ts` の **静的 stub テスト 2 ブロック (現 514-537 の snapshot + 532-540 の入力非依存、§9 M-4)** を局面依存版へ更新。
  - **AI は旧 `TRAP_VALUE_*` のまま = 挙動完全不変** (additive)。
- **S3b (cutover + 依存反転、M1 H-1/H-2 反映で再設計)**:
  - `computeCardDigest` / `updateCardDigest` に **gameState を供給**し、CardDigest のトラップ項を `trapPresence`→`trapValueDelta` (valueModel 算出 cp、sente 絶対視点) へ置換。`evaluateTrapPresence` (digest.ts) は `trapValueDelta` をそのまま返す薄い関数へ。
  - **`evaluateAction` (lookaheadPly=0、`search.ts:784-791`) の直接 `TRAP_VALUE_*` 加算経路も同時に valueModel 経由へ統一** (§9 M-1 棚卸し補完。2系統ドリフト防止)。
  - `CARD_VALUE_BRIDGE` のトラップ分の二重定義を解消 (valueModel が SSOT、`cards/ → ai/` 二重定義の片方除去)。
  - **挙動変化**: トラップ価値が局面依存に。bench before/after (kernel-search OFF==ON depth 維持確認 + card-usage)。
  - 単一 revert 隔離: 本段で digest 経路を valueModel へ切替え (revert = digest 経路を `TRAP_VALUE_*` へ差し戻し)。
- **S3c (校正)**:
  - PoC-2 仮係数 (E_damage / P_min / P_max / SAFETY_REF / SAFETY_SPAN) を bench + 決定的 unit test (`evaluate-action.test.ts` 方式) で校正・確定。
  - phase別カード使用率で 57% 非対称の改善傾向を測定 (**S3 単独では P1 深さ非対称が残るため部分改善が想定**。完全是正は S4 と合わせて)。
  - 棋力退化なし (depthCompleted ±10%) を確認。未使用化した係数 (§5 L-2) を整理。

## 4. 現行構造の棚卸し (移植元マップ、M1 補完済)
- `src/lib/shogi/cards/card-spec-server.ts`: `ValueModel` 型 (L66) + `CARD_VALUE_BRIDGE` (L90-98、静的) + `staticValueModel` stub (L100-107) ← S3a で実装、S3b で SSOT 化。
- `src/lib/shogi/ai/cards/digest.ts`: `CardDigest.trapPresence` (defId 保持) + `evaluateCardDigest` の `evaluateTrapPresence` (`TRAP_VALUE_*` 加算、GameState 非受領) + `computeCardDigest` / `updateCardDigest` (GameState 非受領) ← S3b で gameState 供給 + `trapValueDelta` 化。
- `src/lib/shogi/ai/search.ts`:
  - `evaluateAction` (lookaheadPly=0) の **トラップ直接加算 `trapSigned + TRAP_VALUE_*` (`search.ts:784-791`)** ← S3b で valueModel 経由へ統一 (**M1 で棚卸し漏れ判明・補完**)。
  - `evaluateActionWithLookahead` (lookaheadPly=1) = **実 production 経路** (`engine.ts:324-345` から呼ばれる)。PR3-3 C-6 でトラップ直接加算は削除済 (`search.ts:1347-1351` コメント)、digest.trapPresence 間接経由でのみ加算 ← S3b の digest 局面依存化が効く点。
- `src/lib/shogi/ai/cards/heuristics.ts`: `TRAP_VALUE_NO_PROMOTE=50` / `TRAP_VALUE_CHECK_BREAK=80` + 未使用 `CHECK_BREAK_TRIGGER_THRESHOLD=-200` / `MIN_MANA_RESERVE_FOR_TRAP=6` ← S3b/c で valueModel へ移行、未使用係数は S3c で整理 (§5 L-2)。
- `src/lib/shogi/ai/evaluators/king-safety.ts`: `evaluateKingSafety` (D-KS=C により**移設しない**。card-spec-server は自前 king-exposure を持つ。本ファイルは ai/ の盤面評価用に現状維持)。
- `src/lib/shogi/moves.ts`: `findKing` / `isSquareAttackedByFast` ← card-spec-server の自前 king-exposure 計算が import (cards→moves 正方向、既存パターン)。
- `docs/bench-results/issue-235-poc2.json`: PoC-2 仮係数・実測カーブ (check_break 安全玉 -25 ↔ 露出玉 +230) ← S3a 実装の数値根拠、S3c 校正の出発点。

## 5. リスク (M1 確定反映)
- **D-KS = C 確定 (§9、最重要)**: card-spec-server が `lib/shogi/moves` プリミティブで自前 king-exposure 指標を計算。`cards/ → moves` は `cards/effects.ts:7` で既に確立済の正方向依存ゆえ**新規層違反ゼロ**。B (king-safety 物理移設) は囲いボーナスが P_trigger に混入する意味的ノイズ + 新ディレクトリ新設コストがあり不採用。C の再校正コストは S3c の全係数 bench 校正と重複ゆえ実質追加なし。
- **R-1 二重計上 (cost)**: valueModel は gross 値を返す前提を厳守。AI 側 mana 会計 (applyActionForLookahead) と cost を二重に引かない。
- **R-2 root スカラー打ち消し** (PR3-1 F-1 の轍): 局面依存値は root の digest 計算 (computeCardDigest、root GameState で valueModel 評価) で決定し、digest スカラーとして探索木へ伝播。深い negamax での再計算はしない (W-1 root スカラー方式維持)。
- **R-3 set 増分価値 vs 既設持続価値 (M1 H-1 由来)**: トラップの「今 set する増分価値」と「既設トラップの持続価値」は同一 valueModel で評価し、**digest にその局面依存 cp を保持**することで両方を表現 (approach (i))。set 時のみ加算し digest から除く approach (ii) は持続価値を失うため不採用。
- **R-4 棋力退化**: トラップ価値変更で advanced/expert の手が変わる。bench before/after + 決定的 unit test の相対順序で退化検出。S3c で校正。
- **R-5 校正 flaky 再来** (PR3-3 C-13 の轍): 決定的 unit test (`evaluate-action.test.ts` の相対 assert) + sanity-only bench (`perf-bench-card-usage`) に分離 (§6)。strict per-scenario assert は bench に置かない。
- **R-6 PoC-2 仮係数**: E_damage / P_min / P_max / SAFETY_* は placeholder。S3c bench 校正まで本採用値未確定。
- **D-NP (no_promote 指標、要決定 §9)**: no_promote の P_trigger に自玉露出度を流用するのは意味的に誤り (相手の成り阻止カードで自玉王手確率と無関係、PoC-2 caveat)。→ §9 で「相手成り脅威指標を S3a で実装 (両トラップ対象)」か「S3 を check_break 1枚に絞り no_promote を S4 へ」をユーザー確認。
- **L-2 未使用係数**: `CHECK_BREAK_TRIGGER_THRESHOLD` (しきい値方式) は連続値 valueModel と思想不一致で活用されない見込み。S3 完了時に未使用なら削除 (DoD、AGENTS 実装ガイド10 デッドコード禁止)。`MIN_MANA_RESERVE_FOR_TRAP` も valueModel が cost を引かない設計 (§2) との整合を確認。
- **L-3 盤面系 valueModel=0 のセンチネル**: S3b の SSOT 宣言時、盤面系4枚の `0` は「価値ゼロ」でなく「別経路 (盤面 eval) で捕捉=ここでは加算しない」を意味する。doc/コメントで明示し将来の誤解バグを防ぐ。

## 6. 検証ゲート / bench 方法論 (M1 反映)
各段 lint → typecheck → test:ci (全 green 維持) → build。S3b/c は bench 追加。
- **決定的 calibration**: `evaluate-action.test.ts` に相対順序 assert を追加 (同一 AiTurnState で複数 action のスコアを計算し相対関係を assert = 盤面 eval が共通成分で打ち消し calibration 差のみ残す)。例: 露出度に対し check_break 価値が単調増加 / 安全玉では trapScore 低・露出玉では高。flaky 回避の正本 (PR3-3 C-13 方式、既存 `evaluate-action.test.ts:282-291` の相対 assert を踏襲)。
- **局面依存挙動の実証 (M1 M-2)**: **安全玉版 (expected=move/draw) ↔ 露出玉版 (expected=playCard:trap) のペア bench/unit シナリオ**を追加し、「局面依存化が実際にカード選択を変えた」ことを直接判定する (単一 calib シナリオでは複合条件で寄与を切り分けられないため)。
- **sanity-only bench**: `perf-bench-card-usage` (cardCount>=1 + breakdown log テレメトリ)、`perf-bench-kernel-search` (OFF==ON depth 同値 = ロジック健全性)。`RUN_PERF_BENCH=true` gate。
- **棋力**: `docs/bench-results/issue-235-before-baseline.json` (advanced/expert 57%) を基準に phase別カード使用率の改善傾向 + depthCompleted ±10% (epic §12 多面指標)。
- **「局面依存化 ≠ 棋力向上」** のため bench で別途評価 (epic §8.4.5 caveat 3)。

## 7. rollback
- S3a = additive (valueModel 実装 + 自前 king-exposure、production 未配線) ゆえ revert 安全。D-KS=C は移設を伴わないため king-safety 関連の後方互換懸念なし。
- **S3b が主 cutover** = `git revert` 対象 (digest の `trapValueDelta` 経路 → 旧 `trapPresence` + `TRAP_VALUE_*` 経路へ差し戻し、`evaluateAction` 直接加算も復帰)。digest シグネチャ変更 (gameState 追加) を含むため revert は経路まるごとの差し戻し。1コミットに収めて単一 revert を維持。
- S3c は係数調整 (値のみ) のため revert は値の差し戻し。

## 8. S3 DoD
- [ ] D-NP 確定 (§9、check_break 1枚 or 両トラップ + 相手成り脅威指標)。
- [ ] D-KS=C で card-spec-server が自前 king-exposure を持ち、`cards/ → ai/` 上向き依存を作らない。
- [ ] 対象トラップの valueModel を局面依存実装 + 特性化テスト (局面で変動を pin、PoC-2 カーブ再現)。
- [ ] `computeCardDigest`/`updateCardDigest` に gameState 供給 + トラップ項 `trapValueDelta` 化。`evaluateAction` 直接加算も valueModel 経由へ統一 (2系統解消)。`CARD_VALUE_BRIDGE` トラップ二重定義解消。
- [ ] PoC-2 仮係数を bench 校正・確定。決定的 unit test で相対順序 + 安全玉↔露出玉ペアを pin。
- [ ] 棋力退化なし (depthCompleted ±10% + phase別カード使用率) を bench 実証。
- [ ] 未使用係数 (CHECK_BREAK_TRIGGER_THRESHOLD 等) が S3 完了時も未使用なら削除。盤面系 valueModel=0 のセンチネル意味をコメント明示。
- [ ] 各段 lint / typecheck / test:ci / build green。段階順序 S3a → S3b → S3c (S3b が単一 revert 主点)。
- [ ] 盤面系カード / digest 集約キャッシュ / trap onTrigger は S4 / 別サブタスクへ申し送り (非ゴール明記)。

## 9. M1 マイルストーン1レビュー反映 (策定直後、2026-06-10、AGENTS.md ルール8)
独立 adversarial agent (general-purpose、実コード精読) でレビュー。**総合判定: 当初版は high 2件で要修正 → 本版で反映済**。骨子 (段階分割・rollback・非ゴール線引き・検証ゲート) は妥当と確認。

### 確定事項
- **D-KS = C** (当初推奨 B から変更): `cards/effects.ts:7` が既に `../moves` を import 済 = `cards→moves` は確立済正方向依存。C は新規層違反ゼロ・新ディレクトリ不要、再校正コストは S3c bench 校正と重複ゆえ実質追加なし。B のフル king-safety 流用は囲いボーナスが P_trigger に混入する意味的ノイズリスク。→ §3 S3a / §4 / §5 / §7 反映。
- **H-1 (high) 反映**: 実 production 経路 (lookaheadPly=1) のトラップ価値は digest.trapPresence 間接経由 (PR3-3 C-6 で直接加算削除済)。digest は GameState 非保持ゆえ局面依存化には **digest 計算へ gameState 供給 + トラップ項 `trapValueDelta` 化 (approach (i))** が必要。「set 時1回加算 + digest 除去 (approach (ii))」は既設トラップ持続価値を失うため不採用。→ §2 呼び出し点 / §3 S3b / §5 R-2/R-3 反映。
- **H-2 (high) 反映**: `evaluateTrapPresence`/`evaluateCardDigest` は GameState 非受領。H-1 の approach (i) (digest へ gameState 供給) で配線方針を明記し自動解消。→ §3 S3b / §4 反映。
- **M-1 反映**: `evaluateAction` (lookaheadPly=0、`search.ts:784-791`) のトラップ直接加算が当初棚卸しから漏れ。S3b で同時に valueModel 経由へ統一 (2系統ドリフト防止)。→ §3 S3b / §4 反映。
- **M-2 反映**: bench に安全玉↔露出玉のペアシナリオを追加し局面依存挙動差を直接判定。→ §6 反映。
- **M-4 反映**: `card-spec.test.ts` の入力非依存テスト (532-540) も更新対象に明記。→ §3 S3a 反映。
- **L-2 / L-3 反映**: 未使用係数の S3 完了時削除、盤面系 valueModel=0 のセンチネル意味明示を DoD へ。→ §5 / §8 反映。

### 要ユーザー決定 (D-NP、本 doc 提示時に確認)
- **medium M-3 (no_promote の trigger 指標)**: no_promote は相手の成りを阻止するカードで、P_trigger に**自玉露出度を流用するのは意味的に誤り** (PoC-2 caveat `noPromoteTriggerPerspective` も明記)。正しくは「相手の成り脅威指標」(相手の未成り駒の敵陣接近度等) が必要だが、これは新規設計+校正を要する。
  - **選択肢 A (推奨候補)**: S3 を **check_break 1枚に絞り**、no_promote は S4 へ送る (no_promote は現状の固定値 50 を維持 = 退化なし)。絞込型の趣旨に最も合致、誤指標リスクゼロ。
  - **選択肢 B**: S3a で no_promote 用に「相手成り脅威指標」を新規実装し両トラップを局面依存化 (epic §7「TRAP_VALUE_* 脱却」を2枚とも達成だが設計+校正コスト増)。
  - → 本 doc 提示時にユーザー確認。
