// Issue #193 / PR1b (Phase 3): 探索ホットパス専用の合法手生成。
//
// 設計意図:
// 探索 (negamax / quiescence / findBestMove root) で呼ばれる合法手生成を、
// 既存 `getFullLegalMoves` (src/lib/shogi/moves.ts) と **別シンボル化** する。
// 現時点では透過的な wrap で振る舞い完全保持 (PR1b の最重要 DoD)。
//
// 後続 PR (PR2 等) で、探索ホットパス用の枝刈り・順序最適化・キャッシュ等を
// `getSearchLegalMoves` 側で加える余地を作るための足場。rule logic / UI 経路で
// 呼ばれる `getFullLegalMoves` 側は変更しないことで、両者を独立して進化させる。
//
// 詳細: docs/plans/issue-193.md (親計画) L259-281、docs/plans/issue-193-pr1b-pr1c.md
// (本フェーズ計画) L137 以降参照。

import { getFullLegalMoves } from "@/lib/shogi/moves";
import type { GameState, Move, Player, RuleVariant } from "@/lib/shogi/types";

/**
 * 探索ホットパス用の合法手生成。
 *
 * PR1b 段階では `getFullLegalMoves` の透過的な wrap として実装し、
 * 出力 set が `getFullLegalMoves` と完全一致することを fixture で保証する。
 * 内部実装の最適化は後続 PR で行う。
 */
export function getSearchLegalMoves(
  state: GameState,
  player: Player,
  variant: RuleVariant,
): Move[] {
  return getFullLegalMoves(state, player, variant);
}
