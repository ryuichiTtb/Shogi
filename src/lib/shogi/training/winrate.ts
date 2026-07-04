// 対戦勝率ハーネスの純粋ロジック (Issue #245 Stage 2 P2-2a)。
//
// 学習評価 AI と対戦相手 AI を手番別 chooser で対戦させ、勝率を集計する。React / DB / AI
// ライブラリに非依存 (chooser を注入)。実 AI 注入は scripts/winrate-245.ts、テストはダミー
// chooser で決定的に検証する (#109 疎結合・テスタビリティ、selfplay.ts と同パターン)。
//
// 設計正本: docs/plans/issue-245-p2-2a-winrate-harness.md
// - 合成 chooser (bySide): learnedSide の手番のみ learned、他は opponent (playOneGame 無改変、§3.1)。
// - ペア対局 (playPair): 先手/後手を入替えた 2 局で手番バイアスを相殺 (§3.5)。
// - 集計 (tally): 勝率[draw 除外] と スコア率[draw 0.5] の両方を出す (§3.5、解釈を分けない)。

import type { DeckSpec } from "@/lib/shogi/cards/state";
import type { Difficulty, Player } from "@/lib/shogi/types";

import { playOneGame, type ChooseAction } from "./selfplay";

// 手番別 chooser を合成する: learnedSide の手番は learned、相手手番は opponent。
// playOneGame は単一 chooser しか受けない (selfplay.ts:36) ため、player 分岐を chooser 側に閉じ込め、
// ドライバを無改変のまま A/B 対戦にする (§3.1、difficultyFor と同型の合成)。
export function bySide(
  learnedSide: Player,
  learned: ChooseAction,
  opponent: ChooseAction,
): ChooseAction {
  return (world, player) => (player === learnedSide ? learned : opponent)(world, player);
}

export interface WinrateGameResult {
  learnedSide: Player; // この局で学習 AI が担当した手番
  winner: Player | "draw";
  moveCount: number;
}

export interface MatchOptions {
  learned: ChooseAction;
  opponent: ChooseAction;
  deckSpec: DeckSpec[];
  difficulty?: Difficulty; // メタ記録用 (実難易度は chooser 内で使う)
  maxMoves?: number;
}

// 1 ペア = 学習 AI 先手の 1 局 + 学習 AI 後手の 1 局 (手番バイアス相殺)。
// ★デッキは局ごと独立 shuffle (state.ts) ゆえ色 swap でも手札・deck 運は相殺されず、N の
// 統計吸収に委ねる (手番バイアスのみ相殺、計画 §3.6 / §4)。
export function playPair(opts: MatchOptions): WinrateGameResult[] {
  const sides: Player[] = ["sente", "gote"];
  return sides.map((learnedSide) => {
    const chooser = bySide(learnedSide, opts.learned, opts.opponent);
    const rec = playOneGame({
      chooseAction: chooser,
      deckSpec: opts.deckSpec,
      senteDifficulty: opts.difficulty ?? null,
      goteDifficulty: opts.difficulty ?? null,
      maxMoves: opts.maxMoves,
    });
    // playOneGame は Player | "draw" を必ず埋めるが TrainingGameData.winner の型は nullable ゆえ
    // null/undefined は引き分け扱いに絞る (意味的にも未決着 = draw)。
    return { learnedSide, winner: rec.game.winner ?? "draw", moveCount: rec.game.moveCount };
  });
}

// N ペア (= 2N 局) 対戦する。
export function runMatch(pairs: number, opts: MatchOptions): WinrateGameResult[] {
  const out: WinrateGameResult[] = [];
  for (let i = 0; i < pairs; i++) out.push(...playPair(opts));
  return out;
}

export interface SideTally {
  wins: number;
  losses: number;
  draws: number;
}

export interface WinrateTally {
  games: number;
  overall: SideTally; // 学習 AI 視点
  asSente: SideTally; // 学習 AI が先手だった局のみ
  asGote: SideTally; // 学習 AI が後手だった局のみ
  winRateExclDraws: number | null; // wins / (wins + losses)、決着局 0 なら null
  scoreRate: number; // (wins + 0.5×draws) / games
  drawRate: number; // draws / games
  avgMoveCount: number;
}

// 1 局を学習 AI 視点で勝/負/分に分類する。
function classify(r: WinrateGameResult): keyof SideTally {
  if (r.winner === "draw") return "draws";
  return r.winner === r.learnedSide ? "wins" : "losses";
}

export function tally(results: WinrateGameResult[]): WinrateTally {
  const empty = (): SideTally => ({ wins: 0, losses: 0, draws: 0 });
  const overall = empty();
  const asSente = empty();
  const asGote = empty();
  let moveSum = 0;

  for (const r of results) {
    const key = classify(r);
    overall[key] += 1;
    (r.learnedSide === "sente" ? asSente : asGote)[key] += 1;
    moveSum += r.moveCount;
  }

  const games = results.length;
  const decided = overall.wins + overall.losses;
  return {
    games,
    overall,
    asSente,
    asGote,
    winRateExclDraws: decided > 0 ? overall.wins / decided : null,
    scoreRate: games > 0 ? (overall.wins + 0.5 * overall.draws) / games : 0,
    drawRate: games > 0 ? overall.draws / games : 0,
    avgMoveCount: games > 0 ? moveSum / games : 0,
  };
}
