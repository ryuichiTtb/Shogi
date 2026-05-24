// Issue #222: カード将棋の演出を共通ルールで直列化するための純粋関数。
//
// 背景:
// reducer は 1 ターン分のイベント (cardPlayEvent / moveEvent / manaChargeEvent /
// trapTriggerEvent / drawEvent) を 1 回の更新でまとめて eventLog へ積む。従来は
// それらを差分監視 useEffect が 1 ループで即時・並行発火していたため、複数の
// 大きな演出 (カード使用中央 / 王手 / トラップ発動 / 山札ドロー) が重なって
// 再生され、何が起きているか分かりにくかった。
//
// 本関数は「新規イベント列」を受け取り、ユーザー確定の共通順序
//   (1) カード使用 → (2) 王手 → (3) トラップ発動 → (4) 山札ドロー
// に並べ替えた「演出ステップ列」を返す。実際の DOMRect 解決・SFX・state 反映
// (= 副作用) は呼び出し側オーケストレータがステップを 1 つずつ activate する
// 時点で行う。本関数はあくまで「どの演出をどの順で出すか」だけを決める純粋関数で、
// ai-action-bridge.ts と同じ「純粋関数 + 単体テスト」方針で品質を担保する。
//
// 設計上の判断:
// - 並び順は手番側 (自分/相手) に依らず常に同一のため、playerColor は引数に取らない
//   (自分側か相手 AI 側かの分岐は activate 時の rect / queue 選択でのみ必要)。
// - 王手にはイベントが存在せず gameState から isInCheck で導出される。呼び出し側が
//   過渡的自玉王手 (二手指し 1 手目) 等の抑制を適用済みの最終真偽値 showCheck を
//   渡す。これにより本関数は純粋・テスト可能なまま王手を正しい位置へ差し込める。
// - 王手崩しセレモニー (check_break trapTrigger) は内部で「王手 → トラップ」の
//   2 段を含むため、別途 check ステップを出すと王手演出が二重になる。セレモニーが
//   ある場合は独立 check ステップを抑制する。

import type { GameEvent } from "@/lib/shogi/cards/types";

// 直列化対象の「大きな 4 演出」。軽量装飾 (マナ浮遊 / 早指しバッジ / 移動 SE 等) は
// 直列化せず各ステップに付随して即時発火する (ユーザー確定方針: テンポ最適化)。
export type AnimationStep =
  | {
      kind: "cardUse";
      // カード使用 (通常カード) もしくはトラップ設置。どちらも「カードを使う」演出。
      event: Extract<GameEvent, { kind: "cardPlayEvent" } | { kind: "trapSetEvent" }>;
    }
  | { kind: "check" }
  | {
      kind: "trap";
      // トラップ「発動」(王手崩しセレモニー / no_promote 即時オーバーレイ等)。
      event: Extract<GameEvent, { kind: "trapTriggerEvent" }>;
    }
  | {
      kind: "draw";
      event: Extract<GameEvent, { kind: "drawEvent" }>;
    };

export interface DeriveAnimationStepsContext {
  // このイベントバッチの結果、王手演出を出すべきか。呼び出し側が gameState から
  // isInCheck で判定し、二手指し 1 手目の過渡的自玉王手等の抑制も適用済みの
  // 最終真偽値を渡す。
  showCheck: boolean;
}

// 王手崩しセレモニー (王手 → トラップ発動 → 駒フライトの 3 段演出) を伴う
// trapTrigger かどうか。capturedPieces が無い場合は即時オーバーレイのみ (= 王手段を
// 内包しない) なので、独立 check ステップは抑制しない。
function isCheckBreakCeremony(
  ev: Extract<GameEvent, { kind: "trapTriggerEvent" }>,
): boolean {
  return ev.instance.defId === "check_break" && (ev.capturedPieces?.length ?? 0) > 0;
}

/**
 * 新規イベント列を共通順序 (カード使用 → 王手 → トラップ → ドロー) の演出ステップ列へ変換する。
 *
 * @param events eventLog の差分 (今回新たに積まれたイベント) の配列
 * @param ctx    王手表示可否などイベントから導出できない文脈
 * @returns 再生順に並んだ演出ステップ列。対象演出が無いイベント (moveEvent /
 *          manaChargeEvent 単体) のみの場合は空配列。
 */
export function deriveAnimationSteps(
  events: GameEvent[],
  ctx: DeriveAnimationStepsContext,
): AnimationStep[] {
  const steps: AnimationStep[] = [];

  // (1) カード使用 / トラップ設置 — 出現順 (通常は 1 バッチに高々 1 件)。
  for (const ev of events) {
    if (ev.kind === "cardPlayEvent" || ev.kind === "trapSetEvent") {
      steps.push({ kind: "cardUse", event: ev });
    }
  }

  const trapTriggers = events.filter(
    (ev): ev is Extract<GameEvent, { kind: "trapTriggerEvent" }> =>
      ev.kind === "trapTriggerEvent",
  );
  const hasCheckBreakCeremony = trapTriggers.some(isCheckBreakCeremony);

  // (2) 王手 — 王手崩しセレモニーが王手段を内包する場合は独立ステップを出さない。
  if (ctx.showCheck && !hasCheckBreakCeremony) {
    steps.push({ kind: "check" });
  }

  // (3) トラップ発動 — 出現順。
  for (const ev of trapTriggers) {
    steps.push({ kind: "trap", event: ev });
  }

  // (4) 山札ドロー — 出現順。自動ドローは applyTurnEndEffects がバッチ末尾に積むため
  //     常に最後に来る (手動ドローと自動ドローが同一バッチに同居することはない)。
  for (const ev of events) {
    if (ev.kind === "drawEvent") {
      steps.push({ kind: "draw", event: ev });
    }
  }

  return steps;
}
