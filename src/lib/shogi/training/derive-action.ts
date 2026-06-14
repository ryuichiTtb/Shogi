// 1 decision で生じた GameEvent 束から、採用された TurnAction を導出する
// (Issue #245 フェーズ0, P0-3)。
//
// 人間対局のキャプチャは reducer の eventLog 伸長を監視し、伸びた events 束から
// 「その decision の TurnAction」を逆算する。自己対戦 (P0-4) は action を直接持つため
// 本関数は人間対局専用だが、純粋関数として training/ に置き単体テストする。
//
// 優先順位 (1 decision の events 束に decision-starter は 1 種のみ現れる前提だが防御的に順序付け):
//   1. cardPlayEvent  → playCard (通常カード / double_move = events に move×2 を内包)
//   2. trapSetEvent   → playCard (トラップカード設置 = check_break / no_promote)
//   3. moveEvent      → move     (manaCharge / trapTrigger / auto-draw は move に付随)
//   4. drawEvent(手動) → draw     (auto-draw は手番終了の副作用であり独立 decision でない)
// いずれも無ければ null (= サンプル化しない)。

import type { GameEvent } from "@/lib/shogi/cards/types";
import type { TurnAction } from "@/lib/shogi/kernel/turn-action-types";

function findKind<K extends GameEvent["kind"]>(
  events: readonly GameEvent[],
  kind: K,
): Extract<GameEvent, { kind: K }> | undefined {
  return events.find((e): e is Extract<GameEvent, { kind: K }> => e.kind === kind);
}

export function deriveActionFromEvents(events: readonly GameEvent[]): TurnAction | null {
  const cardPlay = findKind(events, "cardPlayEvent");
  if (cardPlay) {
    return {
      kind: "playCard",
      cardInstanceId: cardPlay.instance.instanceId,
      defId: cardPlay.instance.defId,
      target: cardPlay.target,
    };
  }

  const trapSet = findKind(events, "trapSetEvent");
  if (trapSet) {
    return {
      kind: "playCard",
      cardInstanceId: trapSet.instance.instanceId,
      defId: trapSet.instance.defId,
    };
  }

  const move = findKind(events, "moveEvent");
  if (move) {
    return { kind: "move", move: move.move };
  }

  const manualDraw = events.find(
    (e): e is Extract<GameEvent, { kind: "drawEvent" }> => e.kind === "drawEvent" && e.source !== "auto",
  );
  if (manualDraw) {
    return { kind: "draw" };
  }

  return null;
}
