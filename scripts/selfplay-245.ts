#!/usr/bin/env node
// 自己対戦バッチ生成 (Issue #245 フェーズ0 P0-4)。
//
// CPU vs CPU を UI なしで最後まで回し、per-decision の学習データ (盤面 + カード状態 +
// 採用行動 + 生じたイベント) を JSONL に書き出す。1 行 = 1 試合。
// 既定は JSONL ファイル出力 (DB 不要・Neon 非依存)。DB への取り込みは別途 import で行う
// (rule 5: DB 書き込みは都度ユーザー確認が要るため、生成自体は副作用なしの JSONL に分離)。
//
// 使い方 (worktree ルートで):
//   npx tsx scripts/selfplay-245.ts [games]
//   SELFPLAY_GAMES=20 SELFPLAY_SENTE=expert SELFPLAY_GOTE=expert \
//   SELFPLAY_OUT=docs/training-data/selfplay.jsonl npx tsx scripts/selfplay-245.ts

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { findBestMoveWithStats } from "@/lib/shogi/ai/engine";
import type { WorldState } from "@/lib/shogi/kernel/world-kernel";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";
import { trainingRecordToJsonl } from "@/lib/shogi/training/jsonl";
import { playOneGame, type ChooseAction } from "@/lib/shogi/training/selfplay";
import type { Difficulty, Player } from "@/lib/shogi/types";

const GAMES = Math.max(1, Number(process.env.SELFPLAY_GAMES ?? process.argv[2] ?? "10") || 10);
const SENTE = (process.env.SELFPLAY_SENTE ?? "expert") as Difficulty;
const GOTE = (process.env.SELFPLAY_GOTE ?? "expert") as Difficulty;
const OUT = process.env.SELFPLAY_OUT ?? "/tmp/selfplay-245.jsonl";
const ENGINE_VERSION = process.env.SELFPLAY_ENGINE ?? "bolt-on";
// 手数上限 (未指定なら playOneGame 既定 = SPECTATOR_MAX_MOVES=200)。動作確認・短時間生成用。
const MAX_MOVES = process.env.SELFPLAY_MAX_MOVES ? Number(process.env.SELFPLAY_MAX_MOVES) : undefined;

// production 同等のデッキ構成 (perf-bench と整合)。
const DECK = [
  { defId: "pawn_return" as const, count: 4 },
  { defId: "no_promote" as const, count: 4 },
  { defId: "double_pawn" as const, count: 4 },
];

function difficultyFor(player: Player): Difficulty {
  return player === "sente" ? SENTE : GOTE;
}

// production 同等 (bolt-on) AI を chooser として注入する。
const aiChooser: ChooseAction = (world: WorldState, player: Player) => {
  const r = findBestMoveWithStats(world.gameState, player, difficultyFor(player), CARD_SHOGI_VARIANT, {
    cardState: world.cardState,
    useKernelSearch: true,
    spectator: true,
  });
  return r.action ?? (r.move ? { kind: "move", move: r.move } : null);
};

function main() {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, ""); // truncate

  let totalSamples = 0;
  const winners: Record<"sente" | "gote" | "draw", number> = { sente: 0, gote: 0, draw: 0 };

  for (let i = 0; i < GAMES; i++) {
    const rec = playOneGame({
      chooseAction: aiChooser,
      deckSpec: DECK,
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
}

main();
