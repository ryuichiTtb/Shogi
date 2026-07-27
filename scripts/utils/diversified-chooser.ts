// Issue #245 教材多様化 段4: 「多様化する AI chooser」を 1 本化する。
//
// 通常の自己対戦 (selfplay-245.ts) と分岐生成 (branch-selfplay-245.ts) が同じものを要る。
// 各所で書くと必ず差分が出る (実際 1 度そうなった) ので、ここに寄せる。
//
// やっていること: engine から root の全候補と深読みスコアを受け取り、互角に近い帯の中で
// **これまで選んだ回数が最小の手**を抽選する。強さを落とさずに分岐だけ増やすのが狙い。

import { appendFileSync } from "node:fs";

import { findBestMoveWithStats } from "@/lib/shogi/ai/engine";
import {
  actionKey,
  formatSeenLine,
  pickDiverseAction,
  positionKey,
  recordSeen,
  type SeenIndex,
} from "@/lib/shogi/training/diversify";
import type { ChooseAction } from "@/lib/shogi/training/selfplay";
import type { WorldState } from "@/lib/shogi/kernel/world-kernel";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";
import type { Difficulty, Player } from "@/lib/shogi/types";

export interface DiversifiedChooserOptions {
  /** 手番ごとの難易度。多様化の乱数を我々の抽選に一本化するため advanced/expert を想定。 */
  difficultyFor: (player: Player) => Difficulty;
  /** false なら engine の最善手をそのまま返す (A/B 対照)。 */
  diversify: boolean;
  marginCp: number;
  topN: number;
  /** 出現回数の索引 (呼び出し側が読み込み・共有する)。 */
  seen: SeenIndex;
  /** 抽選用の乱数。デッキ抽選など他の用途とは**別ストリーム**を渡すこと (A/B が交絡するため)。 */
  rng: () => number;
  /** 指定時、選んだ手を 1 行ずつ追記する共有ファイル。 */
  seenFile?: string;
}

export interface ChooserStats {
  decisions: number;
  /** 抽選まで進んだ決定数。 */
  diversified: number;
  /** 候補スコアが取れず engine の最善手を素通しした数。 */
  fallback: number;
  /** 最善と違う手を選んだ数。 */
  changedFromBest: number;
  /** 到達深さの合計 (平均は decisions で割る)。 */
  depthSum: number;
  /** 最善から何 cp 損したか。0 なら同点手を選んだだけ = 棋力低下ゼロ。 */
  lossesCp: number[];
  /** 選んだ行動の種別内訳 (draw の過剰採用を検知する)。 */
  kinds: { move: number; draw: number; playCard: number };
}

export function createChooserStats(): ChooserStats {
  return {
    decisions: 0, diversified: 0, fallback: 0, changedFromBest: 0, depthSum: 0,
    lossesCp: [], kinds: { move: 0, draw: 0, playCard: 0 },
  };
}

export function createDiversifiedChooser(
  opts: DiversifiedChooserOptions,
  stats: ChooserStats,
): ChooseAction {
  return (world: WorldState, player: Player) => {
    const r = findBestMoveWithStats(
      world.gameState, player, opts.difficultyFor(player), CARD_SHOGI_VARIANT,
      {
        cardState: world.cardState,
        // ★二手指し継続中はその状態も渡す。渡さないと engine が通常ターンと誤認して
        //   playCard / draw を返し、適用時に二手指し状態が黙って消える (棋譜が壊れる)。
        doubleMove: world.doubleMove,
        useKernelSearch: true,
        useTurnActionSearch: true,
        // 多様化の判断材料 (root の全候補スコア)。オプトインなので API 応答には影響しない。
        collectRootActionScores: true,
        spectator: true,
      },
    );
    const best = r.action ?? (r.move ? ({ kind: "move", move: r.move } as const) : null);
    if (best === null) return null;
    stats.decisions += 1;
    stats.depthSum += r.stats.depthCompleted;

    // ★注意: ここで選ぶ手は engine のタダ捨てガード (blunder guard) を通らない。
    //   ガードは「探索が同点と見るが実は horizon 起因でタダ捨て」の手を潰すもので、
    //   まさに margin 帯に効くため、教材には production AI なら指さない手が混じりうる。
    //   ラベルは深く読み直して付けるので学習素材としては成立するが、承知のうえで使うこと。
    //
    // 候補スコアが取れない経路 (合法手 1 つの早期 return / fallback / book) は**素通し**する。
    // ここで素通しにしないと、多様化が効かない局面で手が返らず生成が止まる。
    if (!opts.diversify || !r.rootActionScores || r.rootActionScores.length === 0) {
      stats.fallback += 1;
      stats.kinds[best.kind] += 1;
      return best;
    }

    const posKey = positionKey(world.gameState, world.cardState);
    // ★double_move もそのまま指してよい (段6.5)。kernel が doubleMove フラグを立てて
    //   turnEnded=false を返し、続く 2 回の決定でこの chooser が着手を選ぶ。
    //   production の 1-response 方式 (engine が 2 手をまとめて返す) はヘッドレスでは不要。
    const candidates = r.rootActionScores;
    const picked = pickDiverseAction(
      candidates, posKey, opts.seen, { marginCp: opts.marginCp, topN: opts.topN }, opts.rng,
    );
    if (picked === null) {
      stats.fallback += 1;
      stats.kinds[best.kind] += 1;
      return best;
    }
    stats.diversified += 1;
    stats.kinds[picked.kind] += 1;

    const key = actionKey(picked);
    if (key !== actionKey(best)) {
      stats.changedFromBest += 1;
      // 「最善スコア − 選んだ手のスコア」= この 1 手で失った評価値。多様化の代償を実測する。
      const bestScore = candidates.reduce((m, a) => (a.score > m ? a.score : m), -Infinity);
      const pickedScore = candidates.find((a) => actionKey(a.action) === key)?.score;
      if (pickedScore !== undefined) stats.lossesCp.push(bestScore - pickedScore);
    }

    recordSeen(opts.seen, posKey, key);
    if (opts.seenFile) appendFileSync(opts.seenFile, formatSeenLine(posKey, key) + "\n");
    return picked;
  };
}

/** 統計を人が読める形にする (生成ログの末尾に出す)。 */
export function formatChooserStats(stats: ChooserStats, diversify: boolean): string[] {
  const out: string[] = [];
  const pct = (n: number) => ((n / Math.max(1, stats.decisions)) * 100).toFixed(1);
  if (!diversify) {
    out.push("多様化: 無効 (engine の最善手をそのまま採用)");
  } else {
    out.push(
      `多様化: ${stats.decisions} 決定中 ${stats.diversified} 件で抽選 (${pct(stats.diversified)}%) / ` +
        `素通し ${stats.fallback} 件 (${pct(stats.fallback)}%) / 最善から変えた ${stats.changedFromBest} 件 (${pct(stats.changedFromBest)}%)`,
    );
  }
  if (stats.decisions > 0) {
    out.push(`  平均 depthCompleted: ${(stats.depthSum / stats.decisions).toFixed(2)}`);
    out.push(
      `  行動の内訳: move ${stats.kinds.move} (${pct(stats.kinds.move)}%) / ` +
        `playCard ${stats.kinds.playCard} (${pct(stats.kinds.playCard)}%) / draw ${stats.kinds.draw} (${pct(stats.kinds.draw)}%)`,
    );
  }
  if (stats.lossesCp.length > 0) {
    const sorted = [...stats.lossesCp].sort((a, b) => a - b);
    const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const zero = sorted.filter((x) => x === 0).length;
    out.push(
      `  多様化の代償: 平均 ${mean.toFixed(1)}cp / 中央値 ${sorted[Math.floor(sorted.length / 2)].toFixed(1)}cp / ` +
        `最大 ${sorted[sorted.length - 1].toFixed(1)}cp / うち同点 (0cp) ${zero} 件 (${((zero / sorted.length) * 100).toFixed(1)}%)`,
    );
  }
  return out;
}
