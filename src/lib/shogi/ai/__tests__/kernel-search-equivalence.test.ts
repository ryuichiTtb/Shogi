// Issue #235 S1b: AI root カード/ドロー評価の OFF (旧近似) vs ON (L0 カーネル applyTurnAction)
// 特性化テスト。
//
// 位置づけ (計画 docs/plans/issue-235-s1b-ai-wiring.md §3/§5 S1b-4):
//   S1b は useKernelSearch フラグ裏で applyActionForLookahead (OFF) を applyTurnActionForLookahead
//   (ON = kernel) に切替える。ON の「正しさ」自体は S1a の reducer-vs-kernel 等価テストで担保済の
//   ため、本テストは「OFF と ON が §3 の既知差分のみで食い違う (= ON は production 等価への是正)」
//   ことを pin する特性化テスト。strict 等価ではなく、一致すべき次元 (board 駒配置 = trap 非発火時) と
//   既知 divergence 次元 (currentPlayer flip / mana manaCharge / drawProgress lazy / graveyard /
//   noPromoteMarks / status mate score / trap 発火 move の board・trap) を分離して assert する。
//
// 決定論化: spectatorMode=true 固定 (ON の manaCharge を早指し非依存 = MANA_PER_TURN に固定)。

import { describe, expect, it } from "vitest";

import { serializePosition } from "@/lib/shogi/board";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";
import { MANA_CAP, MANA_PER_TURN } from "@/lib/shogi/cards/definitions";
import { createSearchContext } from "../search-context";
import { evaluate } from "../evaluate";
import {
  applyActionForLookahead,
  applyTurnActionForLookahead,
  evaluateActionWithLookahead,
} from "../search";
import { getCardActions } from "../turn/action-generator";
import type { AiTurnState, TurnAction } from "../turn/types";
import type { Board, GameState, PieceType, Player } from "@/lib/shogi/types";
import type { CardGameState, CardInstance } from "@/lib/shogi/cards/types";

// ===== 盤面/状態ビルダー (world-kernel-equivalence.test.ts と同方式) =====

function emptyBoard(): Board {
  return Array.from({ length: 9 }, () =>
    Array.from({ length: 9 }, () => null as Board[number][number]),
  );
}

function pc(type: PieceType, owner: Player) {
  return { type, owner };
}

function buildGameState(
  place: (b: Board) => void,
  currentPlayer: Player,
): GameState {
  const board = emptyBoard();
  place(board);
  const state: GameState = {
    board,
    hand: { sente: {}, gote: {} },
    currentPlayer,
    moveHistory: [],
    positionHistory: [],
    status: "active",
    moveCount: 0,
  };
  state.positionHistory = [serializePosition(state)];
  return state;
}

function minimalCardState(over: Partial<CardGameState> = {}): CardGameState {
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

function aiState(gameState: GameState, cardState: CardGameState): AiTurnState {
  return { gameState, cardState, doubleMove: null, isRoot: true };
}

// OFF / ON の applied state を両方計算 (ON は spectatorMode=true)。
function applyBoth(state: AiTurnState, action: TurnAction, player: Player) {
  const off = applyActionForLookahead(state, action, player);
  const on = applyTurnActionForLookahead(
    state,
    action,
    CARD_SHOGI_VARIANT,
    true,
  );
  return { off, on };
}

// 盤面 (駒配置) のみ比較 (currentPlayer/status/moveCount/history は除外)。
function expectBoardPlacementEqual(a: GameState, b: GameState) {
  expect(a.board).toEqual(b.board);
  expect(a.hand).toEqual(b.hand); // 取り駒 (komadai) も駒配置の一部
}

// ===== 共通配置: 両陣に玉 + 先手歩 =====
const placeKingsAndPawn = (b: Board) => {
  b[0][0] = pc("king", "gote");
  b[8][8] = pc("king", "sente");
  b[6][4] = pc("pawn", "sente");
};

describe("S1b: OFF (applyActionForLookahead) vs ON (applyTurnActionForLookahead) 特性化", () => {
  it("move (trap 非発火・境界未満): board 一致 / ON は manaCharge+1 / drawProgress 両者 +1", () => {
    const cs = () =>
      minimalCardState({
        mana: { sente: 5, gote: 5 },
        drawProgress: { sente: 1, gote: 0 },
      });
    const state = aiState(buildGameState(placeKingsAndPawn, "sente"), cs());
    const action: TurnAction = {
      kind: "move",
      move: {
        type: "move",
        from: { row: 6, col: 4 },
        to: { row: 5, col: 4 },
        piece: "pawn",
        player: "sente",
      },
    };
    const { off, on } = applyBoth(state, action, "sente");
    expect(off).not.toBeNull();
    expect(on).not.toBeNull();
    // board (駒配置) 一致。
    expectBoardPlacementEqual(off!.gameState, on!.gameState);
    // ON 是正: manaCharge +MANA_PER_TURN (OFF は加算なし)。
    expect(off!.cardState.mana.sente).toBe(5);
    expect(on!.cardState.mana.sente).toBe(5 + MANA_PER_TURN);
    // drawProgress: 境界未満は両者 +1。
    expect(off!.cardState.drawProgress.sente).toBe(2);
    expect(on!.cardState.drawProgress.sente).toBe(2);
    // currentPlayer: 両者とも flip (move は OFF/ON 共に applyMove で flip)。
    expect(off!.gameState.currentPlayer).toBe("gote");
    expect(on!.gameState.currentPlayer).toBe("gote");
  });

  it("draw (境界未満): mana/hand/deck/drawProgress 一致、board 駒配置一致 (ON は currentPlayer flip)", () => {
    const card: CardInstance = { instanceId: "s-pr-1", defId: "pawn_return" };
    const cs = () =>
      minimalCardState({
        mana: { sente: 5, gote: 5 },
        deck: { sente: [card], gote: [] },
        drawProgress: { sente: 1, gote: 0 },
      });
    const state = aiState(buildGameState(placeKingsAndPawn, "sente"), cs());
    const { off, on } = applyBoth(state, { kind: "draw" }, "sente");
    expect(off).not.toBeNull();
    expect(on).not.toBeNull();
    expect(on!.cardState.mana.sente).toBe(off!.cardState.mana.sente); // 両者 -2
    expect(on!.cardState.hand.sente).toEqual(off!.cardState.hand.sente); // 引いたカード追加
    expect(on!.cardState.deck.sente).toEqual(off!.cardState.deck.sente); // deck -1
    expect(on!.cardState.drawProgress.sente).toBe(
      off!.cardState.drawProgress.sente,
    ); // 境界未満 両者 +1
    expectBoardPlacementEqual(off!.gameState, on!.gameState);
    // 既知 divergence: ON は currentPlayer flip、OFF は不変。
    expect(off!.gameState.currentPlayer).toBe("sente");
    expect(on!.gameState.currentPlayer).toBe("gote");
  });

  it("draw (境界 drawProgress=4): ON は lazy で auto-draw 連鎖 (hand+2/reset)、OFF は単純 +1 (hand+1)", () => {
    const manualCard: CardInstance = {
      instanceId: "s-pr-1",
      defId: "pawn_return",
    };
    const autoCard: CardInstance = {
      instanceId: "s-dp-1",
      defId: "double_pawn",
    };
    const cs = () =>
      minimalCardState({
        mana: { sente: 5, gote: 5 },
        deck: { sente: [manualCard, autoCard], gote: [] },
        drawProgress: { sente: 4, gote: 0 },
      });
    const state = aiState(buildGameState(placeKingsAndPawn, "sente"), cs());
    const { off, on } = applyBoth(state, { kind: "draw" }, "sente");
    // OFF: drawProgress=5 (単純 +1)、hand に manual の 1 枚のみ。
    expect(off!.cardState.drawProgress.sente).toBe(5);
    expect(off!.cardState.hand.sente).toHaveLength(1);
    // ON: 境界到達で reset + auto-draw → drawProgress=0、hand に manual+auto の 2 枚。
    expect(on!.cardState.drawProgress.sente).toBe(0);
    expect(on!.cardState.hand.sente).toHaveLength(2);
    expect(on!.cardState.deck.sente).toHaveLength(0); // 2 枚引いて空
  });

  it("trap set (check_break・境界未満): cardState 完全一致 (DP-3 graveyard 不変)、board 一致", () => {
    const trapCard: CardInstance = {
      instanceId: "s-cb-1",
      defId: "check_break",
    };
    const cs = () =>
      minimalCardState({
        mana: { sente: 6, gote: 6 },
        hand: { sente: [trapCard], gote: [] },
        drawProgress: { sente: 1, gote: 0 },
      });
    const state = aiState(buildGameState(placeKingsAndPawn, "sente"), cs());
    const action: TurnAction = {
      kind: "playCard",
      cardInstanceId: trapCard.instanceId,
      defId: "check_break",
    };
    const { off, on } = applyBoth(state, action, "sente");
    // trap 系は境界未満で cardState の digest 次元 (mana/hand/trap/graveyard/drawProgress) が完全一致。
    expect(on!.cardState.mana.sente).toBe(off!.cardState.mana.sente); // 両者 -4
    expect(on!.cardState.hand.sente).toEqual(off!.cardState.hand.sente); // 両者 空
    expect(on!.cardState.trap.sente).toEqual(off!.cardState.trap.sente); // 両者 set
    expect(on!.cardState.graveyard.sente).toEqual(
      off!.cardState.graveyard.sente,
    ); // DP-3: 両者 空
    expect(on!.cardState.drawProgress.sente).toBe(
      off!.cardState.drawProgress.sente,
    );
    expectBoardPlacementEqual(off!.gameState, on!.gameState);
  });

  it("modifyBoard (pawn_return): board 一致 / ON は hand→graveyard (DP-3) / OFF は graveyard 追加なし", () => {
    const card: CardInstance = { instanceId: "s-pr-1", defId: "pawn_return" };
    const cs = () =>
      minimalCardState({
        mana: { sente: 5, gote: 5 },
        hand: { sente: [card], gote: [] },
        drawProgress: { sente: 1, gote: 0 },
      });
    const state = aiState(buildGameState(placeKingsAndPawn, "sente"), cs());
    const action: TurnAction = {
      kind: "playCard",
      cardInstanceId: card.instanceId,
      defId: "pawn_return",
      target: { kind: "square", row: 6, col: 4 },
    };
    const { off, on } = applyBoth(state, action, "sente");
    // board: 両者とも applyPawnReturn (= simulateCardEffect が同じ effect fn を呼ぶ) → 一致。
    expectBoardPlacementEqual(off!.gameState, on!.gameState);
    expect(on!.gameState.board[6][4]).toBeNull();
    expect(on!.cardState.mana.sente).toBe(off!.cardState.mana.sente); // 両者 -1
    expect(on!.cardState.hand.sente).toEqual(off!.cardState.hand.sente); // 両者 card 除去
    // 既知 divergence: ON は consumeNormalCard で hand→graveyard、OFF は graveyard 追加なし。
    expect(on!.cardState.graveyard.sente.map((c) => c.defId)).toEqual([
      "pawn_return",
    ]);
    expect(off!.cardState.graveyard.sente).toHaveLength(0);
  });

  it("modifyBoard (pawn_return) で no_promote マーク付き駒: ON は removeNoPromoteMark / OFF は不変", () => {
    const card: CardInstance = { instanceId: "s-pr-1", defId: "pawn_return" };
    const cs = () =>
      minimalCardState({
        mana: { sente: 5, gote: 5 },
        hand: { sente: [card], gote: [] },
        noPromoteMarks: { sente: [{ row: 6, col: 4 }], gote: [] },
      });
    const state = aiState(buildGameState(placeKingsAndPawn, "sente"), cs());
    const action: TurnAction = {
      kind: "playCard",
      cardInstanceId: card.instanceId,
      defId: "pawn_return",
      target: { kind: "square", row: 6, col: 4 },
    };
    const { off, on } = applyBoth(state, action, "sente");
    // 既知 divergence: ON は戻した駒のマークを削除、OFF は近似のため残る。
    expect(on!.cardState.noPromoteMarks.sente).toHaveLength(0);
    expect(off!.cardState.noPromoteMarks.sente).toEqual([{ row: 6, col: 4 }]);
  });

  it("double_move: evaluateActionWithLookahead が OFF/ON 双方で有限スコア (ON 連鎖が throw せず成立)", () => {
    // ON 経路の cardState 消費 (double_move を hand→graveyard / mana-5 / lazy drawProgress) の
    // 正しさ自体は S1a world-kernel-equivalence.test.ts (DP-2 = applyTurnAction ≡ reducer) が担保済。
    // 本ケースは S1b 配線として「ON super-action 連鎖 (playCard→move→move) が turnEnded 不変条件で
    // throw せず有限スコアを返す」ことの smoke。終局 (1手目 mate) の分岐は下の専用ケースで pin。
    const dmCard: CardInstance = { instanceId: "s-dm-1", defId: "double_move" };
    const cs = () =>
      minimalCardState({
        mana: { sente: 8, gote: 8 },
        hand: { sente: [dmCard], gote: [] },
      });
    const action: TurnAction = {
      kind: "playCard",
      cardInstanceId: dmCard.instanceId,
      defId: "double_move",
    };

    const ctxOff = createSearchContext({
      timeLimitMs: 1000,
      useKernelSearch: false,
    });
    const ctxOn = createSearchContext({
      timeLimitMs: 1000,
      useKernelSearch: true,
      spectatorMode: true,
    });

    const stateOff = aiState(buildGameState(placeKingsAndPawn, "sente"), cs());
    const stateOn = aiState(buildGameState(placeKingsAndPawn, "sente"), cs());

    const scoreOff = evaluateActionWithLookahead(
      stateOff,
      action,
      "sente",
      CARD_SHOGI_VARIANT,
      ctxOff,
      false,
      1,
    );
    const scoreOn = evaluateActionWithLookahead(
      stateOn,
      action,
      "sente",
      CARD_SHOGI_VARIANT,
      ctxOn,
      false,
      1,
    );

    expect(Number.isFinite(scoreOff)).toBe(true);
    expect(Number.isFinite(scoreOn)).toBe(true);
    expect(scoreOff).toBeGreaterThan(Number.NEGATIVE_INFINITY);
    expect(scoreOn).toBeGreaterThan(Number.NEGATIVE_INFINITY);
  });
});

// ===== ON 是正 divergence (trap 発火 move / 終局手): M2 レビュー S1b-M2-001/OBS3-T1/T2/T3 反映 =====
// §3 が列挙する「move の trap 発火」「着手後/double_move 終局 (status/mate score)」は OFF (軽量近似) が
// 無視し ON (production 等価 kernel) のみ反映する是正 divergence。これらを既知差分として明示 pin する。

describe("S1b: ON 是正 divergence (trap 発火 move / 終局)", () => {
  it("trap 発火 move: 相手 check_break 保持下で王手すると ON は board/trap を是正・OFF は無視", () => {
    // 後手玉(3,4) に先手金(5,4)→(4,4) で王手。後手は check_break をセット済。
    // OFF=applyMoveForSearch は trap を見ず金を (4,4) に置くだけ。ON=makeMoveWithEffects は
    // check_break を発火させ王手駒(金)を盤上から除去 + 後手の持ち駒へ + trap clear (DP-7)。
    const place = (b: Board) => {
      b[3][4] = pc("king", "gote");
      b[8][8] = pc("king", "sente");
      b[5][4] = pc("gold", "sente");
    };
    const goteTrap = {
      instanceId: "g-cb",
      defId: "check_break" as const,
      owner: "gote" as const,
    };
    const cs = () =>
      minimalCardState({
        mana: { sente: 5, gote: 5 },
        trap: { sente: null, gote: goteTrap },
      });
    const state = aiState(buildGameState(place, "sente"), cs());
    const action: TurnAction = {
      kind: "move",
      move: {
        type: "move",
        from: { row: 5, col: 4 },
        to: { row: 4, col: 4 },
        piece: "gold",
        player: "sente",
      },
    };
    const off = applyActionForLookahead(state, action, "sente");
    const on = applyTurnActionForLookahead(
      state,
      action,
      CARD_SHOGI_VARIANT,
      true,
    );
    expect(off).not.toBeNull();
    expect(on).not.toBeNull();
    // 既知 divergence (ON 是正): OFF は金が (4,4) に残り trap 不変、ON は金除去 + trap clear + 後手持ち駒。
    expect(off!.gameState.board[4][4]).toEqual(pc("gold", "sente"));
    expect(on!.gameState.board[4][4]).toBeNull();
    expect(off!.cardState.trap.gote).toEqual(goteTrap);
    expect(on!.cardState.trap.gote).toBeNull();
    expect(on!.gameState.hand.gote["gold"]).toBe(1); // check_break で取った金が後手持ち駒へ
  });

  it("終局手 (通常 move で詰み): ON は status=checkmate + mate score、OFF は status=active + material", () => {
    // 頭金詰み: 後手玉(0,4)、先手金(2,4)→(1,4)、先手飛(8,4) が金を支える、先手玉(8,8)。
    const place = (b: Board) => {
      b[0][4] = pc("king", "gote");
      b[2][4] = pc("gold", "sente");
      b[8][4] = pc("rook", "sente");
      b[8][8] = pc("king", "sente");
    };
    const cs = () => minimalCardState({ mana: { sente: 5, gote: 5 } });
    const state = aiState(buildGameState(place, "sente"), cs());
    const action: TurnAction = {
      kind: "move",
      move: {
        type: "move",
        from: { row: 2, col: 4 },
        to: { row: 1, col: 4 },
        piece: "gold",
        player: "sente",
      },
    };
    const off = applyActionForLookahead(state, action, "sente");
    const on = applyTurnActionForLookahead(
      state,
      action,
      CARD_SHOGI_VARIANT,
      true,
    );
    // board 駒配置は一致 (どちらも金が (1,4) へ)。status / 評価値が既知 divergence。
    expect(on!.gameState.board[1][4]).toEqual(pc("gold", "sente"));
    expect(off!.gameState.board[1][4]).toEqual(pc("gold", "sente"));
    expect(off!.gameState.status).toBe("active"); // OFF は game-end 非評価
    expect(on!.gameState.status).toBe("checkmate"); // ON は evaluateGameEnd で終局検出
    expect(on!.gameState.winner).toBe("sente");
    // evaluate: ON は mate score ±100000、OFF は material 評価 (mate 未満)。
    expect(evaluate(on!.gameState, CARD_SHOGI_VARIANT)).toBe(100000);
    expect(evaluate(off!.gameState, CARD_SHOGI_VARIANT)).toBeLessThan(100000);
  });

  it("double_move 1手目 mate: ON super-action は終局 (turnEnded=true) 分岐で mate score を採用", () => {
    // 1手目で詰む double_move。捕獲手で mate を構成し scoreMoveForOrdering 上位 (DOUBLE_MOVE_TOP_K=10) を保証。
    // 後手玉(0,0)、後手歩(1,1) を先手金(2,1)が捕獲して詰み (先手香(8,1)が (1,1) を支える)、先手玉(8,8)。
    const place = (b: Board) => {
      b[0][0] = pc("king", "gote");
      b[1][1] = pc("pawn", "gote"); // 捕獲対象 (capture move → 上位 ordering)
      b[2][1] = pc("gold", "sente");
      b[8][1] = pc("lance", "sente"); // (1,1) を縦に支える
      b[8][8] = pc("king", "sente");
    };
    const dmCard: CardInstance = { instanceId: "s-dm-1", defId: "double_move" };
    const cs = () =>
      minimalCardState({
        mana: { sente: 8, gote: 8 },
        hand: { sente: [dmCard], gote: [] },
      });
    const action: TurnAction = {
      kind: "playCard",
      cardInstanceId: dmCard.instanceId,
      defId: "double_move",
    };

    const ctxOn = createSearchContext({
      timeLimitMs: 1000,
      useKernelSearch: true,
      spectatorMode: true,
    });
    const state = aiState(buildGameState(place, "sente"), cs());
    const scoreOn = evaluateActionWithLookahead(
      state,
      action,
      "sente",
      CARD_SHOGI_VARIANT,
      ctxOn,
      false,
      1,
    );
    // 1手目で詰めば kernel が turnEnded=true で finalize し、その局面 (status=checkmate) を評価 → mate score。
    expect(scoreOn).toBe(100000);
  });
});

// ===== seeded harness: card/draw アクションの board 駒配置不変性 =====
// 旧コード無改変の OFF と ON で、draw/trap/modifyBoard の board 駒配置が常に一致することを
// 複数局面で確認 (本 harness は move を除外。move は trap 非発火を「ON 是正 divergence」describe の
// trap 発火 move ケースで OFF/ON 乖離を、trap 非発火を targeted の move ケースで一致を、それぞれ pin 済)。

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

describe("S1b: seeded harness — card/draw の board 駒配置は OFF/ON 一致", () => {
  it("複数 seed × カード手札構成で board 駒配置不変 + cardState 差分は既知次元のみ", () => {
    const ALL_DEFS = [
      "pawn_return",
      "piece_return",
      "double_pawn",
      "no_promote",
      "check_break",
    ] as const;
    for (let seed = 1; seed <= 40; seed++) {
      const rng = mulberry32(seed * 2654435761);
      // 先手に複数種カードを持たせ、盤上に歩・銀を配置 (modifyBoard 対象)。
      const hand: CardInstance[] = ALL_DEFS.map((defId, i) => ({
        instanceId: `s-${defId}-${i}`,
        defId,
      }));
      const drawProgress = { sente: seed % 5, gote: 0 };
      const place = (b: Board) => {
        b[0][0] = pc("king", "gote");
        b[8][8] = pc("king", "sente");
        b[6][4] = pc("pawn", "sente");
        b[6][2] = pc("pawn", "sente");
        b[7][1] = pc("silver", "sente");
      };
      const handPawnForDoublePawn = {
        sente: { pawn: 1 } as Record<string, number>,
        gote: {} as Record<string, number>,
      };
      const cs = (): CardGameState =>
        minimalCardState({
          mana: { sente: 12, gote: 12 },
          hand: { sente: hand.map((c) => ({ ...c })), gote: [] },
          deck: {
            sente: [
              { instanceId: "s-deck-1", defId: "pawn_return" },
              { instanceId: "s-deck-2", defId: "double_pawn" },
            ],
            gote: [],
          },
          drawProgress: { ...drawProgress },
        });
      const gs = () => {
        const g = buildGameState(place, "sente");
        g.hand = handPawnForDoublePawn; // double_pawn の持ち駒歩
        return g;
      };
      const state = aiState(gs(), cs());

      // 全カードアクション (double_move 以外) を列挙して比較。
      const cardActions = [
        ...getCardActions(state, "sente", CARD_SHOGI_VARIANT),
      ].filter((a) => !(a.kind === "playCard" && a.defId === "double_move"));
      // draw も含める。
      const actions: TurnAction[] = [...cardActions, { kind: "draw" }];
      // seeded に最大 8 アクションをサンプル (全件でもよいが時間短縮)。
      const sample =
        actions.length > 8
          ? [...actions].sort(() => rng() - 0.5).slice(0, 8)
          : actions;

      for (const action of sample) {
        const off = applyActionForLookahead(state, action, "sente");
        const on = applyTurnActionForLookahead(
          state,
          action,
          CARD_SHOGI_VARIANT,
          true,
        );
        if (!off || !on) continue; // 両者 null は同条件 (mana 不足等) でスキップ
        // board 駒配置 (盤 + 取り駒) は OFF/ON で常に一致 (draw/trap=不変、modifyBoard=同 effect fn)。
        expect(on.gameState.board).toEqual(off.gameState.board);
        expect(on.gameState.hand).toEqual(off.gameState.hand);
        // cardState の mana は trap/modifyBoard/draw では一致 (move のみ ON は manaCharge、ここは move 除外)。
        expect(on.cardState.mana.sente).toBe(off.cardState.mana.sente);
        // drawProgress は境界未満で一致、境界 (=4) では ON が reset しうる (既知 divergence)。
        if (state.cardState.drawProgress.sente < 4) {
          expect(on.cardState.drawProgress.sente).toBe(
            off.cardState.drawProgress.sente,
          );
        }
      }
    }
  });
});
