// Issue #193 / PR2: blunder guard 同点圏 tie-breaker の純粋関数テスト。
// 「探索が見返りを確認した戦術的犠牲は尊重 / 同点圏の無意味なハングは安全手へ差替え」
// を網羅検証する。

import { describe, it, expect } from "vitest";
import {
  chooseBlunderGuardMove,
  cardResultIntroducesTadasute,
  type SafeCandidate,
} from "../blunder-guard";
import type { GameState, Move } from "../../types";
import { createInitialGameState } from "@/lib/shogi/board";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";

// ----- テスト用 Move fixture (move 同一性は参照で判定するため最小フィールド) -----
function mv(fromRow: number, toRow: number): Move {
  return {
    type: "move",
    piece: "silver",
    from: { row: fromRow, col: 0 },
    to: { row: toRow, col: 0 },
    player: "sente",
    promote: false,
  };
}

const TIE_MARGIN = 150;

describe("chooseBlunderGuardMove (同点圏 tie-breaker)", () => {
  it("安全手が無ければハング手をそのまま返す (差替え不能)", () => {
    const hanging = mv(7, 2);
    expect(chooseBlunderGuardMove(hanging, 500, [], TIE_MARGIN)).toBe(hanging);
  });

  it("ハング手が安全手より TIE_MARGIN を超えて高い → 犠牲を尊重 (ハング手のまま)", () => {
    const hanging = mv(7, 2); // 深いスコア +600 (例: 駒捨てで大きな見返り)
    const safe = mv(8, 7);
    const candidates: SafeCandidate[] = [{ move: safe, deepScore: 100 }];
    // 600 - 100 = 500 > 150 → 尊重
    expect(chooseBlunderGuardMove(hanging, 600, candidates, TIE_MARGIN)).toBe(hanging);
  });

  it("ハング手の優位が TIE_MARGIN 以内 (同点圏) → 安全手へ差替え", () => {
    const hanging = mv(7, 2); // 深いスコア +120
    const safe = mv(8, 7);
    const candidates: SafeCandidate[] = [{ move: safe, deepScore: 50 }];
    // 120 - 50 = 70 <= 150 → 差替え
    expect(chooseBlunderGuardMove(hanging, 120, candidates, TIE_MARGIN)).toBe(safe);
  });

  it("ちょうど TIE_MARGIN の差は同点圏扱い → 安全手へ差替え (境界 <=)", () => {
    const hanging = mv(7, 2);
    const safe = mv(8, 7);
    const candidates: SafeCandidate[] = [{ move: safe, deepScore: 0 }];
    // 150 - 0 = 150 <= 150 → 差替え
    expect(chooseBlunderGuardMove(hanging, 150, candidates, TIE_MARGIN)).toBe(safe);
  });

  it("安全手の方が深いスコアが高い (ノイズ等でハング手が最善でない) → 安全手へ", () => {
    const hanging = mv(7, 2); // 深いスコア +30
    const safe = mv(8, 7);
    const candidates: SafeCandidate[] = [{ move: safe, deepScore: 200 }];
    // 30 - 200 = -170 <= 150 → 差替え
    expect(chooseBlunderGuardMove(hanging, 30, candidates, TIE_MARGIN)).toBe(safe);
  });

  it("複数安全手のうち深いスコア最大のものを選ぶ", () => {
    const hanging = mv(7, 2); // +120
    const safeLow = mv(8, 7);
    const safeHigh = mv(8, 3);
    const candidates: SafeCandidate[] = [
      { move: safeLow, deepScore: 40 },
      { move: safeHigh, deepScore: 90 },
    ];
    // 最善安全手 = safeHigh (90)。120 - 90 = 30 <= 150 → safeHigh へ差替え
    expect(chooseBlunderGuardMove(hanging, 120, candidates, TIE_MARGIN)).toBe(safeHigh);
  });

  it("複数安全手でも、ハング手が全安全手より明確に高ければ尊重", () => {
    const hanging = mv(7, 2); // +900 (明確な犠牲の見返り)
    const candidates: SafeCandidate[] = [
      { move: mv(8, 7), deepScore: 100 },
      { move: mv(8, 3), deepScore: 200 },
    ];
    // 最善安全手 200。900 - 200 = 700 > 150 → 尊重
    expect(chooseBlunderGuardMove(hanging, 900, candidates, TIE_MARGIN)).toBe(hanging);
  });

  it("TIE_MARGIN=0 (実質撤廃寄り): ハング手が僅かでも高ければ尊重", () => {
    const hanging = mv(7, 2);
    const safe = mv(8, 7);
    const candidates: SafeCandidate[] = [{ move: safe, deepScore: 100 }];
    // 101 - 100 = 1 > 0 → 尊重
    expect(chooseBlunderGuardMove(hanging, 101, candidates, 0)).toBe(hanging);
    // 100 - 100 = 0 <= 0 → 差替え (完全同点のみ)
    expect(chooseBlunderGuardMove(hanging, 100, candidates, 0)).toBe(safe);
  });
});

describe("cardResultIntroducesTadasute (カード経由タダ捨て検知)", () => {
  // gote 飛車 [4][4] が列4・行4 を制圧。sente 玉[8][4] / gote 玉[0][4]。
  function baseState(): GameState {
    const gs: GameState = {
      ...createInitialGameState(CARD_SHOGI_VARIANT),
      board: Array.from({ length: 9 }, () => Array(9).fill(null)),
      currentPlayer: "sente",
    };
    gs.board[8][4] = { type: "king", owner: "sente" };
    gs.board[0][4] = { type: "king", owner: "gote" };
    gs.board[4][4] = { type: "rook", owner: "gote" };
    return gs;
  }

  it("相手飛車前に無防備な歩を打つ手はタダ捨てと判定 (true)", () => {
    const before = baseState();
    const after = baseState();
    // gote 飛車 [4][4] の前 [5][4] に sente 歩 → 飛車に只取りされ無防備 (-85cp 悪化)
    after.board[5][4] = { type: "pawn", owner: "sente" };
    expect(cardResultIntroducesTadasute(before, after, "sente", CARD_SHOGI_VARIANT)).toBe(
      true,
    );
  });

  it("攻撃されない安全マスに歩を打つ手はタダ捨てでない (false)", () => {
    const before = baseState();
    const after = baseState();
    after.board[7][0] = { type: "pawn", owner: "sente" }; // 隅、相手飛車の利きの外
    expect(cardResultIntroducesTadasute(before, after, "sente", CARD_SHOGI_VARIANT)).toBe(
      false,
    );
  });

  it("盤面変化なし (新たな無防備駒の発生なし) は false", () => {
    const before = baseState();
    const after = baseState();
    expect(cardResultIntroducesTadasute(before, after, "sente", CARD_SHOGI_VARIANT)).toBe(
      false,
    );
  });
});
