// Issue #235 S1a: L0 ルール/状態カーネル (WorldState + applyTurnAction)。
//
// 目的 (epic doc §3 L0 / S1 計画 docs/plans/issue-235-s1-kernel.md):
//   カード将棋のルール/状態遷移を単一権威 applyTurnAction に集約し、reducer (UI) と AI 探索が
//   同一ロジックを呼ぶ構造の土台を作る (P4 二重実装の解消)。
//
// 戦略 (再実装せず抽出して委譲、計画 §1):
//   - move のロジックは `makeMoveWithEffects` を **reuse** (lib/kernel/move-effects.ts から import)。
//     ※ S1a では reducer.ts に置いたまま export して import 再利用していたが、これは
//       lib(kernel) → hooks(reducer) の暫定逆依存 (層違反) を生んでいた。
//       S1c でこの関数 (+ MakeMoveMode 型) を lib 層の move-effects.ts へ物理移設し、逆依存を解消済。
//       reducer も move-effects.ts から import して呼ぶ (挙動不変)。reducer 本体の各演出フェーズを
//       kernel building-block へ委譲 (薄ラッパ化) するのは S1d cutover。
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
  applyTrapSet,
  consumeNormalCard,
  removeNoPromoteMark,
} from "@/lib/shogi/cards/effects";
// Issue #235 S2b: 効果適用を CardSpec registry の effect 駆動へ統一 (P5 解消)。
// 各 applyXxx は CARD_SPECS[id].effect.apply (= 薄い wrapper) 経由で呼ばれるため、world-kernel が
// applyPawnReturn/applyPieceReturn/applyDoublePawn/applyManaUp を直接 import する必要はなくなった。
import { CARD_SPECS } from "@/lib/shogi/cards/card-spec-server";
import { makeMoveWithEffects } from "@/lib/shogi/kernel/move-effects";
import type {
  CardGameState,
  CardInstance,
  GameEvent,
} from "@/lib/shogi/cards/types";
// Issue #235 S4d-1: TurnAction を L0 中立 location から直接 import (旧 ai/turn/types 経由の
// L0→L2 型逆依存を解消、epic §6 7.5⑤)。
import type { TurnAction } from "@/lib/shogi/kernel/turn-action-types";

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
  // Issue #235 S4b (H-1 前倒し): この遷移が「move 1 手分 (from→to + 捕獲) 以外の盤面変更」を
  // 伴ったか。S4c-2 の TT で incremental updateHash (move 1 手分専用) が使えず computeHash 全量
  // 再計算が必要なノードを検知するためのゲート。true になるのは:
  //   - move で check_break トラップが発火し王手駒を盤上から除去した (triggeredCheckBreak)
  //   - playCard の modifyBoard 効果 (pawn_return / piece_return / double_pawn) で盤が変わった
  // false: 通常 move / no_promote 発火 (単一 move のまま) / draw / setTrap / mana_up / double_move set。
  // (no_promote 発火は finalMove の promote フラグを落とすだけで盤変更は単一 move 内、setTrap/
  //  mana_up/draw は盤不変ゆえ親の boardHash をそのまま引き継げる。)
  boardChangedBeyondMove: boolean;
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
// CONFIRM_PLAY_CARD (reducer.ts) の効果適用部を抽出 (確定済 playCard を 1 ステップ適用)。
// 返り値: 効果適用後の {gameState, cardState, event}。不正 (王手未解除等) は null。
// reducer の CONFIRM_PLAY_CARD (S1d) と AI 探索 (applyTurnAction) が本関数へ委譲する単一権威。
//
// Issue #235 S2b cutover: 旧 effectId switch (trap / mana_up / pawn_return / piece_return / double_pawn)
// を **CardSpec registry の EffectSpec 駆動 dispatch** へ統一 (P5 解消)。盤面変更は spec.effect.apply
// (= 既存 applyXxx の薄い wrapper) に委譲し、汎用処理 (consumeNormalCard / mana 減算 / event 構築 /
// returnedPiece / removeNoPromoteMark sideEffect) は本 dispatcher が担う (§9 B3)。挙動は旧実装と等価
// (world-kernel-equivalence / reducer / effects / kernel-search-equivalence / card-spec テストで担保)。
// double_move は effect を持たない (multiPly のみ) ため本関数の対象外 = applyTurnAction で別扱い。
// trap trigger (no_promote 成り抑止 / check_break 王手崩し) の発火は move-effects.ts インライン (Route B、不変)。
export function applyCardEffectLogic(
  world: WorldState,
  action: Extract<TurnAction, { kind: "playCard" }>,
  player: Player,
): { gameState: GameState; cardState: CardGameState; event: GameEvent } | null {
  const spec = CARD_SPECS[action.defId];
  const effect = spec.effect;
  // effect 無 (double_move 等 multiPly カード) は本関数の対象外。applyTurnAction の playCard 分岐が
  // 事前に処理するため通常到達しないが、防御的に null (旧実装の `else return null` と等価)。
  if (!effect) return null;

  const cost = spec.meta.cost;
  let nextGameState = world.gameState;
  let nextCardState = world.cardState;
  let returnedPieceInfo: { row: number; col: number; pieceType: string } | undefined;

  if (effect.type === "setTrap") {
    // トラップ: consumeNormalCard を使わず mana 直接減算 + applyTrapSet (graveyard 不変 DP-3)。
    if (world.cardState.mana[player] < cost) return null;
    const afterMana: CardGameState = {
      ...world.cardState,
      mana: { ...world.cardState.mana, [player]: world.cardState.mana[player] - cost },
    };
    const afterSet = applyTrapSet(afterMana, player, action.cardInstanceId);
    if (!afterSet) return null;
    nextCardState = afterSet;
  } else if (effect.type === "modifyBoard") {
    if (!action.target || action.target.kind !== "square") return null;
    const targetPos = { row: action.target.row, col: action.target.col };
    // 盤面適用前に target マスの駒を控える。駒があれば「持ち駒へ戻す」効果 (pawn_return / piece_return):
    //   returnedPiece (cardPlayEvent の駒フライト演出用) + removeNoPromoteMark (案A: 戻した駒はマーク喪失)。
    // double_pawn は空マスへの打ちで pieceBefore 無 → どちらも発生しない (旧実装と等価、§9 B3)。
    const pieceBefore = world.gameState.board[targetPos.row]?.[targetPos.col];
    const ng = effect.apply(world.gameState, player, action.target);
    if (!ng) return null;
    nextGameState = ng;
    if (pieceBefore) {
      returnedPieceInfo = {
        row: targetPos.row,
        col: targetPos.col,
        pieceType: unpromotePieceType(pieceBefore.type),
      };
    }
    const consumed = consumeNormalCard(world.cardState, player, action.cardInstanceId, cost);
    if (!consumed) return null;
    nextCardState = pieceBefore ? removeNoPromoteMark(consumed, player, targetPos) : consumed;
  } else if (effect.type === "modifyResource") {
    const consumed = consumeNormalCard(world.cardState, player, action.cardInstanceId, cost);
    if (!consumed) return null;
    // mana リソース変更 (mana_up: +effect.mana、manaCap でクランプ = 旧 applyManaUp と等価)。
    nextCardState =
      effect.mana !== undefined
        ? {
            ...consumed,
            mana: {
              ...consumed.mana,
              [player]: Math.min(consumed.manaCap, consumed.mana[player] + effect.mana),
            },
          }
        : consumed;
    // effect.draw は S2a registry では未使用 (将来カード用)。
  } else {
    return null;
  }

  // 王手中の最終ガード (reducer 等価): 王手中だった場合、適用後も王手なら不正 (no-op)。
  // 合法 action では発生しないが reducer 等価のため再現。
  if (
    isInCheck(world.gameState, player, CARD_SHOGI_VARIANT) &&
    isInCheck(nextGameState, player, CARD_SHOGI_VARIANT)
  ) {
    return null;
  }

  const event: GameEvent =
    spec.eventKind === "trapSetEvent"
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
        // double_move_first は check_break を deferCheckBreak で保留するため常に false。
        boardChangedBeyondMove: r.triggeredCheckBreak,
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
      boardChangedBeyondMove: r.triggeredCheckBreak, // first は deferred で常に false
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
      boardChangedBeyondMove: r.triggeredCheckBreak,
    };
  }

  // 通常 move (reducer.ts:857-875)。applyMove が currentPlayer を flip。
  const r = makeMoveWithEffects(world.gameState, world.cardState, move, { spectatorMode });
  const adv = advanceDrawProgress(r.cardState, r.gameState, move.player);
  return {
    world: { gameState: r.gameState, cardState: adv.cardState, doubleMove: null },
    events: [...r.events, ...adv.events],
    turnEnded: true,
    boardChangedBeyondMove: r.triggeredCheckBreak,
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
    boardChangedBeyondMove: false, // draw は盤不変
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
      boardChangedBeyondMove: false, // フラグ set のみ、盤不変
    };
  }

  const applied = applyCardEffectLogic(world, action, player);
  if (!applied) {
    // 不正 (合法 action では発生しない)。状態不変・turnEnded=false で返す。
    return { world, events: [], turnEnded: false, boardChangedBeyondMove: false };
  }

  // flip (reducer.ts COMMIT_PLAY_CARD:1405) + turn 終了処理
  const flippedGame: GameState = { ...applied.gameState, currentPlayer: opponentOf(player) };
  const adv = advanceDrawProgress(applied.cardState, flippedGame, player);
  // modifyBoard 効果 (pawn_return/piece_return/double_pawn) のみ盤変更。setTrap/mana_up は盤不変。
  const boardChangedBeyondMove = CARD_SPECS[action.defId].effect?.type === "modifyBoard";
  return {
    world: { gameState: flippedGame, cardState: adv.cardState, doubleMove: null },
    events: [applied.event, ...adv.events],
    turnEnded: true,
    boardChangedBeyondMove,
  };
}
