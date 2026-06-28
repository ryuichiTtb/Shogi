// Issue #235 S1a (part2): world-kernel.ts の applyTurnAction が reducer 経路と振る舞い等価で
// あることを検証する property-based 等価テスト。
//
// 位置づけ (S1 計画 docs/plans/issue-235-s1-kernel.md §7 / epic §8.3.4):
//   S1a part1 で新設した applyTurnAction (production 未配線) の唯一の正当性検証。これが green に
//   なるまで applyTurnAction は「未検証・production 未配線」扱い。S1a は additive のみのため、
//   reducer は完全不変 = 本テストは「既存 reducer 経路 vs 新カーネル経路」の独立2実装の等価検証
//   (= 委譲で自明ではなく真の regression guard。flip / turn-end / finalize 合成の orchestration 差を検出)。
//
// 方式 (依存追加なし):
//   - fast-check は使わず、hand-rolled seeded PRNG (mulberry32) + 手書き generator で完結 (AGENTS.md §7)。
//   - seeded WorldState から各ステップで合法 TurnAction を seeded PRNG で 1 つ選び、reducer (dispatch 駆動)
//     と applyTurnAction の両方へ同一 action を適用し、§8.3.1 の must-match 12 射影を deep-equal 比較。
//
// 決定論化 (DP-4):
//   - spectatorMode=true 固定 → 早指しボーナス無効 (fastMove=false 確定) で mana 増分が決定的。
//   - event の `at` (Date.now()) と manaChargeEvent は射影から除外するため Date.now stub は不要。
//
// 射影 (must-match):
//   - gameState 全体 (board 駒種/owner/promoted + 取り駒 hand + currentPlayer + status + winner +
//     moveCount + moveHistory + positionHistory = zobrist 相当を包含) を deep-equal。
//   - cardState の {mana, manaCap, hand[順序], deck[順序], graveyard[順序], trap, noPromoteMarks[{row,col}集合 DP-5],
//     drawProgress}。must-not-match (pendingCard / lastTurnStartedAt / 演出flag / UI / undoSnapshots) は捨象。
//   - events (kind + ドメインフィールド、`at` 除外・manaChargeEvent 除外 DP-4)。
//
// 王手中のカード/ドロー使用は本ランダム harness では生成しない (王手中 card は reducer 側で
// 「BEGIN 通過後 CONFIRM 最終ガードで no-op (pendingCard 残置)」など中間状態が絡み、射影は一致するが
// 生成器の決定性確保が煩雑なため)。王手回避以外のカードはそもそも reducer が拒否する。王手中 double_move
// (checkUsage="unconditional") の等価は末尾 targeted describe で固定盤面により別途 pin する。
//
// 終局 (status≠active) 系の合成分岐 (advanceDrawProgress の status guard / double_move 1手目詰みの即
// finalize) と DP-5×カード (removeNoPromoteMark) / DP-7 (check_break defer→2手目発火) も、ランダム
// harness が現実的に到達しないため末尾 targeted describe で固定盤面により pin する (実装後レビュー反映)。

import { describe, expect, it } from "vitest";

import {
  applyMove,
  createInitialGameState,
  serializePosition,
} from "@/lib/shogi/board";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";
import { getFullLegalMoves, isCheckmate, isInCheck } from "@/lib/shogi/moves";
import { MANA_CAP } from "@/lib/shogi/cards/definitions";
import { CARD_DEFS } from "@/lib/shogi/cards/definitions";
import { getCardActions } from "@/lib/shogi/ai/turn/action-generator";
import { canDraw } from "@/lib/shogi/ai/turn/current-rules";
import type { TurnAction, AiTurnState } from "@/lib/shogi/ai/turn/types";
import type {
  Board,
  GameState,
  Move,
  PieceType,
  Player,
} from "@/lib/shogi/types";
import type {
  CardGameState,
  CardId,
  CardInstance,
  GameEvent,
  TrapInstance,
} from "@/lib/shogi/cards/types";

import {
  reducer,
  type Action,
  type CardShogiGameStateInternal,
} from "@/hooks/card-shogi/reducer";
import { applyTurnAction, type WorldState } from "../world-kernel";

// ===== seeded PRNG (Mulberry32、scripts/utils/prng.ts と同一実装をインライン) =====
// 外部依存・cross-boundary import を避けるため 10 行をインライン化する (AGENTS.md §7)。

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

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

// ===== 決定論的な初期 CardGameState 構築 =====
// createInitialCardState は Math.random でシャッフルするため非決定的。seed 駆動で同一の山札/手札を
// 2 回構築できる自前 builder を使う (reducer 経路・カーネル経路それぞれに独立コピーを渡す)。

// mana_up (deprecated) を除く全カードを混ぜたデッキ構成。double_move / トラップ / modifyBoard を網羅。
const DECK_SPEC: ReadonlyArray<{ defId: CardId; count: number }> = [
  { defId: "pawn_return", count: 2 },
  { defId: "piece_return", count: 1 },
  { defId: "no_promote", count: 2 },
  { defId: "check_break", count: 2 },
  { defId: "double_move", count: 3 },
  { defId: "double_pawn", count: 1 },
];

function buildDeckDeterministic(
  player: Player,
  rng: () => number,
): CardInstance[] {
  const cards: CardInstance[] = [];
  let counter = 0;
  for (const { defId, count } of DECK_SPEC) {
    for (let i = 0; i < count; i++) {
      counter++;
      cards.push({ instanceId: `${player}-${defId}-${counter}`, defId });
    }
  }
  // seeded Fisher-Yates
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

function buildCardState(seed: number): CardGameState {
  const rng = mulberry32(seed);
  const senteDeck = buildDeckDeterministic("sente", rng);
  const goteDeck = buildDeckDeterministic("gote", rng);
  const senteHand = senteDeck.splice(0, 2);
  const goteHand = goteDeck.splice(0, 2);
  // カード経路を厚く踏むため初期マナを高めに振る (double_move=5 を即使用できる水準)。
  const baseMana = Math.min(8 + (seed % 11), MANA_CAP);
  return {
    mana: { sente: baseMana, gote: Math.min(baseMana + 1, MANA_CAP) },
    manaCap: MANA_CAP,
    hand: { sente: senteHand, gote: goteHand },
    deck: { sente: senteDeck, gote: goteDeck },
    graveyard: { sente: [], gote: [] },
    trap: { sente: null, gote: null },
    pendingCard: null,
    lastTurnStartedAt: { sente: null, gote: null },
    noPromoteMarks: { sente: [], gote: [] },
    // 自動ドロー境界 (4→5) を早期に踏ませるため seed で 0..4 に散らす。
    drawProgress: { sente: seed % 5, gote: (seed * 3 + 1) % 5 },
  };
}

function makeReducerState(
  gameState: GameState,
  cardState: CardGameState,
): CardShogiGameStateInternal {
  return {
    gameState,
    selectedSquare: null,
    selectedHandPiece: null,
    legalMoves: [],
    forbiddenMateMoves: [],
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
    lastActionHighlights: [],
    undoSnapshots: [],
    spectatorMode: true, // DP-4 決定論化
    isPaused: false,
  };
}

function makeWorld(gameState: GameState, cardState: CardGameState): WorldState {
  return { gameState, cardState, doubleMove: null };
}

// ===== reducer 経路の駆動 (dispatch 列) =====
// 1 つの TurnAction を reducer の演出フェーズ分割に展開して適用し、演出 flag を精算して安定状態に落とす。
// 戻り値: 適用後 state と、この適用で eventLog に積まれた差分イベント。

function dispatch(
  state: CardShogiGameStateInternal,
  action: Action,
): CardShogiGameStateInternal {
  return reducer(state, action);
}

// 演出フェーズ flag を精算して安定状態へ。
// - isPlayingCard: COMMIT_PLAY_CARD (flip + drawProgress、double_move finalize 経路も含む)
// - isDrawing: COMMIT_DRAW (manual は flip+turnEnd、auto は flag cleanup。manual→auto 連鎖を drain)
// - isCheckBreakAnimating: COMMIT_CHECK_BREAK (flag cleanup)
function settleAnimations(
  state: CardShogiGameStateInternal,
): CardShogiGameStateInternal {
  let s = state;
  if (s.isPlayingCard) s = dispatch(s, { type: "COMMIT_PLAY_CARD" });
  let guard = 0;
  while (s.isDrawing && guard++ < 4) s = dispatch(s, { type: "COMMIT_DRAW" });
  if (s.isCheckBreakAnimating) s = dispatch(s, { type: "COMMIT_CHECK_BREAK" });
  return s;
}

function applyToReducer(
  state: CardShogiGameStateInternal,
  action: TurnAction,
): { state: CardShogiGameStateInternal; events: GameEvent[] } {
  const prevLen = state.eventLog.length;
  let s = state;

  if (action.kind === "move") {
    s = dispatch(s, { type: "MAKE_MOVE", move: action.move });
    s = settleAnimations(s);
  } else if (action.kind === "draw") {
    const player = state.gameState.currentPlayer;
    s = dispatch(s, { type: "DRAW_CARD", player });
    s = settleAnimations(s);
  } else {
    const player = state.gameState.currentPlayer;
    const def = CARD_DEFS[action.defId];
    s = dispatch(s, {
      type: "BEGIN_PLAY_CARD",
      player,
      instanceId: action.cardInstanceId,
    });
    s = dispatch(s, { type: "CONFIRM_PLAY_CARD" });
    if (action.defId === "double_move") {
      // ターン継続 (1手目・2手目は後続の move TurnAction として別ステップで処理)。COMMIT しない。
    } else {
      // targeting あり (modifyBoard) は CONFIRM で selectTarget フェーズへ → SELECT_CARD_TARGET で効果適用。
      // targeting=none (trap / mana_up) は CONFIRM で効果適用済。
      if (def.targeting !== "none" && def.kind !== "trap") {
        if (!action.target)
          throw new Error("targeted card action requires target");
        s = dispatch(s, { type: "SELECT_CARD_TARGET", target: action.target });
      }
      s = settleAnimations(s);
    }
  }

  return { state: s, events: s.eventLog.slice(prevLen) };
}

// ===== 合法 TurnAction 生成 =====

function legalActions(world: WorldState): TurnAction[] {
  const gs = world.gameState;
  if (gs.status !== "active") return [];
  const player = gs.currentPlayer;
  const moves = getFullLegalMoves(gs, player, CARD_SHOGI_VARIANT);
  const moveActions: TurnAction[] = moves.map((move) => ({
    kind: "move",
    move,
  }));

  // double_move 継続中は move のみ (1手目/2手目)。
  if (world.doubleMove) return moveActions;

  const cardActions: TurnAction[] = [];
  // 王手中はドロー禁止 (reducer DRAW_CARD ガード) + カード使用は中間 no-op が絡むため harness では除外。
  if (!isInCheck(gs, player, CARD_SHOGI_VARIANT)) {
    if (canDraw(world.cardState, player)) cardActions.push({ kind: "draw" });
    const aiState: AiTurnState = {
      gameState: gs,
      cardState: world.cardState,
      doubleMove: null,
    };
    for (const ca of getCardActions(aiState, player, CARD_SHOGI_VARIANT))
      cardActions.push(ca);
  }
  return [...moveActions, ...cardActions];
}

// move / card を程よく混ぜて選択 (カード経路を厚く踏むため card に bias)。
function chooseAction(rng: () => number, world: WorldState): TurnAction | null {
  if (world.doubleMove) {
    const moves = getFullLegalMoves(
      world.gameState,
      world.gameState.currentPlayer,
      CARD_SHOGI_VARIANT,
    );
    if (moves.length === 0) return null;
    return { kind: "move", move: pick(rng, moves) };
  }
  const all = legalActions(world);
  if (all.length === 0) return null;
  const cards = all.filter((a) => a.kind !== "move");
  const moves = all.filter((a) => a.kind === "move");
  if (cards.length > 0 && (moves.length === 0 || rng() < 0.5))
    return pick(rng, cards);
  if (moves.length === 0) return pick(rng, cards);
  return pick(rng, moves);
}

// ===== 射影 =====

function sortMarks(
  marks: ReadonlyArray<{ row: number; col: number }>,
): Array<{ row: number; col: number }> {
  return [...marks].sort((a, b) => a.row - b.row || a.col - b.col);
}

function projectCardState(cs: CardGameState) {
  return {
    mana: cs.mana,
    manaCap: cs.manaCap,
    hand: cs.hand, // instanceId 順序込み
    deck: cs.deck, // 順序込み
    graveyard: cs.graveyard, // 順序込み
    trap: cs.trap, // {instanceId, defId, owner} | null
    noPromoteMarks: {
      sente: sortMarks(cs.noPromoteMarks.sente), // DP-5: {row,col} 集合一致
      gote: sortMarks(cs.noPromoteMarks.gote),
    },
    drawProgress: cs.drawProgress,
  };
}

// event 射影: `at` (Date.now) を全階層から除去 + manaChargeEvent を除外 (DP-4)。
// instance/target/capturedPieces 等のドメインフィールドは両経路で構造一致 (kernel/reducer 検証済) のため残す。
function stripAt(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripAt);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (k === "at") continue;
      out[k] = stripAt(val);
    }
    return out;
  }
  return v;
}

function projectEvents(events: GameEvent[]): unknown[] {
  return events
    .filter((e) => e.kind !== "manaChargeEvent")
    .map((e) => stripAt(e));
}

// ===== 等価比較 =====

function expectEquivalent(
  rstate: CardShogiGameStateInternal,
  world: WorldState,
  rEvents?: GameEvent[],
  kEvents?: GameEvent[],
): void {
  // gameState 全体 (board/取り駒hand/currentPlayer/status/winner/moveCount/moveHistory/positionHistory)。
  expect(world.gameState).toEqual(rstate.gameState);
  // cardState 12 射影。
  expect(projectCardState(world.cardState)).toEqual(
    projectCardState(rstate.cardState),
  );
  // events (差分) 射影。
  if (rEvents && kEvents) {
    expect(projectEvents(kEvents)).toEqual(projectEvents(rEvents));
  }
  // サニティ不変量 (DP-6 mana∈[0,manaCap] / drawProgress≥0)。
  for (const p of ["sente", "gote"] as const) {
    expect(world.cardState.mana[p]).toBeGreaterThanOrEqual(0);
    expect(world.cardState.mana[p]).toBeLessThanOrEqual(
      world.cardState.manaCap,
    );
    expect(world.cardState.drawProgress[p]).toBeGreaterThanOrEqual(0);
  }
}

// ===== ランダム等価 harness =====

describe("world-kernel applyTurnAction ≡ reducer 経路 (property-based 等価)", () => {
  const SEEDS = 180;
  const MAX_PLIES = 40;
  // property テストは多数の局面を回すため vitest 既定 5s を超える。決定的・非 flaky なので
  // 余裕を持たせた明示 timeout を与える (実測 ~6s、CI でも安定動作する 30s に設定)。
  const HARNESS_TIMEOUT_MS = 30_000;

  it(
    `${SEEDS} seed × 最大 ${MAX_PLIES} ply のランダム対局で全ステップ等価`,
    () => {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const rng = mulberry32(seed * 2654435761);
        const gs0 = createInitialGameState(CARD_SHOGI_VARIANT);
        // reducer 経路・カーネル経路に独立コピーを渡す (両者とも immutable 更新だが念のため分離)。
        let rstate = makeReducerState(
          createInitialGameState(CARD_SHOGI_VARIANT),
          buildCardState(seed),
        );
        let world = makeWorld(gs0, buildCardState(seed));

        // 初期状態が等価であること。
        expectEquivalent(rstate, world);

        for (let ply = 0; ply < MAX_PLIES; ply++) {
          if (world.gameState.status !== "active") break;
          const action = chooseAction(rng, world);
          if (!action) break;

          const before = world.gameState.currentPlayer;
          const r = applyToReducer(rstate, action);
          const k = applyTurnAction(world, action, { spectatorMode: true });

          expectEquivalent(r.state, k.world, r.events, k.events);

          // turnEnded は「currentPlayer 反転」の射影 (DP-2)。
          const flipped = before !== k.world.gameState.currentPlayer;
          expect(k.turnEnded).toBe(flipped);

          // doubleMove 継続状態の同期 (KernelDoubleMove vs reducer doubleMove)。
          expect(!!k.world.doubleMove).toBe(!!r.state.doubleMove);
          if (k.world.doubleMove && r.state.doubleMove) {
            expect(k.world.doubleMove.movesLeft).toBe(
              r.state.doubleMove.movesLeft,
            );
            expect(k.world.doubleMove.active).toBe(r.state.doubleMove.active);
            // 遅延消費パラメータ (finalize で使う instanceId / cost) も同期していること (OBS4-5)。
            expect(k.world.doubleMove.cardInstance.instanceId).toBe(
              r.state.doubleMove.cardInstance.instanceId,
            );
            expect(k.world.doubleMove.cardCost).toBe(
              r.state.doubleMove.cardCost,
            );
          }

          rstate = r.state;
          world = k.world;
        }
      }
    },
    HARNESS_TIMEOUT_MS,
  );
});

// ===== targeted エッジケース (DP-1〜7 を明示値で固定) =====
// ランダム harness が「reducer ≡ kernel」を保証するのに対し、こちらは各 DP の期待値そのものを pin する
// (両経路が同時に同じ間違いをするケースを防ぐ spec チェック)。

describe("world-kernel applyTurnAction — DP 固定 (targeted)", () => {
  // 共通: 単一 TurnAction を両経路に適用して比較し、カーネル結果を返すヘルパ。
  function applyBoth(
    rstate: CardShogiGameStateInternal,
    world: WorldState,
    action: TurnAction,
  ) {
    const r = applyToReducer(rstate, action);
    const k = applyTurnAction(world, action, { spectatorMode: true });
    expectEquivalent(r.state, k.world, r.events, k.events);
    return { r, k };
  }

  it("DP-1: 通常 move でターン終了 drawProgress +1 (境界未満)", () => {
    const cs = buildCardState(101);
    cs.drawProgress = { sente: 1, gote: 0 };
    const gs = createInitialGameState(CARD_SHOGI_VARIANT);
    const rstate = makeReducerState(
      createInitialGameState(CARD_SHOGI_VARIANT),
      buildCardState(101),
    );
    rstate.cardState.drawProgress = { sente: 1, gote: 0 };
    const world = makeWorld(gs, cs);

    const moves = getFullLegalMoves(gs, "sente", CARD_SHOGI_VARIANT);
    const { k } = applyBoth(rstate, world, { kind: "move", move: moves[0] });

    expect(k.world.cardState.drawProgress.sente).toBe(2); // +1
    expect(k.world.gameState.currentPlayer).toBe("gote"); // flip
    expect(k.turnEnded).toBe(true);
  });

  it("DP-1: 自動ドロー境界 (drawProgress 4→5) で 0 reset + auto-draw 1 枚", () => {
    const gs = createInitialGameState(CARD_SHOGI_VARIANT);
    const csR = buildCardState(102);
    csR.drawProgress = { sente: 4, gote: 0 };
    const rstate = makeReducerState(
      createInitialGameState(CARD_SHOGI_VARIANT),
      csR,
    );
    const csK = buildCardState(102);
    csK.drawProgress = { sente: 4, gote: 0 };
    const world = makeWorld(gs, csK);

    const deckBefore = world.cardState.deck.sente.length;
    const handBefore = world.cardState.hand.sente.length;
    const topCard = world.cardState.deck.sente[0];

    const moves = getFullLegalMoves(gs, "sente", CARD_SHOGI_VARIANT);
    const { k } = applyBoth(rstate, world, { kind: "move", move: moves[0] });

    expect(k.world.cardState.drawProgress.sente).toBe(0); // reset
    expect(k.world.cardState.deck.sente.length).toBe(deckBefore - 1);
    expect(k.world.cardState.hand.sente.length).toBe(handBefore + 1);
    expect(k.world.cardState.hand.sente[handBefore]).toEqual(topCard); // 山札先頭が手札末尾へ
    // auto drawEvent が出る。
    const drawEvents = k.events.filter((e) => e.kind === "drawEvent");
    expect(drawEvents).toHaveLength(1);
    expect(
      (drawEvents[0] as Extract<GameEvent, { kind: "drawEvent" }>).source,
    ).toBe("auto");
  });

  it("DP-1: 山札空で境界到達しても発火せず drawProgress は 5 へ加算 (reset しない)", () => {
    const gs = createInitialGameState(CARD_SHOGI_VARIANT);
    const csR = buildCardState(103);
    csR.deck = { sente: [], gote: csR.deck.gote };
    csR.drawProgress = { sente: 4, gote: 0 };
    const rstate = makeReducerState(
      createInitialGameState(CARD_SHOGI_VARIANT),
      csR,
    );
    const csK = buildCardState(103);
    csK.deck = { sente: [], gote: csK.deck.gote };
    csK.drawProgress = { sente: 4, gote: 0 };
    const world = makeWorld(gs, csK);

    const moves = getFullLegalMoves(gs, "sente", CARD_SHOGI_VARIANT);
    const { k } = applyBoth(rstate, world, { kind: "move", move: moves[0] });

    expect(k.world.cardState.drawProgress.sente).toBe(5); // reset せず加算
    expect(k.world.cardState.hand.sente.length).toBe(
      world.cardState.hand.sente.length,
    ); // 不変
    expect(k.events.filter((e) => e.kind === "drawEvent")).toHaveLength(0);
  });

  it("DP-1: 手動ドロー → manual + 連鎖 auto-draw (drawProgress 4 起点で 2 枚増える)", () => {
    // canDraw は drawProgress<4 を要求するが、reducer DRAW_CARD 自体は drawProgress に依存しないため
    // drawProgress=4 起点の manual→auto 連鎖を直接構築して検証する。
    const gs = createInitialGameState(CARD_SHOGI_VARIANT);
    const csR = buildCardState(104);
    csR.mana = { sente: 5, gote: 5 };
    csR.drawProgress = { sente: 4, gote: 0 };
    const rstate = makeReducerState(
      createInitialGameState(CARD_SHOGI_VARIANT),
      csR,
    );
    const csK = buildCardState(104);
    csK.mana = { sente: 5, gote: 5 };
    csK.drawProgress = { sente: 4, gote: 0 };
    const world = makeWorld(gs, csK);

    const handBefore = world.cardState.hand.sente.length;
    const { k } = applyBoth(rstate, world, { kind: "draw" });

    expect(k.world.cardState.mana.sente).toBe(3); // -DRAW_COST(2)
    expect(k.world.cardState.hand.sente.length).toBe(handBefore + 2); // manual + auto
    expect(k.world.cardState.drawProgress.sente).toBe(0); // 連鎖 auto で reset
    expect(k.world.gameState.currentPlayer).toBe("gote"); // flip
    const drawEvents = k.events.filter((e) => e.kind === "drawEvent") as Array<
      Extract<GameEvent, { kind: "drawEvent" }>
    >;
    expect(drawEvents.map((e) => e.source)).toEqual(["manual", "auto"]);
  });

  it("DP-3: トラップ設置は hand→trap (graveyard 不変) + mana-=cost", () => {
    const gs = createInitialGameState(CARD_SHOGI_VARIANT);
    // 手札に check_break を確定配置 (cost 4)。
    const trapCard: CardInstance = {
      instanceId: "sente-check_break-x",
      defId: "check_break",
    };
    const csR = buildCardState(105);
    csR.hand = { sente: [trapCard], gote: csR.hand.gote };
    csR.mana = { sente: 6, gote: 6 };
    csR.drawProgress = { sente: 0, gote: 0 };
    const rstate = makeReducerState(
      createInitialGameState(CARD_SHOGI_VARIANT),
      csR,
    );
    const csK = buildCardState(105);
    csK.hand = { sente: [{ ...trapCard }], gote: csK.hand.gote };
    csK.mana = { sente: 6, gote: 6 };
    csK.drawProgress = { sente: 0, gote: 0 };
    const world = makeWorld(gs, csK);

    const { k } = applyBoth(rstate, world, {
      kind: "playCard",
      cardInstanceId: trapCard.instanceId,
      defId: "check_break",
    });

    expect(k.world.cardState.trap.sente).toEqual({
      instanceId: trapCard.instanceId,
      defId: "check_break",
      owner: "sente",
    });
    expect(k.world.cardState.hand.sente).toHaveLength(0); // hand から除去
    expect(k.world.cardState.graveyard.sente).toHaveLength(0); // DP-3: graveyard 不変
    expect(k.world.cardState.mana.sente).toBe(2); // 6 - 4
    expect(k.world.cardState.drawProgress.sente).toBe(1); // turn-end +1
    expect(k.world.gameState.currentPlayer).toBe("gote"); // flip
    const ev = k.events.find((e) => e.kind === "trapSetEvent");
    expect(ev).toBeDefined();
  });

  it("DP-3: modifyBoard (pawn_return) は盤上歩→取り駒 + card hand→graveyard + mana-=cost", () => {
    const gs = createInitialGameState(CARD_SHOGI_VARIANT);
    const pawnCard: CardInstance = {
      instanceId: "sente-pawn_return-x",
      defId: "pawn_return",
    };
    const csR = buildCardState(106);
    csR.hand = { sente: [pawnCard], gote: csR.hand.gote };
    csR.mana = { sente: 5, gote: 5 };
    csR.drawProgress = { sente: 0, gote: 0 };
    const rstate = makeReducerState(
      createInitialGameState(CARD_SHOGI_VARIANT),
      csR,
    );
    const csK = buildCardState(106);
    csK.hand = { sente: [{ ...pawnCard }], gote: csK.hand.gote };
    csK.mana = { sente: 5, gote: 5 };
    csK.drawProgress = { sente: 0, gote: 0 };
    const world = makeWorld(gs, csK);

    // 先手の歩 (初期配置 row=6 のいずれか) を対象に戻す。
    const target = { kind: "square" as const, row: 6, col: 4 };
    expect(gs.board[6][4]?.type).toBe("pawn"); // 前提確認

    const { k } = applyBoth(rstate, world, {
      kind: "playCard",
      cardInstanceId: pawnCard.instanceId,
      defId: "pawn_return",
      target,
    });

    expect(k.world.gameState.board[6][4]).toBeNull(); // 盤上から除去
    expect(k.world.gameState.hand.sente["pawn"]).toBe(1); // 取り駒へ
    expect(k.world.cardState.hand.sente).toHaveLength(0);
    expect(k.world.cardState.graveyard.sente).toHaveLength(1); // hand→graveyard
    expect(k.world.cardState.graveyard.sente[0].defId).toBe("pawn_return");
    expect(k.world.cardState.mana.sente).toBe(4); // 5 - 1
    expect(k.world.cardState.drawProgress.sente).toBe(1);
    expect(k.world.gameState.currentPlayer).toBe("gote");
  });

  it("DP-2: double_move は CONFIRM=遅延消費 / 2手目 finalize で hand→graveyard + drawProgress+1", () => {
    const gs = createInitialGameState(CARD_SHOGI_VARIANT);
    const dmCard: CardInstance = {
      instanceId: "sente-double_move-x",
      defId: "double_move",
    };
    const csR = buildCardState(107);
    csR.hand = { sente: [dmCard], gote: csR.hand.gote };
    csR.mana = { sente: 8, gote: 8 };
    csR.drawProgress = { sente: 0, gote: 0 };
    const rstate = makeReducerState(
      createInitialGameState(CARD_SHOGI_VARIANT),
      csR,
    );
    const csK = buildCardState(107);
    csK.hand = { sente: [{ ...dmCard }], gote: csK.hand.gote };
    csK.mana = { sente: 8, gote: 8 };
    csK.drawProgress = { sente: 0, gote: 0 };
    let world = makeWorld(gs, csK);
    let rcur = rstate;

    // (1) playCard double_move: フラグ set のみ・mana/hand/graveyard 不変・turnEnded=false。
    {
      const action: TurnAction = {
        kind: "playCard",
        cardInstanceId: dmCard.instanceId,
        defId: "double_move",
      };
      const r = applyToReducer(rcur, action);
      const k = applyTurnAction(world, action, { spectatorMode: true });
      expectEquivalent(r.state, k.world, r.events, k.events);
      expect(k.turnEnded).toBe(false);
      expect(k.world.gameState.currentPlayer).toBe("sente"); // 反転しない
      expect(k.world.cardState.mana.sente).toBe(8); // 遅延消費 = 不変
      expect(k.world.cardState.hand.sente).toHaveLength(1); // 不変
      expect(k.world.cardState.graveyard.sente).toHaveLength(0);
      expect(k.world.doubleMove?.movesLeft).toBe(2);
      rcur = r.state;
      world = k.world;
    }

    // (2) 1手目: currentPlayer は sente のまま・turnEnded=false・movesLeft 2→1・drawProgress 不変。
    {
      const moves1 = getFullLegalMoves(
        world.gameState,
        "sente",
        CARD_SHOGI_VARIANT,
      );
      const action: TurnAction = { kind: "move", move: moves1[0] };
      const r = applyToReducer(rcur, action);
      const k = applyTurnAction(world, action, { spectatorMode: true });
      expectEquivalent(r.state, k.world, r.events, k.events);
      expect(k.turnEnded).toBe(false);
      expect(k.world.gameState.currentPlayer).toBe("sente");
      expect(k.world.doubleMove?.movesLeft).toBe(1);
      expect(k.world.cardState.drawProgress.sente).toBe(0); // 継続中は加算なし
      expect(k.world.cardState.mana.sente).toBe(8); // チャージなし
      rcur = r.state;
      world = k.world;
    }

    // (3) 2手目: finalize で hand→graveyard + mana-=5 + cardPlayEvent + drawProgress+1 + flip。
    {
      const moves2 = getFullLegalMoves(
        world.gameState,
        "sente",
        CARD_SHOGI_VARIANT,
      );
      const action: TurnAction = { kind: "move", move: moves2[0] };
      const r = applyToReducer(rcur, action);
      const k = applyTurnAction(world, action, { spectatorMode: true });
      expectEquivalent(r.state, k.world, r.events, k.events);
      expect(k.turnEnded).toBe(true);
      expect(k.world.gameState.currentPlayer).toBe("gote"); // flip
      expect(k.world.doubleMove).toBeNull();
      expect(k.world.cardState.mana.sente).toBe(3); // 8 - 5 (遅延消費)
      expect(k.world.cardState.hand.sente).toHaveLength(0);
      expect(k.world.cardState.graveyard.sente).toHaveLength(1);
      expect(k.world.cardState.graveyard.sente[0].defId).toBe("double_move");
      expect(k.world.cardState.drawProgress.sente).toBe(1); // 2手目完了で +1 (1回のみ)
      const cardPlay = k.events.filter((e) => e.kind === "cardPlayEvent");
      expect(cardPlay).toHaveLength(1);
    }
  });
});

// ===== 終局・カード×マーク・DP-7 (targeted、実装後レビュー反映) =====
// マイルストーン2 adversarial レビュー (16 findings / 11 confirmed) で「計画 §8.3.4 の必須エッジ
// (終局手後 turn-end スキップ / double_move 1手目詰み / removeNoPromoteMark / check_break defer→2手目発火 /
// 捕獲駒の no_promote マーク削除) が random でも targeted でも未踏」と判明したため追加。
// これらは applyTurnAction の固有合成分岐 (world-kernel.ts:88 status guard / 258-274 double_move 詰み即
// finalize) を踏み、reducer 経路との等価を pin する。固定盤面で構築するため決定的。

// 空の 9×9 盤を生成。
function emptyBoard(): Board {
  return Array.from({ length: 9 }, () =>
    Array.from({ length: 9 }, () => null as Board[number][number]),
  );
}

function pc(type: PieceType, owner: Player) {
  return { type, owner };
}

// 固定盤面の GameState を構築 (positionHistory は serializePosition で初期化、千日手誤検出を避ける)。
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

// targeted 用の最小 CardGameState。
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

// 単一 TurnAction を両経路に適用して等価比較し、カーネル結果を返す (module-level 版)。
function applyAndCompare(
  rstate: CardShogiGameStateInternal,
  world: WorldState,
  action: TurnAction,
) {
  const r = applyToReducer(rstate, action);
  const k = applyTurnAction(world, action, { spectatorMode: true });
  expectEquivalent(r.state, k.world, r.events, k.events);
  return { r, k };
}

// 頭金 (head-gold) 詰み盤: 後手玉(0,4) を、先手金(2,4)→(1,4) で詰ます。金は先手飛(8,4)が支える。
// 先手玉(8,8) を置いて盤面を well-formed に保つ。後手は玉のみ = 合駒・取りで回避不可。
const placeHeadGoldMate = (b: Board) => {
  b[0][4] = pc("king", "gote");
  b[2][4] = pc("gold", "sente");
  b[8][4] = pc("rook", "sente");
  b[8][8] = pc("king", "sente");
};
const HEAD_GOLD_MATE_MOVE: Move = {
  type: "move",
  from: { row: 2, col: 4 },
  to: { row: 1, col: 4 },
  piece: "gold",
  player: "sente",
};

describe("world-kernel applyTurnAction — 終局・マーク・DP-7 (targeted)", () => {
  it("前提: head-gold 盤で金(2,4)→(1,4) は後手玉を詰ます", () => {
    const gs = buildGameState(placeHeadGoldMate, "sente");
    expect(isInCheck(gs, "gote", CARD_SHOGI_VARIANT)).toBe(false); // 手前は王手でない
    const after = applyMove(gs, HEAD_GOLD_MATE_MOVE);
    expect(isCheckmate(after, "gote", CARD_SHOGI_VARIANT)).toBe(true);
  });

  it("終局: 通常 move で詰ます手は turn-end をスキップ (drawProgress 境界でも reset/auto-draw しない)", () => {
    // drawProgress=4 起点でも、詰む手では advanceDrawProgress (world-kernel.ts:88) が status≠active で no-op。
    const rstate = makeReducerState(
      buildGameState(placeHeadGoldMate, "sente"),
      minimalCardState({ drawProgress: { sente: 4, gote: 0 } }),
    );
    const world = makeWorld(
      buildGameState(placeHeadGoldMate, "sente"),
      minimalCardState({ drawProgress: { sente: 4, gote: 0 } }),
    );

    const { k } = applyAndCompare(rstate, world, {
      kind: "move",
      move: HEAD_GOLD_MATE_MOVE,
    });

    expect(k.world.gameState.status).toBe("checkmate");
    expect(k.world.gameState.winner).toBe("sente");
    expect(k.world.gameState.currentPlayer).toBe("gote"); // flip
    expect(k.turnEnded).toBe(true);
    // 終局でドロー進捗は加算されない (境界 4 のままで reset/auto-draw なし)。
    expect(k.world.cardState.drawProgress.sente).toBe(4);
    expect(k.events.filter((e) => e.kind === "drawEvent")).toHaveLength(0);
  });

  it("終局: double_move 1手目で詰むと即 finalize (flip 戻さず・カード消費・drawProgress スキップ)", () => {
    // world-kernel.ts:258-274 の double_move 1手目詰み専用分岐を踏む。
    const dmCard: CardInstance = {
      instanceId: "sente-double_move-mate",
      defId: "double_move",
    };
    const rstate = makeReducerState(
      buildGameState(placeHeadGoldMate, "sente"),
      minimalCardState({
        hand: { sente: [dmCard], gote: [] },
        mana: { sente: 8, gote: 8 },
        drawProgress: { sente: 4, gote: 0 },
      }),
    );
    let world = makeWorld(
      buildGameState(placeHeadGoldMate, "sente"),
      minimalCardState({
        hand: { sente: [{ ...dmCard }], gote: [] },
        mana: { sente: 8, gote: 8 },
        drawProgress: { sente: 4, gote: 0 },
      }),
    );
    let rcur = rstate;

    // (1) double_move 発動 (遅延消費 → mana/hand 不変、継続)。
    {
      const action: TurnAction = {
        kind: "playCard",
        cardInstanceId: dmCard.instanceId,
        defId: "double_move",
      };
      const { r, k } = applyAndCompare(rcur, world, action);
      expect(k.turnEnded).toBe(false);
      expect(k.world.doubleMove?.movesLeft).toBe(2);
      expect(k.world.cardState.mana.sente).toBe(8);
      rcur = r.state;
      world = k.world;
    }

    // (2) 1手目 = 詰み手。即 finalize で turn 終了。
    {
      const action: TurnAction = { kind: "move", move: HEAD_GOLD_MATE_MOVE };
      const { k } = applyAndCompare(rcur, world, action);
      expect(k.world.gameState.status).toBe("checkmate");
      expect(k.world.gameState.winner).toBe("sente");
      expect(k.turnEnded).toBe(true);
      expect(k.world.gameState.currentPlayer).toBe("gote"); // 詰みでは flip 戻さない (applyMove の flip を維持)
      expect(k.world.doubleMove).toBeNull();
      // double_move カードは詰み finalize で消費される (DP-2 遅延消費)。
      expect(k.world.cardState.mana.sente).toBe(3); // 8 - 5
      expect(k.world.cardState.hand.sente).toHaveLength(0);
      expect(k.world.cardState.graveyard.sente.map((c) => c.defId)).toEqual([
        "double_move",
      ]);
      // 終局なので drawProgress は加算されない (境界 4 のまま)。
      expect(k.world.cardState.drawProgress.sente).toBe(4);
      const cardPlay = k.events.filter((e) => e.kind === "cardPlayEvent");
      expect(cardPlay).toHaveLength(1);
      expect(k.events.filter((e) => e.kind === "drawEvent")).toHaveLength(0);
    }
  });

  it("DP-5×カード: pawn_return で戻した駒の no_promote マークが消える", () => {
    const pawnCard: CardInstance = {
      instanceId: "sente-pawn_return-mk",
      defId: "pawn_return",
    };
    const placePawn = (b: Board) => {
      b[0][0] = pc("king", "gote");
      b[8][8] = pc("king", "sente");
      b[5][4] = pc("pawn", "sente"); // マーク付き歩
    };
    const csOver = {
      hand: { sente: [pawnCard], gote: [] as CardInstance[] },
      mana: { sente: 5, gote: 5 },
      noPromoteMarks: { sente: [{ row: 5, col: 4 }], gote: [] },
    };
    const rstate = makeReducerState(
      buildGameState(placePawn, "sente"),
      minimalCardState({ ...csOver, hand: { sente: [pawnCard], gote: [] } }),
    );
    const world = makeWorld(
      buildGameState(placePawn, "sente"),
      minimalCardState({
        ...csOver,
        hand: { sente: [{ ...pawnCard }], gote: [] },
      }),
    );

    const { k } = applyAndCompare(rstate, world, {
      kind: "playCard",
      cardInstanceId: pawnCard.instanceId,
      defId: "pawn_return",
      target: { kind: "square", row: 5, col: 4 },
    });

    expect(k.world.gameState.board[5][4]).toBeNull(); // 盤上から退去
    expect(k.world.gameState.hand.sente["pawn"]).toBe(1); // 取り駒へ
    expect(k.world.cardState.noPromoteMarks.sente).toHaveLength(0); // マーク削除 (案A 仕様)
    expect(k.world.cardState.graveyard.sente.map((c) => c.defId)).toEqual([
      "pawn_return",
    ]);
    expect(k.world.cardState.mana.sente).toBe(4); // 5 - 1
  });

  it("OBS5-2: 駒取りで相手の no_promote マークが消える (capture removes opponent mark)", () => {
    // makeMoveWithEffects 内 (共有) の挙動だが、カーネルが move を通す合成で同値になることを pin。
    const placeCapture = (b: Board) => {
      b[0][0] = pc("king", "gote");
      b[8][8] = pc("king", "sente");
      b[3][4] = pc("pawn", "gote"); // マーク付き後手歩
      b[3][8] = pc("rook", "sente"); // 横利きで取る
    };
    const csOver = {
      noPromoteMarks: {
        sente: [] as Array<{ row: number; col: number }>,
        gote: [{ row: 3, col: 4 }],
      },
    };
    const rstate = makeReducerState(
      buildGameState(placeCapture, "sente"),
      minimalCardState(csOver),
    );
    const world = makeWorld(
      buildGameState(placeCapture, "sente"),
      minimalCardState(csOver),
    );

    const captureMove: Move = {
      type: "move",
      from: { row: 3, col: 8 },
      to: { row: 3, col: 4 },
      piece: "rook",
      player: "sente",
      captured: "pawn",
    };
    const { k } = applyAndCompare(rstate, world, {
      kind: "move",
      move: captureMove,
    });

    expect(k.world.gameState.board[3][4]).toEqual(pc("rook", "sente"));
    expect(k.world.gameState.hand.sente["pawn"]).toBe(1);
    expect(k.world.cardState.noPromoteMarks.gote).toHaveLength(0); // 取られた駒のマーク消失
  });

  it("DP-7: double_move 中の check_break は 1手目で defer・2手目で発火", () => {
    // 後手が check_break をセット。先手が double_move で 1手目に王手 (defer)、2手目維持で発火。
    const dmCard: CardInstance = {
      instanceId: "sente-double_move-cb",
      defId: "double_move",
    };
    const goteTrap: TrapInstance = {
      instanceId: "gote-check_break",
      defId: "check_break",
      owner: "gote",
    };
    const placeCb = (b: Board) => {
      b[4][4] = pc("king", "gote");
      b[8][8] = pc("king", "sente");
      b[0][0] = pc("rook", "sente"); // 1手目で (4,0) へ動かし王手
      b[8][2] = pc("gold", "sente"); // 2手目の filler (王手は維持)
    };
    const csOver = (dm: CardInstance) => ({
      hand: { sente: [dm], gote: [] as CardInstance[] },
      mana: { sente: 8, gote: 8 },
      trap: { sente: null, gote: goteTrap },
    });
    const rstate = makeReducerState(
      buildGameState(placeCb, "sente"),
      minimalCardState(csOver(dmCard)),
    );
    let world = makeWorld(
      buildGameState(placeCb, "sente"),
      minimalCardState(csOver({ ...dmCard })),
    );
    let rcur = rstate;

    // 前提: 開始局面で後手玉は王手でない。
    expect(isInCheck(world.gameState, "gote", CARD_SHOGI_VARIANT)).toBe(false);

    // (1) double_move 発動。
    {
      const action: TurnAction = {
        kind: "playCard",
        cardInstanceId: dmCard.instanceId,
        defId: "double_move",
      };
      const { r, k } = applyAndCompare(rcur, world, action);
      expect(k.world.doubleMove?.movesLeft).toBe(2);
      rcur = r.state;
      world = k.world;
    }

    // (2) 1手目: 飛(0,0)→(4,0) で後手玉に王手。check_break は defer (発火しない・トラップ残置)。
    {
      const move1: Move = {
        type: "move",
        from: { row: 0, col: 0 },
        to: { row: 4, col: 0 },
        piece: "rook",
        player: "sente",
      };
      const { r, k } = applyAndCompare(rcur, world, {
        kind: "move",
        move: move1,
      });
      expect(k.turnEnded).toBe(false);
      expect(k.world.doubleMove?.movesLeft).toBe(1);
      expect(k.world.cardState.trap.gote).not.toBeNull(); // defer = トラップ未発火
      expect(isInCheck(k.world.gameState, "gote", CARD_SHOGI_VARIANT)).toBe(
        true,
      ); // 王手継続
      expect(
        k.events.filter((e) => e.kind === "trapTriggerEvent"),
      ).toHaveLength(0); // 1手目で発火せず
      rcur = r.state;
      world = k.world;
    }

    // (3) 2手目: 金(8,2)→(7,2) (王手は維持) → check_break 発火し王手駒(飛)を後手が捕獲。
    {
      const move2: Move = {
        type: "move",
        from: { row: 8, col: 2 },
        to: { row: 7, col: 2 },
        piece: "gold",
        player: "sente",
      };
      const { k } = applyAndCompare(rcur, world, { kind: "move", move: move2 });
      expect(k.turnEnded).toBe(true);
      expect(k.world.doubleMove).toBeNull();
      expect(k.world.cardState.trap.gote).toBeNull(); // 発火で消費
      expect(k.world.gameState.board[4][0]).toBeNull(); // 王手していた飛が除去
      expect(k.boardChangedBeyondMove).toBe(true); // S4b: double_move 2手目の check_break 発火
      expect(k.world.gameState.hand.gote["rook"]).toBe(1); // 後手の持ち駒へ
      expect(isInCheck(k.world.gameState, "gote", CARD_SHOGI_VARIANT)).toBe(
        false,
      ); // 王手解除
      // double_move 消費 + 2手目で trapTrigger(check_declared) 発火。
      expect(k.world.cardState.graveyard.sente.map((c) => c.defId)).toEqual([
        "double_move",
      ]);
      const triggers = k.events.filter(
        (e) => e.kind === "trapTriggerEvent",
      ) as Array<Extract<GameEvent, { kind: "trapTriggerEvent" }>>;
      expect(triggers).toHaveLength(1);
      expect(triggers[0].reason).toBe("check_declared");
    }
  });

  it("F-4/OBS4-3: 王手中の double_move (checkUsage=unconditional) — RELAXED 1手目→2手目で解消", () => {
    // 先手玉が後手飛に王手された状態で double_move を使用 (王手中でも unconditional で許可)。
    // 1手目は王手を解消しない RELAXED 手、2手目で玉を逃して解消。
    const dmCard: CardInstance = {
      instanceId: "sente-double_move-chk",
      defId: "double_move",
    };
    const placeChk = (b: Board) => {
      b[4][4] = pc("king", "sente"); // 先手玉が王手される
      b[4][0] = pc("rook", "gote"); // 後手飛が横利きで王手
      b[0][8] = pc("king", "gote");
      b[8][2] = pc("gold", "sente"); // RELAXED 1手目の駒
    };
    const csOver = (dm: CardInstance) => ({
      hand: { sente: [dm], gote: [] as CardInstance[] },
      mana: { sente: 8, gote: 8 },
    });
    const rstate = makeReducerState(
      buildGameState(placeChk, "sente"),
      minimalCardState(csOver(dmCard)),
    );
    let world = makeWorld(
      buildGameState(placeChk, "sente"),
      minimalCardState(csOver({ ...dmCard })),
    );
    let rcur = rstate;

    expect(isInCheck(world.gameState, "sente", CARD_SHOGI_VARIANT)).toBe(true); // 前提: 王手中

    // (1) 王手中に double_move 発動 (unconditional で許可)。
    {
      const action: TurnAction = {
        kind: "playCard",
        cardInstanceId: dmCard.instanceId,
        defId: "double_move",
      };
      const { r, k } = applyAndCompare(rcur, world, action);
      expect(k.world.doubleMove?.movesLeft).toBe(2);
      rcur = r.state;
      world = k.world;
    }

    // (2) RELAXED 1手目: 王手を解消しない手 (金(8,2)→(7,2))。1手目では自玉王手のまま許容。
    {
      const move1: Move = {
        type: "move",
        from: { row: 8, col: 2 },
        to: { row: 7, col: 2 },
        piece: "gold",
        player: "sente",
      };
      const { r, k } = applyAndCompare(rcur, world, {
        kind: "move",
        move: move1,
      });
      expect(k.turnEnded).toBe(false);
      expect(k.world.doubleMove?.movesLeft).toBe(1);
      expect(isInCheck(k.world.gameState, "sente", CARD_SHOGI_VARIANT)).toBe(
        true,
      ); // まだ王手
      rcur = r.state;
      world = k.world;
    }

    // (3) 2手目: 玉(4,4)→(3,4) で飛の利きから逃れ王手解消。
    {
      const move2: Move = {
        type: "move",
        from: { row: 4, col: 4 },
        to: { row: 3, col: 4 },
        piece: "king",
        player: "sente",
      };
      const { k } = applyAndCompare(rcur, world, { kind: "move", move: move2 });
      expect(k.turnEnded).toBe(true);
      expect(k.world.doubleMove).toBeNull();
      expect(isInCheck(k.world.gameState, "sente", CARD_SHOGI_VARIANT)).toBe(
        false,
      ); // 解消
      expect(k.world.gameState.currentPlayer).toBe("gote");
      expect(k.world.cardState.mana.sente).toBe(3); // 8 - 5 (遅延消費)
      expect(k.world.cardState.graveyard.sente.map((c) => c.defId)).toEqual([
        "double_move",
      ]);
    }
  });

  it("OBS5-3: mana_up (deprecated) 分岐の等価 — consume(-2) 後 applyManaUp(+3) で純 +1", () => {
    // mana_up は deprecated でデッキ非投入のためランダム harness では未到達。kernel:applyCardEffectLogic
    // の mana_up 分岐 (reducer CONFIRM と対) を targeted で踏み、デッドカバレッジを解消する。
    const manaCard: CardInstance = {
      instanceId: "sente-mana_up-x",
      defId: "mana_up",
    };
    const placeMinimal = (b: Board) => {
      b[0][0] = pc("king", "gote");
      b[8][8] = pc("king", "sente");
    };
    const csOver = (c: CardInstance) => ({
      hand: { sente: [c], gote: [] as CardInstance[] },
      mana: { sente: 5, gote: 5 },
    });
    const rstate = makeReducerState(
      buildGameState(placeMinimal, "sente"),
      minimalCardState(csOver(manaCard)),
    );
    const world = makeWorld(
      buildGameState(placeMinimal, "sente"),
      minimalCardState(csOver({ ...manaCard })),
    );

    const { k } = applyAndCompare(rstate, world, {
      kind: "playCard",
      cardInstanceId: manaCard.instanceId,
      defId: "mana_up",
    });

    expect(k.world.cardState.mana.sente).toBe(6); // 5 - 2 (consume) + 3 (manaUp)
    expect(k.world.cardState.hand.sente).toHaveLength(0);
    expect(k.world.cardState.graveyard.sente.map((c) => c.defId)).toEqual([
      "mana_up",
    ]);
    expect(k.world.cardState.drawProgress.sente).toBe(1); // turn-end +1
    expect(k.world.gameState.currentPlayer).toBe("gote");
  });
});

// ===== S4b (H-1): boardChangedBeyondMove フラグ (targeted) =====
// ApplyTurnActionResult.boardChangedBeyondMove が「move 1 手分以外の盤面変更」を正しく検知するか
// (S4c-2 の TT 全量再計算ゲートの前提)。true = check_break 発火 move / modifyBoard playCard、
// false = 通常 move / draw / setTrap / mana_up / double_move set。
describe("world-kernel applyTurnAction — boardChangedBeyondMove (S4b H-1)", () => {
  it("通常 move (トラップ無発火) は false", () => {
    const gs = createInitialGameState(CARD_SHOGI_VARIANT);
    const world = makeWorld(gs, minimalCardState());
    const moves = getFullLegalMoves(gs, "sente", CARD_SHOGI_VARIANT);
    const k = applyTurnAction(
      world,
      { kind: "move", move: moves[0] },
      { spectatorMode: true },
    );
    expect(k.boardChangedBeyondMove).toBe(false);
  });

  it("check_break 発火 move は true (王手駒を盤上から除去)", () => {
    const goteTrap: TrapInstance = {
      instanceId: "gote-cb-bcm",
      defId: "check_break",
      owner: "gote",
    };
    const placeCb = (b: Board) => {
      b[4][4] = pc("king", "gote");
      b[8][8] = pc("king", "sente");
      b[0][0] = pc("rook", "sente"); // (4,0) へ動かし row4 で王手
    };
    const world = makeWorld(
      buildGameState(placeCb, "sente"),
      minimalCardState({ trap: { sente: null, gote: goteTrap } }),
    );
    const move: Move = {
      type: "move",
      from: { row: 0, col: 0 },
      to: { row: 4, col: 0 },
      piece: "rook",
      player: "sente",
    };
    const k = applyTurnAction(world, { kind: "move", move }, { spectatorMode: true });
    expect(k.boardChangedBeyondMove).toBe(true);
    // 発火の傍証: 王手していた飛が盤上から除去され trapTriggerEvent が出る。
    expect(k.world.gameState.board[4][0]).toBeNull();
    expect(k.events.some((e) => e.kind === "trapTriggerEvent")).toBe(true);
  });

  it("draw は false (盤不変)", () => {
    const gs = createInitialGameState(CARD_SHOGI_VARIANT);
    const world = makeWorld(
      gs,
      minimalCardState({
        mana: { sente: 5, gote: 5 },
        deck: { sente: [{ instanceId: "d-bcm", defId: "mana_up" }], gote: [] },
      }),
    );
    const k = applyTurnAction(world, { kind: "draw" }, { spectatorMode: true });
    expect(k.boardChangedBeyondMove).toBe(false);
  });

  it("setTrap (check_break) は false (盤不変、cardState のみ変化)", () => {
    const trapCard: CardInstance = { instanceId: "s-cb-bcm", defId: "check_break" };
    const gs = createInitialGameState(CARD_SHOGI_VARIANT);
    const world = makeWorld(
      gs,
      minimalCardState({ hand: { sente: [trapCard], gote: [] }, mana: { sente: 6, gote: 6 } }),
    );
    const k = applyTurnAction(
      world,
      { kind: "playCard", cardInstanceId: trapCard.instanceId, defId: "check_break" },
      { spectatorMode: true },
    );
    expect(k.boardChangedBeyondMove).toBe(false);
  });

  it("modifyBoard (pawn_return) は true (盤上歩を退去)", () => {
    const pawnCard: CardInstance = { instanceId: "s-pr-bcm", defId: "pawn_return" };
    const gs = createInitialGameState(CARD_SHOGI_VARIANT);
    expect(gs.board[6][4]?.type).toBe("pawn"); // 前提: sente 初期歩
    const world = makeWorld(
      gs,
      minimalCardState({ hand: { sente: [pawnCard], gote: [] }, mana: { sente: 5, gote: 5 } }),
    );
    const k = applyTurnAction(
      world,
      {
        kind: "playCard",
        cardInstanceId: pawnCard.instanceId,
        defId: "pawn_return",
        target: { kind: "square", row: 6, col: 4 },
      },
      { spectatorMode: true },
    );
    expect(k.boardChangedBeyondMove).toBe(true);
  });

  it("modifyResource (mana_up) は false (盤不変)", () => {
    const manaCard: CardInstance = { instanceId: "s-mu-bcm", defId: "mana_up" };
    const gs = createInitialGameState(CARD_SHOGI_VARIANT);
    const world = makeWorld(
      gs,
      minimalCardState({ hand: { sente: [manaCard], gote: [] }, mana: { sente: 5, gote: 5 } }),
    );
    const k = applyTurnAction(
      world,
      { kind: "playCard", cardInstanceId: manaCard.instanceId, defId: "mana_up" },
      { spectatorMode: true },
    );
    expect(k.boardChangedBeyondMove).toBe(false);
  });

  it("double_move set (フラグのみ) は false", () => {
    const dmCard: CardInstance = { instanceId: "s-dm-bcm", defId: "double_move" };
    const gs = createInitialGameState(CARD_SHOGI_VARIANT);
    const world = makeWorld(
      gs,
      minimalCardState({ hand: { sente: [dmCard], gote: [] }, mana: { sente: 8, gote: 8 } }),
    );
    const k = applyTurnAction(
      world,
      { kind: "playCard", cardInstanceId: dmCard.instanceId, defId: "double_move" },
      { spectatorMode: true },
    );
    expect(k.boardChangedBeyondMove).toBe(false);
  });
});
