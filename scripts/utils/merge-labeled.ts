// Issue #245 教材多様化 段1: ラベル付けワーカーの出力を結合する純粋ロジック (fs 非依存)。
//
// I/O は scripts/merge-labeled-245.ts が担う。ここを純粋関数に切り出すのは、結合には
// 「壊すと静かに教材が劣化する」不変条件が 2 つあり、テストで固定しておきたいため:
//
//  ① レシピの集計は**重複排除より前**に行う。内容キー (labelIdentityKey) はレシピを含まないので、
//     同じ対局の旧レシピ行と新レシピ行は同一キーになる。後で数えると片方が「重複」として
//     静かに捨てられ、「古いラベルが採用されたことに気づかない」という最悪の取り違えを見逃す。
//  ② 同一レシピ内の重複は「採点できている方」を残す。LABEL_TIME_MS はレシピに含まれないため、
//     時間切れで searchScore=null が混じった採点と、取りこぼし検査パスで採り直した完全な採点が
//     同一レシピ・同一内容キーで並びうる。入力順まかせにすると劣化コピーが勝つ。

import { parseTrainingRecordLine } from "@/lib/shogi/training/jsonl";
import type { TrainingGameRecord } from "@/lib/shogi/training/types";

import { labelIdentityKey, recipeKey } from "./label-identity";

export interface MergeStats {
  totalLines: number; // 渡された行数 (空行・壊れた行を含む)
  broken: number; // JSON として読めなかった行
  dup: number; // 内容キーが既出で捨てた行
  replaced: number; // 既出だが採点がより良いので差し替えた行
  recipes: Map<string, number>; // レシピキー -> 行数 (★重複排除の前に数える)
  unscoredGames: number; // 採用した試合のうち searchScore=null (採点不能) を含むもの
  missingGames: number; // 同 searchScore キーなし (未採点) を含むもの
}

export interface MergeResult {
  lines: string[]; // 結合後の JSONL 行 (初出順)
  stats: MergeStats;
}

/** 採点できていないサンプル数 (未採点 + 採点不能)。少ないほど良い採点。 */
function unscoredCount(record: TrainingGameRecord): number {
  return record.samples.filter((s) => s.searchScore === undefined || s.searchScore === null).length;
}

interface Entry {
  line: string;
  unscored: number;
  hasNull: boolean;
  hasMissing: boolean;
}

export function mergeLabeledRecords(lines: string[]): MergeResult {
  // Map は挿入順を保つので、既出キーを上書きしても出力順は「初出順」のまま保たれる。
  const byContent = new Map<string, Entry>();
  const recipes = new Map<string, number>();
  let broken = 0;
  let dup = 0;
  let replaced = 0;

  for (const line of lines) {
    if (line.trim().length === 0) continue; // 空行 (末尾改行など) は数に入れない
    let record: TrainingGameRecord;
    try {
      record = parseTrainingRecordLine(line);
    } catch {
      broken += 1;
      continue;
    }
    // ★不変条件①: レシピの集計は重複排除より前。
    const rk = recipeKey(record.game.labelMeta);
    recipes.set(rk, (recipes.get(rk) ?? 0) + 1);

    const key = labelIdentityKey(record);
    const entry: Entry = {
      line,
      unscored: unscoredCount(record),
      hasNull: record.samples.some((s) => s.searchScore === null),
      hasMissing: record.samples.some((s) => s.searchScore === undefined),
    };
    const existing = byContent.get(key);
    if (existing === undefined) {
      byContent.set(key, entry);
      continue;
    }
    dup += 1;
    // ★不変条件②: 採点できている方を残す (同点なら先に来た方 = 安定)。
    if (entry.unscored < existing.unscored) {
      byContent.set(key, entry);
      replaced += 1;
    }
  }

  const entries = [...byContent.values()];
  return {
    lines: entries.map((e) => e.line),
    stats: {
      totalLines: lines.length,
      broken,
      dup,
      replaced,
      recipes,
      unscoredGames: entries.filter((e) => e.hasNull).length,
      missingGames: entries.filter((e) => e.hasMissing).length,
    },
  };
}
