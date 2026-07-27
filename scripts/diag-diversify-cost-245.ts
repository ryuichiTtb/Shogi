// Issue #245 教材多様化 段7: 多様化が**実際いくら損したか**を深く読み直して測る。
//
// なぜ要るか: 教材生成の chooser は「互角に近い帯 (既定 60cp) の中で、これまで選んだ回数が
// 最小の手を選ぶ」。この「互角」の判定は**生成時の探索**によるが、本生成の実測では
// 平均到達深さが 1.85 しかなかった (7 ワーカー並列 + 1 手あたりの時間予算のため)。
// 深さ 2 で同点に見える手が、深く読むと大きく損ということは普通に起きる。
// つまり生成ログの「代償 中央値 0.0cp」は**浅い物差しの自己申告**であり、そのままでは
// 教材の質を保証しない。ここでは同じ決定を固定深さで読み直し、真の代償を測る。
//
// ★過去の失敗: 「gap=0 だから棋力低下ゼロ」と浅い測定で判断し、実機で改悪が発覚した
//   (計画書 §判定で気を付けること)。同じ轍を踏まないための測定。
//
// ★★測り方の注意 (ここを間違えると「損ゼロ」という嘘が出る):
//   探索の root は 2 手目以降を**狭い窓**で読み、最善を超えなければ本気で読み直さない
//   (search.ts の PVS)。そのため rootActionScores に載る「劣る手」のスコアは
//   **真の値より良い側に丸められている**。これをそのまま引き算すると損が小さく出る。
//   そこで「実際に選ばれた手」だけは、その手を指した後の局面を**別途フルの窓で読み直して**
//   評価する。最善側 (= PV) のスコアは元から厳密なので、そのまま使ってよい。
//
// 使い方 (リポジトリルートで):
//   DIVCOST_IN=local-data/training/gen-245.part0.jsonl DIVCOST_GAMES=10 \
//     npx tsx scripts/diag-diversify-cost-245.ts
//
// env:
//   DIVCOST_IN        教材 JSONL (カンマ区切り可)。★生の棋譜 (clean 前) を渡すこと
//                     (間引かれた棋譜は ply0 からの再生が成立しない)
//   DIVCOST_GAMES     読み直す試合数 (既定 10)。ファイル全体から等間隔で抜く
//   DIVCOST_PER_GAME  1 試合あたりの決定数 (既定 5)。試合内を等間隔で抜く
//   DIVCOST_DEPTH     読み直す固定深さ (既定 4 = ラベルと同じ)
//   DIVCOST_SHARD / DIVCOST_SHARD_COUNT  並列実行用 (試合を i % count で分ける)
//   ★読み取り専用。教材は書き換えない。

import { readFileSync } from "node:fs";

import { findBestMove } from "@/lib/shogi/ai/search";
import { applyTurnAction as applyForProbe } from "@/lib/shogi/kernel/world-kernel";
import { createSearchContext } from "@/lib/shogi/ai/search-context";
import { actionKey } from "@/lib/shogi/training/diversify";
import { parseTrainingRecordLine } from "@/lib/shogi/training/jsonl";
import { replayToPly } from "@/lib/shogi/training/selfplay";
import { applyTurnAction } from "@/lib/shogi/kernel/world-kernel";
import type { WorldState } from "@/lib/shogi/kernel/world-kernel";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";
import type { TrainingGameRecord } from "@/lib/shogi/training/types";

const IN = (process.env.DIVCOST_IN ?? "local-data/training/gen-245.part0.jsonl")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const GAMES = Math.max(1, Number(process.env.DIVCOST_GAMES ?? "10") || 10);
const PER_GAME = Math.max(1, Number(process.env.DIVCOST_PER_GAME ?? "5") || 5);
const DEPTH = Math.max(1, Number(process.env.DIVCOST_DEPTH ?? "4") || 4);
const SHARD_COUNT = Math.max(1, Number(process.env.DIVCOST_SHARD_COUNT ?? "1") || 1);
const SHARD = Math.max(0, Number(process.env.DIVCOST_SHARD ?? "0") || 0);

// 固定深さ + 時間上限は十分大 (findBestMoveWorld の「予算の 55% で打ち切り」を避ける)。
// addNoise / nearEqualThreshold を 0 にして、難易度由来の揺らぎを排除する。
const OPTIONS = { maxDepth: DEPTH, timeLimitMs: 600_000, addNoise: 0, nearEqualThreshold: 0 };
// この cp を超える損は中身を書き出す (測定の妥当性を人が確かめるため)。
const WORST_CP = Math.max(0, Number(process.env.DIVCOST_WORST_CP ?? "100") || 100);

function loadRecords(): TrainingGameRecord[] {
  const out: TrainingGameRecord[] = [];
  for (const file of IN) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      console.warn(`[divcost] 読めません (skip): ${file}`);
      continue;
    }
    for (const line of text.split("\n")) {
      if (line.trim().length > 0) out.push(parseTrainingRecordLine(line));
    }
  }
  return out;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  // ★線形補間。単純な索引指定だと偶数長で上側に張り付き、小標本で結論が変わる
  //   (段2 で「中央値 83cp」と出た値が、補間に直すと 0.0cp だった)。
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * 「実際に選ばれた手」の厳密な評価値 (手番側視点)。
 *
 * 手を指した後の局面を**新しい探索**で読み直す。root の PV は厳密な値を返すので、
 * 子局面の最善値を反転すれば、この手の真の値になる (窓の丸めが入らない)。
 * 手番が続く手 (二手指しの 1 手目) は反転しない。
 */
function exactScoreOfTaken(world: WorldState, action: TrainingGameRecord["samples"][number]["action"]): number | null {
  const applied = applyForProbe(world, action, { spectatorMode: true });
  const child = applied.world;
  const status = child.gameState.status;
  if (status !== "active") {
    // 指した瞬間に終局。詰ませたなら勝ち、それ以外 (千日手・持将棋等) は互角扱い。
    return status === "checkmate" ? 89_998 : 0;
  }
  const ctx = createSearchContext({
    timeLimitMs: OPTIONS.timeLimitMs,
    useTurnActionSearch: true,
    spectatorMode: true,
    useLearnedEval: false,
  });
  const r = findBestMove(
    child.gameState, child.gameState.currentPlayer, { ...OPTIONS, maxDepth: Math.max(1, DEPTH - 1) },
    CARD_SHOGI_VARIANT, ctx, child.cardState, child.doubleMove,
  );
  const scores = r?.rootActionScores ?? [];
  if (scores.length === 0) return null;
  const bestChild = scores.reduce((m, s) => (s.score > m ? s.score : m), -Infinity);
  // 手番が続く (二手指しの 1 手目) なら視点は同じ = 反転しない。
  return applied.turnEnded ? -bestChild : bestChild;
}

function main() {
  const all = loadRecords();
  if (all.length === 0) {
    console.error("✗ 教材が読めませんでした。DIVCOST_IN を確認してください。");
    process.exit(1);
  }

  // 試合はファイル全体から等間隔で抜く (先頭 N 局だと 1 ワーカーの序盤しか見ない)。
  const gameStride = Math.max(1, Math.floor(all.length / GAMES));
  const picked: { record: TrainingGameRecord; index: number }[] = [];
  for (let i = 0; i < all.length && picked.length < GAMES; i += gameStride) {
    picked.push({ record: all[i], index: i });
  }
  const mine = picked.filter((_, i) => i % SHARD_COUNT === SHARD);

  console.log(
    `教材 ${all.length} 試合 → ${picked.length} 試合を抽出 (stride ${gameStride})、` +
      `うち担当 ${mine.length} 試合 / 深さ ${DEPTH} で読み直し`,
  );

  const costs: number[] = [];
  const worst: { game: number; ply: number; kind: string; taken: number; best: number; cost: number; candidates: number }[] = [];
  const costsByKind: Record<string, number[]> = { move: [], playCard: [], draw: [] };
  let evaluated = 0;
  let skippedReplay = 0;
  let skippedNoScores = 0;
  let notFound = 0;
  const started = Date.now();

  for (const { record, index } of mine) {
    const n = record.samples.length;
    const stride = Math.max(1, Math.floor(n / PER_GAME));
    const targets = new Set<number>();
    for (let p = 0; p < n && targets.size < PER_GAME; p += stride) targets.add(p);

    // 再生は 1 試合 1 回で済ませ、対象 ply で読み直す (ply ごとに再生すると O(n^2))。
    const first = replayToPly(record, 0);
    if (first.world === null) {
      skippedReplay += 1;
      continue;
    }
    let world: WorldState = first.world;
    for (let ply = 0; ply < n; ply++) {
      if (targets.has(ply)) {
        const player = world.gameState.currentPlayer;
        const ctx = createSearchContext({
          timeLimitMs: OPTIONS.timeLimitMs,
          useTurnActionSearch: true, // 教材生成と同じ world 経路
          spectatorMode: true,
          useLearnedEval: false,
        });
        // ★rootActionScores は world 経路の findBestMove が常に返す (engine 側の
        //   collectRootActionScores は API 応答へ載せるかどうかのゲートなのでここでは不要)。
        const r = findBestMove(
          world.gameState, player, OPTIONS, CARD_SHOGI_VARIANT, ctx, world.cardState, world.doubleMove,
        );
        const scores = r?.rootActionScores ?? [];
        if (scores.length === 0) {
          skippedNoScores += 1;
        } else {
          const takenKey = actionKey(record.samples[ply].action);
          const taken = scores.find((s) => actionKey(s.action) === takenKey);
          if (taken === undefined) {
            // 生成時に選べた手が今回の候補に無い = 探索の候補生成が違う (二手指し継続中など)。
            notFound += 1;
          } else {
            const best = scores.reduce((m, s) => (s.score > m ? s.score : m), -Infinity);
            const takenScore = exactScoreOfTaken(world, record.samples[ply].action);
            if (takenScore === null) {
              skippedNoScores += 1;
              world = applyTurnAction(world, record.samples[ply].action, { spectatorMode: true }).world;
              continue;
            }
            const cost = best - takenScore;
            costs.push(cost);
            costsByKind[record.samples[ply].action.kind].push(cost);
            evaluated += 1;
            // 大きく損した決定は中身を残す (測定自体が正しいかを人が確かめられるように)。
            if (cost > WORST_CP) {
              worst.push({
                game: index, ply, kind: record.samples[ply].action.kind,
                taken: takenScore, best, cost, candidates: scores.length,
              });
            }
          }
        }
      }
      world = applyTurnAction(world, record.samples[ply].action, { spectatorMode: true }).world;
    }
    const secs = ((Date.now() - started) / 1000).toFixed(0);
    console.log(`  試合#${index}: ${evaluated} 決定を評価済み (経過 ${secs}s)`);
  }

  const sorted = [...costs].sort((a, b) => a - b);
  const zero = sorted.filter((c) => c <= 0).length;
  const over50 = sorted.filter((c) => c > 50).length;
  const over100 = sorted.filter((c) => c > 100).length;

  console.log(`\n=== 多様化の真の代償 (深さ ${DEPTH} で読み直し) ===`);
  console.log(`  評価した決定: ${evaluated}`);
  if (evaluated > 0) {
    console.log(
      `  代償 cp: 平均 ${(sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(1)} / ` +
        `中央値 ${quantile(sorted, 0.5).toFixed(1)} / 90% 点 ${quantile(sorted, 0.9).toFixed(1)} / ` +
        `最大 ${sorted[sorted.length - 1].toFixed(1)}`,
    );
    console.log(
      `  同点 (0cp 以下): ${zero} (${((zero / sorted.length) * 100).toFixed(1)}%) / ` +
        `50cp 超: ${over50} (${((over50 / sorted.length) * 100).toFixed(1)}%) / ` +
        `100cp 超: ${over100} (${((over100 / sorted.length) * 100).toFixed(1)}%)`,
    );
    for (const kind of ["move", "playCard", "draw"] as const) {
      const c = [...costsByKind[kind]].sort((a, b) => a - b);
      if (c.length === 0) continue;
      console.log(
        `    ${kind}: ${c.length} 件 / 中央値 ${quantile(c, 0.5).toFixed(1)}cp / ` +
          `平均 ${(c.reduce((a, b) => a + b, 0) / c.length).toFixed(1)}cp`,
      );
    }
  }
  if (worst.length > 0) {
    console.log(`\n  --- ${WORST_CP}cp 超の損 (上位 10 件) ---`);
    for (const w of worst.sort((a, b) => b.cost - a.cost).slice(0, 10)) {
      console.log(
        `    試合#${w.game} ply=${w.ply} ${w.kind}: 選んだ手 ${w.taken.toFixed(0)}cp / ` +
          `最善 ${w.best.toFixed(0)}cp / 損 ${w.cost.toFixed(0)}cp (候補 ${w.candidates} 手)`,
      );
    }
  }
  if (skippedReplay > 0) console.warn(`  ⚠ 再生できず除外: ${skippedReplay} 試合`);
  if (skippedNoScores > 0) console.log(`  候補スコアが取れず除外: ${skippedNoScores} 決定`);
  if (notFound > 0) console.log(`  採用手が候補に無く除外: ${notFound} 決定`);
}

main();
