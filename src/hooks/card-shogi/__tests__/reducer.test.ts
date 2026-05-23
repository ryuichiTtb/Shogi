import { describe, expect, it } from "vitest";

import { createInitialGameState } from "@/lib/shogi/board";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";
import type { GameState } from "@/lib/shogi/types";
import type { CardGameState, CardInstance, GameEvent } from "@/lib/shogi/cards/types";
import { MANA_CAP, DRAW_COST, AUTO_DRAW_INTERVAL } from "@/lib/shogi/cards/definitions";

import { reducer, type CardShogiGameStateInternal } from "../reducer";

// ===== fixtures =====

function makeInitialCardState(overrides: Partial<CardGameState> = {}): CardGameState {
  return {
    mana: { sente: 5, gote: 5 },
    manaCap: MANA_CAP,
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

function makeInitialState(
  gameState: GameState = createInitialGameState(CARD_SHOGI_VARIANT),
  cardState: CardGameState = makeInitialCardState(),
): CardShogiGameStateInternal {
  return {
    gameState,
    selectedSquare: null,
    selectedHandPiece: null,
    legalMoves: [],
    isAiThinking: false,
    promotionPendingMove: null,
    cardState,
    eventLog: [],
    isDrawing: false,
    pendingDrawPlayer: null,
    pendingDrawSource: null,
    isPlayingCard: false,
    pendingPlayCardOpponent: null,
    isCheckBreakAnimating: false,
    doubleMove: null,
    forbiddenMateMoves: [],
    undoSnapshots: [],
    // Issue #193 / PR1a (B-3 対応): 観戦モード関連の新規フィールド。既存テストでは
    // 常に false (= 人間プレイ時の挙動) を想定。観戦モード固有の挙動 (早指し disable /
    // PAUSE_GAME / RESUME_GAME) は別途専用テストで検証する想定。
    spectatorMode: false,
    isPaused: false,
  };
}

const card = (id: string, defId: CardInstance["defId"]): CardInstance => ({
  instanceId: id,
  defId,
});

// ===== tests =====

describe("reducer / 駒指し系", () => {
  it("SELECT_SQUARE: 自分の駒を選択すると selectedSquare と legalMoves が設定される", () => {
    const state = makeInitialState();
    // 先手の歩 (row=6, col=4) を選択
    const next = reducer(state, { type: "SELECT_SQUARE", pos: { row: 6, col: 4 } });
    expect(next.selectedSquare).toEqual({ row: 6, col: 4 });
    expect(next.legalMoves.length).toBeGreaterThan(0);
  });

  it("SELECT_SQUARE: pendingCard 中は無視 (state 不変)", () => {
    const pendingCard = { instance: card("c1", "mana_up"), player: "sente" as const, phase: "confirm" as const };
    const state = makeInitialState(
      undefined,
      makeInitialCardState({ pendingCard }),
    );
    const next = reducer(state, { type: "SELECT_SQUARE", pos: { row: 6, col: 4 } });
    expect(next).toBe(state);
  });

  it("SELECT_SQUARE: ドロー演出中 (isDrawing=true) は無視", () => {
    const state = { ...makeInitialState(), isDrawing: true };
    const next = reducer(state, { type: "SELECT_SQUARE", pos: { row: 6, col: 4 } });
    expect(next).toBe(state);
  });

  it("DESELECT で selectedSquare がクリア", () => {
    const state = {
      ...makeInitialState(),
      selectedSquare: { row: 6, col: 4 },
      legalMoves: [],
    };
    const next = reducer(state, { type: "DESELECT" });
    expect(next.selectedSquare).toBeNull();
  });

  it("RESIGN: status=resign + winner が逆プレイヤーに設定", () => {
    const state = makeInitialState();
    // 初期は currentPlayer=sente
    const next = reducer(state, { type: "RESIGN" });
    expect(next.gameState.status).toBe("resign");
    expect(next.gameState.winner).toBe("gote");
  });
});

describe("reducer / カード系: ドロー", () => {
  it("DRAW_CARD: マナ十分 + 手番なら手札に 1 枚追加", () => {
    const deckCard = card("d1", "mana_up");
    const state = makeInitialState(
      undefined,
      makeInitialCardState({
        mana: { sente: DRAW_COST, gote: 0 },
        deck: { sente: [deckCard], gote: [] },
      }),
    );
    const next = reducer(state, { type: "DRAW_CARD", player: "sente" });
    expect(next.cardState.hand.sente).toEqual([deckCard]);
    expect(next.cardState.deck.sente).toEqual([]);
    expect(next.cardState.mana.sente).toBe(0);
    expect(next.isDrawing).toBe(true);
    expect(next.pendingDrawPlayer).toBe("sente");
  });

  it("DRAW_CARD: マナ不足なら state 不変", () => {
    const state = makeInitialState(
      undefined,
      makeInitialCardState({
        mana: { sente: 1, gote: 0 },
        deck: { sente: [card("d1", "mana_up")], gote: [] },
      }),
    );
    const next = reducer(state, { type: "DRAW_CARD", player: "sente" });
    expect(next).toBe(state);
  });

  it("DRAW_CARD: 手番でなければ state 不変", () => {
    const state = makeInitialState();
    const next = reducer(state, { type: "DRAW_CARD", player: "gote" });
    expect(next).toBe(state);
  });

  it("COMMIT_DRAW: isDrawing をクリアし currentPlayer を反転", () => {
    const state: CardShogiGameStateInternal = {
      ...makeInitialState(),
      isDrawing: true,
      pendingDrawPlayer: "sente",
    };
    const next = reducer(state, { type: "COMMIT_DRAW" });
    expect(next.isDrawing).toBe(false);
    expect(next.pendingDrawPlayer).toBeNull();
    expect(next.gameState.currentPlayer).toBe("gote");
  });
});

describe("reducer / カード系: 使用フロー", () => {
  it("BEGIN_PLAY_CARD: target なしカード (mana_up) は phase=confirm", () => {
    const c = card("c1", "mana_up");
    const state = makeInitialState(
      undefined,
      makeInitialCardState({
        mana: { sente: 10, gote: 0 },
        hand: { sente: [c], gote: [] },
      }),
    );
    const next = reducer(state, {
      type: "BEGIN_PLAY_CARD",
      player: "sente",
      instanceId: c.instanceId,
    });
    expect(next.cardState.pendingCard?.phase).toBe("confirm");
    expect(next.cardState.pendingCard?.instance.instanceId).toBe(c.instanceId);
  });

  it("BEGIN_PLAY_CARD: マナ不足なら state 不変", () => {
    const c = card("c1", "mana_up");
    const state = makeInitialState(
      undefined,
      makeInitialCardState({
        mana: { sente: 0, gote: 0 },
        hand: { sente: [c], gote: [] },
      }),
    );
    const next = reducer(state, {
      type: "BEGIN_PLAY_CARD",
      player: "sente",
      instanceId: c.instanceId,
    });
    expect(next).toBe(state);
  });

  it("BEGIN_PLAY_CARD: 手番でなければ state 不変", () => {
    const c = card("c1", "mana_up");
    const state = makeInitialState(
      undefined,
      makeInitialCardState({
        mana: { sente: 10, gote: 10 },
        hand: { sente: [], gote: [c] },
      }),
    );
    // 手番が sente なのに gote が打とうとする
    const next = reducer(state, {
      type: "BEGIN_PLAY_CARD",
      player: "gote",
      instanceId: c.instanceId,
    });
    expect(next).toBe(state);
  });

  it("CONFIRM_PLAY_CARD (mana_up): マナ +3 + 手札からグレイブへ + isPlayingCard=true", () => {
    const c = card("c1", "mana_up");
    const state = makeInitialState(
      undefined,
      makeInitialCardState({
        mana: { sente: 5, gote: 0 },
        hand: { sente: [c], gote: [] },
        pendingCard: { instance: c, player: "sente", phase: "confirm" },
      }),
    );
    const next = reducer(state, { type: "CONFIRM_PLAY_CARD" });
    // mana_up は cost=2 の前提だがここでは具体値より「マナ消費 + applyManaUp(+3) が起きた」ことを検証
    expect(next.cardState.hand.sente).toEqual([]);
    expect(next.cardState.graveyard.sente.length).toBe(1);
    expect(next.isPlayingCard).toBe(true);
    expect(next.pendingPlayCardOpponent).toBe("gote");
  });

  it("CONFIRM_PLAY_CARD (wild_strike): 相手非玉駒を最大6枚消滅 (持ち駒化なし) + カード消費 + 演出開始", () => {
    const c = card("ws1", "wild_strike");
    const gameState = createInitialGameState(CARD_SHOGI_VARIANT);
    const state = makeInitialState(
      gameState,
      makeInitialCardState({
        mana: { sente: 10, gote: 0 },
        hand: { sente: [c], gote: [] },
        pendingCard: { instance: c, player: "sente", phase: "confirm" },
      }),
    );

    const countGoteNonKing = (gs: GameState) => {
      let n = 0;
      for (const row of gs.board) {
        for (const p of row) {
          if (p && p.owner === "gote" && p.type !== "king") n++;
        }
      }
      return n;
    };
    const before = countGoteNonKing(state.gameState);

    const next = reducer(state, { type: "CONFIRM_PLAY_CARD" });

    // 撃破数 (6) ぶん盤上の gote 非玉駒が減る (初期局面は 19 枚 > 6)
    expect(before).toBeGreaterThan(6);
    expect(before - countGoteNonKing(next.gameState)).toBe(6);

    // 消滅 = 持ち駒化しない: sente の持ち駒は増えない
    const sumHand = (h: Partial<Record<string, number>>) =>
      Object.values(h).reduce<number>((a, b) => a + (b ?? 0), 0);
    expect(sumHand(next.gameState.hand.sente)).toBe(0);

    // カード消費 + マナ -10
    expect(next.cardState.hand.sente).toEqual([]);
    expect(next.cardState.graveyard.sente.length).toBe(1);
    expect(next.cardState.mana.sente).toBe(0);

    // cardPlayEvent に destroyedPieces (6 件) が載り、演出再現に使える
    const ev = next.eventLog[next.eventLog.length - 1];
    expect(ev.kind).toBe("cardPlayEvent");
    if (ev.kind === "cardPlayEvent") {
      expect(ev.destroyedPieces).toHaveLength(6);
    }

    // 演出開始フラグ (COMMIT_PLAY_CARD まで手番交代を保留)
    expect(next.isPlayingCard).toBe(true);
    expect(next.pendingPlayCardOpponent).toBe("gote");
  });

  it("CANCEL_PLAY_CARD: pendingCard をクリア", () => {
    const c = card("c1", "mana_up");
    const state = makeInitialState(
      undefined,
      makeInitialCardState({
        pendingCard: { instance: c, player: "sente", phase: "confirm" },
      }),
    );
    const next = reducer(state, { type: "CANCEL_PLAY_CARD" });
    expect(next.cardState.pendingCard).toBeNull();
  });

  it("COMMIT_PLAY_CARD: isPlayingCard をクリアし currentPlayer 反転", () => {
    const state: CardShogiGameStateInternal = {
      ...makeInitialState(),
      isPlayingCard: true,
      pendingPlayCardOpponent: "gote",
    };
    const next = reducer(state, { type: "COMMIT_PLAY_CARD" });
    expect(next.isPlayingCard).toBe(false);
    expect(next.pendingPlayCardOpponent).toBeNull();
    expect(next.gameState.currentPlayer).toBe("gote");
  });
});

describe("reducer / UNDO", () => {
  it("moveHistory が 2 未満なら state 不変", () => {
    const state = makeInitialState();
    const next = reducer(state, { type: "UNDO" });
    expect(next).toBe(state);
  });

  it("eventLog にカード操作 (cardPlayEvent / drawEvent / trapSetEvent / trapTriggerEvent) が含まれていれば state 不変", () => {
    const c = card("c1", "mana_up");
    const state: CardShogiGameStateInternal = {
      ...makeInitialState(),
      // moveHistory を擬似的に積んでも eventLog にカード操作があれば弾かれる
      gameState: {
        ...makeInitialState().gameState,
        moveHistory: [
          { type: "move", player: "sente", piece: "pawn", from: { row: 6, col: 4 }, to: { row: 5, col: 4 } },
          { type: "move", player: "gote", piece: "pawn", from: { row: 2, col: 4 }, to: { row: 3, col: 4 } },
        ],
      },
      eventLog: [
        { kind: "moveEvent", move: { type: "move", player: "sente", piece: "pawn", from: { row: 6, col: 4 }, to: { row: 5, col: 4 } }, at: 0 },
        { kind: "drawEvent", player: "sente", instance: c, at: 0 },
        { kind: "moveEvent", move: { type: "move", player: "gote", piece: "pawn", from: { row: 2, col: 4 }, to: { row: 3, col: 4 } }, at: 0 },
      ],
    };
    const next = reducer(state, { type: "UNDO" });
    expect(next).toBe(state);
  });

  // ===== Issue #130: 自動ドローと UNDO の干渉 =====

  it("scope 内に auto drawEvent のみ含まれる場合は UNDO 可能 + 手札/山札/drawProgress を復元", () => {
    const senteMove = {
      type: "move" as const,
      player: "sente" as const,
      piece: "pawn",
      from: { row: 6, col: 4 },
      to: { row: 5, col: 4 },
    };
    const goteMove = {
      type: "move" as const,
      player: "gote" as const,
      piece: "pawn",
      from: { row: 2, col: 4 },
      to: { row: 3, col: 4 },
    };
    const autoDrawnCard = card("auto-1", "mana_up");
    // 設定 (Issue #132 snapshot 方式): MAKE_MOVE 直前の state を 2 件分 snapshot に保持し、
    // UNDO 時は snapshot[0] (= sente 指す前) を復元する。
    // - snapshot[0] (= 全くの初期): hand=[], deck=[autoDrawnCard], drawProgress={0,0}, eventLog=[]
    // - snapshot[1] (= sente 指した直後 + auto-draw 完了): hand=[autoDrawnCard], deck=[],
    //   drawProgress={sente:0, gote:0} (auto-draw でリセット), eventLog=移動+auto-draw 関連
    // 旧実装 (replay + log 集計) は本テストで `drawProgress 再計算結果が 0` を期待していたが、
    // snapshot 方式は snapshot[0] に保持された値を直接復元するので、用意した snap0 値そのものを返す。
    const snap0Card = makeInitialCardState({
      hand: { sente: [], gote: [] },
      deck: { sente: [autoDrawnCard], gote: [] },
      drawProgress: { sente: 0, gote: 0 },
    });
    const snap0Game = makeInitialState().gameState;
    const snap1Card = makeInitialCardState({
      hand: { sente: [autoDrawnCard], gote: [] },
      deck: { sente: [], gote: [] },
      drawProgress: { sente: 0, gote: 0 },
    });
    const snap1Game = { ...makeInitialState().gameState, moveHistory: [senteMove] };
    const state: CardShogiGameStateInternal = {
      ...makeInitialState(
        undefined,
        makeInitialCardState({
          hand: { sente: [autoDrawnCard], gote: [] },
          deck: { sente: [], gote: [] },
          // 自動ドロー後の状態: drawProgress[sente]=0 (リセット済), gote=1 (1 手指し済)
          drawProgress: { sente: 0, gote: 1 },
        }),
      ),
      gameState: {
        ...makeInitialState().gameState,
        moveHistory: [senteMove, goteMove],
      },
      eventLog: [
        { kind: "moveEvent", move: senteMove, at: 0 },
        // auto-draw が move 直後に発火 (scope 内)
        { kind: "drawEvent", player: "sente", instance: autoDrawnCard, source: "auto", at: 0 },
        { kind: "manaChargeEvent", player: "sente", amount: 1, reason: "turn", at: 0 },
        { kind: "moveEvent", move: goteMove, at: 0 },
        { kind: "manaChargeEvent", player: "gote", amount: 1, reason: "turn", at: 0 },
      ],
      undoSnapshots: [
        { gameState: snap0Game, cardState: snap0Card, eventLog: [] },
        {
          gameState: snap1Game,
          cardState: snap1Card,
          eventLog: [
            { kind: "moveEvent", move: senteMove, at: 0 },
            { kind: "drawEvent", player: "sente", instance: autoDrawnCard, source: "auto", at: 0 },
            { kind: "manaChargeEvent", player: "sente", amount: 1, reason: "turn", at: 0 },
          ],
        },
      ],
    };
    const next = reducer(state, { type: "UNDO" });
    // UNDO 成立 (state が変化している)
    expect(next).not.toBe(state);
    // hand[sente] から auto-draw された 1 枚が除去 (snap0 の値)
    expect(next.cardState.hand.sente).toEqual([]);
    // deck[sente] 先頭に instance が戻る (snap0 の値)
    expect(next.cardState.deck.sente).toEqual([autoDrawnCard]);
    // drawProgress は snap0 の値を復元
    expect(next.cardState.drawProgress.sente).toBe(0);
    expect(next.cardState.drawProgress.gote).toBe(0);
    // eventLog は snap0 の eventLog (空)
    expect(next.eventLog.length).toBe(0);
    // ドロー演出フラグもクリア
    expect(next.isDrawing).toBe(false);
    expect(next.pendingDrawSource).toBeNull();
    // undoSnapshots ring は復元時に 2 件 pop されて空になる
    expect(next.undoSnapshots).toEqual([]);
  });

  it("scope 内に明示的 manual drawEvent が含まれる場合は引き続きブロック (回帰防止)", () => {
    const c = card("m-1", "mana_up");
    const senteMove = {
      type: "move" as const,
      player: "sente" as const,
      piece: "pawn",
      from: { row: 6, col: 4 },
      to: { row: 5, col: 4 },
    };
    const goteMove = {
      type: "move" as const,
      player: "gote" as const,
      piece: "pawn",
      from: { row: 2, col: 4 },
      to: { row: 3, col: 4 },
    };
    const state: CardShogiGameStateInternal = {
      ...makeInitialState(),
      gameState: {
        ...makeInitialState().gameState,
        moveHistory: [senteMove, goteMove],
      },
      eventLog: [
        { kind: "moveEvent", move: senteMove, at: 0 },
        // 明示的 source: "manual" の drawEvent → UNDO ブロック
        { kind: "drawEvent", player: "sente", instance: c, source: "manual", at: 0 },
        { kind: "moveEvent", move: goteMove, at: 0 },
      ],
    };
    const next = reducer(state, { type: "UNDO" });
    expect(next).toBe(state);
  });

  // ===== Issue #132: スコープ外カード操作と待ったの整合性 (snapshot 方式の中核検証) =====

  it("Issue #132: cardPlayEvent が 2 ターン scope 外でも、UNDO で snapshot から復元され カード効果は保持される", () => {
    // 再現シナリオ: 自分が 駒戻し → 相手 1手 → 自分 1手 → 相手 1手 → 自分が UNDO。
    // - getUndoScope は 2 ターン scope 走査の途中で playerChanges=2 で break するため、
    //   先頭の cardPlayEvent には到達せず scope=allow を返す (= 既存の guard が素通り)。
    // - 旧 replay 方式は、cardPlayEvent で発生したカード効果 (盤上駒除去 + 手札+1) を
    //   moveHistory から再現できず、待ったすると盤上に駒が復活していた (Issue #132 本丸)。
    // - snapshot 方式は state 全量を保持するため、scope-bounds の漏れに依存せず正しく復元する。
    const cardInstance = card("piece-return-1", "piece_return");
    const senteMove = {
      type: "move" as const,
      player: "sente" as const,
      piece: "pawn",
      from: { row: 6, col: 4 },
      to: { row: 5, col: 4 },
    };
    const goteMove1 = {
      type: "move" as const,
      player: "gote" as const,
      piece: "pawn",
      from: { row: 2, col: 4 },
      to: { row: 3, col: 4 },
    };
    const goteMove2 = {
      type: "move" as const,
      player: "gote" as const,
      piece: "pawn",
      from: { row: 2, col: 5 },
      to: { row: 3, col: 5 },
    };

    // 設定: 自分は既に「駒戻し」を使用済 (= cardPlayEvent が log 先頭に)、銀1枚を持ち駒に戻した状態。
    // post-card 時点で hand[sente]={silver:1}、graveyard[sente]=[piece-return-1]、銀は盤上から消えている。
    const initialGame = makeInitialState().gameState;
    // post-card state スナップショット (= goteMove1 を指す直前)
    const postCardCard = makeInitialCardState({
      hand: { sente: [], gote: [] },
      graveyard: { sente: [cardInstance], gote: [] },
      // 仮想的に「銀1枚を持ち駒に戻した」想定で hand を直接設定
    });
    // 簡略化のため hand[sente].silver は postCardCard 直接編集はせず、
    // gameState.hand を経由 (将棋ルール上は gameState.hand に持駒格納)
    const postCardGame: GameState = {
      ...initialGame,
      hand: { ...initialGame.hand, sente: { ...initialGame.hand.sente, silver: 1 } },
    };
    // post-goteMove1 state スナップショット (= senteMove を指す直前)
    const postGote1Game: GameState = {
      ...postCardGame,
      moveHistory: [goteMove1],
      moveCount: 1,
    };
    // post-senteMove state スナップショット (= goteMove2 を指す直前)
    const postSenteGame: GameState = {
      ...postCardGame,
      moveHistory: [goteMove1, senteMove],
      moveCount: 2,
    };

    // 現在 state: 4 イベント (card + 3 move) 全て発生後
    const currentGame: GameState = {
      ...postCardGame,
      moveHistory: [goteMove1, senteMove, goteMove2],
      moveCount: 3,
    };
    const currentEventLog: GameEvent[] = [
      { kind: "cardPlayEvent", player: "sente", instance: cardInstance, at: 0 },
      { kind: "moveEvent", move: goteMove1, at: 1 },
      { kind: "moveEvent", move: senteMove, at: 2 },
      { kind: "moveEvent", move: goteMove2, at: 3 },
    ];

    const state: CardShogiGameStateInternal = {
      ...makeInitialState(currentGame, postCardCard),
      eventLog: currentEventLog,
      // ring: snap0=post-goteMove1 (= senteMove 直前), snap1=post-senteMove (= goteMove2 直前)
      undoSnapshots: [
        {
          gameState: postGote1Game,
          cardState: postCardCard,
          eventLog: [
            { kind: "cardPlayEvent", player: "sente", instance: cardInstance, at: 0 },
            { kind: "moveEvent", move: goteMove1, at: 1 },
          ],
        },
        {
          gameState: postSenteGame,
          cardState: postCardCard,
          eventLog: [
            { kind: "cardPlayEvent", player: "sente", instance: cardInstance, at: 0 },
            { kind: "moveEvent", move: goteMove1, at: 1 },
            { kind: "moveEvent", move: senteMove, at: 2 },
          ],
        },
      ],
    };

    const next = reducer(state, { type: "UNDO" });

    // 主目的: UNDO は実行された (state 変化、cardOp scope-bounds 漏れの guard 素通りを確認)
    expect(next).not.toBe(state);
    // moveHistory は snap0 の値 (= 1 件) に巻き戻る
    expect(next.gameState.moveHistory).toHaveLength(1);
    expect(next.gameState.moveHistory[0]).toEqual(goteMove1);
    // ★ 本丸: カード効果 (= 銀1枚が持ち駒に) が保持される。snapshot は post-card state を保持しているため。
    expect(next.gameState.hand.sente.silver).toBe(1);
    // graveyard も保持 (カード使用記録)
    expect(next.cardState.graveyard.sente).toEqual([cardInstance]);
    // eventLog は snap0 の eventLog (cardPlayEvent + goteMove1 = 2 件)。
    // cardPlayEvent は保持される (= カード使用は取り消されていない)。
    expect(next.eventLog).toHaveLength(2);
    expect(next.eventLog[0].kind).toBe("cardPlayEvent");
    // ring は復元時に 2 件 pop されて空
    expect(next.undoSnapshots).toEqual([]);
  });

  it("Issue #132: undoSnapshots が空 (リロード直後) の状態では UNDO 不可", () => {
    // リロード後は in-memory snapshot が消失する。eventLog も空に初期化されるため
    // 二重に保守的に block される (snap=0 件 + getUndoScope null) 想定。
    // 本テストは snap 件数ガードを直接検証する: gameState/eventLog があっても snap が
    // 不足していれば state 不変。
    const senteMove = {
      type: "move" as const,
      player: "sente" as const,
      piece: "pawn",
      from: { row: 6, col: 4 },
      to: { row: 5, col: 4 },
    };
    const goteMove = {
      type: "move" as const,
      player: "gote" as const,
      piece: "pawn",
      from: { row: 2, col: 4 },
      to: { row: 3, col: 4 },
    };
    const state: CardShogiGameStateInternal = {
      ...makeInitialState(),
      gameState: {
        ...makeInitialState().gameState,
        moveHistory: [senteMove, goteMove],
      },
      eventLog: [
        { kind: "moveEvent", move: senteMove, at: 0 },
        { kind: "moveEvent", move: goteMove, at: 1 },
      ],
      // snap が空 (リロード直後)
      undoSnapshots: [],
    };
    const next = reducer(state, { type: "UNDO" });
    expect(next).toBe(state);
  });

  it("Issue #132: undoSnapshots が 1 件のみ (1 ply しか経っていない) の状態でも UNDO 不可", () => {
    // 直近 2 ply 巻き戻しが仕様。snap が 1 件 (= 1 ply のみ) では待った非活性。
    const senteMove = {
      type: "move" as const,
      player: "sente" as const,
      piece: "pawn",
      from: { row: 6, col: 4 },
      to: { row: 5, col: 4 },
    };
    const state: CardShogiGameStateInternal = {
      ...makeInitialState(),
      gameState: {
        ...makeInitialState().gameState,
        moveHistory: [senteMove],
      },
      eventLog: [{ kind: "moveEvent", move: senteMove, at: 0 }],
      undoSnapshots: [
        {
          gameState: makeInitialState().gameState,
          cardState: makeInitialCardState(),
          eventLog: [],
        },
      ],
    };
    const next = reducer(state, { type: "UNDO" });
    expect(next).toBe(state);
  });

  it("Issue #132: doubleMove 中の UNDO は引き続きブロック (cardOp guard より先に dm guard)", () => {
    // 二手指し中は通常の「待った」を不可とする既存仕様 (Issue #82)。
    // snapshot 方式でも引き続き dm guard が先に効くことを回帰確認。
    const senteMove = {
      type: "move" as const,
      player: "sente" as const,
      piece: "pawn",
      from: { row: 6, col: 4 },
      to: { row: 5, col: 4 },
    };
    const goteMove = {
      type: "move" as const,
      player: "gote" as const,
      piece: "pawn",
      from: { row: 2, col: 4 },
      to: { row: 3, col: 4 },
    };
    const cardInstance = card("dm-1", "double_move");
    const state: CardShogiGameStateInternal = {
      ...makeInitialState(),
      gameState: {
        ...makeInitialState().gameState,
        moveHistory: [senteMove, goteMove],
      },
      eventLog: [
        { kind: "moveEvent", move: senteMove, at: 0 },
        { kind: "moveEvent", move: goteMove, at: 1 },
      ],
      undoSnapshots: [
        { gameState: makeInitialState().gameState, cardState: makeInitialCardState(), eventLog: [] },
        {
          gameState: { ...makeInitialState().gameState, moveHistory: [senteMove] },
          cardState: makeInitialCardState(),
          eventLog: [{ kind: "moveEvent", move: senteMove, at: 0 }],
        },
      ],
      doubleMove: {
        active: "sente",
        movesLeft: 1,
        mateInOneAvailable: false,
        cardInstance,
        cardCost: 6,
        preFirstMoveState: {
          gameState: makeInitialState().gameState,
          cardState: makeInitialCardState(),
          eventLog: [],
        },
        preCardState: {
          gameState: makeInitialState().gameState,
          cardState: makeInitialCardState(),
          eventLog: [],
        },
      },
    };
    const next = reducer(state, { type: "UNDO" });
    expect(next).toBe(state);
  });

  // ===== Issue #149: 連続 UNDO の構造的ブロック (UI/reducer 判定統合) =====

  it("Issue #149: 1 回 UNDO 直後の連続 UNDO は no-op (snapshot ring 枯渇による)", () => {
    // 旧バグ: 1 回 UNDO 後、eventLog は 2 ply 前の状態に復元されるため getUndoScope は依然
    // 非 null を返す。一方 undoSnapshots は slice(0,-2) で空になる。UI 側 canUndo memo は
    // undoSnapshots の状態を見ていなかったため「ボタン活性表示のまま、押しても reducer が
    // no-op で何も起きない」状態が発生していた。
    //
    // 本テストは「1 回目の UNDO は成功し、2 回目は state 不変 (no-op)」を検証する。
    // ヘルパ集約 (canUndoFromState) で UI/reducer の判定を統一したことで、フックから返る
    // canUndo も 2 回目で false になり、UI/reducer 双方で挙動が一致する (= ボタン非活性 +
    // reducer no-op が同期する) ことが構造的に保証される。
    const senteMove = {
      type: "move" as const,
      player: "sente" as const,
      piece: "pawn",
      from: { row: 6, col: 4 },
      to: { row: 5, col: 4 },
    };
    const goteMove = {
      type: "move" as const,
      player: "gote" as const,
      piece: "pawn",
      from: { row: 2, col: 4 },
      to: { row: 3, col: 4 },
    };
    const snap0Game = makeInitialState().gameState;
    const snap1Game = { ...makeInitialState().gameState, moveHistory: [senteMove] };
    const state: CardShogiGameStateInternal = {
      ...makeInitialState(),
      gameState: {
        ...makeInitialState().gameState,
        moveHistory: [senteMove, goteMove],
      },
      eventLog: [
        { kind: "moveEvent", move: senteMove, at: 0 },
        { kind: "moveEvent", move: goteMove, at: 1 },
      ],
      undoSnapshots: [
        { gameState: snap0Game, cardState: makeInitialCardState(), eventLog: [] },
        {
          gameState: snap1Game,
          cardState: makeInitialCardState(),
          eventLog: [{ kind: "moveEvent", move: senteMove, at: 0 }],
        },
      ],
    };

    // 1 回目: 成立して snapshot[0] (= 初期局面) に復元、ring は空になる
    const after1st = reducer(state, { type: "UNDO" });
    expect(after1st).not.toBe(state);
    expect(after1st.undoSnapshots).toEqual([]);
    expect(after1st.gameState.moveHistory).toEqual([]);

    // 2 回目: ring が空なので canUndoFromState で false、reducer は state 不変
    // (= 旧バグ「ボタン活性のまま無反応」を構造的に再発させない回帰防止)
    const after2nd = reducer(after1st, { type: "UNDO" });
    expect(after2nd).toBe(after1st);
  });
});

describe("reducer / RESET_TURN_TIMER", () => {
  it("指定プレイヤーの lastTurnStartedAt を現在時刻にセット", () => {
    const state = makeInitialState();
    expect(state.cardState.lastTurnStartedAt.sente).toBeNull();
    const next = reducer(state, { type: "RESET_TURN_TIMER", player: "sente" });
    expect(next.cardState.lastTurnStartedAt.sente).not.toBeNull();
    expect(next.cardState.lastTurnStartedAt.gote).toBeNull();
  });
});

describe("reducer / SET_AI_THINKING / SHOW_PROMOTION_DIALOG / CANCEL_PROMOTION", () => {
  it("SET_AI_THINKING で isAiThinking が切替", () => {
    const state = makeInitialState();
    const next = reducer(state, { type: "SET_AI_THINKING", thinking: true });
    expect(next.isAiThinking).toBe(true);
  });

  it("SHOW_PROMOTION_DIALOG で promotionPendingMove セット", () => {
    const move = { type: "move" as const, player: "sente" as const, piece: "pawn", from: { row: 3, col: 4 }, to: { row: 2, col: 4 } };
    const state = makeInitialState();
    const next = reducer(state, { type: "SHOW_PROMOTION_DIALOG", move });
    expect(next.promotionPendingMove).toEqual(move);
  });

  it("CANCEL_PROMOTION で promotionPendingMove クリア", () => {
    const move = { type: "move" as const, player: "sente" as const, piece: "pawn", from: { row: 3, col: 4 }, to: { row: 2, col: 4 } };
    const state = { ...makeInitialState(), promotionPendingMove: move };
    const next = reducer(state, { type: "CANCEL_PROMOTION" });
    expect(next.promotionPendingMove).toBeNull();
  });
});

// ===== 王手崩しトラップ (#82) =====

describe("reducer / 王手崩しトラップ (check_break)", () => {
  it("MAKE_MOVE で相手 (gote) を王手 + gote が check_break セット中 → トラップ発動", () => {
    // sente の歩 (row=4, col=4) → (row=3, col=4) に進めて gote 玉 (row=2, col=4) に王手
    const gameState: GameState = {
      ...createInitialGameState(CARD_SHOGI_VARIANT),
      board: Array.from({ length: 9 }, () => Array(9).fill(null)),
      hand: { sente: {}, gote: {} },
      currentPlayer: "sente",
    };
    gameState.board[8][4] = { type: "king", owner: "sente" };
    gameState.board[2][4] = { type: "king", owner: "gote" };
    gameState.board[4][4] = { type: "pawn", owner: "sente" };
    const cardState = makeInitialCardState({
      trap: {
        sente: null,
        gote: { instanceId: "trap-1", defId: "check_break", owner: "gote" },
      },
    });
    const state = makeInitialState(gameState, cardState);
    const move = {
      type: "move" as const,
      player: "sente" as const,
      piece: "pawn",
      from: { row: 4, col: 4 },
      to: { row: 3, col: 4 },
    };
    const next = reducer(state, { type: "MAKE_MOVE", move });

    // 移動した sente 歩 (= 王手駒) が gote の持ち駒に
    expect(next.gameState.hand.gote.pawn).toBe(1);
    // 元の盤上 (3,4) は除去済
    expect(next.gameState.board[3][4]).toBeNull();
    // gote 王手解除
    // (isInCheck の検証は effects.test.ts 側でカバー、ここではトラップが消費されたことを確認)
    expect(next.cardState.trap.gote).toBeNull();
    // isCheckBreakAnimating がセット
    expect(next.isCheckBreakAnimating).toBe(true);
    // trapTriggerEvent が emit されている
    const trapEvent = next.eventLog.find((e) => e.kind === "trapTriggerEvent");
    expect(trapEvent).toBeDefined();
    if (trapEvent && trapEvent.kind === "trapTriggerEvent") {
      expect(trapEvent.reason).toBe("check_declared");
      expect(trapEvent.capturedPieces).toBeDefined();
      expect(trapEvent.capturedPieces!.length).toBeGreaterThan(0);
    }
  });

  it("COMMIT_CHECK_BREAK で isCheckBreakAnimating がクリアされる", () => {
    const state: CardShogiGameStateInternal = {
      ...makeInitialState(),
      isCheckBreakAnimating: true,
    };
    const next = reducer(state, { type: "COMMIT_CHECK_BREAK" });
    expect(next.isCheckBreakAnimating).toBe(false);
  });

  it("COMMIT_CHECK_BREAK は isCheckBreakAnimating=false なら state 不変", () => {
    const state = makeInitialState();
    const next = reducer(state, { type: "COMMIT_CHECK_BREAK" });
    expect(next).toBe(state);
  });

  it("trap がセットされていないなら check_break は発動しない (通常の MAKE_MOVE 動作)", () => {
    const gameState: GameState = {
      ...createInitialGameState(CARD_SHOGI_VARIANT),
      board: Array.from({ length: 9 }, () => Array(9).fill(null)),
      hand: { sente: {}, gote: {} },
      currentPlayer: "sente",
    };
    gameState.board[8][4] = { type: "king", owner: "sente" };
    gameState.board[2][4] = { type: "king", owner: "gote" };
    gameState.board[4][4] = { type: "pawn", owner: "sente" };
    const state = makeInitialState(gameState); // trap なし
    const move = {
      type: "move" as const,
      player: "sente" as const,
      piece: "pawn",
      from: { row: 4, col: 4 },
      to: { row: 3, col: 4 },
    };
    const next = reducer(state, { type: "MAKE_MOVE", move });

    // 歩は (3,4) に移動して残っている (持ち駒化されない)
    expect(next.gameState.board[3][4]).toEqual({ type: "pawn", owner: "sente" });
    expect(next.gameState.hand.gote.pawn).toBeUndefined();
    expect(next.isCheckBreakAnimating).toBe(false);
  });
});

// ===== 二手指し × 王手崩し (Issue #220) =====

describe("reducer / 二手指し × 王手崩し (Issue #220)", () => {
  // sente: 玉[8][4] / 飛[5][3]、gote: 玉[2][4]、gote が check_break セット中。
  // sente が二手指し中 (movesLeft=2)。一手目で飛を [5][3]→[5][4] に動かすと
  // 列4で gote 玉に王手 (間の [4][4]/[3][4] は空)。盤はほぼ空なので詰みではない。
  function makeDoubleMoveCheckBreakState(): CardShogiGameStateInternal {
    const gameState: GameState = {
      ...createInitialGameState(CARD_SHOGI_VARIANT),
      board: Array.from({ length: 9 }, () => Array(9).fill(null)),
      hand: { sente: {}, gote: {} },
      currentPlayer: "sente",
    };
    gameState.board[8][4] = { type: "king", owner: "sente" };
    gameState.board[2][4] = { type: "king", owner: "gote" };
    gameState.board[5][3] = { type: "rook", owner: "sente" };
    const cardState = makeInitialCardState({
      trap: {
        sente: null,
        gote: { instanceId: "trap-1", defId: "check_break", owner: "gote" },
      },
    });
    const snapshot = {
      gameState,
      cardState,
      eventLog: [] as GameEvent[],
    };
    return {
      ...makeInitialState(gameState, cardState),
      doubleMove: {
        active: "sente",
        movesLeft: 2,
        mateInOneAvailable: false,
        cardInstance: card("dm-1", "double_move"),
        cardCost: 6,
        preFirstMoveState: snapshot,
        preCardState: snapshot,
      },
    };
  }

  const firstMoveCheck = {
    type: "move" as const,
    player: "sente" as const,
    piece: "rook",
    from: { row: 5, col: 3 },
    to: { row: 5, col: 4 },
  };

  it("一手目で王手しても check_break は発動しない (中間局面のため遅延 / 情報リークなし)", () => {
    const state = makeDoubleMoveCheckBreakState();
    const next = reducer(state, { type: "MAKE_MOVE", move: firstMoveCheck });

    // トラップ未消費 (隠し情報維持) / 発動演出なし / イベントなし
    expect(next.cardState.trap.gote).not.toBeNull();
    expect(next.cardState.trap.gote?.defId).toBe("check_break");
    expect(next.isCheckBreakAnimating).toBe(false);
    expect(next.eventLog.some((e) => e.kind === "trapTriggerEvent")).toBe(false);
    // 飛は盤上に残り、gote 持ち駒化されていない
    expect(next.gameState.board[5][4]).toEqual({ type: "rook", owner: "sente" });
    expect(next.gameState.hand.gote.rook).toBeUndefined();
    // 二手指しは継続 (movesLeft 2→1、currentPlayer は active=sente に戻る)
    expect(next.doubleMove?.movesLeft).toBe(1);
    expect(next.gameState.currentPlayer).toBe("sente");
  });

  it("二手指し完了 (二手目) で最終局面が王手なら check_break が発動する", () => {
    const afterFirst = reducer(makeDoubleMoveCheckBreakState(), {
      type: "MAKE_MOVE",
      move: firstMoveCheck,
    });
    // 二手目: gote の王手を解除しない手 (sente 玉を動かすだけ)
    const secondMoveKeepCheck = {
      type: "move" as const,
      player: "sente" as const,
      piece: "king",
      from: { row: 8, col: 4 },
      to: { row: 7, col: 4 },
    };
    const next = reducer(afterFirst, {
      type: "MAKE_MOVE",
      move: secondMoveKeepCheck,
    });

    // 最終局面が王手 → トラップ発動 (王手駒=飛を gote 持ち駒へ)
    expect(next.cardState.trap.gote).toBeNull();
    expect(next.gameState.hand.gote.rook).toBe(1);
    expect(next.isCheckBreakAnimating).toBe(true);
    const trapEvent = next.eventLog.find((e) => e.kind === "trapTriggerEvent");
    expect(trapEvent?.kind === "trapTriggerEvent" && trapEvent.reason).toBe(
      "check_declared",
    );
    expect(next.doubleMove).toBeNull();
  });

  it("一手目で王手 → 二手目で王手解除 → check_break は発動しない", () => {
    const afterFirst = reducer(makeDoubleMoveCheckBreakState(), {
      type: "MAKE_MOVE",
      move: firstMoveCheck,
    });
    // 二手目: 王手していた飛を [5][4]→[5][3] に戻し王手解除
    const secondMoveResolve = {
      type: "move" as const,
      player: "sente" as const,
      piece: "rook",
      from: { row: 5, col: 4 },
      to: { row: 5, col: 3 },
    };
    const next = reducer(afterFirst, {
      type: "MAKE_MOVE",
      move: secondMoveResolve,
    });

    // 最終局面が非王手 → トラップ未発動 (隠し情報維持)
    expect(next.cardState.trap.gote).not.toBeNull();
    expect(next.cardState.trap.gote?.defId).toBe("check_break");
    expect(next.isCheckBreakAnimating).toBe(false);
    expect(next.eventLog.some((e) => e.kind === "trapTriggerEvent")).toBe(false);
    expect(next.doubleMove).toBeNull();
  });
});

// ===== 自動ドロー (#130) =====

describe("reducer / 自動ドロー (#130)", () => {
  // 共通: 1 マス前進する歩の move
  const sentePawnMove = {
    type: "move" as const,
    player: "sente" as const,
    piece: "pawn",
    from: { row: 6, col: 4 },
    to: { row: 5, col: 4 },
  };

  it("MAKE_MOVE で drawProgress[mover] が +1 される", () => {
    const state = makeInitialState();
    expect(state.cardState.drawProgress.sente).toBe(0);
    const next = reducer(state, { type: "MAKE_MOVE", move: sentePawnMove });
    expect(next.cardState.drawProgress.sente).toBe(1);
    expect(next.cardState.drawProgress.gote).toBe(0);
  });

  it("CONFIRM_PROMOTION で drawProgress[mover] が +1 される (成り宣言したケース)", () => {
    // 成り対象範囲 (row<=2) の sente 歩を作成
    const gameState: GameState = {
      ...createInitialGameState(CARD_SHOGI_VARIANT),
      board: Array.from({ length: 9 }, () => Array(9).fill(null)),
      hand: { sente: {}, gote: {} },
      currentPlayer: "sente",
    };
    gameState.board[8][4] = { type: "king", owner: "sente" };
    gameState.board[0][8] = { type: "king", owner: "gote" };
    gameState.board[3][4] = { type: "pawn", owner: "sente" };
    const state = makeInitialState(gameState);
    const move = {
      type: "move" as const,
      player: "sente" as const,
      piece: "pawn",
      from: { row: 3, col: 4 },
      to: { row: 2, col: 4 },
    };
    const stateWithPending = { ...state, promotionPendingMove: move };
    const next = reducer(stateWithPending, { type: "CONFIRM_PROMOTION", promote: true });
    expect(next.cardState.drawProgress.sente).toBe(1);
    expect(next.cardState.drawProgress.gote).toBe(0);
  });

  it("DRAW_CARD → COMMIT_DRAW (manual) で drawProgress[drawer] が +1 される (連鎖発火しない正常系)", () => {
    const deckCard = card("d1", "mana_up");
    const state = makeInitialState(
      undefined,
      makeInitialCardState({
        mana: { sente: DRAW_COST, gote: 0 },
        deck: { sente: [deckCard, card("d2", "mana_up")], gote: [] },
      }),
    );
    expect(state.cardState.drawProgress.sente).toBe(0);
    const drawn = reducer(state, { type: "DRAW_CARD", player: "sente" });
    // DRAW_CARD 単体では drawProgress は変化しない (COMMIT_DRAW で加算)
    expect(drawn.cardState.drawProgress.sente).toBe(0);
    expect(drawn.pendingDrawSource).toBe("manual");
    const committed = reducer(drawn, { type: "COMMIT_DRAW" });
    expect(committed.cardState.drawProgress.sente).toBe(1);
    expect(committed.gameState.currentPlayer).toBe("gote");
    expect(committed.isDrawing).toBe(false);
    expect(committed.pendingDrawSource).toBeNull();
  });

  it("CONFIRM_PLAY_CARD → COMMIT_PLAY_CARD で drawProgress[player] が +1 される", () => {
    const c = card("c1", "mana_up");
    const state = makeInitialState(
      undefined,
      makeInitialCardState({
        mana: { sente: 5, gote: 0 },
        hand: { sente: [c], gote: [] },
        pendingCard: { instance: c, player: "sente", phase: "confirm" },
      }),
    );
    const confirmed = reducer(state, { type: "CONFIRM_PLAY_CARD" });
    // CONFIRM_PLAY_CARD では drawProgress は変化しない (COMMIT_PLAY_CARD で加算)
    expect(confirmed.cardState.drawProgress.sente).toBe(0);
    const committed = reducer(confirmed, { type: "COMMIT_PLAY_CARD" });
    expect(committed.cardState.drawProgress.sente).toBe(1);
    expect(committed.gameState.currentPlayer).toBe("gote");
  });

  it("drawProgress=4 で MAKE_MOVE → 自動ドローが発火 (isDrawing=true, source=auto)", () => {
    const deckCard = card("d1", "pawn_return");
    const state = makeInitialState(
      undefined,
      makeInitialCardState({
        deck: { sente: [deckCard], gote: [] },
        drawProgress: { sente: AUTO_DRAW_INTERVAL - 1, gote: 0 },
      }),
    );
    const next = reducer(state, { type: "MAKE_MOVE", move: sentePawnMove });
    expect(next.cardState.drawProgress.sente).toBe(0);
    expect(next.cardState.hand.sente).toEqual([deckCard]);
    expect(next.cardState.deck.sente).toEqual([]);
    expect(next.isDrawing).toBe(true);
    expect(next.pendingDrawPlayer).toBe("sente");
    expect(next.pendingDrawSource).toBe("auto");
    // drawEvent (auto) が emit されている
    const drawEvents = next.eventLog.filter((e) => e.kind === "drawEvent");
    expect(drawEvents.length).toBe(1);
    if (drawEvents[0].kind === "drawEvent") {
      expect(drawEvents[0].source).toBe("auto");
      expect(drawEvents[0].player).toBe("sente");
    }
  });

  it("drawProgress=4 で 手動ドロー → COMMIT_DRAW(manual) で auto-draw 連鎖発火 (二段階)", () => {
    const deckCard1 = card("d1", "mana_up");
    const deckCard2 = card("d2", "pawn_return");
    const state = makeInitialState(
      undefined,
      makeInitialCardState({
        mana: { sente: DRAW_COST, gote: 0 },
        deck: { sente: [deckCard1, deckCard2], gote: [] },
        drawProgress: { sente: AUTO_DRAW_INTERVAL - 1, gote: 0 },
      }),
    );
    // 1段目: 手動ドロー
    const drawn = reducer(state, { type: "DRAW_CARD", player: "sente" });
    expect(drawn.cardState.hand.sente).toEqual([deckCard1]);
    expect(drawn.cardState.deck.sente).toEqual([deckCard2]);
    expect(drawn.pendingDrawSource).toBe("manual");
    // drawProgress は DRAW_CARD では変化しない
    expect(drawn.cardState.drawProgress.sente).toBe(AUTO_DRAW_INTERVAL - 1);

    // 2段目: COMMIT_DRAW(manual) → drawProgress 4→5 でしきい値到達 → auto-draw 連鎖
    const committed = reducer(drawn, { type: "COMMIT_DRAW" });
    // 連鎖 auto-draw が発火: hand に 2 枚目の deckCard2 が追加
    expect(committed.cardState.hand.sente).toEqual([deckCard1, deckCard2]);
    expect(committed.cardState.deck.sente).toEqual([]);
    expect(committed.cardState.drawProgress.sente).toBe(0);
    // isDrawing は連鎖 auto-draw 用に再度 true、source=auto
    expect(committed.isDrawing).toBe(true);
    expect(committed.pendingDrawPlayer).toBe("sente");
    expect(committed.pendingDrawSource).toBe("auto");
    // currentPlayer は manual COMMIT_DRAW で gote に反転済 (auto は反転しない)
    expect(committed.gameState.currentPlayer).toBe("gote");
    // drawEvent が 2 件 (manual + auto)
    const drawEvents = committed.eventLog.filter((e) => e.kind === "drawEvent");
    expect(drawEvents.length).toBe(2);
    if (drawEvents[0].kind === "drawEvent" && drawEvents[1].kind === "drawEvent") {
      expect(drawEvents[0].source).toBe("manual");
      expect(drawEvents[1].source).toBe("auto");
    }
  });

  it("deck 空時: drawProgress が 5 に達してもドローは発火せず isDrawing=false のまま", () => {
    const state = makeInitialState(
      undefined,
      makeInitialCardState({
        deck: { sente: [], gote: [] },
        drawProgress: { sente: AUTO_DRAW_INTERVAL - 1, gote: 0 },
      }),
    );
    const next = reducer(state, { type: "MAKE_MOVE", move: sentePawnMove });
    // 進捗は 5 に達したが、deck 空なので発火せず加算のみ
    expect(next.cardState.drawProgress.sente).toBe(AUTO_DRAW_INTERVAL);
    expect(next.cardState.hand.sente).toEqual([]);
    expect(next.isDrawing).toBe(false);
    expect(next.pendingDrawSource).toBeNull();
    // drawEvent は emit されない
    const drawEvents = next.eventLog.filter((e) => e.kind === "drawEvent");
    expect(drawEvents.length).toBe(0);
  });

  it("両者独立カウント: sente の MAKE_MOVE は gote の drawProgress に影響しない", () => {
    const state = makeInitialState(
      undefined,
      makeInitialCardState({
        drawProgress: { sente: 2, gote: 3 },
      }),
    );
    const next = reducer(state, { type: "MAKE_MOVE", move: sentePawnMove });
    expect(next.cardState.drawProgress.sente).toBe(3);
    expect(next.cardState.drawProgress.gote).toBe(3);
  });

  it("DRAW_COST=2: マナ 2 で manual draw 成立、マナ 1 では state 不変", () => {
    // commit 1 で DRAW_COST が 3→2 に下がった事を保証する回帰テスト
    expect(DRAW_COST).toBe(2);
    const c = card("d-cost", "mana_up");
    // mana=2: 成立
    const stateOk = makeInitialState(
      undefined,
      makeInitialCardState({
        mana: { sente: 2, gote: 0 },
        deck: { sente: [c], gote: [] },
      }),
    );
    const okNext = reducer(stateOk, { type: "DRAW_CARD", player: "sente" });
    expect(okNext.cardState.mana.sente).toBe(0);
    expect(okNext.cardState.hand.sente).toEqual([c]);
    expect(okNext.isDrawing).toBe(true);
    // mana=1: 不成立
    const stateNg = makeInitialState(
      undefined,
      makeInitialCardState({
        mana: { sente: 1, gote: 0 },
        deck: { sente: [c], gote: [] },
      }),
    );
    const ngNext = reducer(stateNg, { type: "DRAW_CARD", player: "sente" });
    expect(ngNext).toBe(stateNg);
  });

  it("AI 二重発火防止: gote の MAKE_MOVE で auto-draw 発火後、currentPlayer は反転済 + isDrawing=true を維持", () => {
    // gote 手番、drawProgress[gote]=4。gote が 1 手指すと drawProgress=5 → auto-draw 発火。
    // 結果として currentPlayer は sente に反転済 (applyMove 結果) かつ
    // isDrawing=true (=auto-draw 演出中) で、AI useEffect の再発火条件を満たさないこと。
    const gameState: GameState = {
      ...createInitialGameState(CARD_SHOGI_VARIANT),
      currentPlayer: "gote",
    };
    const deckCard = card("auto-gote", "mana_up");
    const state = makeInitialState(
      gameState,
      makeInitialCardState({
        deck: { sente: [], gote: [deckCard] },
        drawProgress: { sente: 0, gote: AUTO_DRAW_INTERVAL - 1 },
      }),
    );
    const goteMove = {
      type: "move" as const,
      player: "gote" as const,
      piece: "pawn",
      from: { row: 2, col: 4 },
      to: { row: 3, col: 4 },
    };
    const next = reducer(state, { type: "MAKE_MOVE", move: goteMove });
    // currentPlayer は applyMove で sente に反転済
    expect(next.gameState.currentPlayer).toBe("sente");
    // auto-draw が発火し isDrawing=true
    expect(next.isDrawing).toBe(true);
    expect(next.pendingDrawPlayer).toBe("gote");
    expect(next.pendingDrawSource).toBe("auto");
    // hand[gote] にカード追加、deck[gote] 空
    expect(next.cardState.hand.gote).toEqual([deckCard]);
    expect(next.cardState.deck.gote).toEqual([]);
    // drawProgress[gote] リセット
    expect(next.cardState.drawProgress.gote).toBe(0);
    // 次に MAKE_MOVE をもう 1 回呼んでも、本テストでは AI 二重発火は reducer 自体ではなく
    // use-card-shogi-game.ts の useEffect ガード (state.isDrawing チェック) で防がれる。
    // ここでは reducer 出力が「ガード条件を満たす状態 (currentPlayer flipped + isDrawing=true)」
    // になっていることを保証する。
  });
});

// ===== Issue #82: 二手指し (double_move) =====

describe("reducer / 二手指し (double_move)", () => {
  function makeBaseGameState(): GameState {
    const state = createInitialGameState(CARD_SHOGI_VARIANT);
    return state;
  }

  // テスト用 doubleMove ファクトリ。preFirstMoveState/preCardState/cardInstance/cardCost を
  // 持つ新仕様の構造を 1 箇所で集約。
  function makeDM(opts: {
    movesLeft: 1 | 2;
    mateInOneAvailable?: boolean;
    cardInstance?: CardInstance;
    gameStateSnapshot?: GameState;
    cardStateSnapshot?: CardGameState;
    eventLogSnapshot?: GameEvent[];
  }) {
    const snapshot = {
      gameState: opts.gameStateSnapshot ?? makeBaseGameState(),
      cardState: opts.cardStateSnapshot ?? makeInitialCardState(),
      eventLog: opts.eventLogSnapshot ?? [],
    };
    return {
      active: "sente" as const,
      movesLeft: opts.movesLeft,
      mateInOneAvailable: opts.mateInOneAvailable ?? false,
      cardInstance: opts.cardInstance ?? card("dm-fixture", "double_move"),
      cardCost: 5,
      preFirstMoveState: snapshot,
      preCardState: snapshot,
    };
  }

  it("CONFIRM_PLAY_CARD (double_move) [新仕様]: doubleMove のみセット、カード消費・マナ・eventLog は変えない", () => {
    const c = card("dm1", "double_move");
    const state = makeInitialState(
      makeBaseGameState(),
      makeInitialCardState({
        mana: { sente: 10, gote: 0 },
        hand: { sente: [c], gote: [] },
        pendingCard: { instance: c, player: "sente", phase: "confirm" },
      }),
    );
    const next = reducer(state, { type: "CONFIRM_PLAY_CARD" });

    // 新仕様: マナ・手札・graveyard・eventLog は CONFIRM では変えない (2手目完了で finalize)
    expect(next.cardState.mana.sente).toBe(10);
    expect(next.cardState.hand.sente).toEqual([c]);
    expect(next.cardState.graveyard.sente.length).toBe(0);
    expect(next.eventLog.length).toBe(state.eventLog.length); // cardPlayEvent はまだ push されない
    // pendingCard はクリアされる
    expect(next.cardState.pendingCard).toBeNull();
    // doubleMove はセットされる
    expect(next.doubleMove).not.toBeNull();
    expect(next.doubleMove?.active).toBe("sente");
    expect(next.doubleMove?.movesLeft).toBe(2);
    expect(next.doubleMove?.cardInstance).toEqual(c);
    expect(next.doubleMove?.cardCost).toBe(5);
    // 演出はまだ起動しない (2手目完了で起動)
    expect(next.isPlayingCard).toBe(false);
  });

  it("COMMIT_PLAY_CARD: pendingPlayCardOpponent=null (新仕様 finalize 経由) なら currentPlayer は変えない", () => {
    // 新仕様: 2手目完了時に finalizeDoubleMoveCardConsumption が isPlayingCard=true +
    // pendingPlayCardOpponent=null をセットする。COMMIT_PLAY_CARD はこれを検知して再 flip しない。
    const state: CardShogiGameStateInternal = {
      ...makeInitialState(makeBaseGameState()),
      isPlayingCard: true,
      pendingPlayCardOpponent: null, // 新仕様: 2手目 finalize 経由はこれが null
    };
    const next = reducer(state, { type: "COMMIT_PLAY_CARD" });
    // currentPlayer は変えない (sente のまま)
    expect(next.gameState.currentPlayer).toBe("sente");
    expect(next.isPlayingCard).toBe(false);
  });

  it("MAKE_MOVE 1手目 (movesLeft=2): currentPlayer 維持 + movesLeft=1 + カード未消費 (新仕様)", () => {
    const c = card("dm1", "double_move");
    const gameState = makeBaseGameState();
    const cardState = makeInitialCardState({
      mana: { sente: 10, gote: 0 },
      hand: { sente: [c], gote: [] },
    });
    const state: CardShogiGameStateInternal = {
      ...makeInitialState(gameState, cardState),
      doubleMove: makeDM({ movesLeft: 2, cardInstance: c, gameStateSnapshot: gameState, cardStateSnapshot: cardState }),
    };

    const move = {
      type: "move" as const,
      player: "sente" as const,
      piece: "pawn",
      from: { row: 6, col: 4 },
      to: { row: 5, col: 4 },
    };
    const next = reducer(state, { type: "MAKE_MOVE", move });

    expect(next.gameState.currentPlayer).toBe("sente");
    expect(next.doubleMove?.movesLeft).toBe(1);
    // 新仕様: 1手目時点ではカードはまだ手札にあり、マナも消費されていない
    expect(next.cardState.hand.sente).toEqual([c]);
    expect(next.cardState.mana.sente).toBe(10);
    // 演出もまだ起動しない
    expect(next.isPlayingCard).toBe(false);
  });

  it("MAKE_MOVE 2手目 (movesLeft=1): currentPlayer 反転 + doubleMove クリア + カード finalize (新仕様)", () => {
    const c = card("dm1", "double_move");
    const gameState = makeBaseGameState();
    const cardState = makeInitialCardState({
      mana: { sente: 10, gote: 0 },
      hand: { sente: [c], gote: [] },
    });
    const state: CardShogiGameStateInternal = {
      ...makeInitialState(gameState, cardState),
      doubleMove: makeDM({ movesLeft: 1, cardInstance: c, gameStateSnapshot: gameState, cardStateSnapshot: cardState }),
    };

    const move = {
      type: "move" as const,
      player: "sente" as const,
      piece: "pawn",
      from: { row: 6, col: 4 },
      to: { row: 5, col: 4 },
    };
    const next = reducer(state, { type: "MAKE_MOVE", move });

    expect(next.gameState.currentPlayer).toBe("gote"); // ターン交代
    expect(next.doubleMove).toBeNull();
    // 新仕様: 2手目完了で finalize → カード消費 + マナ -6 + cardPlayEvent push + 演出開始
    expect(next.cardState.hand.sente).toEqual([]);
    expect(next.cardState.graveyard.sente.length).toBe(1);
    expect(next.cardState.mana.sente).toBe(5); // 10 - 5
    expect(next.isPlayingCard).toBe(true); // 中央演出開始
    expect(next.pendingPlayCardOpponent).toBeNull(); // currentPlayer は既に flip 済なので null
    // cardPlayEvent が eventLog に追加される
    const cardPlayEvent = next.eventLog.find((e) => e.kind === "cardPlayEvent");
    expect(cardPlayEvent).toBeDefined();
  });

  it("UNDO_DOUBLE_MOVE_FIRST: movesLeft=1 で動作、preFirstMoveState から復元 (movesLeft=2 へ)", () => {
    const preGameState = makeBaseGameState();
    const preCardState = makeInitialCardState({ mana: { sente: 10, gote: 0 } });
    const preEventLog: GameEvent[] = [];

    // 1手目適用後の仮想状態
    const afterFirstMoveState = createInitialGameState(CARD_SHOGI_VARIANT);
    afterFirstMoveState.board[5][4] = { type: "pawn", owner: "sente" };
    afterFirstMoveState.board[6][4] = null;

    const state: CardShogiGameStateInternal = {
      ...makeInitialState(afterFirstMoveState, preCardState),
      doubleMove: makeDM({
        movesLeft: 1,
        gameStateSnapshot: preGameState,
        cardStateSnapshot: preCardState,
        eventLogSnapshot: preEventLog,
      }),
    };

    const next = reducer(state, { type: "UNDO_DOUBLE_MOVE_FIRST" });

    expect(next.gameState).toEqual(preGameState); // 1手目 が undo
    expect(next.cardState).toEqual(preCardState);
    expect(next.eventLog).toEqual(preEventLog);
    expect(next.doubleMove?.movesLeft).toBe(2); // movesLeft=2 へ
    expect(next.doubleMove).not.toBeNull(); // doubleMove は維持
  });

  it("UNDO_DOUBLE_MOVE_FIRST: movesLeft=2 では state 不変 (1手目未適用)", () => {
    const state: CardShogiGameStateInternal = {
      ...makeInitialState(makeBaseGameState()),
      doubleMove: makeDM({ movesLeft: 2 }),
    };
    const next = reducer(state, { type: "UNDO_DOUBLE_MOVE_FIRST" });
    expect(next).toBe(state);
  });

  it("UNDO_DOUBLE_MOVE_FIRST: doubleMove 未セットなら state 不変", () => {
    const state = makeInitialState();
    const next = reducer(state, { type: "UNDO_DOUBLE_MOVE_FIRST" });
    expect(next).toBe(state);
  });

  it("CANCEL_DOUBLE_MOVE: movesLeft=2 でカード使用前の状態に完全復元 (新仕様)", () => {
    const c = card("dm1", "double_move");
    const preGameState = makeBaseGameState();
    const preCardState = makeInitialCardState({
      mana: { sente: 10, gote: 0 },
      hand: { sente: [c], gote: [] },
    });
    const preEventLog: GameEvent[] = [];

    const state: CardShogiGameStateInternal = {
      ...makeInitialState(preGameState, preCardState),
      doubleMove: makeDM({
        movesLeft: 2,
        cardInstance: c,
        gameStateSnapshot: preGameState,
        cardStateSnapshot: preCardState,
        eventLogSnapshot: preEventLog,
      }),
    };

    const next = reducer(state, { type: "CANCEL_DOUBLE_MOVE" });

    // カードは手札に残ったまま、マナも消費されない、doubleMove は null
    expect(next.cardState.hand.sente).toEqual([c]);
    expect(next.cardState.mana.sente).toBe(10);
    expect(next.doubleMove).toBeNull();
    expect(next.eventLog).toEqual(preEventLog);
  });

  it("CANCEL_DOUBLE_MOVE: movesLeft=1 (1手目適用後) でも完全復元", () => {
    const c = card("dm1", "double_move");
    const preGameState = makeBaseGameState();
    const preCardState = makeInitialCardState({
      mana: { sente: 10, gote: 0 },
      hand: { sente: [c], gote: [] },
    });

    // 1手目適用後の仮想状態
    const afterFirstMoveState = createInitialGameState(CARD_SHOGI_VARIANT);
    afterFirstMoveState.board[5][4] = { type: "pawn", owner: "sente" };
    afterFirstMoveState.board[6][4] = null;

    const state: CardShogiGameStateInternal = {
      ...makeInitialState(afterFirstMoveState, preCardState),
      doubleMove: makeDM({
        movesLeft: 1,
        cardInstance: c,
        gameStateSnapshot: preGameState,
        cardStateSnapshot: preCardState,
        eventLogSnapshot: [],
      }),
    };

    const next = reducer(state, { type: "CANCEL_DOUBLE_MOVE" });

    expect(next.gameState).toEqual(preGameState); // 1手目 も undo
    expect(next.cardState).toEqual(preCardState);
    expect(next.doubleMove).toBeNull();
  });

  it("CANCEL_DOUBLE_MOVE: doubleMove 未セットなら state 不変", () => {
    const state = makeInitialState();
    const next = reducer(state, { type: "CANCEL_DOUBLE_MOVE" });
    expect(next).toBe(state);
  });

  // 回帰テスト: バグ報告「キャンセル後にカード使用ポップアップが再表示される」
  // 修正: snapshot 作成時に pendingCard を null クリア + 復元時にも防御的に null 強制
  it("CANCEL_DOUBLE_MOVE: 復元後に pendingCard が null (CardPlayDialog 再表示防止)", () => {
    const c = card("dm1", "double_move");
    // snapshot 内の cardState に pendingCard が誤って残っていたケースを想定
    const snapshotWithPending: CardGameState = {
      ...makeInitialCardState({
        mana: { sente: 10, gote: 0 },
        hand: { sente: [c], gote: [] },
      }),
      pendingCard: { instance: c, player: "sente", phase: "confirm" },
    };
    const state: CardShogiGameStateInternal = {
      ...makeInitialState(makeBaseGameState()),
      doubleMove: {
        active: "sente",
        movesLeft: 2,
        mateInOneAvailable: false,
        cardInstance: c,
        cardCost: 5,
        preFirstMoveState: { gameState: makeBaseGameState(), cardState: snapshotWithPending, eventLog: [] },
        preCardState: { gameState: makeBaseGameState(), cardState: snapshotWithPending, eventLog: [] },
      },
    };

    const next = reducer(state, { type: "CANCEL_DOUBLE_MOVE" });

    // pendingCard が null に強制されること (= CardPlayDialog 表示条件不成立)
    expect(next.cardState.pendingCard).toBeNull();
    // doubleMove も null
    expect(next.doubleMove).toBeNull();
  });

  it("UNDO_DOUBLE_MOVE_FIRST: 復元後に pendingCard が null (CardPlayDialog 再表示防止)", () => {
    const c = card("dm1", "double_move");
    // snapshot 内の cardState に pendingCard が誤って残っていたケースを想定
    const snapshotWithPending: CardGameState = {
      ...makeInitialCardState({
        mana: { sente: 10, gote: 0 },
        hand: { sente: [c], gote: [] },
      }),
      pendingCard: { instance: c, player: "sente", phase: "confirm" },
    };
    const afterFirst = createInitialGameState(CARD_SHOGI_VARIANT);
    afterFirst.board[5][4] = { type: "pawn", owner: "sente" };
    afterFirst.board[6][4] = null;
    const state: CardShogiGameStateInternal = {
      ...makeInitialState(afterFirst),
      doubleMove: {
        active: "sente",
        movesLeft: 1,
        mateInOneAvailable: false,
        cardInstance: c,
        cardCost: 5,
        preFirstMoveState: { gameState: makeBaseGameState(), cardState: snapshotWithPending, eventLog: [] },
        preCardState: { gameState: makeBaseGameState(), cardState: snapshotWithPending, eventLog: [] },
      },
    };

    const next = reducer(state, { type: "UNDO_DOUBLE_MOVE_FIRST" });

    // pendingCard が null に強制されること
    expect(next.cardState.pendingCard).toBeNull();
    // doubleMove は維持 (movesLeft=2)
    expect(next.doubleMove?.movesLeft).toBe(2);
  });

  // CONFIRM_PLAY_CARD で snapshot 作成時に pendingCard が null クリアされていること
  it("CONFIRM_PLAY_CARD (double_move): snapshot 内 cardState の pendingCard が null", () => {
    const c = card("dm1", "double_move");
    const state = makeInitialState(
      makeBaseGameState(),
      makeInitialCardState({
        mana: { sente: 10, gote: 0 },
        hand: { sente: [c], gote: [] },
        pendingCard: { instance: c, player: "sente", phase: "confirm" },
      }),
    );
    const next = reducer(state, { type: "CONFIRM_PLAY_CARD" });

    // doubleMove.preCardState / preFirstMoveState の cardState に pendingCard が残っていない
    expect(next.doubleMove?.preCardState.cardState.pendingCard).toBeNull();
    expect(next.doubleMove?.preFirstMoveState.cardState.pendingCard).toBeNull();
  });

  it("BEGIN_PLAY_CARD: 二手指し中は他カード使用禁止 (state 不変)", () => {
    const c = card("dm1", "double_move");
    const otherC = card("ot1", "mana_up");
    const cardState = makeInitialCardState({
      mana: { sente: 10, gote: 0 },
      hand: { sente: [otherC], gote: [] },
    });
    const state: CardShogiGameStateInternal = {
      ...makeInitialState(makeBaseGameState(), cardState),
      doubleMove: makeDM({ movesLeft: 1, cardInstance: c }),
    };
    const next = reducer(state, {
      type: "BEGIN_PLAY_CARD",
      player: "sente",
      instanceId: otherC.instanceId,
    });
    expect(next).toBe(state);
  });

  it("DRAW_CARD: 二手指し中はドロー禁止 (state 不変)", () => {
    const cardState = makeInitialCardState({
      mana: { sente: 10, gote: 0 },
      deck: { sente: [card("d1", "mana_up")], gote: [] },
    });
    const state: CardShogiGameStateInternal = {
      ...makeInitialState(makeBaseGameState(), cardState),
      doubleMove: makeDM({ movesLeft: 1 }),
    };
    const next = reducer(state, { type: "DRAW_CARD", player: "sente" });
    expect(next).toBe(state);
  });

  it("UNDO: 二手指し中は state 不変 (待った不可)", () => {
    const state: CardShogiGameStateInternal = {
      ...makeInitialState(makeBaseGameState()),
      doubleMove: makeDM({ movesLeft: 1 }),
    };
    const next = reducer(state, { type: "UNDO" });
    expect(next).toBe(state);
  });

  // 回帰テスト: バグ報告「1手目で王手後、2手目で相手玉を取れる」
  // 修正後: SELECT_SQUARE で生成される 2手目候補に玉取り手は含まれない
  it("SELECT_SQUARE 2手目: 1手目王手後の盤面で玉取り手は legalMoves に含まれない", () => {
    // 1手目完了後の仮想盤面: sente 飛車 (1,4) が gote 玉 (0,4) を直接攻撃
    const gameState: GameState = {
      board: Array.from({ length: 9 }, () => Array(9).fill(null)),
      hand: { sente: {}, gote: {} },
      currentPlayer: "sente", // 二手指し override で sente のまま
      moveHistory: [],
      positionHistory: [],
      status: "active",
      moveCount: 1,
    };
    gameState.board[8][4] = { type: "king", owner: "sente" };
    gameState.board[0][4] = { type: "king", owner: "gote" };
    gameState.board[1][4] = { type: "rook", owner: "sente" };

    const state: CardShogiGameStateInternal = {
      ...makeInitialState(gameState),
      doubleMove: makeDM({ movesLeft: 1, gameStateSnapshot: gameState }),
    };

    // sente 飛車 (1,4) を選択
    const next = reducer(state, {
      type: "SELECT_SQUARE",
      pos: { row: 1, col: 4 },
    });

    // legalMoves には飛車が玉を取る手 (0,4) が含まれていてはいけない
    const kingCapture = next.legalMoves.find(
      (m) => m.type === "move" && m.to.row === 0 && m.to.col === 4 && m.captured === "king",
    );
    expect(kingCapture).toBeUndefined();
  });
});

// ===== Issue #82 反映: 待った の カード操作直後ガード (回帰テスト) =====
// 過去 2 ターン (= プレイヤー切替 2 回までの範囲) に カード操作系イベント
// (cardPlayEvent / drawEvent / trapSetEvent / trapTriggerEvent) があれば、
// reducer の UNDO は state を変えず返す。
//
// 既存の通常カード代表 + 二手指し の代表 2 ケースで結合動作を検証。

describe("reducer / UNDO カード操作ガード (Issue #82)", () => {
  it("通常カード使用直後 (cardPlayEvent → 相手手) → UNDO は state 不変", () => {
    const gameState: GameState = {
      board: Array.from({ length: 9 }, () => Array(9).fill(null)),
      hand: { sente: {}, gote: {} },
      currentPlayer: "sente",
      moveHistory: [
        // 過去に sente, gote の通常手が 1 件ずつあるとする (待った には 2 手必要)
        { type: "move", from: { row: 6, col: 4 }, to: { row: 5, col: 4 }, piece: "pawn", player: "sente" },
        { type: "move", from: { row: 2, col: 4 }, to: { row: 3, col: 4 }, piece: "pawn", player: "gote" },
      ],
      positionHistory: [],
      status: "active",
      moveCount: 2,
    };
    const eventLog: GameEvent[] = [
      { kind: "moveEvent", move: gameState.moveHistory[0], at: 1 },
      { kind: "manaChargeEvent", player: "sente", reason: "turn", amount: 1, at: 2 },
      { kind: "moveEvent", move: gameState.moveHistory[1], at: 3 },
      { kind: "manaChargeEvent", player: "gote", reason: "turn", amount: 1, at: 4 },
      // sente が通常カードを使用 → cardPlayEvent (sente の手番消費 = moveEvent なし)
      {
        kind: "cardPlayEvent",
        player: "sente",
        instance: { instanceId: "c1", defId: "pawn_return" },
        at: 5,
      },
      // gote の手番
      { kind: "moveEvent", move: gameState.moveHistory[1], at: 6 },
      { kind: "manaChargeEvent", player: "gote", reason: "turn", amount: 1, at: 7 },
    ];

    const state: CardShogiGameStateInternal = {
      ...makeInitialState(gameState),
      eventLog,
    };

    const next = reducer(state, { type: "UNDO" });
    // state 不変であること (block されたら元の state を返す)
    expect(next).toBe(state);
  });

  it("二手指し使用後 (cardPlayEvent → 1手目 + 2手目 → 相手手) → UNDO は state 不変", () => {
    const gameState: GameState = {
      board: Array.from({ length: 9 }, () => Array(9).fill(null)),
      hand: { sente: {}, gote: {} },
      currentPlayer: "sente",
      moveHistory: [
        // 1手目, 2手目, gote の 3 手 (待った 対象は最後の 2 手 = 2手目 + gote)
        { type: "move", from: { row: 6, col: 4 }, to: { row: 5, col: 4 }, piece: "pawn", player: "sente" },
        { type: "move", from: { row: 5, col: 4 }, to: { row: 4, col: 4 }, piece: "pawn", player: "sente" },
        { type: "move", from: { row: 2, col: 4 }, to: { row: 3, col: 4 }, piece: "pawn", player: "gote" },
      ],
      positionHistory: [],
      status: "active",
      moveCount: 3,
    };
    const eventLog: GameEvent[] = [
      // sente が double_move カードを使用
      {
        kind: "cardPlayEvent",
        player: "sente",
        instance: { instanceId: "dm1", defId: "double_move" },
        at: 1,
      },
      // 1手目 (sente moveEvent、manaChargeEvent なし: double_move_first モード)
      { kind: "moveEvent", move: gameState.moveHistory[0], at: 2 },
      // 2手目 (sente moveEvent、manaChargeEvent なし: double_move_second モード)
      { kind: "moveEvent", move: gameState.moveHistory[1], at: 3 },
      // gote の手番
      { kind: "moveEvent", move: gameState.moveHistory[2], at: 4 },
      { kind: "manaChargeEvent", player: "gote", reason: "turn", amount: 1, at: 5 },
    ];

    const state: CardShogiGameStateInternal = {
      ...makeInitialState(gameState),
      eventLog,
    };

    const next = reducer(state, { type: "UNDO" });
    // state 不変であること (cardPlayEvent が直近 2 ターン内に検出されて block)
    expect(next).toBe(state);
  });

  it("通常進行 (カード操作なし、4 手以上) → UNDO は実行され state が変わる", () => {
    const gameState: GameState = {
      board: Array.from({ length: 9 }, () => Array(9).fill(null)),
      hand: { sente: {}, gote: {} },
      currentPlayer: "sente",
      moveHistory: [
        { type: "move", from: { row: 6, col: 4 }, to: { row: 5, col: 4 }, piece: "pawn", player: "sente" },
        { type: "move", from: { row: 2, col: 4 }, to: { row: 3, col: 4 }, piece: "pawn", player: "gote" },
        { type: "move", from: { row: 6, col: 5 }, to: { row: 5, col: 5 }, piece: "pawn", player: "sente" },
        { type: "move", from: { row: 2, col: 5 }, to: { row: 3, col: 5 }, piece: "pawn", player: "gote" },
      ],
      positionHistory: [],
      status: "active",
      moveCount: 4,
    };
    const eventLog: GameEvent[] = [
      { kind: "moveEvent", move: gameState.moveHistory[0], at: 1 },
      { kind: "manaChargeEvent", player: "sente", reason: "turn", amount: 1, at: 2 },
      { kind: "moveEvent", move: gameState.moveHistory[1], at: 3 },
      { kind: "manaChargeEvent", player: "gote", reason: "turn", amount: 1, at: 4 },
      { kind: "moveEvent", move: gameState.moveHistory[2], at: 5 },
      { kind: "manaChargeEvent", player: "sente", reason: "turn", amount: 1, at: 6 },
      { kind: "moveEvent", move: gameState.moveHistory[3], at: 7 },
      { kind: "manaChargeEvent", player: "gote", reason: "turn", amount: 1, at: 8 },
    ];

    const cardState = makeInitialCardState({ mana: { sente: 5, gote: 5 } });
    // Issue #132 snapshot 方式: 直近 2 ply 分の snapshot を保持して UNDO で snapshot[0] に復元する。
    // - snap0 (= 3 手目を指す直前): moveHistory 2 件、mana={sente:4, gote:4}、eventLog 4 件
    // - snap1 (= 4 手目を指す直前): moveHistory 3 件、mana={sente:5, gote:4}、eventLog 6 件
    const snap0Game: GameState = {
      ...gameState,
      moveHistory: gameState.moveHistory.slice(0, 2),
      moveCount: 2,
    };
    const snap0CardState = makeInitialCardState({ mana: { sente: 4, gote: 4 } });
    const snap1Game: GameState = {
      ...gameState,
      moveHistory: gameState.moveHistory.slice(0, 3),
      moveCount: 3,
    };
    const snap1CardState = makeInitialCardState({ mana: { sente: 5, gote: 4 } });
    const state: CardShogiGameStateInternal = {
      ...makeInitialState(gameState, cardState),
      eventLog,
      undoSnapshots: [
        { gameState: snap0Game, cardState: snap0CardState, eventLog: eventLog.slice(0, 4) },
        { gameState: snap1Game, cardState: snap1CardState, eventLog: eventLog.slice(0, 6) },
      ],
    };

    const next = reducer(state, { type: "UNDO" });
    // state が変わること (UNDO が実行された)
    expect(next).not.toBe(state);
    // moveHistory が 2 件減ること (snap0 の値)
    expect(next.gameState.moveHistory.length).toBe(2);
    // マナが巻き戻ること (snap0 の値: sente=4, gote=4)
    expect(next.cardState.mana.sente).toBe(4);
    expect(next.cardState.mana.gote).toBe(4);
    // eventLog は snap0 の eventLog (4 件)
    expect(next.eventLog.length).toBe(4);
    // ring は復元時に 2 件 pop されて空になる
    expect(next.undoSnapshots).toEqual([]);
  });
});

// ===== Issue #82: 二手指し 2手目 - 禁止された詰み手 (forbiddenMateMoves) =====
// mateInOneAvailable=false 時、2手目で相手玉を詰ませる手は禁止。
// 従来は legalMoves から完全に除外していたが、UX 改善のため
// forbiddenMateMoves という別配列で管理し、UI で赤×表示 + クリック時に
// 禁止理由ダイアログを出せるようにする。

describe("reducer / 二手指し 2手目 forbiddenMateMoves (Issue #82)", () => {
  function makeMatePosition() {
    // sente の頭金詰め盤面 (effects.test.ts と同じセットアップ)
    // gote 玉 (0,4) 周囲を gote 桂で塞ぎ、sente 金 (2,4) で 1,4 を守る。
    // 持ち駒に sente 金。1,4 に金を打てば詰み。
    const board: GameState["board"] = Array.from({ length: 9 }, () => Array(9).fill(null));
    board[8][0] = { type: "king", owner: "sente" };
    board[0][4] = { type: "king", owner: "gote" };
    board[0][3] = { type: "knight", owner: "gote" };
    board[0][5] = { type: "knight", owner: "gote" };
    board[1][3] = { type: "knight", owner: "gote" };
    board[1][5] = { type: "knight", owner: "gote" };
    board[2][4] = { type: "gold", owner: "sente" };
    return board;
  }

  it("SELECT_HAND_PIECE: 2手目 + mateInOneAvailable=false で詰み手は forbiddenMateMoves に分離される", () => {
    const board = makeMatePosition();
    const gameState: GameState = {
      board,
      hand: { sente: { gold: 1 }, gote: {} },
      currentPlayer: "sente",
      moveHistory: [],
      positionHistory: [],
      status: "active",
      moveCount: 0,
    };

    const state: CardShogiGameStateInternal = {
      ...makeInitialState(gameState),
      doubleMove: {
        active: "sente",
        movesLeft: 1, // 2手目
        mateInOneAvailable: false, // 1手詰めは元々できない設定
        cardInstance: card("dm-fixture", "double_move"),
        cardCost: 5,
        preFirstMoveState: { gameState, cardState: makeInitialCardState(), eventLog: [] },
        preCardState: { gameState, cardState: makeInitialCardState(), eventLog: [] },
      },
    };

    // 持ち駒の金を選択 → drop 候補を取得
    const next = reducer(state, { type: "SELECT_HAND_PIECE", pieceType: "gold" });

    // 1,4 への金打ち (詰み) が forbiddenMateMoves に入る
    const forbiddenAt14 = next.forbiddenMateMoves.find(
      (m) => m.type === "drop" && m.dropPiece === "gold" && m.to.row === 1 && m.to.col === 4,
    );
    expect(forbiddenAt14).toBeDefined();

    // 同じ手は legalMoves には含まれない
    const legalAt14 = next.legalMoves.find(
      (m) => m.type === "drop" && m.dropPiece === "gold" && m.to.row === 1 && m.to.col === 4,
    );
    expect(legalAt14).toBeUndefined();
  });

  it("SELECT_HAND_PIECE: 2手目 + mateInOneAvailable=true なら詰み手も legalMoves に含まれ、forbiddenMateMoves は空", () => {
    const board = makeMatePosition();
    const gameState: GameState = {
      board,
      hand: { sente: { gold: 1 }, gote: {} },
      currentPlayer: "sente",
      moveHistory: [],
      positionHistory: [],
      status: "active",
      moveCount: 0,
    };

    const state: CardShogiGameStateInternal = {
      ...makeInitialState(gameState),
      doubleMove: {
        active: "sente",
        movesLeft: 1,
        mateInOneAvailable: true, // 1手詰めができる設定
        cardInstance: card("dm-fixture", "double_move"),
        cardCost: 5,
        preFirstMoveState: { gameState, cardState: makeInitialCardState(), eventLog: [] },
        preCardState: { gameState, cardState: makeInitialCardState(), eventLog: [] },
      },
    };

    const next = reducer(state, { type: "SELECT_HAND_PIECE", pieceType: "gold" });

    // 1,4 への金打ちが legalMoves にも含まれる
    const legalAt14 = next.legalMoves.find(
      (m) => m.type === "drop" && m.dropPiece === "gold" && m.to.row === 1 && m.to.col === 4,
    );
    expect(legalAt14).toBeDefined();

    // forbiddenMateMoves は空
    expect(next.forbiddenMateMoves.length).toBe(0);
  });

  it("DESELECT で forbiddenMateMoves もクリアされる", () => {
    const state: CardShogiGameStateInternal = {
      ...makeInitialState(),
      forbiddenMateMoves: [
        { type: "drop", dropPiece: "gold", piece: "gold", to: { row: 1, col: 4 }, player: "sente" },
      ],
    };
    const next = reducer(state, { type: "DESELECT" });
    expect(next.forbiddenMateMoves.length).toBe(0);
  });

  it("通常時 (二手指しでない) は forbiddenMateMoves が常に空", () => {
    const state = makeInitialState();
    const next = reducer(state, { type: "SELECT_SQUARE", pos: { row: 6, col: 4 } });
    expect(next.forbiddenMateMoves.length).toBe(0);
  });
});

// ===== Issue #82: 王手中のカード使用可否 (checkUsage フラグ) =====

describe("reducer / BEGIN_PLAY_CARD 王手中ガード (Issue #82 / checkUsage)", () => {
  // 9x9 空盤に玉と必要駒だけを置いた検証用 state を作る。
  // 後手の飛車で先手玉に王手をかけた状態を構築。
  // 1手で回避可能 (玉が逃げられる空きあり) なので、unconditional 前提も成立する。
  function makeCheckedState(extraSentePieces: { row: number; col: number; type: string }[] = []) {
    const board = Array.from({ length: 9 }, () =>
      Array<GameState["board"][number][number]>(9).fill(null),
    );
    board[8][4] = { type: "king", owner: "sente" };
    board[0][4] = { type: "king", owner: "gote" };
    // 後手飛車を先手玉と同列で離れた位置に配置 → 縦の王手
    board[5][4] = { type: "rook", owner: "gote" };
    for (const p of extraSentePieces) {
      board[p.row][p.col] = { type: p.type, owner: "sente" } as GameState["board"][number][number];
    }
    const gameState: GameState = {
      board,
      hand: { sente: {}, gote: {} },
      currentPlayer: "sente",
      moveHistory: [],
      positionHistory: [],
      status: "active",
      moveCount: 0,
    };
    return gameState;
  }

  it("forbidden (pawn_return): 王手中は state 不変 (動的判定スキップで非活性)", () => {
    // 自分の盤上に歩を置き CARD_USE_CONDITIONS は通る状態にしてから王手中ガードに到達
    const gs = makeCheckedState([{ row: 7, col: 0, type: "pawn" }]);
    const c = card("c1", "pawn_return");
    const state = makeInitialState(
      gs,
      makeInitialCardState({
        mana: { sente: 10, gote: 0 },
        hand: { sente: [c], gote: [] },
      }),
    );
    const next = reducer(state, {
      type: "BEGIN_PLAY_CARD",
      player: "sente",
      instanceId: c.instanceId,
    });
    expect(next).toBe(state);
  });

  it("forbidden (piece_return): 王手中は state 不変", () => {
    const gs = makeCheckedState([{ row: 7, col: 0, type: "gold" }]);
    const c = card("c1", "piece_return");
    const state = makeInitialState(
      gs,
      makeInitialCardState({
        mana: { sente: 10, gote: 0 },
        hand: { sente: [c], gote: [] },
      }),
    );
    const next = reducer(state, {
      type: "BEGIN_PLAY_CARD",
      player: "sente",
      instanceId: c.instanceId,
    });
    expect(next).toBe(state);
  });

  it("unconditional (double_move): 王手中でも使用可 (UI バグ regression test)", () => {
    // 王手中だが詰みではない (玉が 8,3 や 8,5 へ逃げられる) → 1手回避可能 → 2手以内回避は自明
    // checkUsage="unconditional" により動的判定をスキップし pendingCard が立つこと
    const gs = makeCheckedState();
    const c = card("dm1", "double_move");
    const state = makeInitialState(
      gs,
      makeInitialCardState({
        mana: { sente: 10, gote: 0 },
        hand: { sente: [c], gote: [] },
      }),
    );
    const next = reducer(state, {
      type: "BEGIN_PLAY_CARD",
      player: "sente",
      instanceId: c.instanceId,
    });
    expect(next.cardState.pendingCard?.instance.instanceId).toBe(c.instanceId);
    expect(next.cardState.pendingCard?.phase).toBe("confirm");
  });

  it("conditional (double_pawn): 王手中で合駒可能なら使用可 → pendingCard 設定", () => {
    // double_pawn は「自分の未成り歩がいる列」にしか歩を打てない。
    // 王手は後手飛車 (5,4) → 先手玉 (8,4) の縦の王手。合駒できる空マスは (6,4) (7,4)。
    // 列4に自歩がないと double_pawn の対象列にならないので、列4の安全な位置 (3,4) に
    // 自歩を置く (rook の下側ではないので check の経路に影響しない)。
    const gs = makeCheckedState([{ row: 3, col: 4, type: "pawn" }]);
    gs.hand.sente.pawn = 1;
    const c = card("dp1", "double_pawn");
    const state = makeInitialState(
      gs,
      makeInitialCardState({
        mana: { sente: 10, gote: 0 },
        hand: { sente: [c], gote: [] },
      }),
    );
    const next = reducer(state, {
      type: "BEGIN_PLAY_CARD",
      player: "sente",
      instanceId: c.instanceId,
    });
    expect(next.cardState.pendingCard?.instance.instanceId).toBe(c.instanceId);
  });

  it("forbidden (no_promote / trap): 王手中は state 不変", () => {
    const gs = makeCheckedState();
    const c = card("c1", "no_promote");
    const state = makeInitialState(
      gs,
      makeInitialCardState({
        mana: { sente: 10, gote: 0 },
        hand: { sente: [c], gote: [] },
      }),
    );
    const next = reducer(state, {
      type: "BEGIN_PLAY_CARD",
      player: "sente",
      instanceId: c.instanceId,
    });
    expect(next).toBe(state);
  });

  it("非王手時は checkUsage に関わらず使用可 (forbidden カードでも王手でなければ可)", () => {
    // 王手なしの初期局面で pawn_return を使う。盤上に自歩はある (createInitialGameState)
    const c = card("c1", "pawn_return");
    const state = makeInitialState(
      undefined,
      makeInitialCardState({
        mana: { sente: 10, gote: 0 },
        hand: { sente: [c], gote: [] },
      }),
    );
    const next = reducer(state, {
      type: "BEGIN_PLAY_CARD",
      player: "sente",
      instanceId: c.instanceId,
    });
    // pendingCard が立てばガード通過
    expect(next.cardState.pendingCard?.instance.instanceId).toBe(c.instanceId);
  });
});

// 全7カードに checkUsage が定義されていることを担保する型ガードテスト。
describe("CARD_DEFS / checkUsage 必須化 (Issue #82)", () => {
  it("全カード定義に有効な checkUsage 値が設定されている", async () => {
    const { ALL_CARD_DEFS } = await import("@/lib/shogi/cards/definitions");
    const valid = new Set(["forbidden", "conditional", "unconditional"]);
    for (const def of ALL_CARD_DEFS) {
      expect(valid.has(def.checkUsage)).toBe(true);
    }
  });

  it("trap カードはすべて checkUsage=forbidden で固定 (運用ルール)", async () => {
    const { ALL_CARD_DEFS } = await import("@/lib/shogi/cards/definitions");
    for (const def of ALL_CARD_DEFS) {
      if (def.kind === "trap") {
        expect(def.checkUsage).toBe("forbidden");
      }
    }
  });
});
