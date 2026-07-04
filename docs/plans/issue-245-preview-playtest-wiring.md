# Issue #245 Preview 実機検証 配線計画 (学習 CPU を安全トグルで Preview 有効化)

> 目的: ユーザーが Vercel Preview で **学習評価 (NN) を積んだ CPU と実際に対戦**して検証できるようにする。
> 前回の改悪 (龍王で無駄カード多発) はユーザーの実機対戦で発見された = **人手プレイテストは自動勝率が見逃す「体感の変さ」を捕まえる**。診断 (P2-2b) が modest-positive ゆえ、12〜24h の自動勝率投資の前に**まず手で確かめる**。
> 着手前 rule-8 M1 レビュー (単一 general-purpose agent / #109) の対象。**production/main の既定挙動は完全不変** (default-OFF トグル)。

---

## 0. 一言サマリ

- **やること**: 環境変数 1 つ (`ENABLE_LEARNED_EVAL=1`) を立てた Preview デプロイでだけ、AI が学習脳で指すようにする。未設定 (= 本番/通常) は現状の bolt-on CPU のまま**バイト不変**。
- **要る配線 3 点**: ① 重みファイルを Git 追跡パスへ (デプロイに載せる) ② route.ts で env ON 時に `loadLearnedModel` + `useTurnActionSearch:true` + `useLearnedEval:true` を渡す ③ 既定 OFF の無回帰ガード。
- **可逆**: env を外す or 配線行削除で即座に戻る。

---

## 1. 現状のコード事実 (実コード確認済み)

| # | 事実 | 出典 |
|---|---|---|
| W1 | route.ts は `findBestMoveWithStats(..., { useKernelSearch:true })` のみ。`useTurnActionSearch`/`useLearnedEval` は**渡していない** (S4e で world 経路活性化を revert、経緯コメント有) | `route.ts:200-233` |
| W2 | 本番コードに `loadLearnedModel` 呼出は**無い** (infer.ts の定義とテスト/スクリプトのみ)。= production では NN が一度もロードされない | `grep loadLearnedModel src/` |
| W3 | 重み `local-data/training/model-bootstrap-small.json` は **gitignore = デプロイに含まれない** | `git check-ignore` |
| W4 | `evalLeafWorld` は `useLearnedEval && hasLearnedModel()` の両真でのみ NN 分岐。未ロードなら人手 eval へ silent fallback | `search.ts:898` |
| W5 | P2-2a で engine `FindBestMoveOptions.useLearnedEval` は配線済 (route から渡せば効く) | `engine.ts:191,266` |
| W6 | world 経路 revert の理由は engagement 下駄 (card 使用強制) による無駄カード。**engagement は撤去済** + 学習評価が over-valuation を直す (P2-2b 実測) = 今回はトグル ON で検証する対象そのもの | `route.ts:224-232` / P2-2b §12 |

---

## 2. 配線設計 (最小・default-OFF)

### 2.1 重みをデプロイに載せる (W3)
`model-bootstrap-small.json` を Git 追跡パスへ複製し、コードから読めるようにする。方式は M1 で確定 (下記候補):
- **候補 A (推奨): 静的 import** — `src/lib/shogi/ai/learned/preview-model/bootstrap-small.json` に置き、専用モジュールが `import model from "./bootstrap-small.json"` で束ねる。webpack がバンドル。~1.7MB。確実に serverless で読める (FS 非依存)。
- 候補 B: `public/` へ置き runtime fetch/読込 — serverless FS/URL 解決が面倒ゆえ非推奨。

> ⚠️ M1 論点: 1.7MB JSON のバンドル肥大・cold-start コスト。検証用ゆえ許容の見込みだが M1 で確認。gitignore 例外の追記要否も。

### 2.2 route.ts のトグル配線 (W1/W2/W4/W5)
```
const useLearnedEval = process.env.ENABLE_LEARNED_EVAL === "1";
if (useLearnedEval) ensureLearnedModelLoaded(); // module-level guard で 1 回だけ loadLearnedModel
...
findBestMoveWithStats(..., {
  ...,
  useTurnActionSearch: useLearnedEval ? true : undefined, // world 経路 (NN リーフの前提)
  useLearnedEval: useLearnedEval || undefined,
})
```
- `ensureLearnedModelLoaded()` は新規小モジュール (2.1 の import + `hasLearnedModel()` 未ロード時のみ `loadLearnedModel`)。冪等・スレッド安全 (module-local boolean)。
- **env 未設定時**: 両フラグ未伝播 = `useKernelSearch:true` の bolt-on 経路 = **現状バイト不変** (W1)。

### 2.3 UX (どの難易度で効くか)
- 既定: env ON なら**全難易度**で学習脳 (ユーザー了承済「おまかせなら全難易度」)。
- 比較したい場合の代替 (M1 で要否判断): 特定難易度のみ学習脳にする分岐。今回は簡潔さ優先で全難易度。

---

## 3. 無回帰・安全性 (#109)

- **production/main 不変**: env `ENABLE_LEARNED_EVAL` 未設定が既定 → 両フラグ未伝播 → bolt-on 完全維持。Vercel は Preview 環境にのみ env を設定 (production 環境には設定しない) ことで本番安全。
- **可逆**: env 削除 or route の配線ブロック削除で即戻る。
- **world 経路 revert 履歴 (W6)**: 前回の改悪原因 (engagement 下駄) は撤去済。今回はフラグ内でのみ有効化 = 既定に影響なし。**「今の学習脳 + engagement 無し」の world 経路が実際どう指すか**を確かめるのが本配線の目的。
- **速度 (Vercel 関数時間)**: 1 手の time budget (difficulty 既定 or spectator) + NN (~+20%)。M1 で Vercel の関数最大実行時間と 1 手予算の整合を確認 (超過なら timeout)。

---

## 4. 実装物

| 物 | 種別 | 内容 |
|---|---|---|
| `src/lib/shogi/ai/learned/preview-model/bootstrap-small.json` | 新規 (Git 追跡) | 重み複製 (2.1) |
| `src/lib/shogi/ai/learned/preview-model/index.ts` (仮) | 新規 | `ensureLearnedModelLoaded()` (冪等ロード) |
| `src/app/api/ai-move/route.ts` | 変更 | env トグルで 2 フラグ伝播 + ロード (2.2) |
| 本計画書 | doc | — |

## 5. テスト・検証

- **ユニット**: `ensureLearnedModelLoaded` が 1 回だけロードし `hasLearnedModel()` を true にする / 冪等。route の env OFF で両フラグ未伝播を特性化 (可能なら)。
- **full gate**: lint/typecheck/test:ci/build 緑。build でバンドル肥大警告が出ないか確認。
- **実機**: Preview デプロイ (env ON) でユーザーが対戦し「強さ・カードの使い方」を体感検証。env OFF Preview で従来 CPU と比較可能。

## 6. スコープ外

- 学習 CPU を UI で選択式にする (難易度追加等) — 今回は env トグルで足りる。
- 本番 (production 環境) への恒久 cutover = P2-3 (勝率確認 + M3 後)。本配線は**検証用の可逆トグル**。

## 7. M1 レビュー反映 (2026-07-04、単一 general-purpose agent / #109、実コード照合)

**判定: CHANGES_REQUIRED → 反映済で着手可**。骨子 (default-OFF env トグルで world+NN 経路を Preview のみ有効化、production バイト不変) は妥当・無回帰は構造的成立 (env 未設定→両フラグ未伝播→`worldPathActive=false` (engine.ts:245-248)→bolt-on 完全維持)。W1〜W6 全 CONFIRMED。以下反映:

| # | 指摘 | 反映 |
|---|---|---|
| **B-1 (BLOCKER)** | 重みは `{model, meta}` ラッパ形式。`SerializedMlp` はフラット。既存ローダは全て `.model` をアンラップ (winrate-245.ts:98 等) | §2.1: 複製時に **`.model` サブオブジェクトのみ**を追跡パスへ書き出しフラット化 → `import model` した値をそのまま `loadLearnedModel(model)` に渡せる (アンラップ不要・meta 分小型化) |
| **M-1 (MAJOR)** | NN 未ロードで silent fallback (search.ts:898) → baseline と同挙動で「検証したつもり」空振り。route に検知手段なし | §2.2/§5: `ensureLearnedModelLoaded()` にロード成功 `console.info` + route で**1 手ごとに `resetInferenceCount()` → 探索 → `getInferenceCount()` の絶対値をログ** (winrate-245 の nnCalls>0 assert を route ログへ移植)。0 なら warning。Preview Function ログで NN 実効を確認 |
| **M-2 (MAJOR)** | 効くのは `worldPathActive` = **card-shogi + cardState 供給時のみ** (engine.ts:245-248)。standard/カード無しでは flag ON でも NN 非発火 | §2.3/§5: 「本トグルは card-shogi + cardState 供給時のみ効く。検証は card 将棋で行う」を明記 |
| MN-1 (MINOR) | 1.77MB 静的 import の cold-start/バンドル影響が「見込み」 | §2.1: 候補 A (静的 import) 確定 = Next.js 16.2.1 + resolveJsonModule + webpack バンドルで確実 (FS 非依存)。§5: build でサイズ警告確認 + Preview 1 手目応答で cold-start 体感 |
| MN-2 (MINOR) | 速度懸念は過大 (maxDuration=10s、最悪≈5.1s、deadline 自律遵守で壁時計不変) | §3: maxDuration 据置で可、NN は深さトレードオフに吸収と明記 |
| N-1 (NIT) | featureDim(2478) スキュー staleness ガード無し | §4: `ensureLearnedModelLoaded` で `model.featureDim === FEATURE_DIM` assert |
| N-2 (NIT) | 複製先が追跡パスゆえ gitignore 例外不要 | §2.1: 不要と結論 |
| N-3 (NIT) | env 名タイポは M-1 silent fallback 直結 → 定数化 | §2.2: `ENABLE_LEARNED_EVAL` を定数で 1 箇所定義 |

**結論**: B-1/M-1/M-2 反映済につき実装着手可。方式=静的 import (候補 A、`.model` フラット化複製)、env=`ENABLE_LEARNED_EVAL`、Preview のみ設定で本番安全。
