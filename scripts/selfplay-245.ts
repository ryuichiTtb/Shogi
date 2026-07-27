#!/usr/bin/env node
// 自己対戦バッチ生成 (Issue #245 フェーズ0 P0-4)。
//
// CPU vs CPU を UI なしで最後まで回し、per-decision の学習データ (盤面 + カード状態 +
// 採用行動 + 生じたイベント) を JSONL に書き出す。1 行 = 1 試合。
// 既定は JSONL ファイル出力 (DB 不要・Neon 非依存)。DB への取り込みは別途 import で行う
// (rule 5: DB 書き込みは都度ユーザー確認が要るため、生成自体は副作用なしの JSONL に分離)。
//
// ★Issue #245 教材多様化 段4: 「まだ選んでいない手」へ寄せる多様化を配線した。
// 従来は advanced 同士が完全決定的に指すため、348 局で初手が 2 通りしか無く、
// 完全同一棋譜が 19.5% あった。root の全候補と深読みスコア (rootActionScores) を受け取り、
// 互角に近い帯の中で出現回数が最小の手を選ぶ (強さは落とさず分岐だけ増やす)。
//
// 使い方 (リポジトリルートで):
//   npx tsx scripts/selfplay-245.ts [games]
//   SELFPLAY_GAMES=20 SELFPLAY_SENTE=expert SELFPLAY_GOTE=expert \
//   SELFPLAY_OUT=docs/training-data/selfplay.jsonl npx tsx scripts/selfplay-245.ts

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { trainingRecordToJsonl } from "@/lib/shogi/training/jsonl";
import { createSeenIndex, parseSeenIndexLines } from "@/lib/shogi/training/diversify";
import { playOneGame, type ChooseAction } from "@/lib/shogi/training/selfplay";
import type { Difficulty, Player } from "@/lib/shogi/types";

import {
  createChooserStats,
  createDiversifiedChooser,
  formatChooserStats,
} from "./utils/diversified-chooser";
import { mulberry32 } from "./utils/prng";

const GAMES = Math.max(1, Number(process.env.SELFPLAY_GAMES ?? process.argv[2] ?? "10") || 10);
const SENTE = (process.env.SELFPLAY_SENTE ?? "expert") as Difficulty;
const GOTE = (process.env.SELFPLAY_GOTE ?? "expert") as Difficulty;
const OUT = process.env.SELFPLAY_OUT ?? "/tmp/selfplay-245.jsonl";
// 教材の来歴キー。段4 で chooser を world 単一木 (useTurnActionSearch) へ切替えたので、
// 既定も実態に合わせる。ここが嘘だと段7 で「どちらの経路の産物か」を切り分けられなくなる。
const ENGINE_VERSION = process.env.SELFPLAY_ENGINE ?? "world-diversified";
// 手数上限 (未指定なら playOneGame 既定 = SPECTATOR_MAX_MOVES=200)。動作確認・短時間生成用。
const MAX_MOVES = process.env.SELFPLAY_MAX_MOVES ? Number(process.env.SELFPLAY_MAX_MOVES) : undefined;
// 追記モード: 既存 JSONL を truncate せず末尾へ足す。高難易度の長時間生成を複数回に分けて
// 累積するため (バックグラウンド生成がセッション境界で中断されても進捗を失わない)。
const APPEND = process.env.SELFPLAY_APPEND === "1";

// ---- 多様化 (段4) --------------------------------------------------------
// SELFPLAY_DIVERSIFY=0 で完全に無効化 (従来どおり engine の最善手をそのまま指す = A/B 対照)。
const DIVERSIFY = (process.env.SELFPLAY_DIVERSIFY ?? "1") === "1";
// 最善からこの cp 以内の候補だけを多様化の対象にする。広げるほど多様だが棋力は落ちる。
const MARGIN_CP = Number(process.env.SELFPLAY_MARGIN_CP ?? "60");
// スコア上位この件数まで。終盤の高分岐局面で帯が広くても候補を絞る。
const TOP_N = Number(process.env.SELFPLAY_TOP_N ?? "6");
// 抽選の seed。★並列ワーカーは**必ず別 seed** を渡すこと。同 seed だと初期 SeenIndex も同じなので
// 全ワーカーが同じ抽選列・同じデッキ列を辿り、「完全同一棋譜」を作り直してしまう。
// 未指定時は pid を混ぜて自動的にばらす (実際に使った seed はログへ出す)。
const SEED = process.env.SELFPLAY_SEED !== undefined
  ? Number(process.env.SELFPLAY_SEED)
  : (20260727 ^ Math.imul(process.pid, 2654435761)) >>> 0;
// 「どの局面でどの行動を何回選んだか」の共有ファイル。並列ワーカーはこれを読み、選ぶたび追記する。
const SEEN_FILE = process.env.SELFPLAY_SEEN ?? "";

// ---- デッキ多様化 (段6) --------------------------------------------------
// 教材 348 局は**全局が同一 1 種のデッキ**で、piece_return / check_break は 1 枚も現れていなかった
// (計画書 §1.1)。encoder は手札を種類別に符号化するので、出てこないカードの次元は
// 常に 0 = そのカードについて何も学べない。局ごとにデッキ構成を抽選して穴を埋める。
//
// double_move は探索が未対応 (段6.5) なので入れない。mana_up は deprecated。
// 各構成 12 枚で揃える (初期手札 2 枚 + 山札 10 枚 = 従来と同条件)。
const DECK_PRESETS = [
  // A: 従来の構成 (既存教材との連続性を保つため残す)
  [
    { defId: "pawn_return" as const, count: 4 },
    { defId: "no_promote" as const, count: 4 },
    { defId: "double_pawn" as const, count: 4 },
  ],
  // B: 駒戻し入り (piece_return をカバー)
  [
    { defId: "pawn_return" as const, count: 4 },
    { defId: "piece_return" as const, count: 4 },
    { defId: "double_pawn" as const, count: 4 },
  ],
  // C: トラップ寄り (check_break をカバー)
  [
    { defId: "check_break" as const, count: 4 },
    { defId: "no_promote" as const, count: 4 },
    { defId: "pawn_return" as const, count: 4 },
  ],
  // D: 4 種混合 (組合せの幅を出す)
  [
    { defId: "pawn_return" as const, count: 3 },
    { defId: "double_pawn" as const, count: 3 },
    { defId: "piece_return" as const, count: 3 },
    { defId: "no_promote" as const, count: 3 },
  ],
  // E: 高コスト寄り (マナ運用が変わる = 局面の質も変わる)
  [
    { defId: "piece_return" as const, count: 4 },
    { defId: "check_break" as const, count: 4 },
    { defId: "no_promote" as const, count: 4 },
  ],
];
// SELFPLAY_DECK_POOL=0 で従来の単一デッキに固定 (A/B 対照・再現用)。
const USE_DECK_POOL = (process.env.SELFPLAY_DECK_POOL ?? "1") === "1";

function difficultyFor(player: Player): Difficulty {
  return player === "sente" ? SENTE : GOTE;
}

// 抽選用とデッキ用で**別ストリーム**にする。1 本を共有すると SELFPLAY_DIVERSIFY=0 のとき
// 抽選が rng を消費しないぶんデッキ割当がずれ、A/B 比較が「多様化の効果」と「デッキ違い」の
// 交絡になる。
const pickRng = mulberry32(SEED);
const deckRng = mulberry32((SEED ^ 0x9e3779b9) >>> 0);

const stats = createChooserStats();

// 多様化の状態。SEEN_FILE があれば既存の出現回数を読み込んでから始める。
// ★読み込みは**起動時 1 回だけ**。走行中に他ワーカーが書いた行は取り込まない
// (定期再読込は競合とコストに見合わないと判断。ワーカー間の分散は別 seed で担保する)。
const seen = SEEN_FILE
  ? (() => {
      try {
        return parseSeenIndexLines(readFileSync(SEEN_FILE, "utf8").split("\n"));
      } catch {
        return createSeenIndex(); // 未作成 = 初回
      }
    })()
  : createSeenIndex();

const aiChooser = createDiversifiedChooser(
  {
    difficultyFor,
    diversify: DIVERSIFY,
    marginCp: MARGIN_CP,
    topN: TOP_N,
    seen,
    rng: pickRng,
    seenFile: SEEN_FILE || undefined,
  },
  stats,
);

function main() {
  mkdirSync(dirname(OUT), { recursive: true });
  if (!APPEND) writeFileSync(OUT, ""); // 既定は truncate。APPEND 時は既存へ累積。

  let totalSamples = 0;
  const winners: Record<"sente" | "gote" | "draw", number> = { sente: 0, gote: 0, draw: 0 };

  const deckUsage = new Map<number, number>();
  for (let i = 0; i < GAMES; i++) {
    // 局ごとにデッキを抽選 (seed 固定なので再生成できる)。
    const deckIndex = USE_DECK_POOL ? Math.floor(deckRng() * DECK_PRESETS.length) : 0;
    deckUsage.set(deckIndex, (deckUsage.get(deckIndex) ?? 0) + 1);
    const rec = playOneGame({
      chooseAction: aiChooser,
      deckSpec: DECK_PRESETS[deckIndex],
      senteDifficulty: SENTE,
      goteDifficulty: GOTE,
      engineVersion: ENGINE_VERSION,
      maxMoves: MAX_MOVES,
    });
    appendFileSync(OUT, trainingRecordToJsonl(rec) + "\n");
    totalSamples += rec.samples.length;
    const w = (rec.game.winner ?? "draw") as "sente" | "gote" | "draw";
    winners[w] += 1;
    console.log(
      `game ${i + 1}/${GAMES}: ${rec.samples.length} samples, winner=${w}, moves=${rec.game.moveCount}, status=${rec.game.finalStatus}`,
    );
  }

  console.log(`\nDone. ${GAMES} games, ${totalSamples} samples -> ${OUT}`);
  console.log(`winners: sente=${winners.sente} gote=${winners.gote} draw=${winners.draw}`);
  if (USE_DECK_POOL) {
    const used = [...deckUsage].sort((a, b) => a[0] - b[0]).map(([i, n]) => `${"ABCDE"[i]}:${n}`).join(" ");
    console.log(`デッキ構成の内訳: ${used} (全 ${DECK_PRESETS.length} 種)`);
  } else {
    console.log("デッキ構成: 従来の単一デッキに固定 (SELFPLAY_DECK_POOL=0)");
  }
  for (const line of formatChooserStats(stats, DIVERSIFY)) console.log(line);
  if (DIVERSIFY) {
    console.log(`  seed=${SEED} margin=${MARGIN_CP}cp topN=${TOP_N} seen=${SEEN_FILE || "(共有なし)"}`);
  }
}

main();
