// Issue #245 Stage 2: ラベル生成 (label-search-score-245.ts) における
// 「試合の同一性」判定と「ラベル生成レシピ」の正規化。
//
// 設計意図:
// ラベル生成は 1 試合あたり数十分かかる長時間バッチで、途中停止からの再開と
// 複数ワーカーでの分散が要る。そのどちらも「この試合はもう採点済みか」を
// **行番号や shard 設定に依存せず**判定できることが前提になる。
//
// searchScore は本バッチが後付けする唯一の**サンプル側**フィールドなので、それと
// **試合側の labelMeta** を除けば出力行は入力行と同一内容になる。入力側・出力側を同じ関数で
// 正規化するため、キー順や空白の差では不一致にならない。
//
// ★教材多様化 段1 で「レシピ」の概念を追加した。探索深さや root のカード展開が違えば searchScore は
//   別物なので、既済判定は **内容 × レシピ** で行う必要がある (内容だけで判定すると、深さ4 の成果を
//   深さ5 の実行が「済んでいる」と誤認して取りこぼす)。labelKeyHash は recipe を混ぜたハッシュを返し、
//   labelIdentityKey は recipe を含まない純粋な内容キーを返す (= 入力行 ↔ 出力行 の突合に使う)。
//
// 利用側:
//   - scripts/label-search-score-245.ts   (再開スキップ / claim による取り合い)
//   - scripts/label-done-keys-245.ts      (既済ハッシュ一覧の生成)
//   - scripts/merge-labeled-245.ts        (ワーカー出力の結合と重複排除)

import { createHash } from "node:crypto";

import type { LabelMeta, TrainingGameRecord } from "@/lib/shogi/training/types";

/** レシピ形式の版。LabelMeta にフィールドを足したらここを上げ、recipeKey にも列挙を足す。 */
export const CURRENT_LABEL_RECIPE_VERSION = 1;

/** labelMeta を持たない (= 段1 以前に生成された) ラベルの識別子。 */
export const LEGACY_RECIPE_KEY = "legacy";

/**
 * レシピの正規形。キー順・空白に依存しない短い文字列。
 * ★LabelMeta にフィールドを足したらここに必ず追加し、CURRENT_LABEL_RECIPE_VERSION を上げること。
 *   JSON.stringify を使わないのは、キー順の差で別キーになる事故を構造的に避けるため。
 */
export function recipeKey(meta: LabelMeta | null | undefined): string {
  if (!meta) return LEGACY_RECIPE_KEY;
  return `v${meta.version}|d${meta.depth}|c${meta.expandCards ? 1 : 0}|w${meta.expandDraw ? 1 : 0}`;
}

/**
 * searchScore (サンプル側) と labelMeta (試合側) を除いた「入力行そのまま」の正規形。
 * ラベル付けが後付けするのはこの 2 つだけなので、これを除けば出力行 ↔ 入力行が一致する。
 *
 * ★キー順が一致することは仕様で保証される: オブジェクトの own key 順は「整数索引の昇順 →
 *   文字列キーの生成順」であり、rest 分割 (CopyDataProperties) はその順で複製する。
 *   TrainingGameData / TrainingSampleData に整数様キーは無く、JSON.parse は文書順にキーを作り、
 *   ラベル付けは `{...record.game, labelMeta}` で必ず末尾に足す。ゆえに labelMeta を外した
 *   game のキー順は入力行と一致し、JSON.stringify の結果も一致する。
 */
export function labelIdentityKey(record: TrainingGameRecord): string {
  // familyId も除く: これは train/val をまとめるための派生メタで、ラベルの中身に影響しない。
  // 鍵に含めると、family の作り方を変えた瞬間に既済判定が全滅し、20 時間級のラベル付けが
  // まるごと再実行になる。
  const { labelMeta: _meta, familyId: _family, ...game } = record.game;
  return JSON.stringify({
    game,
    samples: record.samples.map(({ searchScore: _score, ...rest }) => rest),
  });
}

/**
 * 内容 × レシピ の短縮ハッシュ。claim ファイル名と既済一覧 (LABEL_DONE_KEYS) の識別子に使う。
 * 16 hex = 64bit。数百件規模では衝突確率は無視できる (誕生日問題で ~10^-14)。
 *
 * recipe を引数で受けるのは、呼び出し側ごとに「どのレシピとして扱うか」が違うため:
 *   - ラベル付けバッチ: これから採点する**現行レシピ**を渡す (入力行にはまだ labelMeta が無い)
 *   - 既済一覧の生成  : 各レコード**自身の labelMeta** を渡す (別レシピの成果を混同させない)
 */
export function labelKeyHash(
  record: TrainingGameRecord,
  recipe: LabelMeta | null | undefined,
): string {
  return createHash("sha1")
    .update(`${recipeKey(recipe)}\u0000${labelIdentityKey(record)}`)
    .digest("hex")
    .slice(0, 16);
}
