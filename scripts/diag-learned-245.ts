// 学習評価の賢さ診断 (Issue #245 フェーズ1 P1-4)。
//
// ★データ駆動 (#235 の手作り fixture gap=0 の反省): 自己対戦/人間対局の実局面で、評価が
// 「最終的な勝者」をどれだけ正しく当てられるかを **学習NN と 人手evaluate で比較**する。
// 学習に使っていない保留 (val) 対局のみで測る (試合単位分割、train と同 seed/val_frac で再現)。
//
// 指標:
//  - 符号正解率: 決着局 (引分除く) の各局面で sign(評価) == sign(勝敗 z) の割合。高いほど「どちらが
//    優勢か」を正しく読めている。NN > 人手 なら学習評価が賢い証拠。
//  - 終盤符号正解率: 各対局の後半 50% 局面に限定 (優勢がはっきりする局面での精度)。
//
// 使い方:
//   DIAG_IN=local-data/training/human-245.jsonl,local-data/training/selfplay-advanced-245.jsonl \
//     DIAG_MODEL=local-data/training/model-245.json npx tsx scripts/diag-learned-245.ts
//
// env: DIAG_IN(対局JSONL,カンマ区切り) / DIAG_MODEL(重みJSON) / DIAG_SEED(7) / DIAG_VAL_FRAC(0.15)
//   ※ SEED/VAL_FRAC は train-245 と一致させると保留集合が揃う。

import { readFileSync } from "node:fs";

import { deserializeCardState } from "@/lib/shogi/cards/state";
import { computeCardDigest } from "@/lib/shogi/ai/cards/digest";
import { evaluate } from "@/lib/shogi/ai/evaluate";
import { winnerToLabel } from "@/lib/shogi/ai/learned/feature-export";
import { evaluateLearned, loadLearnedModel } from "@/lib/shogi/ai/learned/infer";
import { mulberry32 } from "@/lib/shogi/ai/learned/mlp";
import { parseTrainingRecordLine } from "@/lib/shogi/training/jsonl";
import { familyIdFor } from "./utils/corpus-family";
import type { GameState } from "@/lib/shogi/types";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";

const IN = (process.env.DIAG_IN ?? "local-data/training/human-245.jsonl")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const MODEL = process.env.DIAG_MODEL ?? "local-data/training/model-245.json";
const SEED = Math.max(0, Number(process.env.DIAG_SEED ?? "7") || 7);
const VAL_FRAC = Math.min(0.9, Math.max(0, Number(process.env.DIAG_VAL_FRAC ?? "0.15") || 0.15));

const sign = (v: number) => (v > 0 ? 1 : v < 0 ? -1 : 0);

interface Diag {
  total: number; // 評価した局面数 (決着局のみ)
  handCorrect: number;
  nnCorrect: number;
  lateTotal: number; // 各対局後半 50% の局面数
  handLate: number;
  nnLate: number;
}

function main() {
  const payload = JSON.parse(readFileSync(MODEL, "utf8"));
  loadLearnedModel(payload.model);
  const meta = payload.meta ?? {};

  // 対局を emit 順 (encode と同じ: winner=null は除外) に集める。
  const games: ReturnType<typeof parseTrainingRecordLine>[] = [];
  for (const file of IN) {
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      console.warn(`[diag] 読めません (skip): ${file}`);
      continue;
    }
    for (const line of content.split("\n").filter((l) => l.trim())) {
      const rec = parseTrainingRecordLine(line);
      if (winnerToLabel(rec.game.winner) === null) continue; // 中断は学習除外と一致
      games.push(rec);
    }
  }

  // ★保留 (val) 集合の決定。優先順位は 3 段:
  //   ① model.meta.valFamilyKeys (family 鍵) = 棋譜そのものから引き直せるので入力の並びに依存しない。
  //   ② model.meta.valGameIds (連番) = 旧モデル向け。encode の採番順と一致している前提。
  //   ③ 同 seed / val_frac で分割を再現するフォールバック (どちらも無い最古のモデル)。
  // ★①以外は「学習に使った試合を保留として測る」形で静かに間違いうるので、その旨を警告する。
  const valKeys: string[] = Array.isArray(meta.valFamilyKeys) ? (meta.valFamilyKeys as string[]) : [];
  let valSet: Set<number>;
  if (valKeys.length > 0) {
    const keySet = new Set(valKeys);
    // ★1 つの family に複数の棋譜 (親 + 枝) が属しうるので、突合の検算は「見つかった鍵の種類数」で行う。
    //   対局数で比べると、枝がある分だけ多くなって毎回警告が出てしまう。
    const matchedKeys = new Set<string>();
    valSet = new Set<number>();
    games.forEach((rec, i) => {
      const key = familyIdFor(rec);
      if (!keySet.has(key)) return;
      matchedKeys.add(key);
      valSet.add(i);
    });
    if (matchedKeys.size !== keySet.size) {
      console.warn(
        `⚠️ 保留 family の突合が不完全 (model=${keySet.size} 鍵 → 読込で見つかった ${matchedKeys.size} 鍵): ` +
          `DIAG_IN が学習時の入力と違う可能性があります。`,
      );
    }
  } else if (Array.isArray(meta.valGameIds)) {
    console.warn(
      `⚠️ このモデルは family 鍵を持たない旧形式です。連番での復元は encode の採番順に依存し、` +
        `入力が 1 件違うだけで別の棋譜を保留として測ります (結果は参考値)。`,
    );
    const declared = typeof meta.families === "number" ? meta.families : meta.games;
    if (typeof declared === "number" && declared !== games.length) {
      console.warn(
        `⚠️ 件数不一致 (model=${declared} ≠ diag 読込=${games.length}): 保留集合がズレ結果は無効になりうる。`,
      );
    }
    valSet = new Set(meta.valGameIds as number[]);
  } else {
    const rng = mulberry32(SEED);
    const ids = games.map((_, i) => i);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    const nVal = Math.min(
      Math.max(ids.length > 1 ? 1 : 0, Math.floor(ids.length * VAL_FRAC)),
      Math.max(0, ids.length - 1),
    );
    valSet = new Set(ids.slice(0, nVal));
  }
  const nVal = valSet.size;

  const d: Diag = { total: 0, handCorrect: 0, nnCorrect: 0, lateTotal: 0, handLate: 0, nnLate: 0 };

  for (let gi = 0; gi < games.length; gi++) {
    if (!valSet.has(gi)) continue;
    const rec = games[gi];
    const z = winnerToLabel(rec.game.winner);
    if (z === null || z === 0) continue; // 引分は符号正解率の対象外
    const n = rec.samples.length;
    for (let si = 0; si < n; si++) {
      const s = rec.samples[si];
      const state = s.boardState as GameState;
      const card = deserializeCardState(s.cardState);
      // ★公平化 (M2 MINOR-2): 人手 evaluate にも cardDigest を渡す。未渡だとカード項
      // (evaluateCardDigest / trap 価値) が skip され、全カード状態を使う NN に有利に偏るため、
      // 両者を同一情報量 (盤面+カード状態) で比較して「学習の純粋な価値」を測る。
      const hand = evaluate(state, CARD_SHOGI_VARIANT, computeCardDigest(card));
      const nn = evaluateLearned(state, card);
      const isLate = si >= Math.floor(n / 2);

      d.total++;
      if (sign(hand) === z) d.handCorrect++;
      if (sign(nn) === z) d.nnCorrect++;
      if (isLate) {
        d.lateTotal++;
        if (sign(hand) === z) d.handLate++;
        if (sign(nn) === z) d.nnLate++;
      }
    }
  }

  const pct = (a: number, b: number) => (b === 0 ? "—" : `${((a / b) * 100).toFixed(1)}%`);
  console.log(`=== 学習評価 賢さ診断 (P1-4, 保留 ${nVal}/${games.length} 試合, 決着局のみ) ===`);
  console.log(`model: ${MODEL}`);
  console.log(`評価局面 ${d.total} (うち終盤 ${d.lateTotal})`);
  console.log(`符号正解率 (勝者を当てた割合):`);
  console.log(`  人手 evaluate : 全 ${pct(d.handCorrect, d.total)} / 終盤 ${pct(d.handLate, d.lateTotal)}`);
  console.log(`  学習 NN       : 全 ${pct(d.nnCorrect, d.total)} / 終盤 ${pct(d.nnLate, d.lateTotal)}`);
  console.log(`(NN > 人手 なら学習評価が局面の優劣をより正しく読めている = 賢い証拠)`);
  if (d.total === 0) {
    console.log(`\n⚠️ 評価局面 0: 保留集合に決着局が無い (データ僅少)。自己対戦を増やすと有意になる。`);
  }
}

main();
