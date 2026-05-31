// Issue #193 / PR2: blunder guard の「同点圏 tie-breaker」決定ロジック (純粋関数)。
//
// 背景:
// 旧 blunder guard は「探索の最善手が自駒をタダ取りされる (ハング) 状態を残すなら、
// 無条件で安全な手へ差し替える」後処理だった。これは探索が見返りを確認した戦術的
// 駒捨て (犠牲) まで潰し、AI の棋力を落としていた。
//
// 本関数は root の深い探索スコアを使い、「ハング手」と「最善の安全手」を比較して
// 差替え可否を決める純粋関数。副作用 (盤面適用・evaluate 呼出) を持たないため
// 単体テストで網羅検証できる (engine 統合は findBestMoveWithStats 側)。

import type { Move, GameState, Player, RuleVariant } from "../types";
import { evaluatePieceSafety, getLeastAttackerValue } from "./evaluate";
import { isSquareAttackedByFast } from "../moves";

export interface SafeCandidate {
  move: Move;
  // root での深い探索スコア (手番側視点、高いほど手番側に有利)。
  deepScore: number;
}

/**
 * blunder guard の同点圏 tie-breaker 判定。
 *
 * @param hangingMove      探索が選んだ最善手 (適用後に自駒がハングする手)
 * @param hangingDeepScore hangingMove の深い探索スコア (手番側視点)
 * @param safeCandidates   ハングしない安全手の候補 (深いスコア付き)
 * @param tieMargin        同点圏とみなす cp 閾値 (>=0)
 * @returns 採用すべき手。差替え不要 (= 戦術的犠牲を尊重 / 安全手なし) なら hangingMove、
 *          差替える場合は最善の安全手を返す。
 *
 * 判定:
 * - 安全手が無ければ hangingMove をそのまま (差替え不能)。
 * - 安全手の中で深いスコア最大のものを基準とする。
 * - hangingMove の深いスコア優位が tieMargin を超える (= 探索が明確な見返りを確認した
 *   犠牲) なら hangingMove を尊重。
 * - 優位が tieMargin 以内 (同点圏) なら、horizon 起因の無意味なハングとみなし安全手へ。
 */
export function chooseBlunderGuardMove(
  hangingMove: Move,
  hangingDeepScore: number,
  safeCandidates: SafeCandidate[],
  tieMargin: number,
): Move {
  if (safeCandidates.length === 0) return hangingMove;

  let best = safeCandidates[0];
  for (let i = 1; i < safeCandidates.length; i++) {
    if (safeCandidates[i].deepScore > best.deepScore) best = safeCandidates[i];
  }

  // ハング手が安全手より tieMargin を超えて高ければ犠牲を尊重、以内なら安全手へ。
  return hangingDeepScore - best.deepScore > tieMargin ? hangingMove : best.move;
}

// Issue #193 / PR2 (検証フィードバック): カード使用の結果、手番側に「タダ捨て」
// (無防備で取られる駒の新規発生) が生じたかを判定する純粋関数。
//
// 背景: カードアクションは 0 手先の静的評価で点数化されるため、二歩指しで相手の
// 飛車前に歩を打つ等の「次の手でタダ取りされる」placement を選んでしまうことがあった。
// カード適用前後の pieceSafety ペナルティ (負値、無防備な駒が多いほど小さい) を比較し、
// カードが新たに閾値超の悪化を生んだら「タダ捨て」とみなす。歩のタダ取り (約 85cp 悪化)
// も捕捉できるよう閾値は CARD_TADASUTE_THRESHOLD=80。

// カード適用でタダ捨てとみなす pieceSafety 悪化幅の閾値 (cp)。
export const CARD_TADASUTE_THRESHOLD = 80;

/**
 * カード使用の結果、手番側に無防備で取られる駒 (タダ捨て) が新たに生じたか。
 * @returns after の pieceSafety が before より CARD_TADASUTE_THRESHOLD を超えて悪化したら true
 */
export function cardResultIntroducesTadasute(
  before: GameState,
  after: GameState,
  player: Player,
  variant: RuleVariant,
): boolean {
  const beforeSafety = evaluatePieceSafety(before, player, variant);
  const afterSafety = evaluatePieceSafety(after, player, variant);
  return afterSafety < beforeSafety - CARD_TADASUTE_THRESHOLD;
}

// ===== ブランダーガード: hanging piece 判定 =====
// (PR3-3 C-3 で engine.ts から移動: search.ts double_move でも使うため共通化)

// ブランダーガード用: 駒の価値テーブル (engine.ts から移動)
const BLUNDER_PIECE_VALUES: Record<string, number> = {
  pawn: 100, lance: 300, knight: 400, silver: 500, gold: 600,
  bishop: 800, rook: 1000, promoted_pawn: 600, promoted_lance: 600,
  promoted_knight: 600, promoted_silver: 600, promoted_bishop: 1100,
  promoted_rook: 1300, king: 10000,
};

/**
 * 指した後に手番側の駒がタダ取りまたは損な交換にさらされるかチェック。
 * @param minValue ハングと判定する駒価値の閾値 (cp、デフォルト 300 = 香車以上)
 */
export function hasHangingPiece(
  state: GameState,
  player: Player,
  variant: RuleVariant,
  minValue: number = 300,
): boolean {
  const board = state.board;
  const { rows, cols } = variant.boardSize;
  const opponent: Player = player === "sente" ? "gote" : "sente";

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const piece = board[row][col];
      if (!piece || piece.owner !== player || piece.type === "king") continue;

      const value = BLUNDER_PIECE_VALUES[piece.type] ?? 0;
      if (value < minValue) continue;

      const pos = { row, col };
      if (isSquareAttackedByFast(board, pos, opponent, variant.boardSize)) {
        if (!isSquareAttackedByFast(board, pos, player, variant.boardSize)) {
          return true; // 攻撃されているが守られていない → タダ取り
        }
        // 守られているが、最安攻撃駒との交換で損する場合もブランダー
        const leastAttacker = getLeastAttackerValue(board, pos, opponent, variant.boardSize);
        if (leastAttacker > 0 && (value - leastAttacker) >= minValue) {
          return true; // 損な交換 (例: 飛車を歩で攻撃されている)
        }
      }
    }
  }
  return false;
}
