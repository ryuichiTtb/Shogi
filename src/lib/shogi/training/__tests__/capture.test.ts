import { describe, expect, it } from "vitest";

import { createInitialGameState } from "@/lib/shogi/board";
import { createInitialCardState } from "@/lib/shogi/cards/state";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";
import type { GameEvent } from "@/lib/shogi/cards/types";
import type { Move } from "@/lib/shogi/types";

import { captureSamples, captureStep, createCaptureState, type CaptureWorld } from "../capture";

const gs = createInitialGameState(CARD_SHOGI_VARIANT);
const cs = createInitialCardState([{ defId: "pawn_return", count: 2 }]);

function world(eventLog: GameEvent[], doubleMove: object | null = null): CaptureWorld {
  return { gameState: gs, cardState: cs, doubleMove, eventLog };
}

const m1: Move = { type: "move", from: { row: 6, col: 7 }, to: { row: 5, col: 7 }, piece: "pawn", player: "sente" };
const m2: Move = { type: "move", from: { row: 2, col: 7 }, to: { row: 3, col: 7 }, piece: "pawn", player: "gote" };
const moveEv = (m: Move, at: number): GameEvent => ({ kind: "moveEvent", move: m, at });
const manaEv = (p: "sente" | "gote", at: number): GameEvent => ({ kind: "manaChargeEvent", player: p, amount: 1, reason: "turn", at });

describe("captureStep", () => {
  it("2手指す → 2サンプル (plyIndex 0,1、action=move、events は累積でなく当該 decision の差分)", () => {
    const cap = createCaptureState();
    captureStep(cap, world([])); // 初期 render (prev=null)
    captureStep(cap, world([moveEv(m1, 1), manaEv("sente", 2)])); // 1手目 → sample0
    captureStep(cap, world([moveEv(m1, 1), manaEv("sente", 2), moveEv(m2, 3), manaEv("gote", 4)])); // 2手目 → sample1

    const samples = captureSamples(cap);
    expect(samples).toHaveLength(2);
    expect(samples[0].plyIndex).toBe(0);
    expect(samples[0].action).toEqual({ kind: "move", move: m1 });
    expect(samples[0].events).toHaveLength(2); // moveEvent + manaCharge (差分のみ)
    expect(samples[1].plyIndex).toBe(1);
    expect(samples[1].action).toEqual({ kind: "move", move: m2 });
    expect(samples[1].events).toHaveLength(2);
  });

  it("二手指し: 進行中は保留し、ターン完了で cardPlay + move×2 を 1 サンプルに畳む", () => {
    const cap = createCaptureState();
    captureStep(cap, world([])); // カード宣言直前 (pre-world len 0)
    captureStep(cap, world([], { active: "sente" })); // CONFIRM_PLAY_CARD: eventLog 不変・doubleMove セット → 保留
    captureStep(cap, world([moveEv(m1, 1)], { active: "sente" })); // 1手目: doubleMove 継続 → 保留
    const cardPlay: GameEvent = {
      kind: "cardPlayEvent",
      player: "sente",
      instance: { instanceId: "d1", defId: "double_move" },
      at: 3,
    };
    captureStep(cap, world([moveEv(m1, 1), moveEv(m2, 2), cardPlay], null)); // 2手目完了 → 確定

    const samples = captureSamples(cap);
    expect(samples).toHaveLength(1);
    expect(samples[0].action).toEqual({ kind: "playCard", cardInstanceId: "d1", defId: "double_move" });
    expect(samples[0].events).toHaveLength(3); // move, move, cardPlay
  });

  it("待った (eventLog 縮小) → 巻き戻った decision のサンプルを破棄し、再開後の plyIndex も整合", () => {
    const cap = createCaptureState();
    captureStep(cap, world([]));
    captureStep(cap, world([moveEv(m1, 1)])); // sample0 (len1)
    captureStep(cap, world([moveEv(m1, 1), moveEv(m2, 2)])); // sample1 (len2)
    expect(captureSamples(cap)).toHaveLength(2);

    captureStep(cap, world([moveEv(m1, 1)])); // UNDO: len1 へ縮小 → sample1 破棄
    expect(captureSamples(cap)).toHaveLength(1);

    const m3: Move = { type: "move", from: { row: 2, col: 6 }, to: { row: 3, col: 6 }, piece: "pawn", player: "gote" };
    captureStep(cap, world([moveEv(m1, 1), moveEv(m3, 5)])); // 別の手 → 再 push
    const samples = captureSamples(cap);
    expect(samples).toHaveLength(2);
    expect(samples[1].plyIndex).toBe(1);
    expect(samples[1].action).toEqual({ kind: "move", move: m3 });
  });

  it("auto-draw のみの伸長 → 独立 decision でないためサンプルを作らない", () => {
    const cap = createCaptureState();
    captureStep(cap, world([]));
    const autoDraw: GameEvent = {
      kind: "drawEvent",
      player: "sente",
      instance: { instanceId: "c", defId: "mana_up" },
      source: "auto",
      at: 1,
    };
    captureStep(cap, world([autoDraw]));
    expect(captureSamples(cap)).toHaveLength(0);
  });

  it("手動ドロー → 1サンプル (action=draw)", () => {
    const cap = createCaptureState();
    captureStep(cap, world([]));
    const drawEv: GameEvent = {
      kind: "drawEvent",
      player: "sente",
      instance: { instanceId: "c1", defId: "pawn_return" },
      source: "manual",
      at: 1,
    };
    captureStep(cap, world([drawEv]));
    const samples = captureSamples(cap);
    expect(samples).toHaveLength(1);
    expect(samples[0].action).toEqual({ kind: "draw" });
  });

  it("カード2枚を別 decision で使用 → 2サンプル (plyIndex 0,1)", () => {
    const cap = createCaptureState();
    captureStep(cap, world([]));
    const cp1: GameEvent = { kind: "cardPlayEvent", player: "sente", instance: { instanceId: "a", defId: "pawn_return" }, at: 1 };
    captureStep(cap, world([cp1]));
    const cp2: GameEvent = { kind: "cardPlayEvent", player: "sente", instance: { instanceId: "b", defId: "pawn_return" }, at: 2 };
    captureStep(cap, world([cp1, cp2]));
    const samples = captureSamples(cap);
    expect(samples).toHaveLength(2);
    expect(samples[0].action).toMatchObject({ kind: "playCard", cardInstanceId: "a" });
    expect(samples[1].plyIndex).toBe(1);
    expect(samples[1].action).toMatchObject({ kind: "playCard", cardInstanceId: "b" });
  });

  it("カード使用後に auto-draw が伸長しても追加サンプルは作らない", () => {
    const cap = createCaptureState();
    captureStep(cap, world([]));
    const cp: GameEvent = { kind: "cardPlayEvent", player: "sente", instance: { instanceId: "a", defId: "pawn_return" }, at: 1 };
    captureStep(cap, world([cp]));
    expect(captureSamples(cap)).toHaveLength(1);
    const auto: GameEvent = { kind: "drawEvent", player: "sente", instance: { instanceId: "z", defId: "pawn_return" }, source: "auto", at: 2 };
    captureStep(cap, world([cp, auto]));
    expect(captureSamples(cap)).toHaveLength(1);
  });
});
