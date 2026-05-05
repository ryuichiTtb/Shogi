import { describe, expect, it } from "vitest";

import type { GameEvent } from "@/lib/shogi/cards/types";
import type { Move, Player } from "@/lib/shogi/types";
import { getUndoScope, isCardOpEvent } from "../undo-policy";

// ===== fixtures =====

let nowCounter = 0;
function now() {
  return ++nowCounter;
}

function moveEv(player: Player): GameEvent {
  // 内容は player フィールドさえ正しければ getUndoScope の判定対象として十分
  const move: Move = {
    type: "move",
    from: { row: 0, col: 0 },
    to: { row: 0, col: 0 },
    piece: "pawn",
    player,
  };
  return { kind: "moveEvent", move, at: now() };
}

function manaChargeEv(player: Player, amount = 1): GameEvent {
  return { kind: "manaChargeEvent", player, amount, reason: "turn", at: now() };
}

function cardPlayEv(player: Player): GameEvent {
  return {
    kind: "cardPlayEvent",
    player,
    instance: { instanceId: "x", defId: "pawn_return" },
    at: now(),
  };
}

function drawEv(player: Player): GameEvent {
  return {
    kind: "drawEvent",
    player,
    instance: { instanceId: "x", defId: "pawn_return" },
    at: now(),
  };
}

function trapSetEv(player: Player): GameEvent {
  return {
    kind: "trapSetEvent",
    player,
    instance: { instanceId: "x", defId: "no_promote", owner: player },
    at: now(),
  };
}

function trapTriggerEv(player: Player, defId: "no_promote" | "check_break"): GameEvent {
  return {
    kind: "trapTriggerEvent",
    player,
    instance: { instanceId: "x", defId, owner: player },
    reason: defId === "no_promote" ? "promotion_declared" : "check_declared",
    at: now(),
  };
}

// ===== isCardOpEvent =====

describe("isCardOpEvent", () => {
  it("cardPlayEvent / drawEvent / trapSetEvent / trapTriggerEvent はカード操作", () => {
    expect(isCardOpEvent(cardPlayEv("sente"))).toBe(true);
    expect(isCardOpEvent(drawEv("sente"))).toBe(true);
    expect(isCardOpEvent(trapSetEv("sente"))).toBe(true);
    expect(isCardOpEvent(trapTriggerEv("sente", "no_promote"))).toBe(true);
    expect(isCardOpEvent(trapTriggerEv("sente", "check_break"))).toBe(true);
  });

  it("moveEvent / manaChargeEvent はカード操作ではない", () => {
    expect(isCardOpEvent(moveEv("sente"))).toBe(false);
    expect(isCardOpEvent(manaChargeEv("sente"))).toBe(false);
  });
});

// ===== getUndoScope =====

describe("getUndoScope", () => {
  it("[1] 空ログ → null (履歴なし)", () => {
    expect(getUndoScope([])).toBeNull();
  });

  it("[2] moveEvent 1 件のみ → null (履歴不足)", () => {
    const log: GameEvent[] = [moveEv("sente"), manaChargeEv("sente")];
    expect(getUndoScope(log)).toBeNull();
  });

  it("[3] 同色 moveEvent 2 件のみ (二手指し開始時) → null (相手手番境界に到達せず)", () => {
    const log: GameEvent[] = [moveEv("sente"), moveEv("sente")];
    expect(getUndoScope(log)).toBeNull();
  });

  it("[4] 異色 moveEvent 2 件 (sente → gote)、カード操作なし → 巻き戻し可能 (sente moveEvent index)", () => {
    const log: GameEvent[] = [
      /* 0 */ moveEv("sente"),
      /* 1 */ manaChargeEv("sente"),
      /* 2 */ moveEv("gote"),
      /* 3 */ manaChargeEv("gote"),
    ];
    // 末尾から: gote → sente (playerChanges=1)、ログ末尾到達。movesSeen=2 で sente の index=0 が scopeStartIndex
    expect(getUndoScope(log)).toBe(0);
  });

  it("[5] moveEvent 3 件 (sente → gote → sente) でカード操作なし → 巻き戻し可能 (2 番目 sente の index)", () => {
    const log: GameEvent[] = [
      /* 0 */ moveEv("sente"),
      /* 1 */ manaChargeEv("sente"),
      /* 2 */ moveEv("gote"),
      /* 3 */ manaChargeEv("gote"),
      /* 4 */ moveEv("sente"),
      /* 5 */ manaChargeEv("sente"),
      /* 6 */ moveEv("gote"),
      /* 7 */ manaChargeEv("gote"),
    ];
    // 末尾から: gote(idx6) → sente(idx4, ms=2 → scopeStartIndex=4) → gote(idx2, playerChanges=2 → break)
    expect(getUndoScope(log)).toBe(4);
  });

  it("[6] 通常カード使用直後 (cardPlayEvent → gote moveEvent) → null (block)", () => {
    const log: GameEvent[] = [
      moveEv("sente"),
      manaChargeEv("sente"),
      moveEv("gote"),
      manaChargeEv("gote"),
      cardPlayEv("sente"),
      moveEv("gote"),
      manaChargeEv("gote"),
    ];
    // 末尾から: gote(ms=1) → cardPlayEvent → block
    expect(getUndoScope(log)).toBeNull();
  });

  it("[7] 二手指し使用直後 (cardPlayEvent → 1手目 → 2手目 → gote moveEvent) → null (block)", () => {
    const log: GameEvent[] = [
      moveEv("sente"),
      manaChargeEv("sente"),
      moveEv("gote"),
      manaChargeEv("gote"),
      cardPlayEv("sente"),
      moveEv("sente"), // 1手目
      moveEv("sente"), // 2手目
      moveEv("gote"),
      manaChargeEv("gote"),
    ];
    // 末尾から: gote(ms=1) → sente 2手目 (playerChanges=1, ms=2)
    //          → sente 1手目 (同色、変化なし、ms=3)
    //          → cardPlayEvent → block
    expect(getUndoScope(log)).toBeNull();
  });

  it("[8] カード使用 2 ターン以上前 (中間で通常 1 ターン経過) → 巻き戻し可能", () => {
    const log: GameEvent[] = [
      // ... earlier
      cardPlayEv("sente"), // 2 ターン前
      moveEv("gote"),
      manaChargeEv("gote"),
      // 直近 2 ターン
      moveEv("sente"),
      manaChargeEv("sente"),
      moveEv("gote"),
      manaChargeEv("gote"),
    ];
    // 末尾から: gote(ms=1) → sente(ms=2, scopeStartIndex=3, playerChanges=1)
    //          → gote(playerChanges=2, break)
    // cardPlayEvent には到達しない (= 過去 2 ターンに含まれない) → allow
    expect(getUndoScope(log)).toBe(3);
  });

  it("[9] drawEvent in scope → null (block)", () => {
    const log: GameEvent[] = [
      moveEv("sente"),
      moveEv("gote"),
      drawEv("sente"),
      moveEv("gote"),
    ];
    expect(getUndoScope(log)).toBeNull();
  });

  it("[10] trapSetEvent in scope → null (block)", () => {
    const log: GameEvent[] = [
      moveEv("sente"),
      moveEv("gote"),
      trapSetEv("sente"),
      moveEv("gote"),
    ];
    expect(getUndoScope(log)).toBeNull();
  });

  it("[11] trapTriggerEvent (no_promote) in scope → null (block)", () => {
    // 相手 (gote) の手で自分 (sente) の no_promote が発動する典型ケース
    const log: GameEvent[] = [
      moveEv("sente"),
      moveEv("gote"),
      // sente の番、トラップを置いたわけではないが、過去に置いていた no_promote が発動
      trapTriggerEv("sente", "no_promote"),
      moveEv("gote"),
    ];
    expect(getUndoScope(log)).toBeNull();
  });

  it("[12] trapTriggerEvent (check_break) in scope → null (block)", () => {
    const log: GameEvent[] = [
      moveEv("sente"),
      moveEv("gote"),
      trapTriggerEv("sente", "check_break"),
      moveEv("gote"),
    ];
    expect(getUndoScope(log)).toBeNull();
  });

  it("[13] 4 ターン以上前のカード操作 → スキャン対象外 (allow)", () => {
    // スキャンが必要以上に遡らず、直近 2 ターン境界 (3 つ目 moveEvent) で正しく break
    // することを検証。古い cardPlayEvent には到達しない。
    const log: GameEvent[] = [
      /* 0 */ cardPlayEv("sente"), // 5 ターン前 — スキャン対象外
      /* 1 */ moveEv("gote"),       // 4 ターン前
      /* 2 */ moveEv("sente"),      // 3 ターン前 — ここで break (3 つ目 moveEvent)
      /* 3 */ moveEv("gote"),       // 2 ターン前
      /* 4 */ moveEv("sente"),      // 直近 (sente の 1 ターン前)
      /* 5 */ moveEv("gote"),       // 直近 (gote の最新手)
    ];
    // 末尾から: gote(idx5, ms=1) → sente(idx4, ms=2, scopeStartIndex=4, playerChanges=1)
    //          → gote(idx3, playerChanges=2, break)
    // log[0..2] には到達せず、cardPlayEvent もスキャンしない → allow
    expect(getUndoScope(log)).toBe(4);
  });
});
