import { describe, expect, it } from "vitest";

import { createInitialGameState } from "@/lib/shogi/board";
import {
  createInitialCardState,
  deserializeCardState,
  serializeCardState,
} from "@/lib/shogi/cards/state";
import type { CardGameState } from "@/lib/shogi/cards/types";
import { serializeBoardForTraining } from "@/lib/shogi/training/serialize";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";
import type { PieceType, Player } from "@/lib/shogi/types";

import {
  CARD_DEF_IDS,
  encodePosition,
  FEATURE_DIM,
  FEATURE_LAYOUT,
  HAND_PIECE_TYPES,
  PIECE_TYPES,
  type EncoderPosition,
} from "../encoder";

function emptyBoard(): ({ type: PieceType; owner: Player } | null)[][] {
  return Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => null));
}

function makeCard(overrides: Partial<CardGameState> = {}): CardGameState {
  return { ...createInitialCardState([]), ...overrides };
}

function blockSum(f: Float32Array, block: { offset: number; size: number }): number {
  let s = 0;
  for (let i = 0; i < block.size; i++) s += f[block.offset + i];
  return s;
}

describe("FEATURE_LAYOUT / FEATURE_DIM", () => {
  it("FEATURE_DIM は各ブロックサイズの合算と一致する", () => {
    const sum = Object.values(FEATURE_LAYOUT).reduce((a, b) => a + b.size, 0);
    expect(FEATURE_DIM).toBe(sum);
    expect(FEATURE_DIM).toBeGreaterThan(0);
  });

  it("ブロックは隙間・重なりなく連続配置される", () => {
    const blocks = Object.values(FEATURE_LAYOUT).sort((a, b) => a.offset - b.offset);
    let cursor = 0;
    for (const b of blocks) {
      expect(b.offset).toBe(cursor);
      cursor += b.size;
    }
    expect(cursor).toBe(FEATURE_DIM);
  });
});

describe("encodePosition — 盤面", () => {
  it("空盤は盤面ブロックが全 0", () => {
    const f = encodePosition({ board: emptyBoard(), hand: { sente: {}, gote: {} }, currentPlayer: "sente" }, makeCard());
    expect(blockSum(f, FEATURE_LAYOUT.board)).toBe(0);
  });

  it("1 駒は盤面ブロックに 1 つだけ立ち、正しい索引に入る", () => {
    const board = emptyBoard();
    board[2][3] = { type: "pawn", owner: "sente" };
    const f = encodePosition({ board, hand: { sente: {}, gote: {} }, currentPlayer: "sente" }, makeCard());
    expect(blockSum(f, FEATURE_LAYOUT.board)).toBe(1);

    const N_PIECE = PIECE_TYPES.length;
    const pieceIdx = PIECE_TYPES.indexOf("pawn");
    const ownerIdx = 0; // sente
    const sq = 2 * 9 + 3;
    const idx = FEATURE_LAYOUT.board.offset + (ownerIdx * 81 + sq) * N_PIECE + pieceIdx;
    expect(f[idx]).toBe(1);
  });

  it("所有者で別索引になる (sente と gote の同種駒)", () => {
    const board = emptyBoard();
    board[0][0] = { type: "king", owner: "gote" };
    board[8][8] = { type: "king", owner: "sente" };
    const f = encodePosition({ board, hand: { sente: {}, gote: {} }, currentPlayer: "sente" }, makeCard());
    expect(blockSum(f, FEATURE_LAYOUT.board)).toBe(2);
  });

  it("初期局面: 盤面ブロックの 1 の数 = 盤上の駒数 (自己無矛盾)", () => {
    const gs = createInitialGameState(CARD_SHOGI_VARIANT);
    const pieceCount = gs.board.flat().filter(Boolean).length;
    const f = encodePosition(gs, makeCard());
    expect(blockSum(f, FEATURE_LAYOUT.board)).toBe(pieceCount);
  });
});

describe("encodePosition — 手番 / 手駒 / カード状態", () => {
  it("手番ビット: 先手番=1 / 後手番=0", () => {
    const fs = encodePosition({ board: emptyBoard(), hand: { sente: {}, gote: {} }, currentPlayer: "sente" }, makeCard());
    const fg = encodePosition({ board: emptyBoard(), hand: { sente: {}, gote: {} }, currentPlayer: "gote" }, makeCard());
    expect(fs[FEATURE_LAYOUT.side.offset]).toBe(1);
    expect(fg[FEATURE_LAYOUT.side.offset]).toBe(0);
  });

  it("持ち駒: count / HAND_MAX で正規化 (歩 9 枚 → 0.5)", () => {
    const pos: EncoderPosition = { board: emptyBoard(), hand: { sente: { pawn: 9 }, gote: {} }, currentPlayer: "sente" };
    const f = encodePosition(pos, makeCard());
    const pawnIdx = HAND_PIECE_TYPES.indexOf("pawn");
    expect(f[FEATURE_LAYOUT.hand.offset + pawnIdx]).toBeCloseTo(0.5, 5);
  });

  it("マナ: mana/manaCap 基準で正規化 (manaCap=20, mana=10 → 0.5)", () => {
    const f = encodePosition(
      { board: emptyBoard(), hand: { sente: {}, gote: {} }, currentPlayer: "sente" },
      makeCard({ mana: { sente: 10, gote: 0 } }),
    );
    expect(f[FEATURE_LAYOUT.mana.offset]).toBeCloseTo(0.5, 5);
    expect(f[FEATURE_LAYOUT.mana.offset + 1]).toBe(0);
    expect(f[FEATURE_LAYOUT.mana.offset + 2]).toBeCloseTo(1, 5); // manaCap 20/20
  });

  it("手札カード: defId 別枚数を数え正規化 (同一 defId 2 枚 → 0.5)", () => {
    const f = encodePosition(
      { board: emptyBoard(), hand: { sente: {}, gote: {} }, currentPlayer: "sente" },
      makeCard({
        hand: {
          sente: [
            { instanceId: "a", defId: "pawn_return" },
            { instanceId: "b", defId: "pawn_return" },
          ],
          gote: [],
        },
      }),
    );
    const ci = CARD_DEF_IDS.indexOf("pawn_return");
    expect(f[FEATURE_LAYOUT.cardHand.offset + ci]).toBeCloseTo(0.5, 5);
  });

  it("トラップ: セット中 defId を one-hot (sente check_break)", () => {
    const f = encodePosition(
      { board: emptyBoard(), hand: { sente: {}, gote: {} }, currentPlayer: "sente" },
      makeCard({ trap: { sente: { instanceId: "t", defId: "check_break", owner: "sente" }, gote: null } }),
    );
    const ci = CARD_DEF_IDS.indexOf("check_break");
    expect(f[FEATURE_LAYOUT.trap.offset + ci]).toBe(1);
    expect(blockSum(f, FEATURE_LAYOUT.trap)).toBe(1);
  });

  it("no_promote マーク: プレイヤー別にマーク済マスを立てる", () => {
    const f = encodePosition(
      { board: emptyBoard(), hand: { sente: {}, gote: {} }, currentPlayer: "sente" },
      makeCard({ noPromoteMarks: { sente: [{ row: 2, col: 3 }], gote: [{ row: 6, col: 7 }] } }),
    );
    expect(blockSum(f, FEATURE_LAYOUT.marks)).toBe(2);
    expect(f[FEATURE_LAYOUT.marks.offset + 2 * 9 + 3]).toBe(1); // sente
    expect(f[FEATURE_LAYOUT.marks.offset + 81 + 6 * 9 + 7]).toBe(1); // gote
  });
});

describe("encodePosition — 決定性 / train-inference スキューゼロ", () => {
  it("同一入力は同一ベクトル (決定的)", () => {
    const gs = createInitialGameState(CARD_SHOGI_VARIANT);
    const cs = createInitialCardState([{ defId: "pawn_return", count: 4 }]);
    expect(Array.from(encodePosition(gs, cs))).toEqual(Array.from(encodePosition(gs, cs)));
  });

  it("★ライブ型と直列化→復元で完全一致 (encoder 単一実装の保証)", () => {
    const gs = createInitialGameState(CARD_SHOGI_VARIANT);
    const cs = createInitialCardState([{ defId: "pawn_return", count: 4 }, { defId: "no_promote", count: 4 }]);

    // 推論側: ライブ GameState / CardGameState を直接符号化。
    const live = encodePosition(gs, cs);

    // 学習側: JSONL を経た形 (serializeBoardForTraining 出力 + deserializeCardState) を符号化。
    const serializedBoard = serializeBoardForTraining(gs) as unknown as EncoderPosition;
    const restoredCard = deserializeCardState(serializeCardState(cs));
    const fromSerialized = encodePosition(serializedBoard, restoredCard);

    expect(Array.from(fromSerialized)).toEqual(Array.from(live));
  });
});
