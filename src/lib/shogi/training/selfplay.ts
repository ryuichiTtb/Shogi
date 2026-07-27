// 自己対戦 (CPU vs CPU) の純粋ドライバ (Issue #245 フェーズ0 P0-4)。
//
// 手の選択 (chooseAction) を注入可能にし、React / DB / AI ライブラリに非依存に保つ。
// 実 AI は scripts/selfplay-245.ts が findBestMoveWithStats を注入し、テストは軽量な
// ダミー chooser を注入して高速・決定的に検証する (#109 疎結合・テスタビリティ)。
//
// 既存の純粋カーネルを再利用: applyTurnAction (TurnAction 適用 + 終局判定込み) と
// buildTrainingSample (pre-action スナップショット)。人間対局キャプチャと同じ pre 意味論。

import { SPECTATOR_MAX_MOVES } from "@/lib/shogi/ai/strategy";
import { createInitialGameState, deserializeGameState, serializePosition } from "@/lib/shogi/board";
import { createInitialCardState, deserializeCardState, type DeckSpec } from "@/lib/shogi/cards/state";
import { applyTurnAction, type WorldState } from "@/lib/shogi/kernel/world-kernel";
import type { TurnAction } from "@/lib/shogi/kernel/turn-action-types";
import { CARD_SHOGI_VARIANT } from "@/lib/shogi/variants/card-shogi";
import type { CardGameState } from "@/lib/shogi/cards/types";
import type { Difficulty, GameState, Player } from "@/lib/shogi/types";

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
  // Issue #245 教材多様化 段5 (分岐生成): 初期局面を差し替えて途中から指し継ぐ。
  // 未指定なら従来どおり初期盤面 + createInitialCardState (= 既存呼出は完全に無改変で通る)。
  // ★必ず replayToPly の戻り値を渡すこと。保存済みサンプルから直接復元した world は
  //   positionHistory を持たないため千日手が検出できず、200 手打ち切りの引き分けを量産する。
  initialWorld?: WorldState;
  // 分岐点から**さらに**何手指すかの上限 (initialWorld とセットで使う)。
  // maxMoves が「対局全体の手数上限」なのに対し、こちらは分岐後の増分。
  maxAdditionalMoves?: number;
  // 由来の識別子。分岐生成では「どの対局のどの手から枝分かれしたか」を残し、
  // 段7 の train/val 分割で同じ親から出た枝を同一グループとして扱えるようにする。
  sourceGameId?: string | null;
  // 同じ出どころの棋譜をまとめる鍵 (段7)。分岐生成が親の鍵をそのまま渡す。
  familyId?: string | null;
}

// 1 局を最後まで自己対戦し、per-decision サンプル列 + 勝敗ラベルを返す。
export function playOneGame(opts: PlayOneGameOptions): TrainingGameRecord {
  const maxMoves = opts.maxMoves ?? SPECTATOR_MAX_MOVES;
  // 1 ターンに複数の card/draw decision がありうるがマナ上限で有界。万一の暴走を防ぐ安全網。
  const maxDecisions = maxMoves * 8;

  let world: WorldState = opts.initialWorld ?? {
    gameState: createInitialGameState(CARD_SHOGI_VARIANT),
    cardState: createInitialCardState(opts.deckSpec),
    doubleMove: null,
  };
  // 分岐生成では「分岐点からの増分」で打ち切りたい (対局全体の手数上限とは別)。
  const moveCeiling =
    opts.maxAdditionalMoves !== undefined
      ? Math.min(maxMoves, world.gameState.moveCount + opts.maxAdditionalMoves)
      : maxMoves;
  const samples: TrainingSampleData[] = [];
  let plyIndex = 0;

  while (
    world.gameState.status === "active" &&
    world.gameState.moveCount < moveCeiling &&
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
    sourceGameId: opts.sourceGameId ?? null,
    familyId: opts.familyId ?? null,
  };

  return { game, samples };
}

// ---------------------------------------------------------------------------
// 分岐生成のためのリプレイ (Issue #245 教材多様化 段5)
// ---------------------------------------------------------------------------

export interface ReplayResult {
  /** targetPly の局面 (= samples[targetPly] を指す瞬間) の world。突合に失敗したら null。 */
  world: WorldState | null;
  /** 突合が食い違った ply (成功時は undefined)。 */
  mismatchPly?: number;
}

/**
 * 教材 1 試合の**行動列を先頭から再生**して、指定 ply の局面を作る。
 *
 * なぜ再生するのか: 保存済みサンプルの `boardState` は moveHistory / positionHistory を
 * 持たない (serializeBoardForTraining が容量のため落としている)。そこから直接復元して
 * 指し継ぐと `isRepetition` が分岐前の反復を数えられず、**千日手が検出されないまま
 * 200 手打ち切りの引き分けを量産**する。clean は既定で千日手しか落とさないので、
 * それが教材に混ざってしまう (計画書 §2 B-3)。
 *
 * 初期カード状態は `samples[0].cardState` を復元して使う
 * (`createInitialCardState` はシャッフルが走るので元の山札を再現できない)。
 *
 * 各 ply で盤面 (`serializePosition`) と**カード状態の要点** (マナ / 手札の defId 多重集合) を
 * 保存値と突合し、1 つでも食い違えばその試合は分岐に使わない。盤面だけを見ると、マナコストや
 * ドロー周期の変更といった**盤に出ないドリフト**を素通ししてしまう。
 */
export function replayToPly(record: TrainingGameRecord, targetPly: number): ReplayResult {
  if (targetPly < 0 || targetPly >= record.samples.length) return { world: null };

  let world: WorldState = {
    gameState: createInitialGameState(CARD_SHOGI_VARIANT),
    cardState: deserializeCardState(record.samples[0].cardState),
    doubleMove: null,
  };

  for (let ply = 0; ply <= targetPly; ply++) {
    const sample = record.samples[ply];
    if (serializePosition(world.gameState) !== serializePosition(sampleToGameState(sample.boardState))) {
      return { world: null, mismatchPly: ply };
    }
    if (cardStateFingerprint(world.cardState) !== cardStateFingerprint(deserializeCardState(sample.cardState))) {
      return { world: null, mismatchPly: ply };
    }
    if (ply === targetPly) break;
    world = applyTurnAction(world, sample.action, { spectatorMode: true }).world;
  }
  return { world };
}

// カード状態の突合キー。マナと手札の中身 (defId 多重集合) を見る。
// instanceId や山札の並びまで見ると、意味のない差で分岐候補を落としてしまう。
function cardStateFingerprint(card: CardGameState): string {
  const hand = (player: Player) =>
    card.hand[player].map((c) => c.defId).sort().join(",");
  return `${card.mana.sente}/${card.mana.gote}|${hand("sente")}|${hand("gote")}`;
}

// 保存済み boardState → GameState。履歴は突合に使わないので空で補う
// (serializePosition は 盤面 + 持駒 + 手番 しか見ない)。
function sampleToGameState(boardState: unknown): GameState {
  return deserializeGameState({
    ...(boardState as Record<string, unknown>),
    moveHistory: [],
    positionHistory: [],
  });
}
