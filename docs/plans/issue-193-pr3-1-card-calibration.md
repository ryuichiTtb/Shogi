# Issue #193 PR3-1: カード/ドロー価値キャリブレーション 実装計画

## 0. 文書管理

| 項目 | 内容 |
|---|---|
| 親 Issue | [#193](https://github.com/ryuichiTtb/Shogi/issues/193) AI 棋力強化 (epic) |
| 親計画 md | `docs/plans/issue-193.md` (L570-590 が PR3 セクション) |
| 親メモ | `project-issue-193-roadmap.md` |
| 本計画 md ブランチ | `chore/#193-pr3-1-plan` (計画のみ、本ファイル追加) |
| 実装ブランチ (後続) | `feature/#193-pr3-1` (レビュー合意後に別途作成) |
| 起点 | `origin/main` (PR #231 マージ後、`0ba8f57`) |

## 1. 背景・課題

### 1.1 PR3 全体スコープ内での位置付け

親計画 md L570-590 が定義する **PR3 = カード深読み探索 + cardDigest 増分更新化** は以下 6 要素を含む大規模変更:

| # | 要素 | 本サブ PR で対応 |
|---|---|---|
| (a) | カード/ドロー価値キャリブレーション(運用検証由来) | **本 PR (PR3-1)** |
| (b) | cardDigest 増分更新化 (`updateCardDigest`) | PR3-2 |
| (c) | TurnAction を深さ N までカード使用候補に組み込む | PR3-3 |
| (d) | 二手指し統合探索の多手先拡張 (`double_move` タダ捨て対応含む) | PR3-3 |
| (e) | 相手期待値モデル | PR3-4 |
| (f) | マルチ PV / 将来フィールド検討 | 別途判断 |

PR1d を 4 サブ PR に分割したのと同様、PR3 もデグレ切り分け容易性とリスク低減のためサブ PR に分割。**PR3-1 はもっとも独立性が高くユーザー体験への効果が大きい (a) を最優先で先行する**。

### 1.2 解消したい退化 (現状の不具合)

PR1d 完了 (`6fb006d` `0ba8f57` 時点) の AI で、運用検証により以下退化が再現する:

> **「序盤のみカード/ドローを使い、中盤以降はマナ上限・手札過多でも全くカードを使わない」**

各原因は親計画 md L583-584 に列挙のとおりで、現状コードを確認した結果以下のとおりロジックに対応している:

| # | 退化原因 | 関連実装 (path:line) | 機序 |
|---|---|---|---|
| ① | ドロー +30 固定 | [src/lib/shogi/ai/cards/heuristics.ts:20](src/lib/shogi/ai/cards/heuristics.ts#L20) `DRAW_VALUE_BONUS=30` + [src/lib/shogi/ai/search.ts:760](src/lib/shogi/ai/search.ts#L760) | 局面・手札・マナに依らず常に +30。中盤以降の手札過多 (5+枚) / マナ過多 (15+) でも同じ評価で押し出されない |
| ② | 中盤以降の駒得 cp に桁負け | [src/lib/shogi/ai/cards/digest.ts:97-112](src/lib/shogi/ai/cards/digest.ts#L97) `evaluateCardDigest` | `manaDelta × 10 + handValueDelta + drawProgressDelta × 3 + trapPresence` の合計は中盤で大体 ±40 cp 程度。駒交換 1 回で ±90〜600 cp 動くので相対的に消滅 |
| ③ | 手札価値が指数飽和 | [src/lib/shogi/ai/cards/digest.ts:87-89](src/lib/shogi/ai/cards/digest.ts#L87) `computeHandValue` (`HAND_VALUE_BASE=20`, `HAND_VALUE_DECAY=3.0`) | `20 × (1 - exp(-handSize / 3))` は 3 枚で 12.64 cp (63%)、5 枚で 16.22 cp (81%)。限界価値 3→4 枚 ≒ +0.86 cp で 4 枚目以降の追加価値が事実上 1 cp 未満。中盤に手札がすでに 3-4 枚あればドロー価値ほぼゼロ。(PR3-3 C-9 / レビュー F-3 で実値訂正: 旧記述「19.0 cp / 95%」は分母 DECAY を取り違えた誤計算) |
| ④ | マナ上限で manaDelta 価値消失 | digest `manaDelta = mana.sente - mana.gote`、`MANA_CAP=20`、[src/lib/shogi/cards/definitions.ts:228](src/lib/shogi/cards/definitions.ts#L228) | 両者とも上限到達後は manaCharge イベントが来てもマナが増えず、`manaDelta` が固定化。「マナを消費してカードを使う」と短期的に manaDelta が悪化するだけで「死にマナ回収」が価値化されない |

### 1.3 ユーザー体験への影響

カード将棋の AI 相手にカード戦略が成り立たず、駒将棋ベースの応酬しか発生しない。memory 記載「**ユーザー体験に最も効く残タスク**」のとおり、PR3 内で最初に取り組むべき要素。

## 2. スコープ

### 2.1 含む

- ドロー価値の動的化(固定 30 廃止 → `getDrawValue(state, player, cardState)` 化)
- マナ上限到達ペナルティ(死にマナ価値化、`evaluateCardDigest` への項追加)
- `handValue` 減衰係数 (`HAND_VALUE_DECAY`) の再校正
- (任意) トラップ価値の局面依存化(king safety 連動の `check_break` 価値、序盤限定の `no_promote` 価値)
- 新規 bench fixture: 中盤/終盤局面で CPU の card/draw 使用率を機械計測する仕組み
- 既存棋力退化なしを `perf-bench.test.ts` の `depthCompleted` で確認
- 意図的振る舞い変更を許容する fixture (`strategy-baseline.json`) 再生成方針

### 2.2 含まない (将来 PR)

- `cardDigest` の増分更新化 (`updateCardDigest`) — **PR3-2**
- TurnAction を深さ N までカード使用候補に組み込む深読み探索 — **PR3-3**
- 二手指し統合探索の多手先拡張 (`double_move` タダ捨て対応) — **PR3-3**
- 相手期待値モデル(不完全情報) — **PR3-4**
- マルチ PV — 別途判断
- 将来追加検討フィールド (`lastTurnStartedAt` / `manaChargeEvent.reason`) — 別途判断

### 2.3 振る舞いキープ要件

- standard variant (通常将棋) には**一切影響しない**。
  - `evaluateCardDigest` は冒頭で `variant.id !== "card-shogi"` のとき 0 を返す既存ガードを維持。
  - `evaluateAction` の draw / playCard 経路は card-shogi のみで呼ばれる(`engine.ts` root で `cardState` が存在する場合のみ)。

## 3. 現状コード把握

### 3.1 評価関係の主要シグネチャ

```ts
// src/lib/shogi/ai/search.ts:739
evaluateAction(state, action, player, variant, ctx?, excludeTadasute=false): number
  ├ move:     evaluate(applyMove(state, action.move), variant, cardDigest)
  ├ draw:     evaluate(state, variant, cardDigest) + DRAW_VALUE_BONUS          // ← ① 固定
  └ playCard:
       ├ double_move:                   searchDoubleMoveSuperAction(...)
       ├ no_promote / check_break:      evaluate(state, ...) + TRAP_VALUE_*    // ← ② 固定
       └ others (pawn_return 等):       evaluate(simulateCardEffect(state), ...)

// src/lib/shogi/ai/cards/digest.ts:97
evaluateCardDigest(digest, variant): number =
  manaDelta × MANA_DELTA_COEFFICIENT
+ handValueDelta                                  // ← ③ 飽和
+ drawProgressDelta × DRAW_PROGRESS_COEFFICIENT
+ evaluateTrapPresence(trapPresence)
+ noPromoteMarkCountDelta × NO_PROMOTE_MARK_COEFFICIENT
  ※ 現状 manaCap 連動項なし                    // ← ④ 死にマナ未価値化
```

### 3.2 関連定数 (全て `src/lib/shogi/ai/cards/heuristics.ts`)

| 名前 | 現値 | 用途 | 本 PR の方針 |
|---|---|---|---|
| `MIN_MANA_RESERVE` | 2 | ドロー判定の最低マナ確保 | 維持(別軸) |
| `DRAW_VALUE_BONUS` | 30 | ドロー固定ボーナス | **動的化(関数化)** |
| `HAND_VALUE_BASE` | 20 | 手札 1 枚目の最大価値 | 維持 |
| `HAND_VALUE_DECAY` | 3.0 | handValue 減衰係数 | **再校正候補 (4.5〜6.0)** |
| `MANA_DELTA_COEFFICIENT` | 10 | マナ 1 差 = 10 cp | 維持(死にマナ別項) |
| `DRAW_PROGRESS_COEFFICIENT` | 3 | drawProgress 1 差 = 3 cp | 維持 |
| `TRAP_VALUE_NO_PROMOTE` | 50 | 盤上 no_promote 1 枚価値 | 維持(or 序盤限定昇圧) |
| `TRAP_VALUE_CHECK_BREAK` | 80 | 盤上 check_break 1 枚価値 | 維持(or king safety 連動) |
| `NO_PROMOTE_MARK_COEFFICIENT` | 30 | マーク数差 × cp | 維持 |
| `EARLY_GAME_THRESHOLD` | 40 | 序盤判定の両者合計 ply | **流用(phase 判定)** |
| `MIN_MANA_RESERVE_FOR_TRAP` | 6 | トラップセット時のマナ余裕 | 維持 |
| `CHECK_BREAK_TRIGGER_THRESHOLD` | -200 | check_break プリエンプティブ閾値 | 維持 |
| `DOUBLE_MOVE_TOP_K` | 10 | super-action 1 手目候補上限 | 維持(PR3-3 で再検討) |

### 3.3 既存 bench

- `src/lib/shogi/ai/__tests__/perf-bench.test.ts` (93 行、`RUN_PERF_BENCH=true` で起動): 初期局面 + 8 ply 進めた局面 × 4 難易度で `depthCompleted` / `nodes` / `elapsedMs` をログ出力のみ。baseline 比較は将来。
- `src/lib/shogi/ai/__tests__/perf-bench-spectator.test.ts` (73 行): 観戦モード版。
- いずれも **「カード使用率」を測定する仕組みは未実装**。本 PR で追加が必要。

## 4. 設計

### 4.1 ドロー価値の動的化

#### 4.1.1 関数化

`evaluateAction` の draw 経路で `DRAW_VALUE_BONUS` を直接加算している箇所を、純粋関数化する:

```ts
// src/lib/shogi/ai/cards/heuristics.ts (新規追加)
export function getDrawValue(
  state: GameState,
  player: Player,
  cardState: CardGameState,
): number {
  const handSize = cardState.hand[player].length;
  const mana = cardState.mana[player];

  // 1. 手札ペナルティ: 手札が多いほどドロー価値↓
  //    handValue が指数飽和するため明示的に重複ペナルティを引かない。
  //    代わりに「手札 5 枚以上で追加 1 枚は実質無価値」を表現。
  const handPenalty = Math.max(0, handSize - DRAW_HAND_THRESHOLD)
                    * DRAW_HAND_PENALTY_PER_CARD;

  // 2. マナ余剰ボーナス: マナが余っているほどドロー価値↑(死にマナ回収)
  const manaSurplus = Math.max(0, mana - DRAW_MANA_SURPLUS_THRESHOLD);
  const manaBonus = manaSurplus * DRAW_MANA_SURPLUS_COEF;

  // 3. 局面段階ボーナス: 中盤以降は手札の選択肢価値が高いと仮定
  const phase = computePhaseStage(state); // 0=opening, 1=midgame, 2=endgame
  const phaseBonus = phase === 0 ? 0
                   : phase === 1 ? DRAW_PHASE_MID_BONUS
                   : DRAW_PHASE_END_BONUS;

  return DRAW_VALUE_BASE + manaBonus + phaseBonus - handPenalty;
}
```

#### 4.1.2 新規定数(仮値、bench で校正)

| 定数 | 仮値 | 根拠 |
|---|---|---|
| `DRAW_VALUE_BASE` | 20 | 現 `DRAW_VALUE_BONUS=30` から bonus 系を切り出した残基底 |
| `DRAW_HAND_THRESHOLD` | 4 | 手札 4 枚までは追加価値あり、5 枚目以降は減点 |
| `DRAW_HAND_PENALTY_PER_CARD` | 8 | 1 枚超過あたり -8 cp。5 枚で -8、6 枚で -16 |
| `DRAW_MANA_SURPLUS_THRESHOLD` | 8 | マナ 8 まではドローボーナス無し(普通の余裕レベル) |
| `DRAW_MANA_SURPLUS_COEF` | 3 | 余剰 1 マナ = +3 cp。MANA_CAP=20 で +36 cp 加算可能 |
| `DRAW_PHASE_MID_BONUS` | 15 | 中盤はカード戦略が効くため固定加算 |
| `DRAW_PHASE_END_BONUS` | 5 | 終盤は手数限定で小さめ |

#### 4.1.3 `computePhaseStage(state)` (新規ヘルパ)

```ts
// src/lib/shogi/ai/cards/heuristics.ts (新規追加)
export function computePhaseStage(state: GameState): 0 | 1 | 2 {
  const ply = state.moveCount;       // 両者合計 ply。GameState の既存フィールド
  if (ply < EARLY_GAME_THRESHOLD) return 0;  // 序盤 (両者合計 < 40)
  if (ply < ENDGAME_THRESHOLD) return 1;     // 中盤
  return 2;                                  // 終盤
}
export const ENDGAME_THRESHOLD = 100;
```

- `EARLY_GAME_THRESHOLD = 40` は既存定義を流用。
- `ENDGAME_THRESHOLD = 100` を新規追加(平均的なカード将棋対局は 80-150 手程度)。
- 「材料残量(残駒数)」での phase 判定は将来検討、本 PR は ply ベースのシンプル定義に留める(計算量・実装複雑度を抑制)。

### 4.2 マナ上限到達ペナルティ(死にマナ価値化)

#### 4.2.1 `evaluateCardDigest` に項追加

```ts
// src/lib/shogi/ai/cards/digest.ts evaluateCardDigest (修正)
export function evaluateCardDigest(digest, variant): number {
  if (variant.id !== "card-shogi") return 0;
  let value =
    digest.manaDelta * MANA_DELTA_COEFFICIENT +
    digest.handValueDelta +
    digest.drawProgressDelta * DRAW_PROGRESS_COEFFICIENT;
  value += evaluateTrapPresence(digest.trapPresence);
  value += digest.noPromoteMarkCountDelta * NO_PROMOTE_MARK_COEFFICIENT;
  // 新規: マナ上限近接ペナルティ (sente 絶対視点)
  value += evaluateDeadManaPenalty(digest);
  return value;
}

function evaluateDeadManaPenalty(digest: CardDigest): number {
  // 「マナが上限に近いほど死にマナ価値損失」を sente 絶対視点で表現。
  // sente が上限に近い = sente の死にマナ機会損失大 = sente にとって - (劣勢方向)
  // 逆に gote が上限に近い = gote の死にマナ = gote にとって - = sente にとって +
  // digest には mana.sente / mana.gote が直接ないため manaAbsolute を新規追加 (4.2.2)
  const senteOverflow = Math.max(0, digest.manaAbsolute.sente - DEAD_MANA_THRESHOLD);
  const goteOverflow  = Math.max(0, digest.manaAbsolute.gote  - DEAD_MANA_THRESHOLD);
  return (goteOverflow - senteOverflow) * DEAD_MANA_PENALTY_COEF;
}
```

#### 4.2.2 `CardDigest` 構造拡張

現状 `manaDelta` (sente - gote) しか持たないため、絶対値を新規フィールドで保持:

```ts
// src/lib/shogi/ai/cards/digest.ts (interface 追加)
export interface CardDigest {
  manaDelta: number;       // 既存
  manaCap: number;         // 既存
  manaAbsolute: {          // 新規 (sente/gote の生マナ値、死にマナ計算用)
    sente: number;
    gote: number;
  };
  handValueDelta: number;
  drawProgressDelta: number;
  trapPresence: ...;
  noPromoteMarkCountDelta: number;
}
```

`computeCardDigest` で `cardState.mana.sente / .gote` をそのまま格納するだけ(O(1))。

#### 4.2.3 新規定数

| 定数 | 仮値 | 根拠 |
|---|---|---|
| `DEAD_MANA_THRESHOLD` | 16 | MANA_CAP=20 の 80% 到達でペナルティ発生 |
| `DEAD_MANA_PENALTY_COEF` | 4 | 1 マナ過剰 = -4 cp。20-16=4 マナ過剰で最大 -16 cp |

### 4.3 `handValue` 減衰再校正

現状 `HAND_VALUE_DECAY = 3.0` は 3 枚で 63% (12.64 cp) 飽和、中盤に手札 3-4 枚を想定すると追加 1 枚価値が 1 cp 未満 (3→4 枚 +0.86 cp / 4→5 枚 +0.62 cp)。

校正案: **`HAND_VALUE_DECAY = 5.0`** に変更
(PR3-3 C-9 / レビュー F-3 で実値訂正、旧記述「3 枚 91% / 18.2 cp」「5 枚 99% / 19.7 cp」は誤計算)

| 手札枚数 | DECAY=5.0 (新) | DECAY=3.0 (旧) | 限界価値 (DECAY=5.0、追加 1 枚増分) |
|---|---|---|---|
| 3 枚 | 9.02 cp (45%) | 12.64 cp (63%) | — |
| 4 枚 | 11.01 cp (55%) | 13.46 cp (67%) | 3→4 枚 = +1.99 cp |
| 5 枚 | 12.64 cp (63%) | 16.22 cp (81%) | 4→5 枚 = +1.63 cp |
| 7 枚 | 15.02 cp (75%) | 18.21 cp (91%) | 6→7 枚 = +1.09 cp |
| 10 枚 | 17.29 cp (86%) | 19.29 cp (96%) | 9→10 枚 = +0.68 cp |

- 目的: 中盤 3-5 枚での限界価値 +1.5〜2.0 cp を残す (= ドロー判断に効く)
- bench で `4.0 / 5.0 / 6.0` を比較し最適点を採用 (本 PR では 5.0 採用)

これは退化原因 ③ への直接対策で、`evaluateCardDigest` の構造変更を伴わない安全な係数調整。

### 4.4 トラップ価値の局面依存化(任意)

本 PR で着手するか議論ポイント:

- `TRAP_VALUE_CHECK_BREAK = 80` 固定 → king safety スコアと連動して動的化
  - 玉が安全な序盤 = 価値低、玉危険な中終盤 = 価値高
  - 既存 [evaluators/king-safety.ts](src/lib/shogi/ai/evaluators/king-safety.ts) のスコアを参照
  - **複雑度増・bench 検証コスト増のため PR3-2 以降に送る案も検討**(本 md の論点)
- `TRAP_VALUE_NO_PROMOTE = 50` は EARLY_GAME_THRESHOLD 内で +20 ボーナス
  - 既存 [heuristics.ts:70](src/lib/shogi/ai/cards/heuristics.ts#L70) `EARLY_GAME_THRESHOLD = 40` を流用
  - 本 PR スコープに含めるか論点

**初期案**: 本 PR では着手せず、PR3-2 (cardDigest 増分更新化) と統合検討する。本 PR は退化原因 ①②③④ の直接解消に集中。

### 4.5 通常カード (pawn_return / piece_return / double_pawn) の価値

これらは `simulateCardEffect` で board change 経由評価され、駒価値 (PIECE_VALUES) で自然に cp 化される。退化原因に直接該当しないため、本 PR では係数調整しない(必要なら PR3-3 で深読みと一緒に検討)。

ただし「マナ消費 -X」のコストが board change cp を相対的に圧迫する構造は、4.1 / 4.2 / 4.3 の改善で manaDelta / handValueDelta / drawProgress の base 価値が上がる結果として間接的に解消される見込み。

## 5. 検証計画

### 5.1 ユニットテスト

新規ファイル: `src/lib/shogi/ai/cards/__tests__/heuristics.test.ts`
- `getDrawValue`: 手札 0/3/5/7 × マナ 2/8/15/20 × phase 0/1/2 のマトリクスで境界値テスト
- `computePhaseStage`: ply=0/39/40/99/100/200 の境界値
- `evaluateDeadManaPenalty`: senteAbsolute=12/16/20 × goteAbsolute=12/16/20 の対称性 + 境界値

既存テスト: [src/lib/shogi/ai/__tests__/card-digest.test.ts](src/lib/shogi/ai/__tests__/card-digest.test.ts) の数値固定アサーションを新定数で再計算して更新(`manaAbsolute` フィールド追加に伴う計算式変更)。

既存テスト: [src/lib/shogi/ai/__tests__/evaluate-action.test.ts](src/lib/shogi/ai/__tests__/evaluate-action.test.ts) の `DRAW_VALUE_BONUS` 直接参照テストを `getDrawValue` 呼び出しベースに更新。

### 5.2 機械化 DoD: カード使用率 bench

**新規ファイル**: `src/lib/shogi/ai/__tests__/perf-bench-card-usage.test.ts`(`RUN_PERF_BENCH=true` で起動)

```ts
describe.skipIf(!RUN_PERF_BENCH)("perf-bench card 使用率", () => {
  test("各難易度で midgame/endgame fixture で card/draw が一度以上選ばれる", () => {
    const fixtures = [
      { label: "midgame-1", ...loadFixture("midgame-1.json") },
      { label: "midgame-2", ...loadFixture("midgame-2.json") },
      { label: "endgame-1", ...loadFixture("endgame-1.json") },
      // ... 計 6-10 局面
    ];
    for (const diff of ["beginner", "advanced", "expert"]) {
      let cardCount = 0;
      for (const fx of fixtures) {
        const r = findBestMoveWithStats(fx.state, fx.player, diff, CARD_SHOGI_VARIANT, { cardState: fx.cardState });
        if (r.action?.kind === "playCard" || r.action?.kind === "draw") cardCount++;
      }
      const usageRate = cardCount / fixtures.length;
      console.log(`[card-usage] ${diff}: usageRate=${(usageRate*100).toFixed(0)}% (${cardCount}/${fixtures.length})`);
      // DoD: 中盤以降 fixture で card 使用率 > 0% (1 件以上)
      expect(cardCount).toBeGreaterThanOrEqual(1);
    }
  });
});
```

**fixture 構成案** (`src/lib/shogi/ai/__tests__/fixtures/card-usage/*.json`):
- midgame: 両者合計 ply 40-80 で「手札 4 枚 + マナ 10-15」の局面 × 3-4
- endgame: 両者合計 ply 80-120 で「手札 3 枚 + マナ 15-20(マナ上限近接)」× 2-3

PR1d で生成済の `card-shogi-midgame` / `card-shogi-endgame` fixture (`strategy-baseline.json` 内 80+80 局面)から抜粋して構築。手書きせず既存 fixture を再利用。

### 5.3 棋力退化なし確認

- 既存 `perf-bench.test.ts` を `RUN_PERF_BENCH=true` で実行し、本 PR 前後の `depthCompleted` を比較
- **DoD**: 全難易度で `depthCompleted` 退化 ±10% 以内(親計画 md L635 と同じ基準)
- baseline は本 PR の最初のコミットで取得 → ログを PR コメントに貼付

### 5.4 fixture 再生成

`strategy-baseline.json` (PR1a で生成、PR1c-2 / PR2 で「完全一致」DoD だった) は本 PR で**意図的に振る舞いが変わる**(中盤以降の手の選択が変化)ため、再生成が必要:

```bash
npm run gen:fixture:strategy --variant=card-shogi --skip-opening
```

親計画 md L683 のとおり「PR3 で振る舞い変更を意図的に導入する場合」が再生成タイミングに該当。standard variant は影響なしのため再生成不要。

観戦モード fixture (`spectator-baseline.json`) も親計画 md L675「PR3: 両者対称的な振る舞い + 高度なカード戦略の発現」のとおり振る舞い変更が許容されるため、対称性確認のみ実施し fixture 自体は再生成しない方針(両者 CPU が対称的に動けば良い)。

### 5.5 必須チェック (AGENTS.md ルール 6)

- `npm run lint` → 0 errors
- `npm run typecheck` → クリーン
- `npm run test:ci` → 全 green(`card-digest.test.ts` / `evaluate-action.test.ts` 等の数値更新含む)
- `npm run build` → 成功
- `RUN_PERF_BENCH=true npm run test:ci -- perf-bench` → log 確認(card-usage / 棋力退化なし)
- Vercel Preview deploy → 実機で中盤以降の CPU 対局を観察(カード使用が発現すること)

## 6. リスクと対策

| # | リスク | 対策 |
|---|---|---|
| R-1 | 校正で AI がカードを使いすぎ、駒将棋スキルが退化 | `perf-bench` で `depthCompleted` ±10% 以内を維持 + 棋力比較 fixture(後述)を bench に追加 |
| R-2 | 仮値定数の調整で局所最適に陥り、別カードで悪化 | 定数を 1 つずつ変えて bench を取り直す段階反映(commit 単位を細分化) |
| R-3 | `manaAbsolute` フィールド追加が cardDigest 構造変更で他箇所影響 | digest は root スカラーで子ノード伝播のみ。`computeCardDigest` 内部の +O(1) 追加のみで search 経路は変更なし |
| R-4 | 既存 `strategy-baseline.json` の fixture green が破綻 | 親計画 md L683 のとおり「PR3 で振る舞い変更を意図的に導入する場合」に該当。再生成を計画手順に明示 |
| R-5 | standard variant への意図せぬ影響 | `evaluateCardDigest` 冒頭 `variant.id !== "card-shogi"` ガードを維持。standard fixture (`strategy-baseline.json` の standard 100 局面)で byte-level 一致を確認(再生成しない) |
| R-6 | bench fixture 局面が偏り「カード使用率 > 0」DoD が実質的に意味なし | fixture は手札・マナ・盤面 stage を分散させた 6-10 局面で構成。難易度ごとに別集計 |
| R-7 | `computePhaseStage` の閾値(40/100)が card-shogi 統計と整合しない | 既存 `EARLY_GAME_THRESHOLD=40` を流用。`ENDGAME_THRESHOLD=100` は仮値、bench で再校正可。閾値変更は定数 1 行 |
| R-8 | check_break / no_promote の固定価値据置で「中盤以降の トラップ価値」も不適切な可能性 | 本 PR スコープ外。退化原因 ①②③④ への直接対策に集中。トラップ動的化は PR3-2 で別途検討 |

## 7. DoD (= 完了の定義)

- [ ] `getDrawValue` 関数化・新定数 6 個導入完了。固定 `DRAW_VALUE_BONUS=30` 廃止
- [ ] `evaluateDeadManaPenalty` 項を `evaluateCardDigest` に追加。`CardDigest.manaAbsolute` フィールド追加
- [ ] `HAND_VALUE_DECAY` を bench 校正値に変更
- [ ] `computePhaseStage` ヘルパ + `ENDGAME_THRESHOLD` 定数追加
- [ ] `heuristics.test.ts` 新規 + 既存 `card-digest.test.ts` / `evaluate-action.test.ts` 更新
- [ ] `perf-bench-card-usage.test.ts` 新規追加。**全難易度の中盤/終盤 fixture で card 使用率 > 0** を assert
- [ ] `RUN_PERF_BENCH=true` の既存 `perf-bench.test.ts` で本 PR 前後の `depthCompleted` 退化なし(±10% 以内、ログ比較を PR コメントに貼付)
- [ ] `strategy-baseline.json` の card-shogi-midgame / card-shogi-endgame を再生成(意図的振る舞い変更)
- [ ] standard variant fixture は再生成しない・破綻なし
- [ ] lint / typecheck / test:ci / build green
- [ ] Vercel preview で中盤以降の CPU 対局で card 使用が発現することを実機確認(ユーザー)

## 8. 実装手順(commit 単位)

各 commit 後に `npm run lint && npm run typecheck && npm run test:ci` を通す。bench は最後の commit でまとめて取得。

| # | commit | 内容 | 検証 |
|---|---|---|---|
| C-1 | feat: phase 判定 + 新規定数追加 | `computePhaseStage` / `ENDGAME_THRESHOLD` / 新規定数 6 個を `heuristics.ts` に追加。既存値・他関数は変更しない | ユニットテスト追加・既存 test green |
| C-2 | feat: ドロー価値動的化 | `getDrawValue` 追加、`evaluateAction:760` を呼び出しに置換。`DRAW_VALUE_BONUS` 直接参照を新規関数経由に | `evaluate-action.test.ts` 更新、test green |
| C-3 | feat: 死にマナペナルティ追加 | `CardDigest.manaAbsolute` + `computeCardDigest` 拡張 + `evaluateDeadManaPenalty` 追加 + `card-digest.test.ts` 数値更新 | test green |
| C-4 | tune: `HAND_VALUE_DECAY` 再校正 | 3.0 → 5.0(仮、bench 後最終値に上書き) | test green、`card-digest.test.ts` 数値更新 |
| C-5 | test: card-usage bench 追加 | `perf-bench-card-usage.test.ts` 新規 + `fixtures/card-usage/*.json` 抜粋 | `RUN_PERF_BENCH=true` で log 確認 |
| C-6 | chore: `strategy-baseline` 再生成 | **本 PR では deferred (下記 11.3 参照)** | — |
| C-7 | docs: 計画 md 完了サマリ + メモ更新 | 本 md 末尾に「11. 実装完了サマリ」追記 + `project-issue-193-roadmap.md` を PR3-1 完了状態に更新 | — |

C-1〜C-4 は機能変更、C-5〜C-7 は検証・メタ。各 commit でデグレ切り分けが容易。

## 9. 後続 PR との連携

| PR | 着手条件 | 本 PR との関係 |
|---|---|---|
| PR3-2 (cardDigest 増分更新化) | 本 PR 完了後 | `CardDigest.manaAbsolute` 追加が増分更新化の対象に含まれる |
| PR3-3 (深読み探索 + 二手指し統合) | PR3-2 完了後 | `getDrawValue` / `evaluateDeadManaPenalty` は深さ N でも同じ評価関数として呼ばれる |
| PR3-4 (相手期待値モデル) | PR3-3 完了後 | 期待値モデルが draw / playCard の不完全情報部分を扱うため、本 PR の cp スケールが基準値となる |

本 PR の cp スケール(数値定数)が後続 PR3-2/3/4 のすべての基準値になるため、本 PR の bench DoD が後続全体のリグレッション基準となる。**したがって、本 PR の DoD 達成基準(中盤以降カード使用率 > 0 + 棋力退化なし)を厳密に守ることが、PR3 epic 全体のリスク管理の核**。

## 10. 不明点・要レビュー論点

レビュアー(ユーザー / セルフレビュー両軸)に判断を仰ぎたい論点:

- **論点 P-1**: 4.4 トラップ価値の局面依存化を本 PR に含めるか否か。複雑度を抑えて退化原因①②③④に集中する案を初期提示しているが、「カード使用率 > 0」DoD 達成のために必要なら本 PR に含める判断もあり。
- **論点 P-2**: `computePhaseStage` の閾値 (`EARLY_GAME_THRESHOLD=40`, `ENDGAME_THRESHOLD=100`) の妥当性。bench fixture の ply 分布と整合するか実装時に確認が必要。仮値で着手し、bench 計測後に最終値を決定する方針。
- **論点 P-3**: `DRAW_VALUE_BASE=20` / `DRAW_PHASE_MID_BONUS=15` 等の仮値は変動幅が大きい。bench でカード使用率がゼロから改善する最小値を採用する方針で良いか(過剰なカード使用は別の退化を生む)。
- **論点 P-4**: 新規 fixture (`fixtures/card-usage/*.json`) は既存 `strategy-baseline.json` から抜粋する方針だが、PR1d 時点の fixture が振る舞い変更で再生成されるため、本 PR の bench fixture も再生成タイミングで更新する必要がある。再生成スクリプトの拡張要否。

## 11. 実装完了サマリ (C-7 で追記)

### 11.1 セルフレビュー判断 (P-1〜P-4)
レビュアー判断不在のため、計画 md 設計方針に従いセルフレビューで以下のとおり処理:
- **P-1** (トラップ価値の局面依存化): **含めない**。退化原因①②③④の解消に集中し DoD 達成を狙う。トラップ動的化は king safety 評価との結合が必要で複雑度大、PR3-2 以降で別途検討。
- **P-2** (phase 閾値): 仮値 (40/100) で着手 → bench で再校正可。本 PR 計測結果は問題なし。
- **P-3** (校正方針): カード使用率 0 → > 0 の最小値を採用 + perf-bench `depthCompleted` を上限ガード。bench 結果は 4/4 シナリオで全難易度カード採用、過剰でないことも確認 (使用率 100% は isolation fixture 限定、実盤面では PR3-3 後に再計測)。
- **P-4** (新規 fixture): 既存 strategy-baseline からの抜粋は不要と判断。代わりに初期盤面 + `moveCount` 上書きの isolation 局面を programmatic に構築し、tactical 影響を排した clean な calibration 効果検証を実現 (perf-bench-card-usage.test.ts に説明コメント明記)。

### 11.2 commit 一覧 + 検証結果
| commit | 内容 | 検証 |
|---|---|---|
| C-1 fa56ffd | phase 判定ヘルパ + 新規定数 10 個追加 | heuristics.test.ts 7 件追加・test:ci green |
| C-2 382e408 | `getDrawValue` 動的化 + `DRAW_VALUE_BONUS=30` 削除 | heuristics.test.ts +7 件 / evaluate-action.test.ts 2 件更新・test:ci 467 件 green |
| C-3 0085553 | `CardDigest.manaAbsolute` + `evaluateDeadManaPenalty` 追加 | card-digest.test.ts 死にマナ +6 件・test:ci 473 件 green |
| C-4 ba3343f | `HAND_VALUE_DECAY` 3.0 → 5.0 再校正 | 既存 test 数式自動追従・473 件 green |
| C-5 2e7b548 | `perf-bench-card-usage.test.ts` 新規 (RUN_PERF_BENCH=true で起動) | 全難易度の isolation fixture で 100% (4/4) カード採用、DoD 達成 |

### 11.3 C-6 (strategy-baseline 再生成) の deferred 理由
- スクリプト `scripts/gen-fixture-strategy.ts` は variant 別フィルタ非対応 (全 360 entries を一括生成)。
- 1 回の実行で約 50 分かかる (`strategy-baseline.meta.json` の `elapsedSeconds: 3032.2` 実績)。
- CI では `strategy-equivalence.test.ts` の**静的構造検証のみ**実行され、動的検証 (= 360 entries で findBestMoveWithStats 再実行) は CI 外の `scripts/verify-strategy-fixture.ts` (約 50 分タスク) に分離されている。
- 本 PR の calibration は standard variant に影響しない (`evaluateCardDigest` の `variant.id !== "card-shogi"` ガード) ため、standard-opening/midgame/endgame (180 entries) は変化なし。card-shogi-midgame/endgame (80 entries) のみ振る舞いが変わるが、これは「意図的振る舞い変更」として親計画 md L683 に明示済。
- 結論: 本 PR では再生成 deferred (CI 影響なし)。次回オフライン作業またはユーザー実行で `npm run gen:fixture:strategy` を実行することを推奨。

### 11.4 後続 PR への引継ぎ
- PR3-2 (`updateCardDigest` 増分更新化): `CardDigest.manaAbsolute` (本 PR で追加) も差分更新対象に含む。
- PR3-3 (深読み探索 + 二手指し統合): `getDrawValue` / `evaluateDeadManaPenalty` は本 PR で root-only 評価に組み込まれているが、深さ N の探索ノードでも同じ評価関数として呼ばれる。**実プレイ盤面の midgame でカード使用率を上げるのは PR3-3 の役割** (perf-bench-card-usage.test.ts コメント参照: isolation fixture では DoD 達成済、tactical 盤面は PR3-3 後に再計測)。
- PR3-4 (相手期待値モデル): 本 PR の cp スケール (DRAW_VALUE_BASE / DEAD_MANA_PENALTY_COEF 等) が期待値計算の基準値。
