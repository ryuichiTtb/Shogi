// Issue #245 教材多様化 段1: ワーカー出力の結合ロジックの pin。
//
// ここが壊れると「古いラベルが静かに採用される」「レシピ混在を検知できない」という、
// 実行しても正常に見えるのに教材だけが劣化する事故になるため、不変条件を固定する。

import { describe, expect, it } from "vitest";

import type { LabelMeta, TrainingGameRecord, TrainingSampleData } from "@/lib/shogi/training/types";

import { mergeLabeledRecords } from "../merge-labeled";

const D5: LabelMeta = { version: 1, depth: 5, expandCards: false, expandDraw: false };
const D4: LabelMeta = { ...D5, depth: 4 };

function sample(plyIndex: number, searchScore?: number | null): TrainingSampleData {
  const s: TrainingSampleData = {
    plyIndex,
    moveCount: plyIndex,
    sideToMove: plyIndex % 2 === 0 ? "sente" : "gote",
    boardState: { p: plyIndex },
    cardState: { c: plyIndex },
    action: { kind: "draw" },
    events: [],
  };
  if (searchScore !== undefined) s.searchScore = searchScore;
  return s;
}

// gameId は「別の対局」を作るためのダミー識別子 (内容キーに含まれる engineVersion を流用)。
function line(gameId: string, recipe: LabelMeta | undefined, scores: (number | null | undefined)[]): string {
  const record: TrainingGameRecord = {
    game: {
      source: "self_play",
      variantId: "card-shogi",
      winner: "sente",
      finalStatus: "checkmate",
      moveCount: 10,
      engineVersion: gameId,
    },
    samples: scores.map((sc, i) => sample(i, sc)),
  };
  if (recipe) record.game = { ...record.game, labelMeta: recipe };
  return JSON.stringify(record);
}

describe("mergeLabeledRecords", () => {
  it("同一レシピの完全な重複は 1 件に畳む", () => {
    const l = line("g1", D5, [10, 20]);
    const { lines, stats } = mergeLabeledRecords([l, l]);
    expect(lines).toEqual([l]);
    expect(stats.dup).toBe(1);
    expect(stats.replaced).toBe(0);
  });

  it("別の対局は畳まれない", () => {
    const a = line("g1", D5, [10]);
    const b = line("g2", D5, [10]);
    expect(mergeLabeledRecords([a, b]).lines).toEqual([a, b]);
  });

  // ★不変条件①: レシピ集計は重複排除より前。ここを後ろにすると、同一対局の新旧レシピ行の
  //   片方が「重複」として捨てられ、レシピ混在を検知できなくなる (実際に踏んだバグ)。
  it("同一対局の別レシピ行があってもレシピ内訳に両方が計上される", () => {
    const old = line("g1", D4, [10]);
    const cur = line("g1", D5, [10]);
    const { stats } = mergeLabeledRecords([old, cur]);
    expect([...stats.recipes.entries()].sort()).toEqual([
      ["v1|d4|c0|w0", 1],
      ["v1|d5|c0|w0", 1],
    ]);
    expect(stats.dup).toBe(1); // 内容キーは同一なので重複としては 1 件
  });

  it("未刻印 (legacy) と刻印済みも別レシピとして計上される", () => {
    const { stats } = mergeLabeledRecords([line("g1", undefined, [10]), line("g2", D5, [10])]);
    expect(stats.recipes.get("legacy")).toBe(1);
    expect(stats.recipes.get("v1|d5|c0|w0")).toBe(1);
  });

  // ★不変条件②: 採点できている方が勝つ (LABEL_TIME_MS はレシピに含まれないため、
  //   時間切れで null が混じった採点と採り直した採点が同一レシピで並びうる)。
  it("重複時は採点不能 (null) が少ない方を残す — 劣化コピーが後から来ても勝たない", () => {
    const good = line("g1", D5, [10, 20]);
    const bad = line("g1", D5, [10, null]);
    expect(mergeLabeledRecords([good, bad]).lines).toEqual([good]);
    const r = mergeLabeledRecords([bad, good]);
    expect(r.lines).toEqual([good]); // 劣化コピーが先に来ても差し替わる
    expect(r.stats.replaced).toBe(1);
  });

  it("未採点 (searchScore キーなし) も採点不能と同じく負ける", () => {
    const scored = line("g1", D5, [10, 20]);
    const unlabeled = line("g1", D5, [undefined, undefined]);
    expect(mergeLabeledRecords([unlabeled, scored]).lines).toEqual([scored]);
  });

  it("出力順は初出順を保つ (後から差し替えても位置は動かない)", () => {
    const a1 = line("g1", D5, [null]);
    const b = line("g2", D5, [1]);
    const a2 = line("g1", D5, [7]);
    expect(mergeLabeledRecords([a1, b, a2]).lines).toEqual([a2, b]);
  });

  it("壊れた行は数えて捨てる / 空行は無視する (残りの結合は続行する)", () => {
    const ok = line("g1", D5, [10]);
    const { lines, stats } = mergeLabeledRecords([ok, "{壊れた", "", "  "]);
    expect(lines).toEqual([ok]);
    expect(stats.broken).toBe(1); // 空行は broken に数えない (末尾改行で誤警告しないため)
  });

  it("採用した試合の採点欠落を数える", () => {
    const { stats } = mergeLabeledRecords([
      line("g1", D5, [10, null]),
      line("g2", D5, [undefined]),
      line("g3", D5, [1, 2]),
    ]);
    expect(stats.unscoredGames).toBe(1);
    expect(stats.missingGames).toBe(1);
    expect(stats.totalLines).toBe(3);
  });
});
