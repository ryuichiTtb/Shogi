// カード行動診断 CLI (Issue #245 Stage 2 P2-2b)。
//
// 学習評価が Stage 1 で特定した over-valued 局面 (「飛車の前の歩を戻す」を pieceSafety が +85 と
// 過大評価する) で、カード手 (playCard) を駒指し (move) より **低評価するようになったか** を、
// World 探索の rootActionScores から算出した gap を hand-eval / learned-eval で比較して診断する。
//
// ★findBestMove 直呼び (bench-learned-245.ts と同型) = src 非改変。engine の worldPathActive ゲートを
//   経由せず自前で world 分岐 (search.ts:567)、evalLeafWorld の NN 分岐は ctx.useLearnedEval で駆動。
// ★gap は同一探索呼出内の相対量ゆえ手番視点のまま比較・集計してよい (P2-2b M1 MINOR-1)。
// ★これは「50 局モデルが正しい方向に動いたか」の速い前段スクリーニング。最終判定は勝率 (winrate-245.ts)。
//   gap だけでなく bestMove/bestCard を併記し「card 全般を鈍らせただけ (別種の劣化)」を切り分ける。
//
// 使い方 (リポジトリルートで):
//   DIAG_MODEL=local-data/training/model-bootstrap-small.json \
//   DIAG_IN=local-data/training/labeled-small.jsonl DIAG_SAMPLE=30 DIAG_DEPTH=4 \
//   npx tsx scripts/diag-cardgap-245.ts
//
// env:
//   DIAG_MODEL  学習モデル JSON ({ model } 形式、既定 model-bootstrap-small.json)
//   DIAG_IN     実データ JSONL (カンマ区切り、既定 labeled-small.jsonl)。空/読めない場合は fixture のみ
//   DIAG_SAMPLE 実データからサンプルする card-playable 局面数の上限 (既定 30)
//   DIAG_DEPTH  探索の固定 maxDepth (既定 4 = pieceSafety 過大評価が horizon 内で refute されない深さ)

import { readFileSync } from "node:fs";

import { deserializeCardState } from "@/lib/shogi/cards/state";
import { MANA_CAP } from "@/lib/shogi/cards/definitions";
import type { CardGameState, CardInstance } from "@/lib/shogi/cards/types";
import { hasLearnedModel, loadLearnedModel } from "@/lib/shogi/ai/learned/infer";
import { winnerToLabel } from "@/lib/shogi/ai/learned/feature-export";
import { findBestMove, getWorldLegalActions } from "@/lib/shogi/ai/search";
import { createSearchContext } from "@/lib/shogi/ai/search-context";
import { createInitialGameState } from "@/lib/shogi/board";
import { parseTrainingRecordLine } from "@/lib/shogi/training/jsonl";
import { computeCardGap, aggregateCardGap, type CardGapResult } from "@/lib/shogi/training/cardgap";
import type { WorldState } from "@/lib/shogi/kernel/world-kernel";
import type { Board, GameState, Piece, Player } from "@/lib/shogi/types";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";

const MODEL = process.env.DIAG_MODEL ?? "local-data/training/model-bootstrap-small.json";
const IN = (process.env.DIAG_IN ?? "local-data/training/labeled-small.jsonl")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const SAMPLE = Math.max(0, Number(process.env.DIAG_SAMPLE ?? "30") || 30);
const DEPTH = Math.max(1, Number(process.env.DIAG_DEPTH ?? "4") || 4);

// maxDepth 固定 + timeLimitMs 十分大 (findBestMoveWorld の timeLimitMs*0.55 早期 break を避ける、M1 NIT-3)。
const OPTIONS = { maxDepth: DEPTH, timeLimitMs: 600000, addNoise: 0, nearEqualThreshold: 0 };

function emptyBoard(): Board {
  return Array.from({ length: 9 }, () =>
    Array.from({ length: 9 }, () => null as Board[number][number]),
  );
}
function pc(type: Piece["type"], owner: Player): Piece {
  return { type, owner };
}

// pawn_return 手札 + マナ 12 の決定論カード状態 (test の cardState helper と同型、shuffle 非依存)。
function fixtureCardState(over: Partial<CardGameState> = {}): CardGameState {
  const pr: CardInstance = { instanceId: "s-pr", defId: "pawn_return" };
  return {
    mana: { sente: 12, gote: 12 },
    manaCap: MANA_CAP,
    hand: { sente: [pr], gote: [] },
    deck: { sente: [], gote: [] },
    graveyard: { sente: [], gote: [] },
    trap: { sente: null, gote: null },
    pendingCard: null,
    lastTurnStartedAt: { sente: null, gote: null },
    noPromoteMarks: { sente: [], gote: [] },
    drawProgress: { sente: 0, gote: 0 },
    ...over,
  };
}

// Stage 1 で特定した tactic 局面 (search-world.test.ts:387 placePawnReturnTactic を複製)。
function tacticFixture(): { state: GameState; cardState: CardGameState; player: Player } {
  const board = emptyBoard();
  board[8][8] = pc("king", "sente");
  board[0][0] = pc("king", "gote");
  board[8][1] = pc("rook", "sente");
  board[5][1] = pc("pawn", "sente"); // 飛の利きを塞ぐ自歩 (pawn_return 対象)
  board[2][1] = pc("gold", "gote"); // col1 上方の標的
  const state: GameState = {
    board,
    hand: { sente: {}, gote: {} },
    currentPlayer: "sente",
    moveHistory: [],
    positionHistory: [],
    status: "active",
    moveCount: 0,
  };
  return { state, cardState: fixtureCardState(), player: "sente" };
}

// 1 局面を hand-eval / learned-eval で探索し gap を返す (同一 state/cardState/player、ctx のみ差替)。
function gapFor(
  state: GameState,
  cardState: CardGameState,
  player: Player,
  useLearnedEval: boolean,
): CardGapResult {
  const ctx = createSearchContext({
    timeLimitMs: OPTIONS.timeLimitMs,
    useTurnActionSearch: true, // world 経路
    spectatorMode: true,
    useLearnedEval,
    // selectorM/K は未指定 = 全展開 (Stage 1a 足切り廃止。初期局面の pawn_return 全対象を候補化)。
  });
  const r = findBestMove(state, player, OPTIONS, CARD_SHOGI_VARIANT, ctx, cardState);
  return computeCardGap(r?.rootActionScores ?? []);
}

const fmt = (v: number | null): string => (v === null ? "—" : v.toFixed(0));

function reportFixture(
  name: string,
  state: GameState,
  cardState: CardGameState,
  player: Player,
): void {
  const hand = gapFor(state, cardState, player, false);
  const learned = gapFor(state, cardState, player, true);
  console.log(`\n[fixture] ${name} (手番=${player})`);
  console.log(
    `  hand-eval    : bestMove ${fmt(hand.bestMoveScore)} / bestCard ${fmt(hand.bestCardScore)} (${hand.topCardDefId ?? "—"}) / cardGap ${fmt(hand.cardGap)} / top=${hand.topKind}`,
  );
  console.log(
    `  learned-eval : bestMove ${fmt(learned.bestMoveScore)} / bestCard ${fmt(learned.bestCardScore)} (${learned.topCardDefId ?? "—"}) / cardGap ${fmt(learned.cardGap)} / top=${learned.topKind}`,
  );
  // sanity (M1 MINOR-2): hand-eval で cardGap>0 が起点前提。崩れていれば診断の起点として無効。
  if (hand.cardGap === null || hand.cardGap <= 0) {
    console.log(
      `  ⚠️ sanity: hand-eval の cardGap が >0 でない (=元から card 最善でない)。この fixture は起点として機能しない。`,
    );
  } else if (learned.cardGap !== null && learned.cardGap < hand.cardGap) {
    const flipped = learned.topKind === "move";
    console.log(
      `  ✅ learned が cardGap を ${fmt(hand.cardGap)}→${fmt(learned.cardGap)} に低下${flipped ? " (top が move へ反転=過大評価解消)" : ""}。`,
    );
  } else {
    console.log(`  ❌ learned が cardGap を下げていない (過大評価未解消)。`);
  }
}

// 実データから card-playable な局面 (手札非空+マナ足りて playCard 生成 & move もある) を収集。
function collectRealPositions(): { state: GameState; cardState: CardGameState; player: Player }[] {
  const out: { state: GameState; cardState: CardGameState; player: Player }[] = [];
  for (const file of IN) {
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      console.warn(`[diag-cardgap] 読めません (skip): ${file}`);
      continue;
    }
    for (const line of content.split("\n").filter((l) => l.trim())) {
      const rec = parseTrainingRecordLine(line);
      if (winnerToLabel(rec.game.winner) === null) continue; // 中断は除外 (学習と一致)
      for (const s of rec.samples) {
        // boardState は moveHistory/positionHistory 除外で保存 (types.ts:30)。move 生成
        // (cloneGameState が [...moveHistory]) が要るので空配列を補う (単一局面の card-gap 探索に
        // 千日手履歴は不要ゆえ [] で正)。
        const raw = s.boardState as Omit<GameState, "moveHistory" | "positionHistory">;
        const state: GameState = { ...raw, moveHistory: [], positionHistory: [] };
        if (state.status !== "active") continue;
        const cardState = deserializeCardState(s.cardState);
        const player = state.currentPlayer;
        const world: WorldState = { gameState: state, cardState, doubleMove: null };
        const actions = getWorldLegalActions(world, CARD_SHOGI_VARIANT, true);
        const hasCard = actions.some((a) => a.kind === "playCard");
        const hasMove = actions.some((a) => a.kind === "move");
        if (hasCard && hasMove) out.push({ state, cardState, player });
      }
    }
  }
  return out;
}

function reportRealData(): void {
  const all = collectRealPositions();
  if (all.length === 0) {
    console.log(`\n[実データ] card-playable な局面が 0 (${IN.join(",")})。fixture のみで判断。`);
    return;
  }
  // 局面を偏りなく間引く (全 game に散らす)。
  const stride = Math.max(1, Math.floor(all.length / SAMPLE));
  const picked: typeof all = [];
  for (let i = 0; i < all.length && picked.length < SAMPLE; i += stride) picked.push(all[i]);

  console.log(
    `\n[実データ] card-playable ${all.length} 局面中 ${picked.length} をサンプル (stride ${stride}, D=${DEPTH})...`,
  );
  const handResults: CardGapResult[] = [];
  const learnedResults: CardGapResult[] = [];
  for (const p of picked) {
    handResults.push(gapFor(p.state, p.cardState, p.player, false));
    learnedResults.push(gapFor(p.state, p.cardState, p.player, true));
  }
  const hAgg = aggregateCardGap(handResults);
  const lAgg = aggregateCardGap(learnedResults);
  const pf = (x: number) => `${(x * 100).toFixed(1)}%`;
  const mf = (x: number | null) => (x === null ? "—" : x.toFixed(1));
  console.log(`  card 選好割合 (cardGap>0):  hand ${pf(hAgg.cardPreferredFrac)} → learned ${pf(lAgg.cardPreferredFrac)}`);
  console.log(`  draw 選好割合 (drawGap>0):  hand ${pf(hAgg.drawPreferredFrac)} → learned ${pf(lAgg.drawPreferredFrac)}`);
  console.log(`  平均 cardGap:              hand ${mf(hAgg.meanCardGap)} → learned ${mf(lAgg.meanCardGap)}`);
  console.log(`  平均 bestMoveScore:        hand ${mf(hAgg.meanBestMoveScore)} → learned ${mf(lAgg.meanBestMoveScore)} (move 側が一律に鈍っていないかの切り分け)`);
  console.log(`  top 種別 (hand):    move ${hAgg.topKindCounts.move} / card ${hAgg.topKindCounts.playCard} / draw ${hAgg.topKindCounts.draw}`);
  console.log(`  top 種別 (learned): move ${lAgg.topKindCounts.move} / card ${lAgg.topKindCounts.playCard} / draw ${lAgg.topKindCounts.draw}`);
  console.log(
    `\n  解釈: learned が card 選好割合/平均 cardGap を下げていれば「無意味カードを減らす」方向 (必要条件)。` +
      `\n        ただし bestMoveScore が hand と大きくズレていれば「card だけでなく評価全般が変質」= 別種の劣化を疑う。` +
      `\n        最終判定は対戦勝率 (winrate-245.ts)。本診断は前段スクリーニング。`,
  );
}

function main(): void {
  const payload = JSON.parse(readFileSync(MODEL, "utf8"));
  loadLearnedModel(payload.model);
  if (!hasLearnedModel()) {
    console.error(`FAIL: モデルのロードに失敗しました (${MODEL} の { model } を確認)。`);
    process.exit(1);
  }
  console.log(`=== カード行動診断 (P2-2b, D=${DEPTH}) ===`);
  console.log(`model: ${MODEL} (hidden=${payload.model.hidden}, featureDim=${payload.model.featureDim})`);

  // fixture 1: 初期局面 + pawn_return 手札。
  reportFixture("初期局面 + pawn_return", createInitialGameState(CARD_SHOGI_VARIANT), fixtureCardState(), "sente");
  // fixture 2: tactic 局面 (飛の利きを塞ぐ自歩)。
  const t = tacticFixture();
  reportFixture("tactic (飛前歩戻し)", t.state, t.cardState, t.player);

  // 実データ多数局面 (1 fixture 轍回避)。
  reportRealData();
}

main();
