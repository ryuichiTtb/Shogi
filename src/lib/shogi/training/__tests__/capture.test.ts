import { describe, expect, it } from "vitest";

import { createInitialGameState } from "@/lib/shogi/board";
import { createInitialCardState } from "@/lib/shogi/cards/state";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";
import type { GameEvent } from "@/lib/shogi/cards/types";
import type { Move } from "@/lib/shogi/types";

import {
  captureSamples,
  captureStep,
  captureStorageSnapshot,
  createCaptureState,
  restoreCaptureState,
  type CaptureWorld,
} from "../capture";

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

describe("captureStorageSnapshot / restoreCaptureState (リロード耐性)", () => {
  function buildCapWith2Samples() {
    const cap = createCaptureState();
    captureStep(cap, world([]));
    captureStep(cap, world([moveEv(m1, 1)]));
    captureStep(cap, world([moveEv(m1, 1), moveEv(m2, 2)]));
    return cap; // samples=2, plyCounter=2
  }

  it("round-trip: snapshot → restore で samples 本体と plyCounter を保持し、prev は null", () => {
    const snap = captureStorageSnapshot(buildCapWith2Samples());
    expect(snap.samples).toHaveLength(2);
    expect(snap.plyCounter).toBe(2);

    const restored = restoreCaptureState(snap);
    expect(captureSamples(restored)).toEqual(snap.samples);
    expect(restored.plyCounter).toBe(2);
    expect(restored.prev).toBeNull();
  });

  it("復元 → post-reload で追加(plyIndex 連番継続・復元分は保持)", () => {
    const restored = restoreCaptureState(captureStorageSnapshot(buildCapWith2Samples()));
    captureStep(restored, world([])); // post-reload: eventLog 空から再スタート (prev セット)
    captureStep(restored, world([moveEv(m1, 1)])); // 新規追加
    const samples = captureSamples(restored);
    expect(samples).toHaveLength(3); // 復元2 + 新規1
    expect(samples[2].plyIndex).toBe(2); // plyCounter 連番継続 (plyIndex 重複なし)
  });

  it("復元 → post-reload の待った(eventLog 縮小)で復元サンプルを誤 pop しない(本丸)", () => {
    const restored = restoreCaptureState(captureStorageSnapshot(buildCapWith2Samples()));
    captureStep(restored, world([])); // prev セット
    captureStep(restored, world([moveEv(m1, 1)])); // post sample (len1)
    captureStep(restored, world([moveEv(m1, 1), moveEv(m2, 2)])); // post sample (len2)
    expect(captureSamples(restored)).toHaveLength(4); // 復元2 + post2
    captureStep(restored, world([moveEv(m1, 1)])); // 待った: len2→1
    expect(captureSamples(restored)).toHaveLength(3); // post 末尾1だけ pop、復元2は不変
  });

  it("復元 → eventLog を 0 まで縮小しても復元サンプルは残る", () => {
    const restored = restoreCaptureState(captureStorageSnapshot(buildCapWith2Samples()));
    captureStep(restored, world([])); // prev len0
    captureStep(restored, world([moveEv(m1, 1)])); // post sample (len1)
    expect(captureSamples(restored)).toHaveLength(3);
    captureStep(restored, world([])); // 縮小 len1→0
    expect(captureSamples(restored)).toHaveLength(2); // post pop、復元2残存
  });

  it("空 snapshot 復元 = createCaptureState 相当", () => {
    const restored = restoreCaptureState({ samples: [], plyCounter: 0 });
    expect(captureSamples(restored)).toEqual([]);
    expect(restored.plyCounter).toBe(0);
    expect(restored.prev).toBeNull();
  });
});
