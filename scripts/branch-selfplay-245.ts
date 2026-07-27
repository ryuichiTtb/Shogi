// Issue #245 教材多様化 段5: 既存の教材から**枝分かれ**させて中終盤の局面を増やす。
//
// なぜ要るか (計画書 §2 B-4): 31 手以降は既に 92-97% がユニークなので「既出手を避ける」だけでは
// 中終盤はほとんど多様化しない。にもかかわらず全対局が同じ 2 通りの序盤から派生しているため、
// カバーしている局面空間そのものが狭い。そこで **既存対局の途中から別の手を指し直す**ことで、
// 「そこまでは自然な進行 + そこから先は別世界」という中終盤の局面を安価に増やす。
//
// ★分岐点は必ず `replayToPly` (行動列の先頭からの再生) で作る。保存済みの盤面から直接復元すると
//   positionHistory が無く千日手を検出できず、200 手打ち切りの引き分けを量産して教材を汚す
//   (計画書 §2 B-3)。
//
// 層化抽出: 序盤 (0-39 手) / 中盤 (40-99 手) / 終盤 (100 手以上) から狙った比率で分岐点を取る。
// 終盤は 1 本が短い (すぐ終わる) ので、同じコストで多く取れる = 手薄な帯を厚くできる。
//
// 使い方 (リポジトリルートで):
//   BRANCH_IN=local-data/training/snap-selfplay.jsonl \
//     BRANCH_OUT=local-data/training/branch-245.jsonl \
//     BRANCH_COUNT=60 npx tsx scripts/branch-selfplay-245.ts
//
// env:
//   BRANCH_IN        分岐元の教材 JSONL (カンマ区切り可)
//   BRANCH_OUT       出力 JSONL (1 行 = 1 分岐対局)
//   BRANCH_COUNT     生成する分岐の本数 (既定 30)
//   BRANCH_OPENING / BRANCH_MIDGAME / BRANCH_ENDGAME  各帯の配分比 (既定 1 / 2 / 3 = 終盤厚め)
//   BRANCH_PER_PARENT 同一対局から取る分岐の上限 (既定 3)
//   BRANCH_MAX_ADDITIONAL 分岐点からさらに指す手数の上限 (既定 200 = 実質無制限)
//   BRANCH_SEED      抽出と多様化抽選の seed (既定 20260727)
//   BRANCH_APPEND    "1" で BRANCH_OUT へ追記
//   多様化まわりの env は selfplay-245.ts と同名 (SELFPLAY_MARGIN_CP / SELFPLAY_TOP_N / SELFPLAY_SEEN)
//   ★入力は読み取り専用。
//   ★本スクリプトの**出力を再び BRANCH_IN に与えることはできない** (分岐対局の samples[0] は
//     初期局面ではないため replayToPly の突合が必ず外れ、静かに全件 skip される)。

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  actionKey,
  createSeenIndex,
  parseSeenIndexLines,
  positionKey,
  recordSeen,
} from "@/lib/shogi/training/diversify";
import { parseTrainingRecordLine, trainingRecordToJsonl } from "@/lib/shogi/training/jsonl";
import { playOneGame, replayToPly } from "@/lib/shogi/training/selfplay";
import type { TrainingGameRecord } from "@/lib/shogi/training/types";
import { getWorldLegalActions } from "@/lib/shogi/ai/search";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";
import type { Difficulty, Player } from "@/lib/shogi/types";

import { BRANCH_SOURCE_PREFIX, contentFamilyKey } from "./utils/corpus-family";
import {
  createChooserStats,
  createDiversifiedChooser,
  formatChooserStats,
} from "./utils/diversified-chooser";
import { mulberry32 } from "./utils/prng";

const IN = (process.env.BRANCH_IN ?? "local-data/training/snap-selfplay.jsonl")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const OUT = process.env.BRANCH_OUT ?? "local-data/training/branch-245.jsonl";
const COUNT = Math.max(1, Number(process.env.BRANCH_COUNT ?? "30") || 30);
const PER_PARENT = Math.max(1, Number(process.env.BRANCH_PER_PARENT ?? "3") || 3);
const MAX_ADDITIONAL = Math.max(1, Number(process.env.BRANCH_MAX_ADDITIONAL ?? "200") || 200);
// ★並列実行するなら別 seed を渡すこと (未指定なら pid を混ぜて自動でばらす)。
const SEED = process.env.BRANCH_SEED !== undefined
  ? Number(process.env.BRANCH_SEED)
  : (20260727 ^ Math.imul(process.pid, 2654435761)) >>> 0;
const APPEND = process.env.BRANCH_APPEND === "1";
const SENTE = (process.env.SELFPLAY_SENTE ?? "expert") as Difficulty;
const GOTE = (process.env.SELFPLAY_GOTE ?? "expert") as Difficulty;
const MARGIN_CP = Number(process.env.SELFPLAY_MARGIN_CP ?? "60");
const TOP_N = Number(process.env.SELFPLAY_TOP_N ?? "6");
const SEEN_FILE = process.env.SELFPLAY_SEEN ?? "";
const DIVERSIFY = (process.env.SELFPLAY_DIVERSIFY ?? "1") === "1";

// 層化の配分 (相対比)。終盤はプールが薄く (clean 後 140 手以降は 6.9%)、1 本も短いので厚く取る。
const PHASE_WEIGHTS = {
  opening: Number(process.env.BRANCH_OPENING ?? "1"),
  midgame: Number(process.env.BRANCH_MIDGAME ?? "2"),
  endgame: Number(process.env.BRANCH_ENDGAME ?? "3"),
} as const;
const MIDGAME_FROM = 40;
const ENDGAME_FROM = 100;
type Phase = keyof typeof PHASE_WEIGHTS;

// 分岐は元対局の cardState (山札の中身ごと) を引き継ぐので、デッキ構成は**親の記録をそのまま継ぐ**。
// ここで別の構成を書くと、記録メタと実際の山札が食い違う。親に記録が無い場合だけ従来構成で埋める。
const FALLBACK_DECK = [
  { defId: "pawn_return" as const, count: 4 },
  { defId: "no_promote" as const, count: 4 },
  { defId: "double_pawn" as const, count: 4 },
];
type DeckSpecLike = { defId: string; count: number }[];
function deckSpecOf(record: TrainingGameRecord): DeckSpecLike {
  const spec = record.game.deckSpecSente;
  return Array.isArray(spec) && spec.length > 0 ? (spec as DeckSpecLike) : FALLBACK_DECK;
}

// 教材の来歴キー (selfplay-245.ts と揃える)。分岐元は sourceGameId に別途残す。
const ENGINE_VERSION = process.env.SELFPLAY_ENGINE ?? "world-diversified-branch";

const rng = mulberry32(SEED);
const seen = SEEN_FILE
  ? (() => {
      try {
        return parseSeenIndexLines(readFileSync(SEEN_FILE, "utf8").split("\n"));
      } catch {
        return createSeenIndex();
      }
    })()
  : createSeenIndex();

const stats = createChooserStats();
const aiChooser = createDiversifiedChooser(
  {
    difficultyFor: (player) => (player === "sente" ? SENTE : GOTE),
    diversify: DIVERSIFY,
    marginCp: MARGIN_CP,
    topN: TOP_N,
    seen,
    rng,
    seenFile: SEEN_FILE || undefined,
  },
  stats,
);

interface Candidate {
  record: TrainingGameRecord;
  gameIndex: number;
  ply: number;
  phase: Phase;
}

function phaseOf(moveCount: number): Phase {
  if (moveCount >= ENDGAME_FROM) return "endgame";
  if (moveCount >= MIDGAME_FROM) return "midgame";
  return "opening";
}

function loadRecords(): TrainingGameRecord[] {
  const out: TrainingGameRecord[] = [];
  for (const file of IN) {
    let raw: string;
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      console.warn(`[branch] 読めません (skip): ${file}`);
      continue;
    }
    for (const line of raw.split("\n")) {
      if (line.trim().length === 0) continue;
      try {
        out.push(parseTrainingRecordLine(line));
      } catch {
        // 壊れた行は無視
      }
    }
  }
  return out;
}

/** 帯ごとに分岐点の候補を集める。ここではまだ再生しない (安いふるいだけ)。 */
function collectCandidates(records: TrainingGameRecord[]): Record<Phase, Candidate[]> {
  const byPhase: Record<Phase, Candidate[]> = { opening: [], midgame: [], endgame: [] };
  records.forEach((record, gameIndex) => {
    // 中断対局は分岐しても勝敗ラベルが付かない。
    if (record.game.winner == null) return;
    record.samples.forEach((sample, ply) => {
      // 最終手からは分岐できない (指し継ぐ余地が無い)。
      if (ply >= record.samples.length - 1) return;
      const phase = phaseOf(sample.moveCount);
      byPhase[phase].push({ record, gameIndex, ply, phase });
    });
  });
  return byPhase;
}

/** Fisher-Yates (seed 固定)。 */
function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function main() {
  mkdirSync(dirname(OUT), { recursive: true });
  if (!APPEND) writeFileSync(OUT, "");

  const records = loadRecords();
  if (records.length === 0) {
    console.error("分岐元の対局がありません (BRANCH_IN を確認してください)");
    process.exit(1);
  }
  const byPhase = collectCandidates(records);
  console.log(
    `分岐元 ${records.length} 試合 / 候補: 序盤 ${byPhase.opening.length} 中盤 ${byPhase.midgame.length} 終盤 ${byPhase.endgame.length}`,
  );

  // 配分比から各帯の目標本数を決め、足りない帯のぶんは他帯へ回す (取りこぼしを作らない)。
  const rawWeight = PHASE_WEIGHTS.opening + PHASE_WEIGHTS.midgame + PHASE_WEIGHTS.endgame;
  // 重みが全部 0 / 非数値だと配分が NaN になる。既定比へ落として続行する。
  const totalWeight = Number.isFinite(rawWeight) && rawWeight > 0 ? rawWeight : 1;
  const quota: Record<Phase, number> = {
    opening: Math.round((COUNT * PHASE_WEIGHTS.opening) / totalWeight),
    midgame: Math.round((COUNT * PHASE_WEIGHTS.midgame) / totalWeight),
    endgame: 0,
  };
  quota.endgame = Math.max(0, COUNT - quota.opening - quota.midgame);

  const perParent = new Map<number, number>();
  const picked: Candidate[] = [];
  // 帯ごとにシャッフル済みの候補を持ち、1 巡目は配分どおり、2 巡目で不足ぶんを他帯から埋める。
  const pools: Record<Phase, Candidate[]> = {
    endgame: shuffle(byPhase.endgame),
    midgame: shuffle(byPhase.midgame),
    opening: shuffle(byPhase.opening),
  };
  const cursor: Record<Phase, number> = { endgame: 0, midgame: 0, opening: 0 };

  const take = (phase: Phase, need: number): number => {
    let taken = 0;
    while (taken < need && cursor[phase] < pools[phase].length) {
      const cand = pools[phase][cursor[phase]++];
      // 同じ対局から取り過ぎると「元が同じ」局面ばかりになる。
      const used = perParent.get(cand.gameIndex) ?? 0;
      if (used >= PER_PARENT) continue;
      perParent.set(cand.gameIndex, used + 1);
      picked.push(cand);
      taken += 1;
    }
    return taken;
  };

  const order = ["endgame", "midgame", "opening"] as const;
  for (const phase of order) take(phase, quota[phase]);
  // 候補が薄い帯の不足ぶんは他帯へ回す (終盤プールは元々薄いので、ここで本数を落とさない)。
  let shortfall = COUNT - picked.length;
  if (shortfall > 0) {
    for (const phase of order) {
      if (shortfall <= 0) break;
      shortfall -= take(phase, shortfall);
    }
  }
  if (picked.length < COUNT) {
    console.warn(`  ⚠ 候補不足で ${COUNT - picked.length} 本届きませんでした (分岐元を増やしてください)`);
  }

  let written = 0;
  let skippedMismatch = 0;
  let skippedNoChoice = 0;
  let totalSamples = 0;
  const producedPhase: Record<Phase, number> = { opening: 0, midgame: 0, endgame: 0 };

  for (const cand of picked) {
    const replay = replayToPly(cand.record, cand.ply);
    if (replay.world === null) {
      // 再生が合わない試合 = エンジン/カード効果が変わった等。静かに混ぜず捨てる。
      skippedMismatch += 1;
      continue;
    }
    const world = replay.world;
    // ガード: 終局済み / 二手指し継続中 / 選択肢が 1 つしか無い局面は分岐にならない。
    if (world.gameState.status !== "active" || world.doubleMove !== null) {
      skippedNoChoice += 1;
      continue;
    }
    // 「選択肢が 2 つ以上あるか」は探索と同じ集合で見る (findBestMoveWorld は draw も候補にする)。
    if (getWorldLegalActions(world, CARD_SHOGI_VARIANT, true).length < 2) {
      skippedNoChoice += 1;
      continue;
    }
    // ★親がこの局面で実際に指した手を「既出」として登録してから分岐する。
    //   入れないと最小層抽選で親と同じ手を引く確率が残り (topN=6 なら ~17%)、
    //   「分岐したのに元と同じ」= 生成時間の丸損になる。
    //   キーは**再生した world から**作る (chooser と同じ作り方)。保存サンプルから作ると、
    //   replay の突合が見ていない領域 (山札枚数・トラップ等) がドリフトしたときに
    //   posKey だけ静かにズレて、この対策が空振りする。
    recordSeen(
      seen,
      positionKey(world.gameState, world.cardState),
      actionKey(cand.record.samples[cand.ply].action),
    );

    // 親の鍵は**間引かれていない元の棋譜**から作る (全行動列を使うため、
    // clean などでサンプルを削った後の棋譜からでは同じ値にならない)。
    const parent = contentFamilyKey(cand.record);
    const rec = playOneGame({
      chooseAction: aiChooser,
      deckSpec: deckSpecOf(cand.record) as never,
      senteDifficulty: SENTE,
      goteDifficulty: GOTE,
      engineVersion: ENGINE_VERSION,
      // 分岐元をたどれるようにする (段7 で同じ親から出た枝を同一グループへ寄せ、
      // train/val 分割のリークを防ぐため)。★入力ファイルの構成や順序が変わっても
      // 同じ親を指すよう、行番号ではなく**親の内容**から作る。
      sourceGameId: `${BRANCH_SOURCE_PREFIX}${parent}:${cand.ply}`,
      // ★枝は親と同じ family に属する (train/val をこの単位で分けて val リークを防ぐ)。
      familyId: parent,
      initialWorld: world,
      maxAdditionalMoves: MAX_ADDITIONAL,
    });
    if (rec.samples.length === 0) {
      skippedNoChoice += 1;
      continue;
    }
    appendFileSync(OUT, trainingRecordToJsonl(rec) + "\n");
    written += 1;
    totalSamples += rec.samples.length;
    producedPhase[cand.phase] += 1;
    console.log(
      `branch ${written}/${picked.length}: 親#${cand.gameIndex} ply=${cand.ply} (${cand.phase}) ` +
        `-> ${rec.samples.length} samples, winner=${rec.game.winner}, status=${rec.game.finalStatus}`,
    );
  }

  console.log(`\nDone. ${written} 分岐 / ${totalSamples} サンプル -> ${OUT}`);
  console.log(
    `  帯別: 序盤 ${producedPhase.opening} / 中盤 ${producedPhase.midgame} / 終盤 ${producedPhase.endgame}`,
  );
  if (skippedMismatch > 0) console.warn(`  ⚠ 再生が合わず除外: ${skippedMismatch} 件`);
  if (skippedNoChoice > 0) console.log(`  選択肢が無く除外: ${skippedNoChoice} 件`);
  for (const line of formatChooserStats(stats, DIVERSIFY)) console.log(`  ${line}`);
  console.log(`  seed=${SEED} margin=${MARGIN_CP}cp topN=${TOP_N}`);
}

main();
