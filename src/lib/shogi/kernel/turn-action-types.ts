// Issue #235 S4d-1 (epic §6 7.5⑤): TurnAction 型を L0 (kernel) 中立 location へ昇格。
//
// 背景: world-kernel.ts (L0) が `TurnAction` を ai/turn/types (L2) から import していた
// (L0→L2 型逆依存)。TurnAction は「カーネルが適用する 1 ターンの行動」= L0 の語彙であり、
// L0/L2 双方が参照する中立型として kernel 配下に置くのが正しい依存方向 (L0 所有 → L2 consume)。
//
// 移行: 本ファイルが定義の唯一の源。ai/turn/types は本型を re-export し、既存 importer
// (ai 層内・hooks 等) は変更不要 (型のみ移動 = 実行時影響ゼロ)。world-kernel は本ファイルから
// 直接 import して逆依存を解消する。

import type { CardId, CardTarget } from "@/lib/shogi/cards/types";
import type { Move } from "@/lib/shogi/types";

// AI 探索 / カーネルが扱う統一行動型。
// - move: 通常の駒指し (既存 Move の薄いラッパ)
// - draw: 山札ドロー (マナ DRAW_COST 消費)
// - playCard: 手札カード使用 (def.cost マナ消費 + 効果適用)
export type TurnAction =
  | { kind: "move"; move: Move }
  | { kind: "draw" }
  | { kind: "playCard"; cardInstanceId: string; defId: CardId; target?: CardTarget };
