// Issue #193 / PR2: blunder guard 同点圏 tie-breaker の純粋関数テスト。
// 「探索が見返りを確認した戦術的犠牲は尊重 / 同点圏の無意味なハングは安全手へ差替え」
// を網羅検証する。

import { describe, it, expect } from "vitest";
import { chooseBlunderGuardMove, type SafeCandidate } from "../blunder-guard";
import type { Move } from "../../types";

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
