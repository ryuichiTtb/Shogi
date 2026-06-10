# Issue #235 S3: L1 ValueModel 内容依存値付け — 実装計画

> 親 doc (epic SSOT): `docs/plans/issue-235-card-shogi-ai-redesign.md` (§3 L1/L2 / §4 ValueModel / §7 S3 / §8.4.5 PoC-2 caveat / §9 PR3 引き継ぎ / §12 棋力ゲート / §13 F-001 用語注意)。
> 前段: S2 (L1 CardSpec registry) 完了・PR #237〜#241 マージ済 (main `e955d47`)。S2 完了定義: `issue-235-s2-cardspec.md §8/§14`。
> ブランチ `feature/#235-s3` (origin/main 起点)。本 doc は AGENTS.md ルール8 マイルストーン1 (実装着手前レビュー) の対象。
> スコープ: ユーザー承認の **「絞込型」** (2026-06-10)。**M1 adversarial レビュー反映済 (§9)**。

## 0. 位置づけ・ゴール / 非ゴール
S3 = L1 ValueModel の内容依存値付け。**S0〜S2 は全て挙動不変の土台整備だったが、S3 は CPU の棋力 (カード選択) を実際に変える最初の段**。現状トラップ2枚の価値が固定係数 (`TRAP_VALUE_CHECK_BREAK=80` / `TRAP_VALUE_NO_PROMOTE=50`) で局面非依存。これを局面依存の ValueModel へ置換する。

**ゴール (絞込型、epic §7 S3 行)**:
1. **トラップ2枚の ValueModel を局面依存化** (D-NP=B 確定、§9): `P_trigger × E_damage` モデルを `card-spec-server.ts` の valueModel に実装し、固定係数 `TRAP_VALUE_*` を脱却。**check_break = 自玉露出度** / **no_promote = 相手成り脅威指標** と P_trigger 指標を明確に分離する (同一カーブ流用禁止)。
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
- [x] D-NP 確定 (§9、check_break 1枚 or 両トラップ + 相手成り脅威指標)。→ 両トラップ + 相手成り脅威指標 (選択肢 B、§9 D-NP)。
- [x] D-KS=C で card-spec-server が自前 king-exposure を持ち、`cards/ → ai/` 上向き依存を作らない。→ S3a で `moves`/`variants` プリミティブ自前計算 (§10)。
- [x] 対象トラップの valueModel を局面依存実装 + 特性化テスト (局面で変動を pin、PoC-2 カーブ再現)。→ S3a (§10)。
- [x] `computeCardDigest`/`updateCardDigest` に gameState 供給 + トラップ項 `trapValueDelta` 化。`evaluateAction` 直接加算も valueModel 経由へ統一 (2系統解消)。`CARD_VALUE_BRIDGE` トラップ二重定義解消。→ S3b (§11)。
- [x] PoC-2 仮係数を bench 校正・確定。決定的 unit test で相対順序 + 安全玉↔露出玉ペアを pin。→ S3c (§12、TRAP_P_MIN 0.05→0.10 確定、決定的テスト3件)。
- [x] 棋力退化なし (depthCompleted ±10% + phase別カード使用率) を bench 実証。→ S3c (§12、全難易度 depthCompleted 0.0% 変化、card% beginner/intermediate 86%→100%)。
- [x] 未使用係数 (CHECK_BREAK_TRIGGER_THRESHOLD 等) が S3 完了時も未使用なら削除。盤面系 valueModel=0 のセンチネル意味をコメント明示。→ S3c で `CHECK_BREAK_TRIGGER_THRESHOLD`/`MIN_MANA_RESERVE_FOR_TRAP` 削除 (§12)。盤面系=0 センチネルは S3a/S3b でコメント明示済。
- [x] 各段 lint / typecheck / test:ci / build green。段階順序 S3a → S3b → S3c (S3b が単一 revert 主点)。→ 全段 green、順序遵守 (§10/§11/§12)。
- [x] 盤面系カード / digest 集約キャッシュ / trap onTrigger は S4 / 別サブタスクへ申し送り (非ゴール明記)。→ §12 S4 申し送り。

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

### D-NP 確定 (2026-06-10、ユーザー決定 = 選択肢 B「罠2枚とも賢くする」)
- **medium M-3 (no_promote の trigger 指標)**: no_promote は相手の成りを阻止するカードで、P_trigger に自玉露出度を流用するのは意味的に誤り (PoC-2 caveat `noPromoteTriggerPerspective`)。
- **決定 = B**: S3a で no_promote 用に **「相手成り脅威指標」を新規実装**し、check_break (自玉露出度) と no_promote (相手成り脅威) の**両トラップを局面依存化**する。epic §7「TRAP_VALUE_* 脱却」を2枚とも達成。
- **相手成り脅威指標の設計方針 (S3a)**: no_promote 価値 = `P_promo(相手の成りそう度) × E_damage_no_promote`。
  - `P_promo`: 相手 (opponent) の**未成り・成り可能駒** (歩/香/桂/銀/角/飛) が**相手の成り地点 (= 自陣側 3 段)** にどれだけ接近しているかを `lib/shogi/moves` プリミティブで盤面走査して算出し、`[P_MIN, P_MAX]` へ正規化 (check_break の king-exposure→確率マッピングと同型)。盤面の向き (先後) を player で正しく反転すること。
  - `E_damage_no_promote`: 成り阻止の価値 (cp、PoC-2 `NO_PROMOTE_E_DAMAGE=160` 出発点、S3c 校正)。
  - 既存の成り判定/成り地点ヘルパ (moves/rules) を再利用し、無ければ最小実装 (cards→moves 正方向)。
- **影響**: §0 ゴール1 の対象は check_break + no_promote の2枚。S3a の実装対象・特性化テスト・S3c 校正が2枚分に増える。check_break は self-king-exposure、no_promote は opponent-promotion-threat と**指標を明確に分離**する (同一カーブ流用を禁止)。

## 10. S3a M2 マイルストーンレビュー (実装後、2026-06-10、AGENTS.md ルール8)

S3a = トラップ2枚の valueModel を局面依存実装する **additive** 段 (production 未配線=挙動不変)。

### 変更
- `card-spec-server.ts`: check_break valueModel = 自玉露出度 `kingExposure` (玉8近傍の被利き数 + 王手中加点) → `P_trigger × CHECK_BREAK_E_DAMAGE` (gross)。no_promote valueModel = 相手成り脅威度 `promotionThreat` (相手の成り可能・未成り駒の成り地点接近度) → `P_trigger × NO_PROMOTE_E_DAMAGE` (gross)。残り5枚は `STATIC_CARD_VALUE` (mana_up=30 / 盤面系4枚=0 センチネル)。D-KS=C: king-exposure/promotion-threat は `findKing`/`isSquareAttackedByFast` (moves) + `PIECE_DEF_MAP`/`STANDARD_VARIANT` (variants/standard) で自前計算 = cards→ai を作らない。係数は PoC-2 仮値 (S3c 校正)。
- `card-spec.test.ts`: valueModel テストを静的5枚 + トラップ2枚の局面依存テスト (安全玉↔露出玉・脅威ゼロ↔接近・promoted 除外・gote 視点反転) へ更新 (29→37 件)。

### 検証実測
- lint 0err (22 warning は既存・純増ゼロ) / typecheck / test:ci **579 passed** (e955d47 baseline 573 + 新規6、既存573不変) / build 緑。
- bench は S3a が production 未配線 (valueModel を読む production コードゼロ) のため不要 (S3b/c で実施)。

### 総合判定
**S3a は commit/push 可 (指摘ゼロ)**。独立 adversarial agent (general-purpose、41 tool uses、ミューテーションテスト併用) で **additive 維持・metric 正当・発散点ゼロ** を確認:
- additive: `spec.valueModel` を読む production コードはゼロ (world-kernel/action-generator は effect/meta/useCondition/checkUsage/targeting のみ参照)。既存テスト573不変。
- metric: 盤面向き (先後反転) は canonical `isInPromotionZone` (board.ts) と完全一致、attacker 指定は canonical 王手判定 (moves.ts:374) と一致、gross 値は PoC-2 の cost 込み値と意図的分離 (二重計上回避) で正しい。テストは promotionDistance 分岐反転で3件落ちる=実効性実証。
- 層: card-spec-server は ai/ を import せず (D-KS=C)、循環なし。card-shogi variant も STANDARD_VARIANT spread (9×9/pz=3) ゆえ promotionZoneRows 流用は正しい。

### S3b への申し送り
- valueModel は gross のため、digest 経路への gameState 供給時に mana cost を別途確実に引く (計画 §3 S3b 方針)。
- root スカラー1回評価 (R-2) を維持し深い negamax で再計算しない。

## 11. S3b M2 マイルストーンレビュー (cutover 実装後、2026-06-10、AGENTS.md ルール8)

S3b = トラップ評価を固定係数 (TRAP_VALUE_*) から局面依存 valueModel へ cutover + 依存反転。**CPU の棋力が実際に変わる behavior-changing 段**。

### 変更
- `digest.ts`: `CardDigest.trapPresence` (defId ペア) → `trapValueDelta: number` (sente 絶対視点 cp)。`computeCardDigest`/`updateCardDigest` に gameState 引数追加 + `computeTrapValueDelta` ヘルパ (sente トラップ +valueModel(sente) / gote -valueModel(gote)、gameState 省略時 0)。`evaluateCardDigest` は `digest.trapValueDelta` を加算。`evaluateTrapPresence` 削除、TRAP_VALUE_* import 削除、`getCardValue` import。
- `search.ts`: `evaluateAction` (ply=0) のトラップ分岐を `getCardValue(defId, gameState, player)` へ。digest 呼び出し 8 点に post-action gameState 供給。TRAP_VALUE_* import 削除。
- `engine.ts`: root `computeCardDigest(options.cardState, state)`。
- `card-spec-server.ts`: `getCardValue(id, gameState, player)` アクセサ追加 (ai → L1 依存反転)。
- `heuristics.ts`: TRAP_VALUE_NO_PROMOTE/CHECK_BREAK 撤去 (dead code 除去、§5 L-2)。
- テスト: card-digest.test / evaluate-action.test を trapValueDelta + valueModel 期待値へ更新 (固定値ハードコード排除)。trap-only calibration を相手成り脅威盤面へ更新。perf-bench コメント更新。

### 設計判断 (M1 H-1/H-2 反映)
- **approach (i)**: digest にトラップの局面依存価値を precompute (gameState 供給時、valueModel)。digest は GameState を持たないため evaluate 時の再計算は不可 = root スカラー方式 (W-1) を維持しつつ局面依存化。「set 時1回加算+digest 除去」(approach ii) は既設トラップの持続価値を失うため不採用。
- **gameState は任意パラメータ** (省略時 trapValueDelta=0): card-digest.test の 62 呼び出しのうちトラップ非関与 (大半) は churn せず維持。production 全 9 呼び出しは gameState を必ず渡す (トラップ価値が機能)。
- **gross 値**: valueModel はコストを引かない (AI の mana 会計が別途処理、二重計上回避)。
- **依存反転**: digest/search が card-spec-server.getCardValue を import (ai → L1 正方向)、循環なし。

### 検証実測
- lint 0err / typecheck 緑 / test:ci **580 passed** (S3a 579 + card-digest 新規1。既存等価ゲート world-kernel-equivalence/reducer/effects/kernel-search-equivalence すべて緑=デグレなし) / build 緑。
- bench (RUN_PERF_BENCH): kernel-search **OFF==ON depthCompleted 維持** (digest 局面依存化は OFF/ON 両経路に等しく作用=ロジック健全)。card-usage sanity (cardCount>=1) pass。

### 挙動変化 (意図的)
- **AI のトラップ価値が局面依存に**: check_break は自玉が危ない局面ほど高く (安全玉 ~15cp ↔ 露出玉 ~270cp gross)、no_promote は相手の成り脅威が高い局面ほど高く評価 (固定 80/50 を脱却)。狙い = advanced/expert の使い渋り (57%) の一因 P2 (価値圧縮) の緩和。**仮係数は PoC-2 由来で S3c bench 校正**。
- UI/ゲームルール/standard variant = 不変。

### 総合判定
**S3b は commit/push 可 (high/medium 指摘ゼロ)**。独立 adversarial agent (general-purpose、47 tool uses、手計算併用) で **cutover 正当・二重計上なし・符号正 (sente 絶対視点)・gameState 配線正 (8点)・root スカラー持続価値保全・等価性成立・依存反転循環なし・standard 不変・テスト非 vacuous** を確認。指摘は low cosmetic 2件 (digest ヘッダコメント / テスト名の stale) のみ → 本段で修正済。

### S3c への申し送り
- PoC-2 仮係数 (TRAP_P_MIN/MAX / E_DAMAGE / KING_EXPOSURE_REF / PROMO_THREAT_REF 等) を bench 校正し本採用値を確定。安全玉↔露出玉ペアの決定的 unit test (§6 M-2) を追加。phase別カード使用率で 57% 非対称の改善傾向を測定。未使用係数の最終確認。

## 12. S3c M2 マイルストーンレビュー (校正実装後、2026-06-10、AGENTS.md ルール8) — **S3 全段完了**

S3c = PoC-2 仮係数を bench + 決定的 unit test で校正し**本採用値を確定**する段。S3b で局面依存化したトラップ valueModel の係数を実測ベースで仕上げ、未使用係数を整理する。**S3c 完了をもって S3 (L1 ValueModel 内容依存値付け) 全段完了**。

### 変更 (4 ファイル、working-tree)
- `card-spec-server.ts`: `TRAP_P_MIN` **0.05 → 0.10**。コメントブロックを「PoC-2 仮値 → S3c 本採用値」へ更新し校正根拠を明記。他係数 (TRAP_P_MAX=0.9 / CHECK_BREAK_E_DAMAGE=300 / NO_PROMOTE_E_DAMAGE=160 / KING_EXPOSURE_REF=6 / KING_IN_CHECK_WEIGHT=3 / PROMO_THREAT_REF=6 / PROMO_PROXIMITY_MAX=3) は PoC-2 + S3b ユーザー承認値のまま据置。
- `card-spec.test.ts`: floor リテラル更新。check_break `P_MIN_VAL = 0.1×300 = 30`、no_promote `P_MIN_VAL = 0.1×160 = 16`。P_MAX 側 (0.9×) は不変。
- `evaluate-action.test.ts`: 決定的テスト 3 件追加 (新 describe「evaluateAction calibration (S3c…)」)。noise なし `evaluateActionWithLookahead`/`evaluateAction` を直接呼び相対順序を pin (C-13 / §6 方式)。
- `heuristics.ts`: デッドコード `MIN_MANA_RESERVE_FOR_TRAP` / `CHECK_BREAK_TRIGGER_THRESHOLD` を削除 (§5 L-2、しきい値方式トラップ候補生成は連続値 valueModel 採用で不採用に。実参照ゼロ)。`EARLY_GAME_THRESHOLD` は `computePhaseStage` で現用のため保持。

### 校正の判断と根拠
- **TRAP_P_MIN 0.05 → 0.10**: PoC-2 仮値 0.05 は「set 済の dormant トラップが**生涯で** trigger する確率」を過小評価していた。王手・成りは 1 局を通じて高頻度で発生するため、置いたトラップの将来発火確率は 5% より明らかに高い。0.10 への引き上げで:
  - **floor**: check_break 15→30cp / no_promote 8→16cp。
  - 「静かな盤面 + dead マナ (上限近接、overflow あり) → dormant トラップ set」が**正 EV** になる (浪費されるはずのマナを option value に変換する好手)。
  - 「静かな盤面 + 通常マナ → move」は維持 (P_MIN<0.127 で過剰セットを抑止)。
  - 危険局面 (露出玉 / 相手成り脅威) は ratio が P_MAX 側へ押し上げるため**挙動不変**。
- **他係数据置の根拠**: PoC-2 実測カーブ (check_break 安全玉 -25 ↔ 露出玉 +230) + S3b 時点でユーザー承認済の正規化基準。bench で depthCompleted 退化なしを確認できたため再校正不要と判断。

### 決定的テスト 3 件 (回帰ガード)
1. **no_promote flip**: 相手成り脅威ありで trap > move、脅威なしで move > trap (局面依存が機能)。
2. **check_break 露出 isolation** (ply=0): `(trap−draw)_露出玉 > (trap−draw)_安全玉`。getDrawValue が両局面同値で相殺され、valueModel 差 (270−30=240cp) が決定に伝播することを pin (盤面 eval は共通成分で打ち消し)。
3. **check_break dead マナ dormant flip** (S3c 校正の核): dead マナ (19、overflow 3) → trap > move / 通常マナ (8) → move > trap。**P_MIN=0.05 では flip しない**ことをミューテーション検証で実証 (M2 で `TRAP_P_MIN=0.05` に戻すと `expected 10.03 to be greater than 21` で FAIL) = 本テストが校正の真の回帰ガード。
- check_break は `checkUsage="forbidden"` (王手中使用不可) のため、本来の使い所は**予防的 dormant セット**。露出玉局面では「玉を安全マスへ逃がす能動防御 move」が trap に勝つのが正 (テストコメントに明記)。

### bench 実測 (before P_MIN=0.05 → after 0.10、3-run median、全 4 難易度)
| 難易度 | depthCompleted (B→A) | Δ% | card% (B→A) |
|---|---|---|---|
| beginner | 3 → 3 | **0.0%** | 86% → **100%** |
| intermediate | 5.33 → 5.33 | **0.0%** | 86% → **100%** |
| advanced | 5.78 → 5.78 | **0.0%** | 57% → 57% |
| expert | 6 → 6 | **0.0%** | 57% → 57% |
- **depthCompleted 全難易度 0.0% 変化 = 棋力退化なし** (DoD ±10% に余裕)。
- **校正に測定可能な効果**: `calib-trap-only-no-draw` (no_promote, mana19) が beginner で before 全3run=move → after 全3run=**trap(no_promote)** に一貫 flip (floor 8→16cp + dead マナ回収で dormant トラップが競争力獲得=狙い通り)。intermediate も安定化。
- **advanced/expert 57% 不変**: 深く読み best move > dormant trap となるため P1 深さ非対称が支配的 (S4 マター)。S3 単独では構造的に直らない (epic §8.4.5 caveat / §12 想定通り)。

### 検証実測
- lint **0 errors / 22 warnings** (S3b baseline 維持、純増ゼロ) / typecheck 緑 / test:ci **583 passed | 12 skipped** (S3b 580 + 新規3、既存不変=デグレなし) / build 緑。
- bench (standalone tsx `measure-baseline-235.ts 3`、RUN_PERF_BENCH 経路): 上表のとおり。

### 挙動変化 (意図的)
- **dormant トラップの set 判断が局面適応的に**: dead マナ局面で予防的トラップセットを選好し、通常マナでは move を維持。advanced/expert の使い渋り (57%) は P1 深さ非対称が主因のため S3 単独では不変 (S4 で是正)。
- UI / ゲームルール / standard variant = 不変。

### 総合判定
**S3c は commit/push 可 (high/medium 指摘ゼロ)**。独立 adversarial agent (general-purpose、約 39 tool uses、ミューテーションテスト + 手計算 × 実測突合 + grep 全消費者洗い出し併用) で以下を確認:
- 符号正 (digest sente+/gote−、search ply=0 整合) / 二重計上なし (manaDelta でコスト 1 回・trapValueDelta で gross 1 回、P_MIN は会計に非干渉) / floor 算術正 (30 / 16、P_MAX 270 / 144 不変、clamp 健全) / 全 consumer 整合 (getCardValue 一本に集約、stale 旧 floor リテラル皆無) / デッドコード除去妥当 (削除2定数は参照ゼロ、EARLY_GAME_THRESHOLD は現用) / テスト非 vacuous (ミューテーションで test3 FAIL を実証) / 棋力退化なし (P_MIN は探索深度に非干渉な評価スカラー) / UI・UX 該当なし (変更は `src/lib/shogi/` のみ、components/hooks 非波及) / NaN・負値・異常値の発生経路なし (玉不在・手札ゼロ・マナ上限ちょうど等エッジ網羅)。
- 指摘は low 1件 (test1/test2 は P_MIN を pin しない=S3a/S3b の局面依存性ガードであり、コメントで「2点で pin」と既に正確に説明済 → 修正不要)。

### S4 (L2 TurnAction 単一探索 + TT 拡張) への申し送り
- **57% 非対称の主因 P1 (深さ非対称)** は S3 では構造的に解消できない。S4 で TurnAction を単一探索木に統合し TT を拡張することが本丸 (epic §7、最大の山場)。
- トラップ valueModel の係数は S3c で本採用確定。S4 で探索構造が変わっても valueModel は SSOT として再利用 (gross 値・root スカラー方式 W-1 を維持)。
- 盤面系カード valueModel (現 0 センチネル) の精緻化 / digest 集約キャッシュ / trap onTrigger イベントモデルは引き続き非ゴール (S4 以降 / 別サブタスク)。
