// Issue #235 S1a: L0 ルール/状態カーネル (WorldState + applyTurnAction)。
//
// 目的 (epic doc §3 L0 / S1 計画 docs/plans/issue-235-s1-kernel.md):
//   カード将棋のルール/状態遷移を単一権威 applyTurnAction に集約し、reducer (UI) と AI 探索が
//   同一ロジックを呼ぶ構造の土台を作る (P4 二重実装の解消)。
//
// 戦略 (再実装せず抽出して委譲、計画 §1):
//   - move の純粋ロジックは reducer の makeMoveWithEffects を **reuse** (export して import)。
//     ※ S1a では reducer 側は makeMoveWithEffects に export を付与するのみで振る舞い不変。
//       makeMoveWithEffects の kernel への物理移設と reducer 薄ラッパ化は S1c (clean な層構造化)。
//       それまで lib/kernel → hooks/reducer の暫定依存が残る (循環なし、reducer は React 非依存)。
//   - draw/playCard/turnEnd は UI state 結合の reducer ロジックから cardState 変換部のみを抽出して
//     kernel に新規実装 (advanceDrawProgress / applyCardEffectLogic / finalizeDoubleMoveLogic)。
//     これらと reducer 経路の等価性は property-based 等価テスト (S1a part2) で担保する。
//
// 設計判断 (S1 計画 §2/§4、DP-1〜7):
//   - 二層構造: building-block 関数群 + atomic applyTurnAction。reducer は演出フェーズ
//     (CONFIRM/COMMIT) を維持しつつ同一 building-block を呼ぶ (関数レベル single-authority)。
//   - DP-1: drawProgress は turn 終了時に +1、AUTO_DRAW_INTERVAL 到達∧deck非空で 0 reset + 自動ドロー
//     (非再帰・1回)。AI 旧 immediate+1 近似は S1b でカーネル委譲時に解消。
//   - DP-2: double_move はマルチ ply。1手目は flip 戻し turnEnded=false、2手目は applyMove で
//     flip 済のため再 flip せず turnEnded=true + finalize 遅延消費。
//   - DP-3: setTrap は hand→trap (graveyard 不変)、通常カードは hand→graveyard。
//   - currentPlayer flip: move は applyMove (makeMoveWithEffects 内) が flip。draw/playCard は
//     盤を applyMove で動かさないため kernel が明示 flip。

import type { GameState, Move, Player } from "@/lib/shogi/types";
import { isInCheck } from "@/lib/shogi/moves";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";
import { unpromotePieceType } from "@/lib/shogi/variants/standard";
import { CARD_DEFS, DRAW_COST, AUTO_DRAW_INTERVAL } from "@/lib/shogi/cards/definitions";
import {
  applyPawnReturn,
  applyPieceReturn,
  applyDoublePawn,
  applyManaUp,
  applyTrapSet,
  consumeNormalCard,
  removeNoPromoteMark,
} from "@/lib/shogi/cards/effects";
import { makeMoveWithEffects } from "@/hooks/card-shogi/reducer";
import type {
  CardGameState,
  CardInstance,
  GameEvent,
} from "@/lib/shogi/cards/types";
import type { TurnAction } from "@/lib/shogi/ai/turn/types";

// ===== WorldState (L0) =====
// kernel が扱う二手指し継続状態。reducer の doubleMove から UI/UNDO 専用フィールド
// (mateInOneAvailable / preFirstMoveState / preCardState) を除いたロジック部分。
export interface KernelDoubleMove {
  active: Player;
  movesLeft: 1 | 2;
  cardInstance: CardInstance;
  cardCost: number;
}

export interface WorldState {
  gameState: GameState; // 盤 + 持ち駒 + currentPlayer + status
  cardState: CardGameState; // mana/hand/deck/graveyard/trap/drawProgress/noPromoteMarks
  doubleMove: KernelDoubleMove | null;
}

export interface ApplyTurnActionResult {
  world: WorldState;
  events: GameEvent[];
  turnEnded: boolean;
}

export interface ApplyTurnActionOptions {
  spectatorMode?: boolean; // DP-4: 早指しボーナス無効化 (決定論化)
}

const opponentOf = (p: Player): Player => (p === "sente" ? "gote" : "sente");

// ===== building-block: advanceDrawProgress (DP-1) =====
// applyTurnEndEffects (reducer.ts:447-494) の cardState 変換部を抽出。
// turn 終了側 player の drawProgress を +1、AUTO_DRAW_INTERVAL 到達∧deck非空で 0 reset +
// 自動ドロー (deck先頭→hand)。**非再帰・1回のみ**。UI flag (isDrawing 等) は呼出側 (reducer)
// が返り値 events の auto drawEvent を読んで event-driven にセットする (S1c)。
export function advanceDrawProgress(
  cardState: CardGameState,
  gameState: GameState,
  player: Player,
): { cardState: CardGameState; events: GameEvent[] } {
  // 終局後はドロー進捗加算・自動ドロー発火をスキップ (reducer.ts:454、Issue #170)
  if (gameState.status !== "active") return { cardState, events: [] };

  const current = cardState.drawProgress[player];
  const next = current + 1;
  const deck = cardState.deck[player];

  if (next < AUTO_DRAW_INTERVAL || deck.length === 0) {
    return {
      cardState: {
        ...cardState,
        drawProgress: { ...cardState.drawProgress, [player]: next },
      },
      events: [],
    };
  }

  const [top, ...rest] = deck;
  return {
    cardState: {
      ...cardState,
      drawProgress: { ...cardState.drawProgress, [player]: 0 },
      deck: { ...cardState.deck, [player]: rest },
      hand: { ...cardState.hand, [player]: [...cardState.hand[player], top] },
    },
    events: [{ kind: "drawEvent", player, instance: top, source: "auto", at: Date.now() }],
  };
}

// ===== building-block: finalizeDoubleMoveLogic (DP-2) =====
// finalizeDoubleMoveCardConsumption (reducer.ts:666-694) の cardState/event 部を抽出。
// 二手指し 2手目完了 (or 1手目詰み) 時にカード本体を遅延消費 (consumeNormalCard) + cardPlayEvent。
export function finalizeDoubleMoveLogic(
  cardState: CardGameState,
  dm: KernelDoubleMove,
): { cardState: CardGameState; events: GameEvent[] } {
  const consumed = consumeNormalCard(
    cardState,
    dm.active,
    dm.cardInstance.instanceId,
    dm.cardCost,
  );
  // 異常系: 手札からカードが消えている (reducer.ts:676-679 と同じ防御)。消費せず継続。
  if (!consumed) return { cardState, events: [] };
  return {
    cardState: consumed,
    events: [
      { kind: "cardPlayEvent", player: dm.active, instance: dm.cardInstance, at: Date.now() },
    ],
  };
}

// ===== building-block: applyCardEffectLogic (DP-3/DP-7) =====
// CONFIRM_PLAY_CARD (reducer.ts:1226-1342) の効果適用部を抽出 (確定済 playCard を 1 ステップ適用)。
// modifyBoard 系は direct-apply (simulateCardEffect は returnedPiece / removeNoPromoteMark を
// 落とすため使わない、計画 §4 訂正)。double_move は本関数の対象外 (applyTurnAction で別扱い)。
// 返り値: 効果適用後の {gameState, cardState, event}。不正 (王手未解除等) は null。
function applyCardEffectLogic(
  world: WorldState,
  action: Extract<TurnAction, { kind: "playCard" }>,
  player: Player,
): { gameState: GameState; cardState: CardGameState; event: GameEvent } | null {
  const def = CARD_DEFS[action.defId];
  let nextGameState = world.gameState;
  let nextCardState = world.cardState;
  let returnedPieceInfo: { row: number; col: number; pieceType: string } | undefined;

  if (def.kind === "trap") {
    // トラップ: consumeNormalCard を使わず mana 直接減算 + applyTrapSet (graveyard 不変 DP-3)
    if (world.cardState.mana[player] < def.cost) return null;
    const afterMana: CardGameState = {
      ...world.cardState,
      mana: { ...world.cardState.mana, [player]: world.cardState.mana[player] - def.cost },
    };
    const afterSet = applyTrapSet(afterMana, player, action.cardInstanceId);
    if (!afterSet) return null;
    nextCardState = afterSet;
  } else if (def.effectId === "mana_up") {
    const consumed = consumeNormalCard(world.cardState, player, action.cardInstanceId, def.cost);
    if (!consumed) return null;
    nextCardState = applyManaUp(consumed, player);
  } else if (def.effectId === "pawn_return" || def.effectId === "piece_return") {
    if (!action.target || action.target.kind !== "square") return null;
    const targetPos = { row: action.target.row, col: action.target.col };
    const returnedPiece = world.gameState.board[targetPos.row]?.[targetPos.col];
    const ng =
      def.effectId === "pawn_return"
        ? applyPawnReturn(world.gameState, player, targetPos)
        : applyPieceReturn(world.gameState, player, targetPos);
    if (!ng) return null;
    nextGameState = ng;
    if (returnedPiece) {
      returnedPieceInfo = {
        row: targetPos.row,
        col: targetPos.col,
        pieceType: unpromotePieceType(returnedPiece.type),
      };
    }
    const consumed = consumeNormalCard(world.cardState, player, action.cardInstanceId, def.cost);
    if (!consumed) return null;
    // 持ち駒に戻った駒は no_promote マークを失う (案A 仕様、reducer.ts:1266/1284)
    nextCardState = removeNoPromoteMark(consumed, player, targetPos);
  } else if (def.effectId === "double_pawn") {
    if (!action.target || action.target.kind !== "square") return null;
    const targetPos = { row: action.target.row, col: action.target.col };
    const ng = applyDoublePawn(world.gameState, player, targetPos);
    if (!ng) return null;
    nextGameState = ng;
    const consumed = consumeNormalCard(world.cardState, player, action.cardInstanceId, def.cost);
    if (!consumed) return null;
    nextCardState = consumed;
  } else {
    return null;
  }

  // 王手中の最終ガード (reducer.ts:1338-1342): 王手中だった場合、適用後も王手なら不正 (no-op)。
  // 合法 action では発生しないが reducer 等価のため再現。
  if (
    isInCheck(world.gameState, player, CARD_SHOGI_VARIANT) &&
    isInCheck(nextGameState, player, CARD_SHOGI_VARIANT)
  ) {
    return null;
  }

  const event: GameEvent =
    def.kind === "trap"
      ? {
          kind: "trapSetEvent",
          player,
          instance: { instanceId: action.cardInstanceId, defId: action.defId, owner: player },
          at: Date.now(),
        }
      : {
          kind: "cardPlayEvent",
          player,
          instance: { instanceId: action.cardInstanceId, defId: action.defId },
          target: action.target,
          returnedPiece: returnedPieceInfo,
          at: Date.now(),
        };

  return { gameState: nextGameState, cardState: nextCardState, event };
}

// ===== atomic applyTurnAction =====
// 確定済 TurnAction を WorldState に 1 遷移で適用。AI / property test / headless から呼ぶ。
// reducer は演出フェーズで同一 building-block を呼ぶため、本関数と等価な結果になる
// (property-based 等価テストで担保)。
export function applyTurnAction(
  world: WorldState,
  action: TurnAction,
  opts: ApplyTurnActionOptions = {},
): ApplyTurnActionResult {
  if (action.kind === "move") {
    return applyMoveAction(world, action.move, opts);
  }
  if (action.kind === "draw") {
    return applyDrawAction(world);
  }
  return applyPlayCardAction(world, action, opts);
}

function applyMoveAction(
  world: WorldState,
  move: Move,
  opts: ApplyTurnActionOptions,
): ApplyTurnActionResult {
  const dm = world.doubleMove;
  const spectatorMode = opts.spectatorMode;

  // 二手指し 1手目 (movesLeft === 2)
  if (dm && dm.movesLeft === 2) {
    const r = makeMoveWithEffects(world.gameState, world.cardState, move, {
      mode: "double_move_first",
      spectatorMode,
    });
    const gameOver = r.gameState.status !== "active";
    if (gameOver) {
      // 1手目で詰み成立 → 即 finalize (reducer.ts:800-816)。status≠active なので
      // advanceDrawProgress は no-op (reducer の COMMIT_PLAY_CARD→applyTurnEndEffects と等価)。
      const fin = finalizeDoubleMoveLogic(r.cardState, dm);
      const adv = advanceDrawProgress(fin.cardState, r.gameState, dm.active);
      return {
        world: { gameState: r.gameState, cardState: adv.cardState, doubleMove: null },
        events: [...r.events, ...fin.events, ...adv.events],
        turnEnded: true,
      };
    }
    // 継続: currentPlayer を dm.active (自分) に戻し movesLeft 2→1 (reducer.ts:819-832)
    return {
      world: {
        gameState: { ...r.gameState, currentPlayer: dm.active },
        cardState: r.cardState,
        doubleMove: { ...dm, movesLeft: 1 },
      },
      events: r.events,
      turnEnded: false,
    };
  }

  // 二手指し 2手目 (movesLeft === 1) → finalize 遅延消費 (reducer.ts:836-855 + COMMIT_PLAY_CARD)
  if (dm && dm.movesLeft === 1) {
    const r = makeMoveWithEffects(world.gameState, world.cardState, move, {
      mode: "double_move_second",
      spectatorMode,
    });
    // currentPlayer は applyMove で既に opponent へ flip 済 → 再 flip しない (DP-2)
    const fin = finalizeDoubleMoveLogic(r.cardState, dm);
    const adv = advanceDrawProgress(fin.cardState, r.gameState, dm.active);
    return {
      world: { gameState: r.gameState, cardState: adv.cardState, doubleMove: null },
      events: [...r.events, ...fin.events, ...adv.events],
      turnEnded: true,
    };
  }

  // 通常 move (reducer.ts:857-875)。applyMove が currentPlayer を flip。
  const r = makeMoveWithEffects(world.gameState, world.cardState, move, { spectatorMode });
  const adv = advanceDrawProgress(r.cardState, r.gameState, move.player);
  return {
    world: { gameState: r.gameState, cardState: adv.cardState, doubleMove: null },
    events: [...r.events, ...adv.events],
    turnEnded: true,
  };
}

function applyDrawAction(world: WorldState): ApplyTurnActionResult {
  const player = world.gameState.currentPlayer;
  // 合法 draw 前提 (deck非空・mana≥DRAW_COST・非王手・dm なし) は getLegalActions で保証。
  const deck = world.cardState.deck[player];
  const [top, ...rest] = deck;
  const afterDraw: CardGameState = {
    ...world.cardState,
    mana: { ...world.cardState.mana, [player]: world.cardState.mana[player] - DRAW_COST },
    deck: { ...world.cardState.deck, [player]: rest },
    hand: { ...world.cardState.hand, [player]: [...world.cardState.hand[player], top] },
  };
  const drawEvent: GameEvent = {
    kind: "drawEvent",
    player,
    instance: top,
    source: "manual",
    at: Date.now(),
  };
  // flip (reducer.ts:1133-1135) + turn 終了処理 (drawProgress)
  const flippedGame: GameState = { ...world.gameState, currentPlayer: opponentOf(player) };
  const adv = advanceDrawProgress(afterDraw, flippedGame, player);
  return {
    world: { gameState: flippedGame, cardState: adv.cardState, doubleMove: null },
    events: [drawEvent, ...adv.events],
    turnEnded: true,
  };
}

function applyPlayCardAction(
  world: WorldState,
  action: Extract<TurnAction, { kind: "playCard" }>,
  opts: ApplyTurnActionOptions,
): ApplyTurnActionResult {
  void opts;
  const player = world.gameState.currentPlayer;
  const def = CARD_DEFS[action.defId];

  // double_move: doubleMove フラグ set のみ (mana/hand/graveyard 不変 = 遅延消費 DP-2、reducer.ts:1294-1331)
  if (action.defId === "double_move") {
    return {
      world: {
        ...world,
        doubleMove: {
          active: player,
          movesLeft: 2,
          cardInstance: { instanceId: action.cardInstanceId, defId: action.defId },
          cardCost: def.cost,
        },
      },
      events: [],
      turnEnded: false,
    };
  }

  const applied = applyCardEffectLogic(world, action, player);
  if (!applied) {
    // 不正 (合法 action では発生しない)。状態不変・turnEnded=false で返す。
    return { world, events: [], turnEnded: false };
  }

  // flip (reducer.ts COMMIT_PLAY_CARD:1405) + turn 終了処理
  const flippedGame: GameState = { ...applied.gameState, currentPlayer: opponentOf(player) };
  const adv = advanceDrawProgress(applied.cardState, flippedGame, player);
  return {
    world: { gameState: flippedGame, cardState: adv.cardState, doubleMove: null },
    events: [applied.event, ...adv.events],
    turnEnded: true,
  };
}
