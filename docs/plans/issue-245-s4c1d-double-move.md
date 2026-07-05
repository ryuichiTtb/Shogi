# Issue #245 S4c-1d: double_move (二手指し) の AI 統合 実装計画

> #235 S4c-1 で分離された double_move の World 探索統合 (実行プラミング含む)。正本経緯は
> [issue-235-s4-search-engine.md](./issue-235-s4-search-engine.md) §12.9 (M1 BLOCKER 3件)・§12.10 (確定スコープ = 1-response 方式)。
> 背景: ユーザー実機検証 (2026-07-05) で「CPU が二手指しを一度も使わない」と指摘。真因は
> ①World 探索が double_move を構造的に除外 (`search.ts:801`) ②教材 348 局のデッキに double_move 不在、の 2 重。
> 本段は①を解消する。②は本段完了後の +152 局生成 (double_move 入りデッキ) で対応。
> 着手前 rule-8 M1 レビュー (単一 general-purpose agent / #109) の対象。

---

## 0. 一言サマリ (初心者向け)

- **やること**: 「二手指し」カードを AI が読み筋に入れて使えるようにする。①探索が「カードを使う→1手目→2手目」の3段を正しく読めるように ②選んだら 1 回のレスポンスで「カード+1手目+2手目」を返し、画面側が順に実行する (1-response 方式)。
- **なぜ今まで使えなかったか**: 二手指しは「1手で手番が終わらない」特殊カードで、探索・実行の両方に特別対応が要り、以前のレビューで危険箇所が 3 つ見つかり棚上げされていた。
- **安全策**: この機能は World 探索経路 (現在 Preview の学習 CPU のみが使用) に閉じる。**production (bolt-on) は無改変・flag OFF でバイト不変**。

## 1. 現状の事実 (調査済、2026-07-05 単一調査 agent / 実コード照合)

| # | 事実 | 出典 |
|---|---|---|
| F1 | `getWorldLegalActions` が double_move を除外 (`continue`)。card 展開は root のみ (`expandCards` gate) | `search.ts:801` / `:784` |
| F2 | **kernel 側の double_move 遷移は完成済**: playCard→doubleMove set・遅延消費・turnEnded=false / 1手目→movesLeft 2→1・同 player 継続 (詰みなら即 finalize) / 2手目→finalize・turnEnded=true | `world-kernel.ts:384-398,285-314,318-332` |
| F3 | `negamaxWorld` に turnEnded=false 保険分岐が既存 (現状到達不能、`depth-1` で回している) | `search.ts:1146-1151` |
| F4 | B-1 (useEffect デッドロック): AI 駆動 useEffect の deps に `doubleMove` 無し、CONFIRM_PLAY_CARD(double_move) は deps をどれも変えない → mid-turn 再クエリでは 2 手目が発火しない。**1-response 方式なら再発火自体が不要** (既存 AI カードの同期 2-dispatch 実績と同じ machinery) | `use-card-shogi-game.ts:131-238` / `reducer.ts:1103-1131` |
| F5 | B-2 (payload 5箇所): request 側 5 箇所は **1-response 方式なら全て不要**。変更は response 側のみ (`FindBestMoveResult` / `AiMoveResponse` に additive 追加。route.ts は JSON パススルーで無変更) | `route.ts:277` / `engine.ts:194` / `use-ai-request.ts:53-60` |
| F6 | B-3 (mateInOne 制約): ルール「カード使用時点で 1 手詰め不可なら 2 手目詰み禁止 + 相手玉取り常時禁止」は **UI 層 (reducer 候補生成) にのみ実装**。reducer の MAKE_MOVE は無検証適用、探索側もフィルタ皆無。AI が UI 候補フィルタをバイパスして dispatch するため、**探索側フィルタが正当性の唯一の砦になる** | `moves.ts:710-753` / `reducer.ts:350-441,642-712` / `definitions.ts:155-175` |
| F7 | production bolt-on は double_move を選んでも client null フォールバックで move 実行 (実質未使用)。S4c-1d は world 経路のみの変更で bolt-on 無改変 | `ai-action-bridge.ts:44-46` / `engine.ts:375-443` |
| F8 | TT: S4c-2 の誤 hit ゼロ設計は doubleMove を fold していない (TODO 予約のみ)。中間ノードが store すると通常ノードと衝突し silent 棋力破壊 | `card-zobrist.ts:22-23` |

## 2. 設計 (確定スコープ = #235 §12.10 + M1 ヘルパ方式)

### 2.1 探索側 (search.ts) — root 専用ヘルパで double_move を読む

**方式 = root 専用ヘルパ `searchDoubleMoveLineWorld` (M-4)**。生の `negamaxWorld` (production 共有ホットパス) は**本体無改変**とし、double_move 線の全規律を 1 ヘルパに閉じ込める。これにより「world flag ON かつ dm 手札なし (現 Preview の 348 局デッキ) で探索結果バイト等価」が構造的に成立し、B-1/B-2 も構造的に無害化される。

1. **候補化**: `findBestMoveWorld` の root で double_move が手札にあれば候補に含める (`getWorldLegalActions` の `:801 continue` は**中間ノード防御として維持**しつつ、root では別途 dm を候補列に足す or gate を root 限定で緩める。実装詳細は着手時に確定、いずれも root 限定)。中間ノードは move-only 不変。
2. **ヘルパ `searchDoubleMoveLineWorld(rootWorld, dmAction, depth, alpha, ctx)` → `{ score, move1, move2 | null }`**:
   - a. `mateInOneAvailable = hasOneMoveMate(state, player, CARD_SHOGI_VARIANT, cardState)` を **1 回**計算 (論点1、reducer:1125 と同一呼出)。
   - b. **move1 候補** = UI と同一線 (`getDoubleMoveFirstLegalmoves` 相当、RELAXED = 1手目自玉王手容認で 2手目解消を許容、N-1)。玉取り除外。
   - c. 各 move1 を kernel 適用 (`applyTurnAction` double_move_first) → W2。**W2 が turnEnded=true (1手目で詰み)** なら終端: score = 詰みスコア、`move2 = null` (M-1)。
   - d. 継続 (W2 turnEnded=false) なら **move2 候補** = `getDoubleMoveSecondLegalMoves` を **optional cardState 引数で拡張して共用** (M-2、production 呼出元ゼロ確認済、玉取り除外内蔵 + `!mateInOneAvailable` で詰み除外 + check_break/no_promote トラップを UI と同一 predicate で模擬)。
   - e. 各 move2 を kernel 適用 → W3 (turnEnded=true, currentPlayer flip 済)。**`boardHash3 = computeHash(W3.gameState)` を全量計算** (B-1 解消)。score = `-negamaxWorld(W3, depth-1, -∞, -alpha, boardHash3, ...)` (相手番へ正しく反転)。
   - f. **着手空 (合法 move2 なし)** の move1 線は **score を積まず棄却** (rootActionScores にも積まない、N-2)。W2 の全 move1 が空なら dm 線自体を棄却。
   - g. best `{score, move1, move2}` を **探索済の合法 pair のみ**から選ぶ (N-3)。`ctx.stopped` を毎ループ検査し即 bail (N-4)。
3. **root ループでの扱い (M-3)**: dm action は i===0/else の negamax scout 分岐を**双方 bypass**し、ヘルパを**同視点窓 `(alpha, +∞)`** で呼ぶ (score は他 root action と同じ root player 視点)。soft reduction を dm に適用する場合はヘルパへ渡す depth を調整し depth 会計込みで定義。`cardSeen++`・`rootActionScores.push({action: dmAction, score})` を他 card と同列に。noise/nearEqual は score にのみ作用し、採用時は記録済 pair をそのまま実行側へ渡す。
4. **negamaxWorld 本体の防御ガード (B-2/論点4)**: 本体は無改変が原則だが、防御として ①null-move 実行条件に `world.doubleMove === null` を追加 ②TT probe/store を `world.doubleMove !== null` で skip (冒頭 probe 前 + store 前)。ヘルパ方式では中間 dm ノードが本体に到達しないため通常は不発だが、将来 S5 deep 展開の地雷防止 (dev assert 相当)。

### 2.2 実行側 (1-response 方式)
- `FindBestMoveResult` (`engine.ts:194`) / `AiMoveResponse` (`use-ai-request.ts:53-61`) に `doubleMove?: { move1: Move; move2: Move | null }` を additive 追加 (M-1、route は JSON パススルーで無変更)。engine は bestAction=double_move かつ world 経路のときのみヘルパ由来 pair を付与。
- `ai-action-bridge.ts` (`:44-46`) の null フォールバックを、**`doubleMove` 引数の存在で分岐** (defId 判定でない、論点3): 有 → `[BEGIN_PLAY_CARD, CONFIRM_PLAY_CARD, MAKE_MOVE(move1)]` + (move2 非 null なら `MAKE_MOVE(move2)`) の dispatch 列。無 (bolt-on / 詰み1手) → 現行の move フォールバック維持。
- `use-card-shogi-game.ts` は bridge へ `doubleMove` を伝搬 (`:207-214`)。useEffect deps 変更なし (F4)。reducer:632 status guard が 4 発目 no-op の defense-in-depth (M-1)。

### 2.3 変更しないもの
- **`negamaxWorld` 本体ロジック** (防御ガード 2 行を除く)・production bolt-on 経路 (`engine.ts:375-443`) — 無改変。
- route.ts — 無変更 (パススルー)。world flag は Preview env トグルのまま (production OFF 継続)。
- reducer / kernel 遷移 — 完成済 (F2)。reducer の UI 候補生成 (`reducer.ts:350-441`) の重複実装統合は別リファクタ (production UI ゆえ本段見送り、M-2)。

## 3. 無回帰・安全性 (#109)

- **production バイト不変**: 変更は world 経路 (flag OFF で不活性) + response 型の additive 追加 + bridge の double_move 分岐 (production では bestAction=double_move が返らない: bolt-on は F7 の null フォールバック経路のままだが、**bridge 変更で bolt-on の double_move 選択時も 4-dispatch が動くようになる点は挙動変更**→ M1 論点: bolt-on 側は moves 欠落 (undefined) ゆえ null 維持 = 実質不変、を確認)。
- **正当性**: B-3 フィルタが探索側の唯一の砦。UI 候補生成と同一条件を共有 (可能なら共通関数化)。
- **符号/depth 会計**: #235 の最危険領域。特性化テストで pin (同 player 継続・depth 保存・soft reduction/null-move との相互作用)。
- **時間予算**: double_move 線は実質 depth+1 の部分木。depthCompleted 低下と Vercel 504 を bench で確認。

## 4. テスト計画

1. R-8: 中間ノードで evaluate 未到達 (no-leaf 不変条件)。
2. 符号/depth: double_move 線の score が「カード→1手目→2手目→相手番」で正しく手番視点を維持する特性化 (単純詰み fixture で手計算値と一致)。
3. B-3: mateInOneAvailable true/false × 玉取り手の除外を単体検証。UI 候補 (`legalSecondMoves`) と探索フィルタの一致。
4. root で double_move が最善となる fixture (2 手で駒得確定等) で bestAction=double_move + doubleMoveMoves が合法手ペア。
5. bridge: 4-dispatch 列 (moves 有) / null (moves 無 = bolt-on 後方互換)。
6. E2E: reducer に 4-dispatch を通し二手指しが完走 (カード消費・手番遷移・盤面)。
7. 無回帰: flag OFF (production) の探索結果バイト等価。既存 test:ci 全緑。

## 5. 段階分割 (コミット単位)

| 段 | 内容 | ゲート |
|---|---|---|
| a | 探索統合 (2.1: 候補化+会計+中間ノード規律+B-3+抽出) + テスト 1-4 | full gate |
| b | 実行プラミング (2.2: response 型+bridge+hook) + テスト 5-6 | full gate + M2 |
| c | (別途) +152 局生成 (double_move 入りデッキ) → 深さ5 ラベル → 500 局学習 | 学習パイプライン |

## 6. M1 論点 (レビューで確定)

1. `mateInOneAvailable` の搬送: KernelDoubleMove 拡張 vs SearchContext — kernel 型に載せるのが自然だが L0 型変更の波及を確認。
2. move1/move2 抽出方式: PV 追跡 vs root 専用再評価 — PV が noise 後の bestAction と整合するか。
3. bridge 変更が bolt-on 経路の挙動を変えないこと (moves undefined → null 維持) の確認。
4. TT skip の実装位置 (probe/store 両方、middle-node 判定)。
5. カード追加チェックリスト (docs/card-shogi-new-card-checklist.md) への「#245 学習パイプライン再回し (新カード→featureDim 変化→追加自己対戦+差分ラベル+再 encode/train)」追記 (本段 or 別コミット)。

## 7. M1 レビュー反映 (2026-07-05、単一 general-purpose agent / #109、実コード照合)

**判定: CHANGES_REQUIRED → 反映済で着手可**。F1〜F8 全 CONFIRMED (F2/F4/F6/F7 精密化)。骨格 (1-response / root 専用候補化 / no-leaf / additive 型 / bolt-on 無改変) は妥当だが、BLOCKER 2 + MAJOR 4 を反映。**中核決定 = 論点2/M-4 の「root 専用ヘルパ方式」採用**により、生の negamaxWorld (production 共有ホットパス) を無改変にして BLOCKER 2 件と TT/抽出問題を構造的に無害化する。

### 5 論点の確定
1. **mateInOneAvailable 搬送 = 不要**。ヘルパが root で `hasOneMoveMate(state, player, CARD_SHOGI_VARIANT, cardState)` (moves.ts:680-692、reducer:1125 と同一) を 1 回計算しローカル使用。**kernel で計算させない** (bolt-on kernel が production で走り性能/挙動混入するため)。
2. **move1/move2 抽出 = root 専用ヘルパ `searchDoubleMoveLineWorld`**。中間ノードは TT store しない設計ゆえ PV 追跡は構造的に不可能。ヘルパが move1×move2 を自前展開し W3(turnEnded=true) から `-negamaxWorld(depth-1)` を呼ぶ → score と pair が構成的に一致・noise 後も記録 pair をそのまま使用。**BLOCKER-1/2・TT skip・拡張抑止・着手空・抽出が全てヘルパ内に局所化**。
3. **bridge bolt-on 無影響 = OK (条件付き)**: bridge は「moves 引数の存在のみ」で分岐 (defId 判定でなく)。bolt-on は doubleMoveMoves 非付与→undefined→null 維持=現行同一。§3 文言を「flag OFF 探索結果バイト等価 + moves 欠落時 null 維持の挙動等価」に精密化 (N-5)。
4. **TT skip = probe/store 両方、`world.doubleMove!==null` で negamaxWorld 冒頭 probe 前**。ヘルパ方式で中間ノードは negamaxWorld 非到達だが**防御ガード**として入れる (将来 S5 deep 展開の地雷防止)。fold は今段不採用。card-zobrist.ts:22-24 TODO 更新。
5. **チェックリスト追記 = 本ブランチ別コミット** (ドキュメントのみ、gate=lint/typecheck)。内容に「multiPly (turnEnded=false) カード追加時は world 中間ノード規律 + bridge dispatch 列の対応が必要」を含める。

### BLOCKER/MAJOR 反映
| # | 指摘 | 反映 |
|---|---|---|
| **B-1** | turnEnded=false 遷移の boardHash 手番パリティ汚染 (updateHash が無条件 SIDE_TO_MOVE flip、dm 1手目は currentPlayer 非 flip → W3 以深の正規部分木 TT が「同盤逆手番」と衝突、silent 棋力破壊) | §2.1: **ヘルパ方式で W3 進入時に `computeHash(W3.gameState)` を 1 回全量計算** (dm 線は root 直下限定で性能無視可)。R-14 型特性化テスト (dm 線経由 W3 hash === computeHash(W3)) |
| **B-2** | 中間ノード null-move pruning 抑止漏れ (doubleMove 保持のまま手番 flip した nullWorld → 相手 move が dm 1手目分岐に吸われ状態破壊) | §2.1: null-move 実行条件に `world.doubleMove===null` 追加 (ヘルパでも防御)。テスト 1 に null-move 非発火 assert |
| **M-1** | 1手目詰み線 (move2 なし) が固定 2-tuple 型で表現不能 | §2.2: 型を `{move1: Move; move2: Move \| null}` に。bridge は move2 非 null 時のみ 4 発目 dispatch。reducer:632 status guard を defense-in-depth 明記 |
| **M-2** | B-3 詰み判定を UI と同一 predicate に (check_break/no_promote トラップで raw isCheckmate と kernel 適用後 status が乖離、AI だけ人間禁止手を指す規約違反) | §2.1: **`moves.ts` の `getDoubleMoveSecondLegalMoves` を optional cardState 引数で拡張し共用** (production 呼出元ゼロ確認済、玉取り除外 isKingCapture 内蔵)。テスト 3 は UI `legalSecondMoves` との集合一致 (check_break 局面含む) |
| **M-3** | root ループ turnEnded=false 分岐の窓/reduction 未記述 (符号事故最頻発点) | §2.1: dm 分岐は i===0/else 双方 bypass、同視点窓 `(alpha, +∞)`、soft reduction 適用時は depth 会計込みで定義。cardSeen++/rootActionScores 積み方明記。テスト 2 に root 窓引き継ぎケース |
| **M-4** | 中間ノード規律を negamaxWorld 汎用パスに埋める設計の見直し → ヘルパ方式 | §2.1 全体をヘルパ方式へ改稿 (negamaxWorld 本体無改変 = 無回帰構造的成立) |

MINOR N-1〜N-7 / NIT: §2.1 (RELAXED 1手目線 N-1、着手空=score 積まない N-2、pair は探索済合法のみ N-3、ctx.stopped 伝播 N-4)、§3 (N-5)、§4 bench (dm 入りデッキ fixture N-7)、card-zobrist TODO (N-6) に反映。

**結論**: §2 をヘルパ方式へ改稿済 (下記)。実装着手可。

## 8. M2 レビュー反映 (2026-07-05、単一 general-purpose agent / #109、実装完了時・push 前)

**判定: CHANGES_REQUIRED → 反映済で push 可 (APPROVE_WITH_NITS 相当)**。設計・符号・詰み規約・無回帰の構造は健全と確認 (A 符号/depth OK・B 非 dm 経路バイト等価 OK・C 防御ガード OK・D production 等価 OK)。以下を反映:

| # | 指摘 | 反映 |
|---|---|---|
| **BLOCKER-1** | `npm run typecheck` 赤 (`ai-action-bridge.test.ts` の `move2` リテラルに `Move.player` 欠落、TS2741)。test:ci は esbuild で型剥がすため緑だが tsc/build は失敗。**bridge テスト追加後に typecheck 再実行を怠った手落ち** | `move2` に `player:"sente"` 追加 → typecheck/lint/test:ci 795/build **全緑を再確認** |
| MINOR-1 | B-3 の kernel status 判定は check_break 局面で UI の生 isCheckmate より permissive。ただし「生盤面で詰み ⟹ kernel でも詰み」ゆえ **一方向・安全側** (AI が本物の禁じ手詰みを指さない)。コメントの「UI と同一結果」は不正確 | ヘルパ header コメントを「一方向・安全側の乖離」と正確化 |
| MINOR-2 | 1手目 `getKingSafePseudoLegalMoves` に cardState 未伝播 (no_promote マーク駒の成りは kernel silent-block されるため候補が広いだけ・不正状態なし) | コメントで kernel silent-block 委譲を明記。冗長な `.filter(!isKingCapture)` 除去 (getKingSafePseudoLegalMoves が内部除外済、NIT-2) |
| NIT-1 | 詰みスコア特性化・check_break 集合比較・4-dispatch reducer E2E のテスト薄 | 後続 (段階c の実機確認 + 派生テスト) で補完。現行 7 件で主要点はカバー |

**教訓**: 最終編集 (テスト追加) 後に full gate 全項目 (特に typecheck) を再実行してから完了報告する (rule 実装ガイドライン6)。
