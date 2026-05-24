// Issue #222: deriveAnimationSteps の単体テスト。
// 「カード使用 → 王手 → トラップ → ドロー」の共通順序へ正しく並べ替えられること、
// 王手崩しセレモニー時に王手段が二重化しないこと、装飾イベント単体では空になることを検証する。

import { describe, it, expect } from "vitest";
import { deriveAnimationSteps } from "../animation-steps";
import type { CardId, GameEvent } from "@/lib/shogi/cards/types";
import type { Move } from "@/lib/shogi/types";

// ----- イベント fixture ヘルパ (テスト可読性のため最小フィールドのみ) -----

const sampleMove: Move = {
  type: "move",
  piece: "rook",
  from: { row: 7, col: 7 },
  to: { row: 2, col: 7 },
  player: "sente",
  promote: false,
};

function moveEvent(): GameEvent {
  return { kind: "moveEvent", move: sampleMove, at: 1 };
}
function manaChargeEvent(): GameEvent {
  return { kind: "manaChargeEvent", player: "sente", amount: 1, reason: "turn", at: 2 };
}
function cardPlayEvent(defId: CardId = "mana_up"): GameEvent {
  return {
    kind: "cardPlayEvent",
    player: "sente",
    instance: { instanceId: "c1", defId },
    at: 3,
  };
}
function trapSetEvent(): GameEvent {
  return {
    kind: "trapSetEvent",
    player: "sente",
    instance: { instanceId: "t1", defId: "check_break", owner: "sente" },
    at: 4,
  };
}
function checkBreakTrigger(captured = 1): GameEvent {
  return {
    kind: "trapTriggerEvent",
    player: "gote",
    instance: { instanceId: "t1", defId: "check_break", owner: "gote" },
    reason: "check_declared",
    capturedPieces: Array.from({ length: captured }, (_, i) => ({
      row: i,
      col: 0,
      pieceType: "pawn",
      originalPieceType: "pawn",
      originalOwner: "sente" as const,
    })),
    at: 5,
  };
}
function simpleTrapTrigger(): GameEvent {
  // no_promote 等の即時オーバーレイ型 (capturedPieces 無し)。
  return {
    kind: "trapTriggerEvent",
    player: "gote",
    instance: { instanceId: "t2", defId: "no_promote", owner: "gote" },
    reason: "promotion_declared",
    at: 6,
  };
}
function drawEvent(source: "manual" | "auto" = "auto"): GameEvent {
  return {
    kind: "drawEvent",
    player: "sente",
    instance: { instanceId: "d1", defId: "mana_up" },
    source,
    at: 7,
  };
}

describe("deriveAnimationSteps", () => {
  it("装飾イベント (move / manaCharge) のみ・王手なしなら空配列", () => {
    expect(
      deriveAnimationSteps([moveEvent(), manaChargeEvent()], { showCheck: false }),
    ).toEqual([]);
  });

  it("空イベントなら空配列", () => {
    expect(deriveAnimationSteps([], { showCheck: false })).toEqual([]);
  });

  it("駒移動で王手 → check ステップのみ", () => {
    const steps = deriveAnimationSteps([moveEvent(), manaChargeEvent()], {
      showCheck: true,
    });
    expect(steps.map((s) => s.kind)).toEqual(["check"]);
  });

  it("カード使用のみ → cardUse ステップ", () => {
    const steps = deriveAnimationSteps([cardPlayEvent(), manaChargeEvent()], {
      showCheck: false,
    });
    expect(steps.map((s) => s.kind)).toEqual(["cardUse"]);
  });

  it("トラップ設置 (trapSetEvent) も cardUse 扱い", () => {
    const steps = deriveAnimationSteps([trapSetEvent()], { showCheck: false });
    expect(steps.map((s) => s.kind)).toEqual(["cardUse"]);
  });

  it("カード使用 + 王手 → cardUse → check の順", () => {
    const steps = deriveAnimationSteps([cardPlayEvent(), moveEvent()], {
      showCheck: true,
    });
    expect(steps.map((s) => s.kind)).toEqual(["cardUse", "check"]);
  });

  it("即時トラップ + 王手 → check → trap の順 (セレモニーでないので王手は出す)", () => {
    const steps = deriveAnimationSteps([moveEvent(), simpleTrapTrigger()], {
      showCheck: true,
    });
    expect(steps.map((s) => s.kind)).toEqual(["check", "trap"]);
  });

  it("王手崩しセレモニーは王手段を内包 → 独立 check ステップを抑制", () => {
    const steps = deriveAnimationSteps([moveEvent(), checkBreakTrigger()], {
      showCheck: true,
    });
    // check は出さず trap のみ
    expect(steps.map((s) => s.kind)).toEqual(["trap"]);
  });

  it("capturedPieces 無しの check_break は即時扱い → 王手は抑制しない", () => {
    const ev: GameEvent = {
      kind: "trapTriggerEvent",
      player: "gote",
      instance: { instanceId: "t1", defId: "check_break", owner: "gote" },
      reason: "check_declared",
      at: 5,
    };
    const steps = deriveAnimationSteps([moveEvent(), ev], { showCheck: true });
    expect(steps.map((s) => s.kind)).toEqual(["check", "trap"]);
  });

  it("二手指し 2 手目相当: cardPlay + move + manaCharge + 王手崩し → cardUse → trap", () => {
    const steps = deriveAnimationSteps(
      [cardPlayEvent(), moveEvent(), manaChargeEvent(), checkBreakTrigger()],
      { showCheck: true },
    );
    expect(steps.map((s) => s.kind)).toEqual(["cardUse", "trap"]);
  });

  it("全部入り (cardPlay + move + manaCharge + 王手崩し + 自動ドロー) → cardUse → trap → draw", () => {
    const steps = deriveAnimationSteps(
      [cardPlayEvent(), moveEvent(), manaChargeEvent(), checkBreakTrigger(), drawEvent("auto")],
      { showCheck: true },
    );
    expect(steps.map((s) => s.kind)).toEqual(["cardUse", "trap", "draw"]);
  });

  it("通常手 + 即時トラップ + 自動ドロー + 王手 → check → trap → draw", () => {
    const steps = deriveAnimationSteps(
      [moveEvent(), manaChargeEvent(), simpleTrapTrigger(), drawEvent("auto")],
      { showCheck: true },
    );
    expect(steps.map((s) => s.kind)).toEqual(["check", "trap", "draw"]);
  });

  it("ドロー演出は常に最後 (出現順を保持)", () => {
    const steps = deriveAnimationSteps([drawEvent("manual"), manaChargeEvent()], {
      showCheck: false,
    });
    expect(steps.map((s) => s.kind)).toEqual(["draw"]);
    const drawStep = steps[0];
    expect(drawStep.kind === "draw" && drawStep.event.source).toBe("manual");
  });

  it("ステップは元イベントへの参照を保持する", () => {
    const cp = cardPlayEvent();
    const steps = deriveAnimationSteps([cp], { showCheck: false });
    expect(steps[0].kind === "cardUse" && steps[0].event).toBe(cp);
  });

  it("複数トラップ発動は出現順に並ぶ", () => {
    const t1 = simpleTrapTrigger();
    const t2 = checkBreakTrigger();
    const steps = deriveAnimationSteps([t1, t2], { showCheck: false });
    // どちらも trap。check_break が混ざるが showCheck=false なので check は元々無し
    expect(steps.map((s) => s.kind)).toEqual(["trap", "trap"]);
    expect(steps[0].kind === "trap" && steps[0].event).toBe(t1);
    expect(steps[1].kind === "trap" && steps[1].event).toBe(t2);
  });
});
