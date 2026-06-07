// Issue #235 S1c: move 効果適用ロジックの物理移設 (reducer.ts → lib/kernel)。
//
// 背景・目的:
//   makeMoveWithEffects は「駒移動 + マナチャージ + トラップ発動/フィルタ + no_promote マーク
//   追従 + 王手崩しトラップ + 終局判定」を一括適用するロジックで、reducer (UI) と
//   world-kernel (L0 カーネル / AI 探索) の双方から呼ばれる。S1a では reducer.ts に
//   置いたまま export して world-kernel が import 再利用していたが、これは
//   lib(world-kernel) → hooks(reducer) の逆依存 (層違反) を生んでいた。
//   S1c でこの関数 (+ MakeMoveMode 型) を lib 層の本モジュールへ物理移設し、逆依存を解消する。
//
// 移設方針 (純粋リファクタ・挙動完全不変):
//   関数本体は 1 行も変えていない (reducer.ts:241-428 からの lift)。依存はすべて lib 層
//   (board/moves/rules/variants/cards/effects/定数) で hooks 非依存。
//   reducer は本モジュールから makeMoveWithEffects を import して従来どおり直接呼ぶ
//   (呼出経路・ロジック不変)。等価は S1a property test + reducer.test/undo/effects で担保。
//
// 注意 (非純粋性): 本関数は Date.now() に依存する (早指しボーナス isFastMove 判定 + イベント at)。
//   決定論が必要な経路 (AI 探索 / property test) は spectatorMode=true を渡し、event の at は
//   射影で除外する (epic §8.3 DP-4)。物理移設はこの契約を変えない (メモ化・キャッシュ禁止)。

import type { GameState, Move, Player, Position } from "@/lib/shogi/types";
import { applyMove } from "@/lib/shogi/board";
import { isInCheck } from "@/lib/shogi/moves";
import { evaluateGameEnd } from "@/lib/shogi/rules";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";
import {
  MANA_PER_TURN,
  MANA_FAST_BONUS,
  FAST_THRESHOLD_MS,
} from "@/lib/shogi/cards/definitions";
import {
  applyCheckBreak,
  applyTrapClear,
  hasNoPromoteMark,
  addNoPromoteMark,
  removeNoPromoteMark,
  moveNoPromoteMark,
} from "@/lib/shogi/cards/effects";
import type { CardGameState, GameEvent } from "@/lib/shogi/cards/types";

// 移動処理のモード切替 (Issue #82 二手指し)。
// - "normal": 通常の指し手 (マナチャージ + 早指しタイマークリア)
// - "double_move_first": 二手指しの 1手目 (マナチャージなし + タイマークリアなし、ターン継続中)
// - "double_move_second": 二手指しの 2手目 (マナチャージなし、タイマークリアあり、ターン交代)
// 二手指しはカード使用扱いのため、1手目・2手目とも通常のマナチャージ (+1〜+2) は発生しない
// (カードコスト -6 のみ消費、これは CONFIRM_PLAY_CARD 側で処理済み)。
export type MakeMoveMode = "normal" | "double_move_first" | "double_move_second";

// 移動 + マナチャージ + トラップフィルタ を一括適用。
// reducer の CONFIRM_PROMOTION / MAKE_MOVE、および world-kernel の applyTurnAction から呼ばれる。
// Issue #235 S1c: reducer.ts から本 lib モジュールへ物理移設し、world-kernel → reducer の
// 逆依存を解消した (振る舞い不変・関数本体は無改変)。
export function makeMoveWithEffects(
  gameState: GameState,
  cardState: CardGameState,
  move: Move,
  // Issue #193 / PR1a: spectatorMode は CPU vs CPU 観戦モード時に true。
  // 早指し判定 (FAST_THRESHOLD_MS) を完全 disable し、両 CPU の連続指しによる
  // マナ蓄積異常を防ぐ。spectatorMode=false の人間プレイ時は完全に従来挙動を保持。
  options?: { mode?: MakeMoveMode; spectatorMode?: boolean },
): {
  gameState: GameState;
  cardState: CardGameState;
  events: GameEvent[];
  finalMove: Move;
  // 王手崩しトラップが発動した場合のみ true。MAKE_MOVE 側で isCheckBreakAnimating をセットする。
  triggeredCheckBreak: boolean;
} {
  const mode: MakeMoveMode = options?.mode ?? "normal";
  const spectatorMode = options?.spectatorMode ?? false;
  const opponent: Player = move.player === "sente" ? "gote" : "sente";
  const events: GameEvent[] = [];

  // 1. 成り宣言フィルタ
  //   (a) 自分の駒に既に「成り不可」マークがあれば silent ブロック (新規トラップは発火させない)
  //   (b) (a) でなく、相手が no_promote トラップをセット中なら新規発動
  //       → 成りブロック + 移動先位置にマーク追加 + トラップ消費
  let finalMove = move;
  let cardStateNext = cardState;
  let pendingMarkAdd: Position | null = null;

  const opponentTrap = cardState.trap[opponent];
  const ownMarkAtFrom =
    move.from !== undefined &&
    move.from !== null &&
    hasNoPromoteMark(cardState, move.player, move.from);

  if (move.promote && ownMarkAtFrom) {
    // 既マーク済み駒の成り宣言 → silent ブロック (トラップは無関係、消費しない)
    finalMove = { ...move, promote: false };
  } else if (move.promote && opponentTrap && opponentTrap.defId === "no_promote") {
    // 新規発動: 成り宣言を無効化し、移動後位置に永続マーク付与、トラップ消費
    finalMove = { ...move, promote: false };
    cardStateNext = applyTrapClear(cardStateNext, opponent);
    pendingMarkAdd = move.to;
    events.push({
      kind: "trapTriggerEvent",
      player: opponent,
      instance: opponentTrap,
      reason: "promotion_declared",
      at: Date.now(),
    });
  }

  // 2. 駒移動
  const nextGameState = applyMove(gameState, finalMove);

  // 3. 成り不可マークの追従処理 (move 系のみ。drop は対象外)
  if (finalMove.type === "move" && finalMove.from) {
    // (a) 取られた相手駒のマークがあれば削除 (case A: 取られたら消失)
    if (hasNoPromoteMark(cardStateNext, opponent, finalMove.to)) {
      cardStateNext = removeNoPromoteMark(cardStateNext, opponent, finalMove.to);
    }
    // (b) 自分の駒のマークを from → to に移動
    if (hasNoPromoteMark(cardStateNext, finalMove.player, finalMove.from)) {
      cardStateNext = moveNoPromoteMark(
        cardStateNext,
        finalMove.player,
        finalMove.from,
        finalMove.to,
      );
    }
  }

  // 4. トラップ発動分のマーク追加 (成り宣言を無効化した直後の駒位置に付与)
  if (pendingMarkAdd) {
    cardStateNext = addNoPromoteMark(cardStateNext, finalMove.player, pendingMarkAdd);
  }

  // 4.5 王手崩しトラップ (#82)
  // 移動の結果、相手 (= トラップ所有者候補) が王手中になり、かつ check_break
  // トラップがセットされていれば自動発動。王手駒すべてを盤上から除去し、
  // トラップ所有者の持ち駒に unpromote 加算する。
  let postTrapGameState = nextGameState;
  let triggeredCheckBreak = false;
  const opponentTrapPostMove = cardStateNext.trap[opponent];
  // この手の結果、相手の check_break トラップが発動条件 (相手玉が王手中) を満たすか。
  const wouldTriggerCheckBreak =
    !!opponentTrapPostMove &&
    opponentTrapPostMove.defId === "check_break" &&
    isInCheck(nextGameState, opponent, CARD_SHOGI_VARIANT);
  // Issue #220 / #222 検証修正: 二手指しの一手目 (double_move_first) は中間局面。
  // トラップはターン完了 (二手目) の最終局面でのみ発動すべきで、一手目では常に保留する。
  // 旧実装は「一手目が (トラップ未考慮の盤面で) 詰みなら例外的に発動」していたが、
  // check_break トラップがセットされている限り真の詰みは成立しない (トラップが王手駒を
  // 奪い王手を解除するため)。よって一手目発動は誤りで、二手目を指す前にトラップが暴発し、
  // 最終局面で王手している駒ではなく一手目の駒が奪われる不具合になっていた (検証で判明)。
  const deferCheckBreak = mode === "double_move_first";
  if (!deferCheckBreak && wouldTriggerCheckBreak) {
    const result = applyCheckBreak(nextGameState, opponent);
    if (result) {
      postTrapGameState = result.gameState;
      // 取られた相手 (= move.player) の駒に no_promote マークがあれば消失
      for (const cap of result.capturedPieces) {
        if (hasNoPromoteMark(cardStateNext, finalMove.player, { row: cap.row, col: cap.col })) {
          cardStateNext = removeNoPromoteMark(cardStateNext, finalMove.player, {
            row: cap.row,
            col: cap.col,
          });
        }
      }
      cardStateNext = applyTrapClear(cardStateNext, opponent);
      events.push({
        kind: "trapTriggerEvent",
        player: opponent,
        instance: opponentTrapPostMove,
        reason: "check_declared",
        capturedPieces: result.capturedPieces,
        at: Date.now(),
      });
      triggeredCheckBreak = true;
    }
  }

  // 5. ゲーム終了判定 + 移動イベントログ
  const evaluated = evaluateGameEnd(postTrapGameState, CARD_SHOGI_VARIANT);
  // Issue #220 / #222 検証修正: 二手指し一手目で check_break を保留した場合、形式上の
  // 詰み (トラップ未適用の盤面) は真の終局ではない (ターン完了後にトラップが王手を解除
  // する)。中間局面として active を維持し二手目を継続させる。これがないと MAKE_MOVE 側
  // gameOver 判定が偽の詰みで二手指しを打ち切り、二手目を指せなくなる。
  // (nextGameState は applyMove 直後で status="active"。evaluateGameEnd を通す前の値。)
  const resultGameState =
    deferCheckBreak && wouldTriggerCheckBreak ? nextGameState : evaluated;
  events.push({ kind: "moveEvent", move: finalMove, at: Date.now() });

  // 6. マナチャージ + lastTurnStartedAt クリア (mode で挙動を切替)
  if (mode === "normal") {
    // 通常の指し手: マナチャージ + 早指し判定 + タイマークリア
    const lastStarted = cardStateNext.lastTurnStartedAt[move.player];
    // Issue #193 / PR1a: 観戦モード時は早指し判定を完全スキップ (両 CPU が常に <4 秒で
    // 指してマナ蓄積が異常になることを防ぐ)。spectatorMode=false の人間プレイ時は
    // 完全に従来挙動を保持する。
    const isFastMove =
      !spectatorMode &&
      lastStarted !== null &&
      Date.now() - lastStarted < FAST_THRESHOLD_MS;
    const manaAmount =
      MANA_PER_TURN + (isFastMove ? MANA_FAST_BONUS : 0);
    cardStateNext = {
      ...cardStateNext,
      mana: {
        ...cardStateNext.mana,
        [move.player]: Math.min(
          cardStateNext.manaCap,
          cardStateNext.mana[move.player] + manaAmount,
        ),
      },
      lastTurnStartedAt: {
        ...cardStateNext.lastTurnStartedAt,
        [move.player]: null,
      },
    };
    events.push({
      kind: "manaChargeEvent",
      player: move.player,
      amount: manaAmount,
      reason: "turn",
      fastMove: isFastMove,
      at: Date.now(),
    });
  } else if (mode === "double_move_second") {
    // 二手指しの 2手目: マナチャージなし。lastTurnStartedAt のみクリア (ターン交代)
    cardStateNext = {
      ...cardStateNext,
      lastTurnStartedAt: {
        ...cardStateNext.lastTurnStartedAt,
        [move.player]: null,
      },
    };
  }
  // mode === "double_move_first": どちらもしない (ターン継続中のため)

  return {
    gameState: resultGameState,
    cardState: cardStateNext,
    events,
    finalMove,
    triggeredCheckBreak,
  };
}
