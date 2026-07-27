// Issue #245 教材多様化 段7: 「同じ出どころの棋譜」をひとまとめにする鍵 (family)。
//
// なぜ要るか: 分岐生成 (段5) は既存の棋譜の途中から枝を生やす。親と枝、あるいは同じ親から出た
// 枝どうしは分岐点まで**同じ道**を通るので、片方が学習用・片方が検証用に散ると、
// 検証データに「学習で見たのとほぼ同じ局面」が混ざる。すると検証の数字だけが良くなり、
// 未知の局面への強さを測れなくなる (val リーク)。
// そこで親と枝に同じ family 鍵を与え、train/val は family ごと丸ごと振り分ける。
//
// ★鍵は**内容から導く** (TrainingGameData に ID が無いため)。入力ファイルの並び順や
//   ファイル名に依存しないので、生成の順番が変わっても親子が結び付く。

import { createHash } from "node:crypto";

import type { TrainingGameRecord } from "@/lib/shogi/training/types";

/** 分岐棋譜の sourceGameId 接頭辞 (`branch:<親の内容ハッシュ>:<分岐 ply>`)。 */
export const BRANCH_SOURCE_PREFIX = "branch:";

/**
 * 対局の安定識別子。開始局面 + 全行動列から作る 64bit (16 桁 hex)。
 *
 * ★ここを変えると、既に生成済みの分岐棋譜が持つ親ハッシュと繋がらなくなる (family が割れる)。
 *   変更する場合は分岐棋譜も作り直すこと。
 */
export function contentFamilyKey(record: TrainingGameRecord): string {
  // サンプルが空の棋譜は内容が無く互いに区別できない。全部同じ鍵になると
  // 無関係な棋譜がひとつの family に集まるので、その旨が分かる鍵を返す
  // (呼び出し側の clean / encode はいずれも空の棋譜を捨てるので実データには出ない)。
  if (record.samples.length === 0) return "empty-record-0000";
  const seed = JSON.stringify([
    record.samples[0].boardState,
    record.samples[0].cardState,
    record.samples.map((s) => s.action),
  ]);
  // 同じパイプラインの clean / label-identity と同じ sha1 に揃える (自前ハッシュを増やさない)。
  // 先頭 16 桁 = 64bit。数万件規模でも衝突確率は無視できる。
  return createHash("sha1").update(seed).digest("hex").slice(0, 16);
}

/**
 * この対局が属する family の鍵。
 * - 分岐棋譜 (`sourceGameId = branch:<親ハッシュ>:<ply>`) は**親の鍵**を返す = 親および兄弟枝と同じ組。
 * - それ以外は自分の内容ハッシュ。
 *
 * ★内容ハッシュは**行動列を全部**使うので、サンプルを間引いた後の棋譜から計算しても
 *   間引く前と同じ値にはならない。clean のように中身を削る工程は、削る**前**に
 *   `familyId` を刻んでから削ること (刻印があれば再計算せずそれを返す)。
 */
export function familyIdFor(record: TrainingGameRecord): string {
  const stamped = record.game.familyId;
  if (typeof stamped === "string" && stamped.length > 0) return stamped;
  const source = record.game.sourceGameId;
  if (typeof source === "string" && source.startsWith(BRANCH_SOURCE_PREFIX)) {
    const parent = source.slice(BRANCH_SOURCE_PREFIX.length).split(":")[0];
    if (parent.length > 0) return parent;
  }
  return contentFamilyKey(record);
}
