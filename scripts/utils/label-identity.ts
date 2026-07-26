// Issue #245 Stage 2: ラベル生成 (label-search-score-245.ts) における「試合の同一性」判定。
//
// 設計意図:
// ラベル生成は 1 試合あたり数十分かかる長時間バッチで、途中停止からの再開と
// 複数ワーカーでの分散が要る。そのどちらも「この試合はもう採点済みか」を
// **行番号や shard 設定に依存せず**判定できることが前提になる。
//
// searchScore は本バッチが後付けする唯一のフィールドなので、それを除けば出力行は
// 入力行と同一内容になる。入力側・出力側を同じ関数で正規化するため、キー順や空白の
// 差では不一致にならない。
//
// 利用側:
//   - scripts/label-search-score-245.ts   (再開スキップ / claim による取り合い)
//   - scripts/label-done-keys-245.ts      (既済ハッシュ一覧の生成)

import { createHash } from "node:crypto";

import type { TrainingGameRecord } from "@/lib/shogi/training/types";

/** searchScore を除いた「入力行そのまま」の正規形。出力行 ↔ 入力行の同一性キー。 */
export function labelIdentityKey(record: TrainingGameRecord): string {
  return JSON.stringify({
    game: record.game,
    samples: record.samples.map(({ searchScore: _score, ...rest }) => rest),
  });
}

/**
 * 内容キーの短縮ハッシュ。claim ファイル名と既済一覧 (LABEL_DONE_KEYS) の識別子に使う。
 * 16 hex = 64bit。数百件規模では衝突確率は無視できる (誕生日問題で ~10^-14)。
 */
export function labelKeyHash(record: TrainingGameRecord): string {
  return createHash("sha1").update(labelIdentityKey(record)).digest("hex").slice(0, 16);
}
