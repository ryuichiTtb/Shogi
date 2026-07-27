// Issue #245 教材多様化 段3: 多様化コアの不変条件を固定する。
//
// ここが壊れると「教材を作り直したのに前と同じ棋譜ばかり」「seed を固定したのに再現しない」
// という、生成に丸一日かけてから気づく類の事故になる。

import { describe, expect, it } from "vitest";

import { createInitialGameState } from "@/lib/shogi/board";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";
import { MANA_CAP } from "@/lib/shogi/cards/definitions";
import { serializeCardState } from "@/lib/shogi/cards/state";
import { sampleToSparseRow } from "@/lib/shogi/ai/learned/feature-export";
import type { CardGameState } from "@/lib/shogi/cards/types";
import type { TurnAction } from "@/lib/shogi/kernel/turn-action-types";
import type { TrainingSampleData } from "../types";

import {
  actionKey,
  createSeenIndex,
  formatSeenLine,
  getSeenCount,
  parseSeenIndexLines,
  pickDiverseAction,
  positionKey,
  recordSeen,
  seenKeysFromSample,
  serializeSeenIndex,
  type ScoredAction,
} from "../diversify";

const OPTS = { marginCp: 100, topN: 8 };

// ===== seeded PRNG (Mulberry32、scripts/utils/prng.ts と同一実装をインライン) =====
// src のテストから scripts へ深い相対 import を張らないための既存慣習
// (src/lib/shogi/kernel/__tests__/world-kernel-equivalence.test.ts と同じ)。
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cardState(over: Partial<CardGameState> = {}): CardGameState {
  return {
    mana: { sente: 10, gote: 10 },
    manaCap: MANA_CAP,
    hand: { sente: [], gote: [] },
    deck: { sente: [], gote: [] },
    graveyard: { sente: [], gote: [] },
    trap: { sente: null, gote: null },
    pendingCard: null,
    lastTurnStartedAt: { sente: null, gote: null },
    noPromoteMarks: { sente: [], gote: [] },
    drawProgress: { sente: 0, gote: 0 },
    ...over,
  };
}

const move = (fromRow: number, promote = false): TurnAction => ({
  kind: "move",
  move: {
    type: "move",
    from: { row: fromRow, col: 0 },
    to: { row: fromRow - 1, col: 0 },
    piece: "pawn",
    player: "sente",
    promote,
  },
});

describe("actionKey", () => {
  it("instanceId が違っても同じカード・同じ対象なら同一キー", () => {
    const a: TurnAction = { kind: "playCard", cardInstanceId: "s-1", defId: "pawn_return" };
    const b: TurnAction = { kind: "playCard", cardInstanceId: "s-99", defId: "pawn_return" };
    expect(actionKey(a)).toBe(actionKey(b));
  });

  it("カードの種類・対象が違えば別キー", () => {
    const base: TurnAction = { kind: "playCard", cardInstanceId: "x", defId: "pawn_return" };
    const otherCard: TurnAction = { kind: "playCard", cardInstanceId: "x", defId: "double_pawn" };
    const withTarget: TurnAction = {
      kind: "playCard", cardInstanceId: "x", defId: "pawn_return",
      target: { kind: "square", row: 6, col: 4 },
    };
    const otherTarget: TurnAction = {
      kind: "playCard", cardInstanceId: "x", defId: "pawn_return",
      target: { kind: "square", row: 6, col: 5 },
    };
    expect(actionKey(base)).not.toBe(actionKey(otherCard));
    expect(actionKey(base)).not.toBe(actionKey(withTarget));
    expect(actionKey(withTarget)).not.toBe(actionKey(otherTarget));
  });

  it("move は移動元・移動先・成りで区別され、captured には依存しない", () => {
    expect(actionKey(move(6))).toBe(actionKey(move(6)));
    expect(actionKey(move(6))).not.toBe(actionKey(move(5)));
    expect(actionKey(move(6))).not.toBe(actionKey(move(6, true)));
    // captured は局面から決まる従属情報なので、あってもキーは変わらない。
    const withCapture: TurnAction = {
      kind: "move",
      move: { ...(move(6) as Extract<TurnAction, { kind: "move" }>).move, captured: "pawn" },
    };
    expect(actionKey(withCapture)).toBe(actionKey(move(6)));
  });

  it("draw は単一キー", () => {
    expect(actionKey({ kind: "draw" })).toBe(actionKey({ kind: "draw" }));
    expect(actionKey({ kind: "draw" })).not.toBe(actionKey(move(6)));
  });
});

describe("positionKey", () => {
  const state = createInitialGameState(CARD_SHOGI_VARIANT);

  it("手札の並び順が違うだけなら同一キー (encoder は defId 別の枚数しか見ない)", () => {
    const a = cardState({
      hand: {
        sente: [
          { instanceId: "1", defId: "pawn_return" },
          { instanceId: "2", defId: "double_pawn" },
        ],
        gote: [],
      },
    });
    const b = cardState({
      hand: {
        sente: [
          { instanceId: "9", defId: "double_pawn" },
          { instanceId: "8", defId: "pawn_return" },
        ],
        gote: [],
      },
    });
    expect(positionKey(state, a)).toBe(positionKey(state, b));
  });

  it("手札の中身が違えば別キー", () => {
    const a = cardState({ hand: { sente: [{ instanceId: "1", defId: "pawn_return" }], gote: [] } });
    const b = cardState({ hand: { sente: [{ instanceId: "1", defId: "double_pawn" }], gote: [] } });
    expect(positionKey(state, a)).not.toBe(positionKey(state, b));
  });

  it("マナが違えば別キー (盤面が同じでもモデルには別入力)", () => {
    expect(positionKey(state, cardState({ mana: { sente: 3, gote: 3 } }))).not.toBe(
      positionKey(state, cardState({ mana: { sente: 9, gote: 3 } })),
    );
  });

  it("盤面が違えば別キー / 16 hex 固定長", () => {
    const moved = { ...state, currentPlayer: "gote" as const };
    expect(positionKey(state, cardState())).not.toBe(positionKey(moved, cardState()));
    expect(positionKey(state, cardState())).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("SeenIndex", () => {
  it("記録した回数を数える / 未記録は 0", () => {
    const idx = createSeenIndex();
    expect(getSeenCount(idx, "p", "a")).toBe(0);
    recordSeen(idx, "p", "a");
    recordSeen(idx, "p", "a");
    recordSeen(idx, "p", "b");
    expect(getSeenCount(idx, "p", "a")).toBe(2);
    expect(getSeenCount(idx, "p", "b")).toBe(1);
    expect(getSeenCount(idx, "q", "a")).toBe(0);
  });

  it("追記フォーマット (1 行 = 1 回) を読み込んで集計できる", () => {
    const idx = parseSeenIndexLines([
      formatSeenLine("p", "a"),
      formatSeenLine("p", "a"),
      formatSeenLine("p", "b"),
      "",
    ]);
    expect(getSeenCount(idx, "p", "a")).toBe(2);
    expect(getSeenCount(idx, "p", "b")).toBe(1);
  });

  it("圧縮フォーマット (count つき) と往復する", () => {
    const idx = createSeenIndex();
    recordSeen(idx, "p", "a", 5);
    recordSeen(idx, "q", "b");
    const restored = parseSeenIndexLines(serializeSeenIndex(idx));
    expect(getSeenCount(restored, "p", "a")).toBe(5);
    expect(getSeenCount(restored, "q", "b")).toBe(1);
  });

  it("壊れた行は無視して残りを読む (1 行の破損で生成成果を失わない)", () => {
    const idx = parseSeenIndexLines(["こわれた行", "p a 3", "q", "r b -1", "s c abc"]);
    expect(getSeenCount(idx, "p", "a")).toBe(3);
    expect(getSeenCount(idx, "r", "b")).toBe(0);
    expect(getSeenCount(idx, "s", "c")).toBe(0);
  });
});

describe("pickDiverseAction", () => {
  const candidates = (): ScoredAction[] => [
    { action: move(6), score: 100 }, // 最善
    { action: move(5), score: 60 }, // margin 内
    { action: move(4), score: 20 }, // margin 内 (100-100=0 以上)
    { action: move(3), score: -50 }, // margin 外
  ];

  it("未出の手があれば必ず未出から選ぶ", () => {
    const idx = createSeenIndex();
    recordSeen(idx, "p", actionKey(move(6)), 3);
    recordSeen(idx, "p", actionKey(move(5)), 1);
    // 未出は move(4) のみ → seed に依らず必ず move(4)
    for (let seed = 0; seed < 20; seed++) {
      const picked = pickDiverseAction(candidates(), "p", idx, OPTS, mulberry32(seed));
      expect(actionKey(picked!)).toBe(actionKey(move(4)));
    }
  });

  it("全部既出でも最小回数の層から選ぶ (候補が枯渇しない)", () => {
    const idx = createSeenIndex();
    recordSeen(idx, "p", actionKey(move(6)), 5);
    recordSeen(idx, "p", actionKey(move(5)), 2);
    recordSeen(idx, "p", actionKey(move(4)), 2);
    const picked = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      picked.add(actionKey(pickDiverseAction(candidates(), "p", idx, OPTS, mulberry32(seed))!));
    }
    // 最小回数は 2 の 2 手。5 回の最善は選ばれない。
    expect(picked).toEqual(new Set([actionKey(move(5)), actionKey(move(4))]));
  });

  it("margin 外の手は選ばれない (棋力を落とし過ぎない)", () => {
    const idx = createSeenIndex();
    for (let seed = 0; seed < 40; seed++) {
      const picked = pickDiverseAction(candidates(), "p", idx, OPTS, mulberry32(seed));
      expect(actionKey(picked!)).not.toBe(actionKey(move(3)));
    }
  });

  it("topN で候補を絞る (スコア上位のみ)", () => {
    const idx = createSeenIndex();
    const picked = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      picked.add(
        actionKey(pickDiverseAction(candidates(), "p", idx, { marginCp: 1000, topN: 2 }, mulberry32(seed))!),
      );
    }
    expect(picked).toEqual(new Set([actionKey(move(6)), actionKey(move(5))]));
  });

  it("同じ seed なら結果が完全に再現する", () => {
    const idx = createSeenIndex();
    const run = () => {
      const rng = mulberry32(1234);
      return Array.from({ length: 10 }, () =>
        actionKey(pickDiverseAction(candidates(), "p", idx, OPTS, rng)!),
      );
    };
    expect(run()).toEqual(run());
  });

  it("候補が空なら null", () => {
    expect(pickDiverseAction([], "p", createSeenIndex(), OPTS, mulberry32(1))).toBeNull();
  });

  it("最小層からの抽選が偏らない (一様性のおおまかな確認)", () => {
    const idx = createSeenIndex();
    const rng = mulberry32(2026);
    const hits = new Map<string, number>();
    // 3 手すべて未出 = 最小層 3 件。240 回引いて各手が 1/3 の近傍に収まること。
    for (let i = 0; i < 240; i++) {
      const k = actionKey(pickDiverseAction(candidates(), "p", idx, OPTS, rng)!);
      hits.set(k, (hits.get(k) ?? 0) + 1);
    }
    expect(hits.size).toBe(3);
    for (const n of hits.values()) {
      expect(n).toBeGreaterThan(50); // 期待 80、極端な偏り (特定手に張り付く) を検出
      expect(n).toBeLessThan(120);
    }
  });

  it("marginCp / topN の異常値 (NaN・負値) でも落ちない", () => {
    const idx = createSeenIndex();
    for (const opts of [
      { marginCp: Number.NaN, topN: 8 },
      { marginCp: -100, topN: 8 },
      { marginCp: 100, topN: 0 },
      { marginCp: 100, topN: Number.NaN },
    ]) {
      const picked = pickDiverseAction(candidates(), "p", idx, opts, mulberry32(3));
      expect(picked).not.toBeNull();
    }
  });

  it("局面が違えば出現回数は独立 (posKey ごとのカウント)", () => {
    const idx = createSeenIndex();
    recordSeen(idx, "p", actionKey(move(6)), 9);
    // 別局面 "q" では move(6) は未出なので、最善がそのまま選ばれる
    const picked = pickDiverseAction(candidates(), "q", idx, { marginCp: 0, topN: 8 }, mulberry32(7));
    expect(actionKey(picked!)).toBe(actionKey(move(6)));
  });
});

// ★段3 の同一性の定義は clean (scripts/clean-training-245.ts) の重複判定と揃っている必要がある。
// 片方だけ変わると「索引の局面同一性」と「教材の重複判定」が食い違い、段7 で多様化が
// 空振りしても誰も気づかない。encoder 入力の非ゼロ集合が一致することで縛る。
describe("seenKeysFromSample と feature-export の同一性の定義が一致する", () => {
  const state = createInitialGameState(CARD_SHOGI_VARIANT);
  const cs = cardState({
    hand: { sente: [{ instanceId: "1", defId: "pawn_return" }], gote: [] },
    mana: { sente: 7, gote: 4 },
  });
  const sample: TrainingSampleData = {
    plyIndex: 0,
    moveCount: 0,
    sideToMove: "sente",
    boardState: { board: state.board, hand: state.hand, currentPlayer: state.currentPlayer },
    cardState: serializeCardState(cs),
    action: move(6),
    events: [],
  };

  it("同じサンプルから同じ posKey が出る (encoder 入力が同一)", () => {
    expect(seenKeysFromSample(sample).posKey).toBe(positionKey(state, cs));
    expect(seenKeysFromSample(sample).actKey).toBe(actionKey(move(6)));
  });

  it("clean が見る非ゼロ特徴が変われば posKey も変わる (定義の連動)", () => {
    const before = sampleToSparseRow(sample, 0, 0);
    const changed: TrainingSampleData = {
      ...sample,
      cardState: serializeCardState(cardState({ ...cs, mana: { sente: 1, gote: 4 } })),
    };
    const after = sampleToSparseRow(changed, 0, 0);
    // clean 側の入力ハッシュが変わるケースでは、posKey も必ず変わること。
    expect(`${before.idx}|${before.val}`).not.toBe(`${after.idx}|${after.val}`);
    expect(seenKeysFromSample(sample).posKey).not.toBe(seenKeysFromSample(changed).posKey);
  });

});
