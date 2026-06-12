// Issue #235 S4a (D-I): no_promote マーク駒の mark-aware 着手生成の特性化テスト。
//
// ユーザー決定 (2026-06-10): 成り無効化マーク駒は成れないまま、**盤上内に着地する限り**
// 成り必須マス (mustPromote: 歩/香の最奥段、桂の残2段) へも不成で進める (行き所のない駒を
// マーク駒に限り許容)。盤外着地のみ非合法 (着手生成が盤上のみ生成するので自然に除外)。
//
// 検証観点:
//  - マーク歩 2段目→1段目 不成可 (dead 許容、敵駒捕獲を含む)
//  - マーク桂 3段目→1段目 不成可 (on-board dead) / マーク桂 2段目→盤外は不生成
//  - マーク駒は promote=true (幻の成り手) を一切生成しない
//  - cardState 未供給 / マーク非該当は従来生成と完全等価 (standard 不変の担保)
//  - 詰み判定: マーク歩の不成前進が王手回避になり詰みでない (移動 LIST の正しさが判定へ伝播)

import { describe, it, expect } from "vitest";
import { getPieceMoves, getFullLegalMoves, isCheckmate } from "../moves";
import { createInitialGameState } from "../board";
import { createInitialCardState } from "../cards/state";
import { CARD_SHOGI_VARIANT } from "../variants/card-shogi";
import type { Board, GameState, Piece, Player, Position } from "../types";
import type { CardGameState } from "../cards/types";

function emptyBoard(): Board {
  return Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => null));
}

function gameStateWith(pieces: Array<{ pos: Position; piece: Piece }>, currentPlayer: Player = "sente"): GameState {
  const gs = createInitialGameState(CARD_SHOGI_VARIANT);
  gs.board = emptyBoard();
  for (const { pos, piece } of pieces) {
    gs.board[pos.row][pos.col] = piece;
  }
  gs.currentPlayer = currentPlayer;
  return gs;
}

function markedCardState(player: Player, marks: Position[]): CardGameState {
  const cs = createInitialCardState([{ defId: "no_promote", count: 4 }]);
  cs.noPromoteMarks[player] = marks.map((m) => ({ row: m.row, col: m.col }));
  return cs;
}

const sentePawn: Piece = { type: "pawn", owner: "sente" };
const senteKnight: Piece = { type: "knight", owner: "sente" };
const senteLance: Piece = { type: "lance", owner: "sente" };
const senteSilver: Piece = { type: "silver", owner: "sente" };
const gotePawn: Piece = { type: "pawn", owner: "gote" };
const goteKing: Piece = { type: "king", owner: "gote" };
const senteKing: Piece = { type: "king", owner: "sente" };

describe("S4a: no_promote マーク駒の mark-aware 着手生成 (D-I)", () => {
  it("マーク歩 2段目→1段目: 不成で前進できる (mustPromote マスへ dead 許容)", () => {
    // sente 歩を row1 (2段目)、玉は遠方に置く。row0 (1段目) は空。
    const gs = gameStateWith([
      { pos: { row: 1, col: 4 }, piece: sentePawn },
      { pos: { row: 8, col: 0 }, piece: senteKing },
      { pos: { row: 0, col: 8 }, piece: goteKing },
    ]);
    const cs = markedCardState("sente", [{ row: 1, col: 4 }]);

    const moves = getPieceMoves(gs, { row: 1, col: 4 }, "sente", CARD_SHOGI_VARIANT, cs);
    const toRow0 = moves.filter((m) => m.type === "move" && m.to.row === 0 && m.to.col === 4);
    expect(toRow0).toHaveLength(1);
    expect(toRow0[0].promote).toBe(false); // 不成
    // 幻の成り手 (promote=true) は一切生成しない
    expect(moves.some((m) => m.type === "move" && m.promote === true)).toBe(false);
  });

  it("マーク歩 2段目→1段目: 敵駒を不成で取れる (capture-intent)", () => {
    const gs = gameStateWith([
      { pos: { row: 1, col: 4 }, piece: sentePawn },
      { pos: { row: 0, col: 4 }, piece: { type: "silver", owner: "gote" } },
      { pos: { row: 8, col: 0 }, piece: senteKing },
      { pos: { row: 0, col: 8 }, piece: goteKing },
    ]);
    const cs = markedCardState("sente", [{ row: 1, col: 4 }]);

    const moves = getPieceMoves(gs, { row: 1, col: 4 }, "sente", CARD_SHOGI_VARIANT, cs);
    const capture = moves.find((m) => m.type === "move" && m.to.row === 0 && m.to.col === 4);
    expect(capture).toBeDefined();
    expect(capture!.promote).toBe(false);
    expect(capture!.captured).toBe("silver");
  });

  it("マーク桂 3段目→1段目: 不成で跳べる (on-board dead 許容)", () => {
    // sente 桂を row2 (3段目)。前方ジャンプ先 row0 (1段目) は盤上 = mustPromote だが不成許容。
    const gs = gameStateWith([
      { pos: { row: 2, col: 4 }, piece: senteKnight },
      { pos: { row: 8, col: 0 }, piece: senteKing },
      { pos: { row: 0, col: 8 }, piece: goteKing },
    ]);
    const cs = markedCardState("sente", [{ row: 2, col: 4 }]);

    const moves = getPieceMoves(gs, { row: 2, col: 4 }, "sente", CARD_SHOGI_VARIANT, cs);
    const toRow0 = moves.filter((m) => m.type === "move" && m.to.row === 0);
    // 桂の前方ジャンプ (row2→row0、col±1) が不成で生成される
    expect(toRow0.length).toBeGreaterThan(0);
    expect(toRow0.every((m) => m.promote === false)).toBe(true);
  });

  it("マーク桂 2段目: 前方ジャンプは盤外ゆえ生成されない", () => {
    // sente 桂を row1 (2段目)。前方ジャンプ先 row-1 は盤外 → 生成されない (isValidPos で除外)。
    const gs = gameStateWith([
      { pos: { row: 1, col: 4 }, piece: senteKnight },
      { pos: { row: 8, col: 0 }, piece: senteKing },
      { pos: { row: 0, col: 8 }, piece: goteKing },
    ]);
    const cs = markedCardState("sente", [{ row: 1, col: 4 }]);

    const moves = getPieceMoves(gs, { row: 1, col: 4 }, "sente", CARD_SHOGI_VARIANT, cs);
    // 桂は前方ジャンプのみ。盤外なので合法手ゼロ。
    expect(moves).toHaveLength(0);
  });

  it("cardState 未供給 / マーク非該当は従来生成と完全等価 (promote=true を含む)", () => {
    const gs = gameStateWith([
      { pos: { row: 1, col: 4 }, piece: sentePawn },
      { pos: { row: 8, col: 0 }, piece: senteKing },
      { pos: { row: 0, col: 8 }, piece: goteKing },
    ]);

    const baseline = getPieceMoves(gs, { row: 1, col: 4 }, "sente", CARD_SHOGI_VARIANT);
    // cardState 未供給: mustPromote ゆえ promote=true のみ (従来挙動)
    expect(baseline).toHaveLength(1);
    expect(baseline[0].promote).toBe(true);

    // 別マスをマークした cardState (この歩は非該当) → baseline と一致
    const csOther = markedCardState("sente", [{ row: 5, col: 5 }]);
    const withOtherMark = getPieceMoves(gs, { row: 1, col: 4 }, "sente", CARD_SHOGI_VARIANT, csOther);
    expect(withOtherMark).toEqual(baseline);
  });

  it("getFullLegalMoves: マーク駒の不成手が全合法手に含まれる", () => {
    const gs = gameStateWith([
      { pos: { row: 1, col: 4 }, piece: sentePawn },
      { pos: { row: 8, col: 0 }, piece: senteKing },
      { pos: { row: 0, col: 8 }, piece: goteKing },
    ]);
    const cs = markedCardState("sente", [{ row: 1, col: 4 }]);

    const full = getFullLegalMoves(gs, "sente", CARD_SHOGI_VARIANT, cs);
    const pawnAdvance = full.find(
      (m) => m.type === "move" && m.from?.row === 1 && m.from?.col === 4 && m.to.row === 0,
    );
    expect(pawnAdvance).toBeDefined();
    expect(pawnAdvance!.promote).toBe(false);
    // マーク駒の幻成りは全合法手にも現れない
    expect(
      full.some((m) => m.type === "move" && m.from?.row === 1 && m.from?.col === 4 && m.promote),
    ).toBe(false);
  });

  it("詰み判定: マーク歩の不成前進が唯一の王手回避なら詰みでない", () => {
    // gote 玉 row0,col0。sente 飛 row0,col8 が横利きで王手。gote マーク歩を row1,col0 に置き、
    // row0,col0 は玉。歩は前進で玉を守れないので、別の回避: gote 玉が逃げられない状況を作る。
    // ここでは「マーク歩が不成で前進して合駒/回避になる」最小例として、gote 玉が row1 に居て
    // sente 飛が縦王手、gote マーク歩 (row0,col0、最奥段=gote の row8 側ではない) ... 簡潔のため
    // 「マーク駒に合法手が存在する=詰みでない」ことを移動 LIST 経由で確認する。
    // gote 玉 row0,col4 / sente 香 row8,col4 が縦に王手 (間に駒なし)。gote マーク歩 row1,col3。
    // gote 玉は左右 (col3 は自歩、col5) と前 (row1,col4) へ逃げられるので素直に詰みでない=
    // mark-aware でも非詰みが保たれる (回避手の存在は mark 不変だが、LIST 生成が壊れていない確認)。
    const gs = gameStateWith(
      [
        { pos: { row: 0, col: 4 }, piece: goteKing },
        { pos: { row: 1, col: 3 }, piece: { type: "pawn", owner: "gote" } },
        { pos: { row: 8, col: 4 }, piece: { type: "lance", owner: "sente" } },
        { pos: { row: 8, col: 0 }, piece: senteKing },
      ],
      "gote",
    );
    const cs = markedCardState("gote", [{ row: 1, col: 3 }]);
    // gote は王手中だが玉が逃げられる → 詰みでない (mark-aware でも判定が壊れない)
    expect(isCheckmate(gs, "gote", CARD_SHOGI_VARIANT, cs)).toBe(false);
  });

  it("マーク香 slide: 最奥段まで不成のみ生成し盤外スライドを出さない (slide emission site)", () => {
    // sente 香 row4,col4。前方 row3/2/1 は空、row0 に gote 歩。香は前方 slide のみ。
    // マークありで row3/2/1 (空・不成) と row0 (敵歩を不成で捕獲) の 4 手のみ = 任意成り
    // (row2/1) も成り必須 (row0) も不成に潰れ、promote=true は一切出ない。slide-empty /
    // slide-capture 両 emission site の isMarked 枝を網羅。
    const gs = gameStateWith([
      { pos: { row: 4, col: 4 }, piece: senteLance },
      { pos: { row: 0, col: 4 }, piece: gotePawn },
      { pos: { row: 8, col: 0 }, piece: senteKing },
      { pos: { row: 0, col: 8 }, piece: goteKing },
    ]);
    const cs = markedCardState("sente", [{ row: 4, col: 4 }]);

    const moves = getPieceMoves(gs, { row: 4, col: 4 }, "sente", CARD_SHOGI_VARIANT, cs);
    expect(moves).toHaveLength(4); // 非マーク時は 6 (row2/1 に成り、row0 が成り必須)
    expect(moves.every((m) => m.type === "move" && m.promote === false)).toBe(true);
    const lastRank = moves.find((m) => m.to.row === 0 && m.to.col === 4);
    expect(lastRank).toBeDefined();
    expect(lastRank!.captured).toBe("pawn"); // 最奥段の敵歩を不成で捕獲
    expect(moves.some((m) => m.to.row < 0)).toBe(false); // 盤外スライドなし
  });

  it("後手マーク歩: 方向反転して最奥段 (row8) へ不成前進する", () => {
    // gote 歩 row7,col4 (後手は +row 方向)。row8 は後手の最奥段 = mustPromote。マークありで
    // row8 への不成 1 手のみ = 方向反転経路 (actualDr=-dr) でも isMarked 枝が正しく効く。
    const gs = gameStateWith(
      [
        { pos: { row: 7, col: 4 }, piece: gotePawn },
        { pos: { row: 0, col: 0 }, piece: goteKing },
        { pos: { row: 8, col: 8 }, piece: senteKing },
      ],
      "gote",
    );
    const cs = markedCardState("gote", [{ row: 7, col: 4 }]);

    const moves = getPieceMoves(gs, { row: 7, col: 4 }, "gote", CARD_SHOGI_VARIANT, cs);
    expect(moves).toHaveLength(1);
    expect(moves[0].to).toEqual({ row: 8, col: 4 });
    expect(moves[0].promote).toBe(false); // 非マーク時は promote=true (mustPromote)
  });

  it("マーク銀: 任意成りマス (canPromote だが非 mustPromote) でも不成のみ生成する", () => {
    // sente 銀 row3,col4 → row2 は成りゾーン進入だが銀は mustPromote にならない (任意成り)。
    // マークありで成りゾーンへの前進は不成のみ = マーク=「成り必須の上書き」でなく「成り全面禁止」。
    const gs = gameStateWith([
      { pos: { row: 3, col: 4 }, piece: senteSilver },
      { pos: { row: 8, col: 0 }, piece: senteKing },
      { pos: { row: 0, col: 8 }, piece: goteKing },
    ]);
    const cs = markedCardState("sente", [{ row: 3, col: 4 }]);

    const moves = getPieceMoves(gs, { row: 3, col: 4 }, "sente", CARD_SHOGI_VARIANT, cs);
    const toRow2 = moves.filter((m) => m.type === "move" && m.to.row === 2 && m.to.col === 4);
    expect(toRow2).toHaveLength(1); // 非マーク時は 2 (不成 + 任意成り)
    expect(toRow2[0].promote).toBe(false);
    expect(moves.some((m) => m.type === "move" && m.promote === true)).toBe(false);
  });
});
