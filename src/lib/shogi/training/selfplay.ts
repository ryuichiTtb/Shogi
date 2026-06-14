// 自己対戦 (CPU vs CPU) の純粋ドライバ (Issue #245 フェーズ0 P0-4)。
//
// 手の選択 (chooseAction) を注入可能にし、React / DB / AI ライブラリに非依存に保つ。
// 実 AI は scripts/selfplay-245.ts が findBestMoveWithStats を注入し、テストは軽量な
// ダミー chooser を注入して高速・決定的に検証する (#109 疎結合・テスタビリティ)。
//
// 既存の純粋カーネルを再利用: applyTurnAction (TurnAction 適用 + 終局判定込み) と
// buildTrainingSample (pre-action スナップショット)。人間対局キャプチャと同じ pre 意味論。

import { SPECTATOR_MAX_MOVES } from "@/lib/shogi/ai/strategy";
import { createInitialGameState } from "@/lib/shogi/board";
import { createInitialCardState, type DeckSpec } from "@/lib/shogi/cards/state";
import { applyTurnAction, type WorldState } from "@/lib/shogi/kernel/world-kernel";
import type { TurnAction } from "@/lib/shogi/kernel/turn-action-types";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";
import type { Difficulty, Player } from "@/lib/shogi/types";

import { buildTrainingSample } from "./serialize";
import type { TrainingGameData, TrainingGameRecord, TrainingSampleData } from "./types";

// 局面を見て次の 1 行動 (move / playCard / draw) を返す。合法手が無ければ null。
export type ChooseAction = (world: WorldState, player: Player) => TurnAction | null;

export interface PlayOneGameOptions {
  chooseAction: ChooseAction;
  deckSpec: DeckSpec[];
  senteDifficulty?: Difficulty | null;
  goteDifficulty?: Difficulty | null;
  senteCharacterId?: string | null;
  goteCharacterId?: string | null;
  maxMoves?: number;
  engineVersion?: string | null;
}

// 1 局を最後まで自己対戦し、per-decision サンプル列 + 勝敗ラベルを返す。
export function playOneGame(opts: PlayOneGameOptions): TrainingGameRecord {
  const maxMoves = opts.maxMoves ?? SPECTATOR_MAX_MOVES;
  // 1 ターンに複数の card/draw decision がありうるがマナ上限で有界。万一の暴走を防ぐ安全網。
  const maxDecisions = maxMoves * 8;

  let world: WorldState = {
    gameState: createInitialGameState(CARD_SHOGI_VARIANT),
    cardState: createInitialCardState(opts.deckSpec),
    doubleMove: null,
  };
  const samples: TrainingSampleData[] = [];
  let plyIndex = 0;

  while (
    world.gameState.status === "active" &&
    world.gameState.moveCount < maxMoves &&
    plyIndex < maxDecisions
  ) {
    const player = world.gameState.currentPlayer;
    const action = opts.chooseAction(world, player);
    if (!action) break; // 合法手なし = 既に終局
    const applied = applyTurnAction(world, action, { spectatorMode: true });
    // pre-action スナップショット (行動する側がその局面を見ている瞬間) + 採用 action + 生じた events。
    samples.push(buildTrainingSample(world, action, applied.events, plyIndex));
    plyIndex += 1;
    world = applied.world;
  }

  // status が active のまま抜けた = 手数上限到達 → 引き分け扱い。
  const winner: Player | "draw" =
    world.gameState.status === "active" ? "draw" : (world.gameState.winner ?? "draw");

  const game: TrainingGameData = {
    source: "self_play",
    variantId: CARD_SHOGI_VARIANT.id,
    senteDifficulty: opts.senteDifficulty ?? null,
    senteCharacterId: opts.senteCharacterId ?? null,
    goteDifficulty: opts.goteDifficulty ?? null,
    goteCharacterId: opts.goteCharacterId ?? null,
    humanColor: null,
    deckSpecSente: opts.deckSpec,
    deckSpecGote: opts.deckSpec,
    winner,
    finalStatus: world.gameState.status,
    moveCount: world.gameState.moveCount,
    engineVersion: opts.engineVersion ?? null,
    sourceGameId: null,
  };

  return { game, samples };
}
