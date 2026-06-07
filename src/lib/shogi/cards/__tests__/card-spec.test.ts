// Issue #235 S2a: CardSpec registry の特性化テスト (S2 計画 §8 / §9 A6)。
//
// 位置づけ: S2a で新設した registry (card-spec.ts / card-spec-server.ts) は production 未配線 (additive)。
// 本テストが「registry 出力 ≡ 現行 (CARD_DEFS / CARD_USE_CONDITIONS / applyXxx)」を pin する唯一の
// 正当性検証であり、S2b 以降 (registry を実 dispatch へ繋ぐ cutover) の等価ゲートの土台になる。
//
// 検証項目:
//   1. exhaustiveness (全 7 枚が registry に存在、CARD_DEFS と過不足なし — R-3 安全網)
//   2. CARD_META ≡ CARD_DEFS の subset 射影 (除外フィールドを含まない、§9 A6)
//   3. CardSpec の targeting / checkUsage ≡ CARD_DEFS
//   4. eventKind 派生規則 (trap → trapSetEvent / 他 → cardPlayEvent、§9 A6)
//   5. effect.type / multiPly / setTrap.trigger / onTrigger stub の構造
//   6. effect.apply ≡ 現行 applyXxx (複数 board × player × target fixture で構造一致)
//   7. useCondition ≡ CARD_USE_CONDITIONS (複数 snapshot)
//   8. valueModel snapshot (静的 stub、入力非依存)
//   9. registry SSOT helper ≡ ALL_CARD_DEFS ベースの抽出

import { describe, expect, it } from "vitest";

import type { Board, GameState, Piece, Player, Position } from "@/lib/shogi/types";
import type { CardGameState, CardId, CardInstance } from "../types";
import { ALL_CARD_DEFS, CARD_DEFS, CARD_USE_CONDITIONS } from "../definitions";
import { applyDoublePawn, applyPawnReturn, applyPieceReturn } from "../effects";
import {
  CARD_META,
  getActiveCards,
  getPlayableCards,
  getValidCardIds,
} from "../card-spec";
import {
  CARD_SPECS,
  getAllCardSpecs,
  getCardSpec,
  type EffectSpec,
} from "../card-spec-server";
import type { WorldState } from "@/lib/shogi/kernel/world-kernel";

// ===== fixtures (effects.test.ts と同方式) =====

const ROWS = 9;
const COLS = 9;

// 手書きユニオン CardId の全件 (R-3: registry 定義漏れ検出の property test 用。
// CardId を追加して registry/本配列に追記し忘れると、型 (Record<CardId, CardSpec>) と本テストの
// 双方で検出される)。
const ALL_CARD_IDS: CardId[] = [
  "mana_up",
  "pawn_return",
  "double_pawn",
  "piece_return",
  "check_break",
  "double_move",
  "no_promote",
];

// CardMeta が持つべきキー / 持ってはならないキー (§9 A6)。
const META_KEYS: (keyof (typeof CARD_META)[CardId])[] = [
  "id",
  "kind",
  "name",
  "icon",
  "cost",
  "rarity",
  "phase",
  "status",
  "relatedIssues",
];
const META_EXCLUDED_KEYS = [
  "description",
  "detailDescription",
  "useConditionDescription",
  "addedAt",
  "effectId",
  "targeting",
  "checkUsage",
];

function emptyBoard(): Board {
  return Array.from({ length: ROWS }, () => Array<Piece | null>(COLS).fill(null));
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    board: emptyBoard(),
    hand: { sente: {}, gote: {} },
    currentPlayer: "sente",
    moveHistory: [],
    positionHistory: [],
    status: "active",
    moveCount: 0,
    ...overrides,
  };
}

function makeCardState(overrides: Partial<CardGameState> = {}): CardGameState {
  return {
    mana: { sente: 0, gote: 0 },
    manaCap: 20,
    hand: { sente: [], gote: [] },
    deck: { sente: [], gote: [] },
    graveyard: { sente: [], gote: [] },
    trap: { sente: null, gote: null },
    pendingCard: null,
    lastTurnStartedAt: { sente: null, gote: null },
    noPromoteMarks: { sente: [], gote: [] },
    drawProgress: { sente: 0, gote: 0 },
    ...overrides,
  };
}

function makeWorld(gameState: GameState, cardState: CardGameState = makeCardState()): WorldState {
  return { gameState, cardState, doubleMove: null };
}

function place(state: GameState, pos: Position, piece: Piece): void {
  state.board[pos.row][pos.col] = piece;
}

// modifyBoard effect の apply を取り出す (型ナローイング)。
function boardApply(id: CardId): Extract<EffectSpec, { type: "modifyBoard" }>["apply"] {
  const effect = CARD_SPECS[id].effect;
  if (!effect || effect.type !== "modifyBoard") {
    throw new Error(`${id} は modifyBoard effect ではない`);
  }
  return effect.apply;
}

// ===== 1. exhaustiveness =====

describe("CardSpec registry exhaustiveness (R-3)", () => {
  it("全 7 枚が CARD_SPECS / CARD_META に存在する", () => {
    for (const id of ALL_CARD_IDS) {
      expect(CARD_SPECS[id], `CARD_SPECS[${id}] が未定義`).toBeDefined();
      expect(CARD_META[id], `CARD_META[${id}] が未定義`).toBeDefined();
    }
  });

  it("CARD_SPECS のキー集合は CARD_DEFS と完全一致 (過不足なし)", () => {
    expect(new Set(Object.keys(CARD_SPECS))).toEqual(new Set(Object.keys(CARD_DEFS)));
    expect(new Set(Object.keys(CARD_META))).toEqual(new Set(Object.keys(CARD_DEFS)));
  });

  it("ALL_CARD_IDS が CARD_DEFS の全件と一致 (手書きユニオン網羅)", () => {
    expect(new Set(ALL_CARD_IDS)).toEqual(new Set(Object.keys(CARD_DEFS)));
  });

  it("getAllCardSpecs() は 7 件・挿入順が CARD_SPECS と一致", () => {
    const specs = getAllCardSpecs();
    expect(specs).toHaveLength(7);
    expect(specs.map((s) => s.meta.id)).toEqual(Object.keys(CARD_SPECS));
  });

  it("getCardSpec(id) は CARD_SPECS[id] と同一参照", () => {
    for (const id of ALL_CARD_IDS) {
      expect(getCardSpec(id)).toBe(CARD_SPECS[id]);
    }
  });
});

// ===== 2. CARD_META ≡ CARD_DEFS subset 射影 =====

describe("CARD_META ≡ CARD_DEFS subset (§9 A6)", () => {
  it("各カードの meta フィールドが CARD_DEFS と一致", () => {
    for (const id of ALL_CARD_IDS) {
      const def = CARD_DEFS[id];
      const meta = CARD_META[id];
      expect(meta.id).toBe(def.id);
      expect(meta.kind).toBe(def.kind);
      expect(meta.name).toBe(def.name);
      expect(meta.icon).toBe(def.icon);
      expect(meta.cost).toBe(def.cost);
      expect(meta.rarity).toBe(def.rarity);
      expect(meta.phase).toBe(def.phase);
      expect(meta.status).toBe(def.status);
      expect(meta.relatedIssues).toEqual(def.relatedIssues);
    }
  });

  it("meta は許可キーのみを持ち、除外フィールドを含まない", () => {
    for (const id of ALL_CARD_IDS) {
      const keys = Object.keys(CARD_META[id]);
      // 許可キーの部分集合であること (phase/relatedIssues は optional のため undefined 時は欠落しうる)
      for (const k of keys) {
        expect(META_KEYS as string[]).toContain(k);
      }
      // 除外キーは一切持たない
      for (const excluded of META_EXCLUDED_KEYS) {
        expect(keys).not.toContain(excluded);
      }
    }
  });
});

// ===== 3. targeting / checkUsage ≡ CARD_DEFS =====

describe("CardSpec targeting / checkUsage ≡ CARD_DEFS", () => {
  it("targeting が CARD_DEFS と一致", () => {
    for (const id of ALL_CARD_IDS) {
      expect(CARD_SPECS[id].targeting).toBe(CARD_DEFS[id].targeting);
    }
  });

  it("checkUsage が CARD_DEFS と一致", () => {
    for (const id of ALL_CARD_IDS) {
      expect(CARD_SPECS[id].checkUsage).toBe(CARD_DEFS[id].checkUsage);
    }
  });
});

// ===== 4. eventKind 派生規則 =====

describe("eventKind 派生規則 (§9 A6)", () => {
  it("trap → trapSetEvent / 他 → cardPlayEvent (CARD_DEFS.kind から導出)", () => {
    for (const id of ALL_CARD_IDS) {
      const expected = CARD_DEFS[id].kind === "trap" ? "trapSetEvent" : "cardPlayEvent";
      expect(CARD_SPECS[id].eventKind).toBe(expected);
    }
  });

  it("明示 pin: 通常/multiPly カードは cardPlayEvent", () => {
    for (const id of ["mana_up", "pawn_return", "piece_return", "double_pawn", "double_move"] as CardId[]) {
      expect(CARD_SPECS[id].eventKind).toBe("cardPlayEvent");
    }
  });

  it("明示 pin: トラップ設置は trapSetEvent", () => {
    for (const id of ["no_promote", "check_break"] as CardId[]) {
      expect(CARD_SPECS[id].eventKind).toBe("trapSetEvent");
    }
  });
});

// ===== 5. effect 構造 / multiPly / setTrap =====

describe("effect 構造 / multiPly (M1 A1/A2 / R-1)", () => {
  it("modifyBoard カード (pawn_return / piece_return / double_pawn)", () => {
    for (const id of ["pawn_return", "piece_return", "double_pawn"] as CardId[]) {
      expect(CARD_SPECS[id].effect?.type).toBe("modifyBoard");
      expect(CARD_SPECS[id].multiPly).toBeUndefined();
    }
  });

  it("modifyResource カード (mana_up) は mana: 3", () => {
    const effect = CARD_SPECS.mana_up.effect;
    expect(effect?.type).toBe("modifyResource");
    if (effect?.type === "modifyResource") {
      expect(effect.mana).toBe(3);
      expect(effect.draw).toBeUndefined();
    }
  });

  it("setTrap カード: trigger 正・onTrigger は未配線 stub (@deferred S3)", () => {
    const noPromote = CARD_SPECS.no_promote.effect;
    expect(noPromote?.type).toBe("setTrap");
    if (noPromote?.type === "setTrap") {
      expect(noPromote.trigger).toBe("promotion_declared");
      expect(noPromote.onTrigger).toBeUndefined();
    }
    const checkBreak = CARD_SPECS.check_break.effect;
    expect(checkBreak?.type).toBe("setTrap");
    if (checkBreak?.type === "setTrap") {
      expect(checkBreak.trigger).toBe("check_declared");
      expect(checkBreak.onTrigger).toBeUndefined();
    }
  });

  it("double_move は effect なし・multiPly: 2 (effect 共用体外)", () => {
    expect(CARD_SPECS.double_move.effect).toBeUndefined();
    expect(CARD_SPECS.double_move.multiPly).toBe(2);
  });
});

// ===== 6. effect.apply ≡ applyXxx =====

describe("effect.apply ≡ applyXxx (modifyBoard 構造一致)", () => {
  // pawn_return: 自盤上の歩 / と金を持ち駒へ。ピン駒・空マス・敵駒は null。
  it("pawn_return ≡ applyPawnReturn (複数 fixture)", () => {
    const apply = boardApply("pawn_return");

    const cases: { state: GameState; player: Player; sq: Position }[] = [];

    // (a) 自歩を戻す (sente、玉あり・ピンなし)
    {
      const s = makeState();
      place(s, { row: 8, col: 4 }, { type: "king", owner: "sente" });
      place(s, { row: 6, col: 4 }, { type: "pawn", owner: "sente" });
      cases.push({ state: s, player: "sente", sq: { row: 6, col: 4 } });
    }
    // (b) と金を戻す (unpromote)
    {
      const s = makeState();
      place(s, { row: 8, col: 4 }, { type: "king", owner: "sente" });
      place(s, { row: 3, col: 5 }, { type: "promoted_pawn", owner: "sente" });
      cases.push({ state: s, player: "sente", sq: { row: 3, col: 5 } });
    }
    // (c) 空マス → null
    {
      const s = makeState();
      place(s, { row: 8, col: 4 }, { type: "king", owner: "sente" });
      cases.push({ state: s, player: "sente", sq: { row: 5, col: 5 } });
    }
    // (d) 敵の歩 → null
    {
      const s = makeState();
      place(s, { row: 8, col: 4 }, { type: "king", owner: "sente" });
      place(s, { row: 2, col: 4 }, { type: "pawn", owner: "gote" });
      cases.push({ state: s, player: "sente", sq: { row: 2, col: 4 } });
    }
    // (e) ピン駒 (gote 飛車が sente 玉を狙う筋の自歩) → null
    {
      const s = makeState();
      place(s, { row: 8, col: 4 }, { type: "king", owner: "sente" });
      place(s, { row: 5, col: 4 }, { type: "pawn", owner: "sente" });
      place(s, { row: 0, col: 4 }, { type: "rook", owner: "gote" });
      cases.push({ state: s, player: "sente", sq: { row: 5, col: 4 } });
    }
    // (f) gote 対称
    {
      const s = makeState({ currentPlayer: "gote" });
      place(s, { row: 0, col: 4 }, { type: "king", owner: "gote" });
      place(s, { row: 2, col: 3 }, { type: "pawn", owner: "gote" });
      cases.push({ state: s, player: "gote", sq: { row: 2, col: 3 } });
    }

    for (const { state, player, sq } of cases) {
      const viaSpec = apply(state, player, { kind: "square", row: sq.row, col: sq.col });
      const viaDirect = applyPawnReturn(state, player, sq);
      expect(viaSpec).toEqual(viaDirect);
    }
  });

  it("piece_return ≡ applyPieceReturn (複数 fixture)", () => {
    const apply = boardApply("piece_return");
    const cases: { state: GameState; player: Player; sq: Position }[] = [];

    // (a) 金を戻す
    {
      const s = makeState();
      place(s, { row: 8, col: 4 }, { type: "king", owner: "sente" });
      place(s, { row: 6, col: 4 }, { type: "gold", owner: "sente" });
      cases.push({ state: s, player: "sente", sq: { row: 6, col: 4 } });
    }
    // (b) 成銀を戻す (unpromote → silver)
    {
      const s = makeState();
      place(s, { row: 8, col: 4 }, { type: "king", owner: "sente" });
      place(s, { row: 3, col: 2 }, { type: "promoted_silver", owner: "sente" });
      cases.push({ state: s, player: "sente", sq: { row: 3, col: 2 } });
    }
    // (c) 玉 → null
    {
      const s = makeState();
      place(s, { row: 8, col: 4 }, { type: "king", owner: "sente" });
      cases.push({ state: s, player: "sente", sq: { row: 8, col: 4 } });
    }
    // (d) ピン駒 → null
    {
      const s = makeState();
      place(s, { row: 8, col: 4 }, { type: "king", owner: "sente" });
      place(s, { row: 5, col: 4 }, { type: "gold", owner: "sente" });
      place(s, { row: 0, col: 4 }, { type: "rook", owner: "gote" });
      cases.push({ state: s, player: "sente", sq: { row: 5, col: 4 } });
    }
    // (e) 空マス → null
    {
      const s = makeState();
      place(s, { row: 8, col: 4 }, { type: "king", owner: "sente" });
      cases.push({ state: s, player: "sente", sq: { row: 4, col: 4 } });
    }

    for (const { state, player, sq } of cases) {
      const viaSpec = apply(state, player, { kind: "square", row: sq.row, col: sq.col });
      const viaDirect = applyPieceReturn(state, player, sq);
      expect(viaSpec).toEqual(viaDirect);
    }
  });

  it("double_pawn ≡ applyDoublePawn (複数 fixture)", () => {
    const apply = boardApply("double_pawn");
    const cases: { state: GameState; player: Player; sq: Position }[] = [];

    // (a) 同列に自歩あり・空マス・持ち駒歩あり → 配置可
    {
      const s = makeState({ hand: { sente: { pawn: 1 }, gote: {} } });
      place(s, { row: 8, col: 4 }, { type: "king", owner: "sente" });
      place(s, { row: 0, col: 0 }, { type: "king", owner: "gote" });
      place(s, { row: 5, col: 3 }, { type: "pawn", owner: "sente" });
      cases.push({ state: s, player: "sente", sq: { row: 6, col: 3 } });
    }
    // (b) 配置先が埋まっている → null
    {
      const s = makeState({ hand: { sente: { pawn: 1 }, gote: {} } });
      place(s, { row: 8, col: 4 }, { type: "king", owner: "sente" });
      place(s, { row: 0, col: 0 }, { type: "king", owner: "gote" });
      place(s, { row: 5, col: 3 }, { type: "pawn", owner: "sente" });
      place(s, { row: 6, col: 3 }, { type: "silver", owner: "sente" });
      cases.push({ state: s, player: "sente", sq: { row: 6, col: 3 } });
    }
    // (c) 同列に自歩なし → null
    {
      const s = makeState({ hand: { sente: { pawn: 1 }, gote: {} } });
      place(s, { row: 8, col: 4 }, { type: "king", owner: "sente" });
      place(s, { row: 0, col: 0 }, { type: "king", owner: "gote" });
      cases.push({ state: s, player: "sente", sq: { row: 6, col: 7 } });
    }
    // (d) 持ち駒に歩なし → null
    {
      const s = makeState({ hand: { sente: {}, gote: {} } });
      place(s, { row: 8, col: 4 }, { type: "king", owner: "sente" });
      place(s, { row: 0, col: 0 }, { type: "king", owner: "gote" });
      place(s, { row: 5, col: 3 }, { type: "pawn", owner: "sente" });
      cases.push({ state: s, player: "sente", sq: { row: 6, col: 3 } });
    }

    for (const { state, player, sq } of cases) {
      const viaSpec = apply(state, player, { kind: "square", row: sq.row, col: sq.col });
      const viaDirect = applyDoublePawn(state, player, sq);
      expect(viaSpec).toEqual(viaDirect);
    }
  });

  it("modifyBoard.apply は非 square target で null", () => {
    for (const id of ["pawn_return", "piece_return", "double_pawn"] as CardId[]) {
      const apply = boardApply(id);
      const s = makeState();
      place(s, { row: 8, col: 4 }, { type: "king", owner: "sente" });
      expect(apply(s, "sente", { kind: "handPiece", pieceType: "pawn" })).toBeNull();
    }
  });
});

// ===== 7. useCondition ≡ CARD_USE_CONDITIONS =====

describe("useCondition ≡ CARD_USE_CONDITIONS (§8)", () => {
  it("条件未登録カードは useCondition undefined", () => {
    for (const id of ["mana_up", "check_break", "double_move", "no_promote"] as CardId[]) {
      expect(CARD_SPECS[id].useCondition).toBeUndefined();
      expect(CARD_USE_CONDITIONS[id]).toBeUndefined();
    }
  });

  it("pawn_return: 盤上に自歩/と金がある時のみ true (現行と一致)", () => {
    const condFn = CARD_SPECS.pawn_return.useCondition!;
    const raw = CARD_USE_CONDITIONS.pawn_return!;

    const withPawn = makeState();
    place(withPawn, { row: 6, col: 4 }, { type: "pawn", owner: "sente" });
    const withTokin = makeState();
    place(withTokin, { row: 3, col: 4 }, { type: "promoted_pawn", owner: "sente" });
    const without = makeState();
    place(without, { row: 6, col: 4 }, { type: "silver", owner: "sente" });

    for (const gs of [withPawn, withTokin, without]) {
      const world = makeWorld(gs);
      expect(condFn(world, "sente")).toBe(raw(gs, "sente", world.cardState));
    }
  });

  it("piece_return: 盤上に玉以外の駒がある時のみ true (現行と一致)", () => {
    const condFn = CARD_SPECS.piece_return.useCondition!;
    const raw = CARD_USE_CONDITIONS.piece_return!;

    const withPiece = makeState();
    place(withPiece, { row: 8, col: 4 }, { type: "king", owner: "sente" });
    place(withPiece, { row: 6, col: 4 }, { type: "gold", owner: "sente" });
    const onlyKing = makeState();
    place(onlyKing, { row: 8, col: 4 }, { type: "king", owner: "sente" });

    for (const gs of [withPiece, onlyKing]) {
      const world = makeWorld(gs);
      expect(condFn(world, "sente")).toBe(raw(gs, "sente", world.cardState));
    }
  });

  it("double_pawn: 持ち駒に歩あり & 盤上に自未成り歩がある時のみ true (現行と一致)", () => {
    const condFn = CARD_SPECS.double_pawn.useCondition!;
    const raw = CARD_USE_CONDITIONS.double_pawn!;

    const ok = makeState({ hand: { sente: { pawn: 1 }, gote: {} } });
    place(ok, { row: 5, col: 3 }, { type: "pawn", owner: "sente" });
    const noHand = makeState({ hand: { sente: {}, gote: {} } });
    place(noHand, { row: 5, col: 3 }, { type: "pawn", owner: "sente" });
    const noBoardPawn = makeState({ hand: { sente: { pawn: 1 }, gote: {} } });
    place(noBoardPawn, { row: 3, col: 3 }, { type: "promoted_pawn", owner: "sente" });

    for (const gs of [ok, noHand, noBoardPawn]) {
      const world = makeWorld(gs);
      expect(condFn(world, "sente")).toBe(raw(gs, "sente", world.cardState));
    }
  });
});

// ===== 8. valueModel snapshot =====

describe("valueModel snapshot (S2 stub、入力非依存)", () => {
  const EXPECTED: Record<CardId, number> = {
    no_promote: 50,
    check_break: 80,
    mana_up: 30,
    pawn_return: 0,
    piece_return: 0,
    double_pawn: 0,
    double_move: 0,
  };

  it("各カードの valueModel が期待静的値を返す", () => {
    const gs = makeState();
    for (const id of ALL_CARD_IDS) {
      expect(CARD_SPECS[id].valueModel(gs, "sente")).toBe(EXPECTED[id]);
    }
  });

  it("valueModel は gameState / player に依存しない (S2 stub)", () => {
    const gsA = makeState();
    const gsB = makeState({ currentPlayer: "gote", moveCount: 50 });
    place(gsB, { row: 4, col: 4 }, { type: "rook", owner: "gote" });
    for (const id of ALL_CARD_IDS) {
      const vm = CARD_SPECS[id].valueModel;
      expect(vm(gsA, "sente")).toBe(vm(gsB, "gote"));
    }
  });
});

// ===== 9. registry SSOT helper =====

describe("registry SSOT helper ≡ ALL_CARD_DEFS ベース抽出", () => {
  it("getValidCardIds() ≡ ALL_CARD_DEFS の id 集合", () => {
    expect(new Set(getValidCardIds())).toEqual(new Set(ALL_CARD_DEFS.map((d) => d.id)));
  });

  it("getActiveCards() ≡ status === active", () => {
    expect(new Set(getActiveCards().map((m) => m.id))).toEqual(
      new Set(ALL_CARD_DEFS.filter((d) => d.status === "active").map((d) => d.id)),
    );
  });

  it("getPlayableCards() ≡ status !== deprecated", () => {
    expect(new Set(getPlayableCards().map((m) => m.id))).toEqual(
      new Set(ALL_CARD_DEFS.filter((d) => d.status !== "deprecated").map((d) => d.id)),
    );
  });
});
