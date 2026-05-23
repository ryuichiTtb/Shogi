// Issue #193 / PR1d-2: action-generator (getCardActions) の data integrity 検証。
//
// 設計意図:
// - BEGIN_PLAY_CARD 7 項目 (reducer.ts:1124) が AI 側で正しく再現されているか検証
// - 通常 3 カード (pawn_return / piece_return / double_pawn) の候補生成を確認
// - double_move とトラップ系 (no_promote / check_break) は PR1d-3/PR1d-4 で対応のため対象外
//
// 計画 md `docs/plans/issue-193-pr1d.md` PR1d-2 詳細 / 検証計画 / 機能追加検証 参照。

import { describe, it, expect } from "vitest";
import { getCardActions } from "../turn/action-generator";
import { createInitialCardState } from "@/lib/shogi/cards/state";
import { createInitialGameState } from "@/lib/shogi/board";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";
import type { CardId, CardInstance } from "@/lib/shogi/cards/types";
import type { AiTurnState } from "../turn/types";

// テスト用デッキ (BEGIN_PLAY_CARD 7 項目で意味を持つ通常カード 3 種を含む)
const TEST_DECK = [
  { defId: "pawn_return" as const, count: 4 },
  { defId: "piece_return" as const, count: 4 },
  { defId: "double_pawn" as const, count: 4 },
];

// 必要に応じて手札に強制的に挿入するためのヘルパ
function makeCardInstance(defId: CardId, instanceId: string): CardInstance {
  return { instanceId, defId };
}

// 標準的な AiTurnState を作る (sente 手番、card-shogi 初期局面)
function makeAiTurnState(): AiTurnState {
  return {
    gameState: createInitialGameState(CARD_SHOGI_VARIANT),
    cardState: createInitialCardState(TEST_DECK),
    doubleMove: null,
    isRoot: true,
  };
}

describe("getCardActions (BEGIN_PLAY_CARD 7 項目を AI 側で再現)", () => {
  it("(1) 二手指し中 (state.doubleMove !== null) は何も yield しない", () => {
    const state = makeAiTurnState();
    state.doubleMove = { active: "sente", movesLeft: 1 };
    const actions = Array.from(getCardActions(state, "sente", CARD_SHOGI_VARIANT));
    expect(actions).toEqual([]);
  });

  it("(2) 自分の手番でなければ (gameState.currentPlayer !== player) 何も yield しない", () => {
    const state = makeAiTurnState();
    // 初期局面は sente 手番なので、gote 視点では候補なし
    const actions = Array.from(getCardActions(state, "gote", CARD_SHOGI_VARIANT));
    expect(actions).toEqual([]);
  });

  it("(4) マナ不足のカードはスキップ (sente 初期マナ 2 < piece_return cost 3)", () => {
    const state = makeAiTurnState();
    // piece_return (cost 3) のみを手札に置き、それ以外を空にする
    state.cardState.hand.sente = [makeCardInstance("piece_return", "sente-test-1")];
    state.cardState.mana.sente = 2; // < 3 (piece_return cost)
    const actions = Array.from(getCardActions(state, "sente", CARD_SHOGI_VARIANT));
    // piece_return はマナ不足、他に手札なし → 候補なし
    expect(actions).toEqual([]);
  });

  it("(4) マナ十分のカードは候補に含まれる (pawn_return cost 1 ≤ sente 初期マナ 2)", () => {
    const state = makeAiTurnState();
    // pawn_return のみ (cost 1) を手札に置く
    state.cardState.hand.sente = [makeCardInstance("pawn_return", "sente-test-pr1")];
    const actions = Array.from(getCardActions(state, "sente", CARD_SHOGI_VARIANT));
    // pawn_return の有効マス (歩・と金マス) が複数 yield されることを期待
    // 初期局面では sente の歩が 9 マス、合計で複数の PlayCardAction が yield される
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      expect(action.kind).toBe("playCard");
      if (action.kind === "playCard") {
        expect(action.defId).toBe("pawn_return");
        expect(action.cardInstanceId).toBe("sente-test-pr1");
        expect(action.target?.kind).toBe("square");
      }
    }
  });

  it("(6) CARD_USE_CONDITIONS で false 返却時はスキップ (= use condition 不一致)", () => {
    const state = makeAiTurnState();
    // double_pawn (cost 1) を手札に置く。use condition で「持ち駒に歩あり」を要求。
    state.cardState.hand.sente = [makeCardInstance("double_pawn", "sente-test-dp1")];
    // 初期局面の sente 持ち駒は空 (歩なし) → CARD_USE_CONDITIONS で false → スキップ
    const actions = Array.from(getCardActions(state, "sente", CARD_SHOGI_VARIANT));
    expect(actions).toEqual([]);
  });

  it("複数カード混在で各カードの候補が個別に列挙される", () => {
    const state = makeAiTurnState();
    // sente マナを十分にして全カード使用可能にする
    state.cardState.mana.sente = 10;
    // sente の歩を持ち駒に追加 (double_pawn の use condition を満たすため)
    state.gameState.hand.sente.pawn = 1;
    state.cardState.hand.sente = [
      makeCardInstance("pawn_return", "sente-test-pr2"),
      makeCardInstance("double_pawn", "sente-test-dp2"),
    ];
    const actions = Array.from(getCardActions(state, "sente", CARD_SHOGI_VARIANT));
    // pawn_return の候補と double_pawn の候補がそれぞれ含まれる
    const defIds = new Set(actions.map((a) => (a.kind === "playCard" ? a.defId : null)));
    expect(defIds.has("pawn_return")).toBe(true);
    expect(defIds.has("double_pawn")).toBe(true);
  });

  it("(3) 手札にないカードは自然にスキップ (for...of で手札のみ列挙)", () => {
    const state = makeAiTurnState();
    // 手札を空にする
    state.cardState.hand.sente = [];
    const actions = Array.from(getCardActions(state, "sente", CARD_SHOGI_VARIANT));
    expect(actions).toEqual([]);
  });

  it("PlayCardAction の cardInstanceId は手札の instance.instanceId と一致 (重複 instance がない)", () => {
    const state = makeAiTurnState();
    state.cardState.hand.sente = [
      makeCardInstance("pawn_return", "sente-unique-id-1"),
      makeCardInstance("pawn_return", "sente-unique-id-2"),
    ];
    const actions = Array.from(getCardActions(state, "sente", CARD_SHOGI_VARIANT));
    // それぞれの instance で別の PlayCardAction 群が生成される (square ごとに instance 別)
    const ids = new Set(actions.map((a) => (a.kind === "playCard" ? a.cardInstanceId : null)));
    expect(ids.has("sente-unique-id-1")).toBe(true);
    expect(ids.has("sente-unique-id-2")).toBe(true);
  });
});

describe("getCardActions の Generator 性質", () => {
  it("Iterable として複数回 spread 可能 (= ジェネレータが正しく実装されている)", () => {
    const state = makeAiTurnState();
    state.cardState.hand.sente = [makeCardInstance("pawn_return", "sente-test-iter1")];
    const gen1 = getCardActions(state, "sente", CARD_SHOGI_VARIANT);
    const list1 = Array.from(gen1);
    // 同じ state で 2 回目の generator を取得しても同じ件数
    const gen2 = getCardActions(state, "sente", CARD_SHOGI_VARIANT);
    const list2 = Array.from(gen2);
    expect(list1.length).toBe(list2.length);
  });
});

describe("getCardActions トラップ系 (PR1d-4: no_promote / check_break)", () => {
  it("no_promote / check_break は targeting:none で候補生成 (マナ十分・トラップ未セット)", () => {
    const state = makeAiTurnState();
    state.cardState.mana.sente = 10;
    state.cardState.hand.sente = [
      makeCardInstance("no_promote", "np1"),
      makeCardInstance("check_break", "cb1"),
    ];
    const actions = Array.from(getCardActions(state, "sente", CARD_SHOGI_VARIANT));
    const defIds = new Set(actions.map((a) => (a.kind === "playCard" ? a.defId : null)));
    expect(defIds.has("no_promote")).toBe(true);
    expect(defIds.has("check_break")).toBe(true);
  });

  it("マナ不足ではトラップ候補に含まれない (no_promote cost 3 / check_break cost 4)", () => {
    const state = makeAiTurnState();
    state.cardState.mana.sente = 2;
    state.cardState.hand.sente = [
      makeCardInstance("no_promote", "np1"),
      makeCardInstance("check_break", "cb1"),
    ];
    const actions = Array.from(getCardActions(state, "sente", CARD_SHOGI_VARIANT));
    expect(actions).toEqual([]);
  });

  it("同種トラップがセット済なら hasSameKindTrapPlaced で除外 (BEGIN_PLAY_CARD 項目5)", () => {
    const state = makeAiTurnState();
    state.cardState.mana.sente = 10;
    state.cardState.hand.sente = [
      makeCardInstance("no_promote", "np1"),
      makeCardInstance("check_break", "cb1"),
    ];
    // sente 盤面に no_promote トラップをセット済 → no_promote のみ除外、check_break は残る
    state.cardState.trap.sente = {
      instanceId: "existing-np",
      defId: "no_promote",
      owner: "sente",
    };
    const actions = Array.from(getCardActions(state, "sente", CARD_SHOGI_VARIANT));
    const defIds = new Set(actions.map((a) => (a.kind === "playCard" ? a.defId : null)));
    expect(defIds.has("no_promote")).toBe(false);
    expect(defIds.has("check_break")).toBe(true);
  });
});

describe("getCardActions 乱撃 (wild_strike #196)", () => {
  it("targeting:none のため target 無しの単一 PlayCardAction を生成 (マナ十分・相手非玉駒あり)", () => {
    const state = makeAiTurnState();
    state.cardState.mana.sente = 10;
    state.cardState.hand.sente = [makeCardInstance("wild_strike", "ws1")];
    // 初期局面は gote の非玉駒が多数 → 使用条件 OK
    const actions = Array.from(getCardActions(state, "sente", CARD_SHOGI_VARIANT));
    const wsActions = actions.filter((a) => a.kind === "playCard" && a.defId === "wild_strike");
    expect(wsActions).toHaveLength(1);
    const first = wsActions[0];
    expect(first.kind).toBe("playCard");
    if (first.kind === "playCard") expect(first.target).toBeUndefined();
  });

  it("マナ不足 (cost 10 未満) では生成されない", () => {
    const state = makeAiTurnState();
    state.cardState.mana.sente = 9;
    state.cardState.hand.sente = [makeCardInstance("wild_strike", "ws1")];
    const actions = Array.from(getCardActions(state, "sente", CARD_SHOGI_VARIANT));
    expect(actions).toEqual([]);
  });

  it("相手が玉だけなら CARD_USE_CONDITIONS で除外 (盤上の相手非玉駒なし)", () => {
    const state = makeAiTurnState();
    state.cardState.mana.sente = 10;
    state.cardState.hand.sente = [makeCardInstance("wild_strike", "ws1")];
    // 盤面から gote の非玉駒を全て除去 (玉のみ残す)
    const board = state.gameState.board;
    for (let r = 0; r < board.length; r++) {
      for (let c = 0; c < board[r].length; c++) {
        const p = board[r][c];
        if (p && p.owner === "gote" && p.type !== "king") board[r][c] = null;
      }
    }
    const actions = Array.from(getCardActions(state, "sente", CARD_SHOGI_VARIANT));
    expect(actions).toEqual([]);
  });
});
