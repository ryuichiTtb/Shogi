import { describe, expect, it } from "vitest";

import { getWorldLegalActions } from "@/lib/shogi/ai/search";
import { getCardActions } from "@/lib/shogi/ai/turn/action-generator";
import type { Player } from "@/lib/shogi/types";
import type { WorldState } from "@/lib/shogi/kernel/world-kernel";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";

import { playOneGame, replayToPly } from "../selfplay";

const DECK = [
  { defId: "pawn_return" as const, count: 2 },
  { defId: "mana_up" as const, count: 2 },
];

// 常に最初の合法手 (move-only) を指す決定的ダミー AI (実 AI 非依存・高速)。
function firstMoveChooser(world: WorldState) {
  const actions = getWorldLegalActions(world, CARD_SHOGI_VARIANT, false);
  return actions[0] ?? null;
}

describe("playOneGame", () => {
  it("ダミーAIで 1 局を回し、per-decision サンプルと勝敗ラベルを生成する", () => {
    const rec = playOneGame({
      chooseAction: firstMoveChooser,
      deckSpec: DECK,
      senteDifficulty: "beginner",
      goteDifficulty: "beginner",
      maxMoves: 12,
    });

    expect(rec.samples.length).toBeGreaterThan(0);
    expect(rec.samples.length).toBeLessThanOrEqual(12);
    rec.samples.forEach((s, i) => {
      expect(s.plyIndex).toBe(i);
      expect(s.action).toBeTruthy();
      expect(s.boardState).toBeTruthy();
      expect(s.cardState).toBeTruthy();
    });
    expect(rec.game.source).toBe("self_play");
    expect(rec.game.variantId).toBe(CARD_SHOGI_VARIANT.id);
    expect(["sente", "gote", "draw"]).toContain(rec.game.winner);
    expect(rec.game.deckSpecSente).toEqual(DECK);
  });

  it("chooseAction が即 null → 空の試合 (samples 0、引き分け)", () => {
    const rec = playOneGame({ chooseAction: () => null, deckSpec: DECK, maxMoves: 12 });
    expect(rec.samples).toHaveLength(0);
    expect(rec.game.winner).toBe("draw");
    expect(rec.game.finalStatus).toBe("active");
  });

  it("maxMoves でサンプル数が有界", () => {
    const rec = playOneGame({ chooseAction: firstMoveChooser, deckSpec: DECK, maxMoves: 4 });
    expect(rec.samples.length).toBeLessThanOrEqual(4);
  });
});

// Issue #245 教材多様化 段5: 分岐生成のためのリプレイ。
// 保存済みサンプルから直接復元すると positionHistory が無く千日手を検出できないため、
// 行動列を先頭から再生する必要がある (計画書 §2 B-3)。ここではその再生が
// 「各 ply で保存値と一致する」ことと「履歴が積まれる」ことを固定する。
describe("replayToPly (段5 分岐生成)", () => {
  // 決定的な chooser で 1 局作り、それを再生する。
  const record = playOneGame({
    chooseAction: (world) => {
      const actions = getWorldLegalActions(world, CARD_SHOGI_VARIANT, false);
      return actions.length > 0 ? actions[0] : null;
    },
    deckSpec: [{ defId: "pawn_return", count: 4 }],
    maxMoves: 12,
  });

  it("全 ply で保存値と一致する (突合が通る)", () => {
    expect(record.samples.length).toBeGreaterThan(2);
    for (let ply = 0; ply < record.samples.length; ply++) {
      const r = replayToPly(record, ply);
      expect(r.mismatchPly).toBeUndefined();
      expect(r.world).not.toBeNull();
      // 再生した局面が、その ply のサンプルと同じ手番・手数であること。
      expect(r.world!.gameState.currentPlayer).toBe(record.samples[ply].sideToMove);
      expect(r.world!.gameState.moveCount).toBe(record.samples[ply].moveCount);
    }
  });

  it("再生した局面は positionHistory を先頭から積んでいる (千日手が検出できる)", () => {
    const last = replayToPly(record, record.samples.length - 1);
    const g = last.world!.gameState;
    // 初期局面 1 + 指した手数ぶん = 分岐前の反復を漏れなく数えられる状態。
    expect(g.positionHistory.length).toBe(g.moveCount + 1);
  });

  it("カード状態が食い違う試合も弾く (盤に出ないドリフトを素通ししない)", () => {
    const broken = {
      ...record,
      samples: record.samples.map((s, i) => {
        if (i !== 2) return s;
        const cs = s.cardState as { mana: { sente: number; gote: number } };
        return { ...s, cardState: { ...cs, mana: { ...cs.mana, sente: cs.mana.sente + 5 } } };
      }),
    };
    const r = replayToPly(broken, broken.samples.length - 1);
    expect(r.world).toBeNull();
    expect(r.mismatchPly).toBe(2);
  });

  it("範囲外の ply は null", () => {
    expect(replayToPly(record, -1).world).toBeNull();
    expect(replayToPly(record, record.samples.length).world).toBeNull();
  });

  it("行動列が食い違う試合は mismatchPly を返して分岐に使わせない", () => {
    // 2 手目のサンプルの手番を反転させる = 再生結果と合わなくなる。
    const broken = {
      ...record,
      samples: record.samples.map((s, i) => {
        if (i !== 2) return s;
        const b = s.boardState as { currentPlayer: string };
        return {
          ...s,
          boardState: { ...b, currentPlayer: b.currentPlayer === "sente" ? "gote" : "sente" },
        };
      }),
    };
    const r = replayToPly(broken, broken.samples.length - 1);
    expect(r.world).toBeNull();
    expect(r.mismatchPly).toBe(2);
  });
});

// 分岐生成は「途中局面から指し継ぐ」ので、初期 world の差し替えと増分手数の上限が要る。
describe("playOneGame の initialWorld / maxAdditionalMoves (段5)", () => {
  const base = playOneGame({
    chooseAction: (world) => {
      const actions = getWorldLegalActions(world, CARD_SHOGI_VARIANT, false);
      return actions.length > 0 ? actions[0] : null;
    },
    deckSpec: [{ defId: "pawn_return", count: 4 }],
    maxMoves: 12,
  });

  it("initialWorld から指し継ぎ、maxAdditionalMoves で増分を打ち切る", () => {
    const mid = replayToPly(base, 4).world!;
    const startCount = mid.gameState.moveCount;
    const branched = playOneGame({
      chooseAction: (world) => {
        const actions = getWorldLegalActions(world, CARD_SHOGI_VARIANT, false);
        return actions.length > 0 ? actions[actions.length - 1] : null; // 別の手を選ぶ
      },
      deckSpec: [{ defId: "pawn_return", count: 4 }],
      initialWorld: mid,
      maxAdditionalMoves: 3,
    });
    // 分岐後のサンプルだけを持つ (前半は元対局が持っている)。
    expect(branched.samples[0].moveCount).toBe(startCount);
    expect(branched.game.moveCount).toBeLessThanOrEqual(startCount + 3);
    expect(branched.game.moveCount).toBeGreaterThan(startCount);
  });

  it("initialWorld 未指定なら従来どおり初期盤面から始まる (既存呼出は無改変)", () => {
    expect(base.samples[0].moveCount).toBe(0);
  });
});

// Issue #245 教材多様化 段6.5: 二手指し (double_move) を教材へ含める。
//
// これまで chooser が二手指しの継続状態を engine へ渡していなかったため、継続中に
// engine が「通常のターン」と誤認して playCard / draw を返すと、kernel が doubleMove:null を
// 返して**二手指し状態が黙って消える**(棋譜が壊れる) 問題があった。
// ここでは (a) 継続が正しく 2→1 と進むこと (b) サンプルに継続状態が刻まれること を固定する。
describe("二手指しの教材記録 (段6.5)", () => {
  const DM_DECK = [{ defId: "double_move" as const, count: 4 }];

  // 使えるときは必ず double_move を打ち、それ以外は最初の合法手を指す決定的 chooser。
  // ★double_move は getWorldLegalActions が意図的に除外する (S4c-1)。実際の探索は
  //   findBestMoveWorld が getCardActions から別途候補化しているので、テストも同じ経路で取る。
  const dmChooser = (world: WorldState, player: Player) => {
    if (world.doubleMove === null) {
      const cardActions = [...getCardActions(
        { gameState: world.gameState, cardState: world.cardState, doubleMove: null, isRoot: true },
        player,
        CARD_SHOGI_VARIANT,
      )];
      const dm = cardActions.find((a) => a.kind === "playCard" && a.defId === "double_move");
      if (dm) return dm;
    }
    const actions = getWorldLegalActions(world, CARD_SHOGI_VARIANT, false);
    return actions.find((a) => a.kind === "move") ?? null;
  };

  it("二手指しが 2→1 と進み、状態が消えない", () => {
    const rec = playOneGame({ chooseAction: dmChooser, deckSpec: DM_DECK, maxMoves: 60 });
    const dmPlays = rec.samples.filter(
      (s) => s.action.kind === "playCard" && s.action.defId === "double_move",
    );
    expect(dmPlays.length).toBeGreaterThan(0);

    for (let i = 0; i < rec.samples.length; i++) {
      const a = rec.samples[i].action;
      if (!(a.kind === "playCard" && a.defId === "double_move")) continue;
      const first = rec.samples[i + 1];
      if (!first) break; // 対局末尾で打ち切られた場合
      // 1 手目: 継続中 (残り 2) で、必ず着手であること (card/draw が来たら状態が壊れている)
      expect(first.doubleMoveMovesLeft).toBe(2);
      expect(first.action.kind).toBe("move");
      const second = rec.samples[i + 2];
      if (second) {
        expect(second.doubleMoveMovesLeft).toBe(1);
        expect(second.action.kind).toBe("move");
      }
    }
  });

  it("通常のターンには継続状態を刻まない (既存サンプルと同じ形)", () => {
    const rec = playOneGame({ chooseAction: firstMoveChooser, deckSpec: DECK, maxMoves: 10 });
    expect(rec.samples.every((s) => s.doubleMoveMovesLeft === undefined)).toBe(true);
  });

  it("二手指しの 1 手目は盤面だけでは通常局面と区別できない (だから記録が要る)", () => {
    const rec = playOneGame({ chooseAction: dmChooser, deckSpec: DM_DECK, maxMoves: 60 });
    const first = rec.samples.find((s) => s.doubleMoveMovesLeft === 2);
    expect(first).toBeDefined();
    // boardState には継続の情報が無い = doubleMoveMovesLeft が唯一の手がかり。
    expect(JSON.stringify(first!.boardState)).not.toContain("doubleMove");
  });
});
