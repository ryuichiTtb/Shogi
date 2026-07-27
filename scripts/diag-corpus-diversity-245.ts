// Issue #245 教材多様化: 教材 (JSONL) の**多様性**を測る読み取り専用の点検ツール。
//
// 背景: 348 局の既存教材は「試合数は多いが中身がほぼ同じ」だった (計画書 §1.1)。
//   初手は 2 通りしかなく / 19.5% が全行動列まで完全同一 / 34.5% が千日手 /
//   デッキは 1 種類だけで piece_return・check_break・double_move は 1 枚も現れていない。
// 試合数だけ見ていると気付けないので、多様性を数字で出す道具をここに固定する。
// 生成のたび (パイロット・本生成・分岐追加の各時点) に同じ物差しで測り直すために使う。
//
// 使い方 (リポジトリルートで):
//   DIAG_IN=local-data/training/gen-245.part0.jsonl npx tsx scripts/diag-corpus-diversity-245.ts
//   DIAG_IN=a.jsonl,b.jsonl DIAG_OPENING_PLIES=15 npx tsx scripts/diag-corpus-diversity-245.ts
//
// env:
//   DIAG_IN             入力 JSONL (カンマ区切りで複数可)
//   DIAG_OPENING_PLIES  「序盤帯」とみなす決定数 (既定 15)
//   DIAG_TOP            内訳の表示件数 (既定 8)
//
// ★入力は読み取り専用。教材を書き換えることは一切しない。

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { sampleToSparseRow } from "@/lib/shogi/ai/learned/feature-export";
import { parseTrainingRecordLine } from "@/lib/shogi/training/jsonl";
import { actionKey } from "@/lib/shogi/training/diversify";
import { recipeKey } from "./utils/label-identity";
import type { TrainingGameRecord, TrainingSampleData } from "@/lib/shogi/training/types";

const IN = (process.env.DIAG_IN ?? "local-data/training/snap-selfplay.jsonl")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const OPENING_PLIES = Math.max(1, Number(process.env.DIAG_OPENING_PLIES ?? "15") || 15);
const TOP = Math.max(1, Number(process.env.DIAG_TOP ?? "8") || 8);

function sha(s: string): string {
  return createHash("sha1").update(s).digest("hex").slice(0, 20);
}

/** 出現数を数えるだけの入れ物 (Map<string, number> の定型処理をまとめる)。 */
class Tally {
  private readonly counts = new Map<string, number>();
  add(key: string, n = 1) {
    this.counts.set(key, (this.counts.get(key) ?? 0) + n);
  }
  get size() {
    return this.counts.size;
  }
  get total() {
    return [...this.counts.values()].reduce((a, b) => a + b, 0);
  }
  /** 多い順の上位。件数が TOP を超えたら「他 N 種」に畳む。 */
  top(limit = TOP): string {
    const sorted = [...this.counts].sort((a, b) => b[1] - a[1]);
    const head = sorted.slice(0, limit).map(([k, v]) => `${k}:${v}`);
    if (sorted.length > limit) head.push(`…他 ${sorted.length - limit} 種`);
    return head.join(" / ") || "(なし)";
  }
  /** 最も多い要素の件数 (最大クラスタの大きさ)。 */
  maxCount(): number {
    let max = 0;
    for (const v of this.counts.values()) if (v > max) max = v;
    return max;
  }
}

/** デッキ構成を "pawn_return×4+no_promote×4" の形の 1 行に潰す (種類の内訳を見るため)。 */
function deckLabel(spec: unknown): string {
  if (!Array.isArray(spec)) return "(不明)";
  return (
    spec
      .map((e) => {
        const entry = e as { defId?: unknown; count?: unknown };
        return `${String(entry.defId)}×${Number(entry.count ?? 0)}`;
      })
      .sort()
      .join("+") || "(空)"
  );
}

/** サンプルの同一性 = エンコーダが実際に見る入力 (clean スクリプトと同じ物差し)。 */
function encoderInputHash(sample: TrainingSampleData): string {
  const row = sampleToSparseRow(sample, 0, 0);
  return sha(`${row.idx.join(",")}|${row.val.map((v) => v.toFixed(4)).join(",")}`);
}

function pct(n: number, d: number): string {
  return d > 0 ? ((n / d) * 100).toFixed(1) : "0.0";
}

function main() {
  const records: TrainingGameRecord[] = [];
  for (const file of IN) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      console.warn(`[diag] 読めません (skip): ${file}`);
      continue;
    }
    for (const line of text.split("\n")) {
      if (line.trim().length === 0) continue;
      records.push(parseTrainingRecordLine(line));
    }
  }
  if (records.length === 0) {
    console.error("✗ 読み込めた試合が 0 件です。DIAG_IN を確認してください。");
    process.exit(1);
  }

  const status = new Tally();
  const winners = new Tally();
  const sources = new Tally();
  const engines = new Tally();
  const decks = new Tally();
  const recipes = new Tally();
  const firstActions = new Tally();
  const gameHashes = new Tally();
  const gameHashesNorm = new Tally();
  const kinds = new Tally();
  const cardsPlayed = new Tally();
  const branchParents = new Tally();
  const moveCountBands = new Tally();

  let totalSamples = 0;
  let doubleMoveSamples = 0;
  let branchGames = 0;
  let labeledSamples = 0;
  let unlabelableSamples = 0;

  // 局面のユニーク率 (エンコーダ入力ベース) と、序盤帯だけに絞った同じ指標。
  const seenInputs = new Set<string>();
  const seenOpeningInputs = new Set<string>();
  let dupInputs = 0;
  let openingSamples = 0;
  let dupOpeningInputs = 0;

  for (const record of records) {
    const g = record.game;
    status.add(g.finalStatus ?? "(unknown)");
    winners.add(String(g.winner ?? "(null)"));
    sources.add(g.source);
    engines.add(g.engineVersion ?? "(none)");
    decks.add(deckLabel(g.deckSpecSente));
    recipes.add(recipeKey(g.labelMeta));
    gameHashes.add(sha(JSON.stringify(record.samples.map((s) => s.action))));
    gameHashesNorm.add(sha(record.samples.map((s) => actionKey(s.action)).join(">")));
    moveCountBands.add(`${Math.floor((g.moveCount ?? 0) / 20) * 20}-`);
    if (g.sourceGameId) {
      branchGames += 1;
      // "branch:<親ハッシュ>:<ply>" の親部分だけを見て、1 親からいくつ枝が出たかを測る。
      const parent = g.sourceGameId.split(":").slice(0, 2).join(":");
      branchParents.add(parent);
    }
    if (record.samples.length > 0) firstActions.add(actionKey(record.samples[0].action));

    for (const s of record.samples) {
      totalSamples += 1;
      kinds.add(s.action.kind);
      if (s.action.kind === "playCard") cardsPlayed.add(s.action.defId);
      if (s.doubleMoveMovesLeft !== undefined) doubleMoveSamples += 1;
      if (s.searchScore !== undefined) {
        if (s.searchScore === null) unlabelableSamples += 1;
        else labeledSamples += 1;
      }

      const h = encoderInputHash(s);
      if (seenInputs.has(h)) dupInputs += 1;
      else seenInputs.add(h);
      if (s.plyIndex < OPENING_PLIES) {
        openingSamples += 1;
        if (seenOpeningInputs.has(h)) dupOpeningInputs += 1;
        else seenOpeningInputs.add(h);
      }
    }
  }

  const games = records.length;
  console.log("=== 教材の多様性 ===");
  console.log(`入力: ${IN.join(" , ")}`);
  console.log(`規模: ${games} 試合 / ${totalSamples} サンプル`);
  console.log(`  source     : ${sources.top()}`);
  console.log(`  engine     : ${engines.top()}`);
  console.log(`  ラベルの版 : ${recipes.top()}`);
  if (labeledSamples + unlabelableSamples > 0) {
    console.log(
      `  採点済み   : ${labeledSamples} (${pct(labeledSamples, totalSamples)}%) / ` +
        `採点不能 ${unlabelableSamples} / 未採点 ${totalSamples - labeledSamples - unlabelableSamples}`,
    );
  }

  console.log("\n--- ① 試合の重なり ---");
  // 2 通りの数え方を並べる。cardInstanceId には「山札の何枚目か」が入る (例 gote-pawn_return-1) ため、
  // 指し手がそっくり同じ棋譜でもシャッフルが違うと raw では別物に見える。
  // 「棋譜として同じか」を見たいなら instanceId を落とした方 (norm) を読む。
  // 一方 clean スクリプトの重複除去は raw で判定する。norm で落とすと、指し手は同じでも
  // **手札の中身が違う** (引いた札が違う) 局を巻き込んで消すため。取りこぼしは
  // サンプル単位の重複除去 (エンコーダ入力が同じものを畳む) が拾う。
  console.log(
    `  distinct な棋譜: ${gameHashesNorm.size} / ${games} 本 (${pct(gameHashesNorm.size, games)}%)` +
      `   ※instanceId 込みなら ${gameHashes.size} 本`,
  );
  console.log(
    `  完全同一の複製 : ${games - gameHashesNorm.size} 試合 (${pct(games - gameHashesNorm.size, games)}%) / ` +
      `最大クラスタ ${gameHashesNorm.maxCount()} 試合`,
  );

  console.log("\n--- ② 立ち上がりの幅 ---");
  console.log(`  初手の種類     : ${firstActions.size} 通り`);
  console.log(`  初手の内訳     : ${firstActions.top()}`);
  console.log(
    `  序盤 ${OPENING_PLIES} 手帯の重複: ${dupOpeningInputs} / ${openingSamples} サンプル ` +
      `(${pct(dupOpeningInputs, openingSamples)}% が他局と完全一致)`,
  );

  console.log("\n--- ③ 局面の重なり (エンコーダから見た入力) ---");
  console.log(
    `  ユニーク局面: ${seenInputs.size} / ${totalSamples} (${pct(seenInputs.size, totalSamples)}%) / ` +
      `重複 ${dupInputs} (${pct(dupInputs, totalSamples)}%)`,
  );

  console.log("\n--- ④ 行動とカード ---");
  console.log(`  行動の内訳: ${kinds.top(3)}`);
  console.log(`  カード使用: ${cardsPlayed.total} 回 / ${cardsPlayed.size} 種`);
  console.log(`    内訳    : ${cardsPlayed.top(12)}`);
  console.log(`  二手指し継続中のサンプル: ${doubleMoveSamples}`);

  console.log("\n--- ⑤ 出自と終局 ---");
  console.log(`  デッキ構成: ${decks.size} 種`);
  console.log(`    内訳    : ${decks.top()}`);
  console.log(`  finalStatus: ${status.top()}`);
  console.log(`  winner     : ${winners.top()}`);
  console.log(`  手数の分布 : ${moveCountBands.top(10)}`);
  if (branchGames > 0) {
    console.log(
      `  分岐由来   : ${branchGames} 試合 (${pct(branchGames, games)}%) / 親 ${branchParents.size} 局 ` +
        `(1 親あたり最大 ${branchParents.maxCount()} 枝)`,
    );
  }
}

main();
