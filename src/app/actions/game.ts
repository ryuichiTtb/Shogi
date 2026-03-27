"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { createInitialGameState, serializeGameState, deserializeGameState } from "@/lib/shogi/board";
import { getVariantById } from "@/lib/shogi/variants/index";
import type { Difficulty, GameConfig, GameState, Move, Player } from "@/lib/shogi/types";

const DEFAULT_PLAYER_ID = "default-player";

// デフォルトユーザーを確保（認証実装前の仮実装）
async function ensureDefaultUser() {
  const user = await prisma.user.upsert({
    where: { id: DEFAULT_PLAYER_ID },
    create: { id: DEFAULT_PLAYER_ID, name: "Player" },
    update: {},
  });
  return user;
}

// 新規ゲームを作成
export async function createGame(
  difficulty: Difficulty,
  playerColor: Player,
  characterId: string,
  variantId: string = "standard"
): Promise<string> {
  const user = await ensureDefaultUser();
  const variant = getVariantById(variantId);
  const initialState = createInitialGameState(variant);

  // variant（関数を含む）はシリアライズ不可なのでIDのみ保存
  const serializableConfig = {
    variantId,
    difficulty,
    playerColor,
    characterId,
    soundEnabled: true,
    commentaryEnabled: true,
  };

  const game = await prisma.game.create({
    data: {
      playerId: user.id,
      playerColor,
      difficulty,
      variantId,
      characterId,
      status: "active",
      boardState: serializeGameState(initialState),
      gameConfig: serializableConfig,
    },
  });

  return game.id;
}

// ゲームを取得
export async function getGame(gameId: string) {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: {
      moves: {
        orderBy: { moveNum: "asc" },
      },
    },
  });

  if (!game) return null;

  const stored = game.gameConfig as {
    variantId: string;
    difficulty: Difficulty;
    playerColor: Player;
    characterId: string;
    soundEnabled: boolean;
    commentaryEnabled: boolean;
  };
  const gameConfig: GameConfig = {
    variant: getVariantById(stored.variantId ?? game.variantId),
    difficulty: stored.difficulty ?? (game.difficulty as Difficulty),
    playerColor: stored.playerColor ?? (game.playerColor as Player),
    characterId: stored.characterId ?? game.characterId,
    soundEnabled: stored.soundEnabled ?? true,
    commentaryEnabled: stored.commentaryEnabled ?? true,
  };

  return {
    ...game,
    boardState: deserializeGameState(game.boardState),
    gameConfig,
  };
}

// 手を保存してゲーム状態を更新
export async function saveMove(
  gameId: string,
  move: Move,
  newBoardState: GameState,
  notation: string,
  moveNum: number,
  comment?: string
): Promise<void> {
  await prisma.$transaction([
    prisma.gameMove.create({
      data: {
        gameId,
        moveNum,
        player: move.player,
        moveData: move as object,
        notation,
        comment,
      },
    }),
    prisma.game.update({
      where: { id: gameId },
      data: {
        boardState: serializeGameState(newBoardState),
        status: newBoardState.status,
        winner: newBoardState.winner,
      },
    }),
  ]);

  revalidatePath(`/game/${gameId}`);
}

// ゲーム状態を更新（投了など）
export async function updateGameStatus(
  gameId: string,
  status: string,
  winner?: string
): Promise<void> {
  await prisma.game.update({
    where: { id: gameId },
    data: { status, winner },
  });

  revalidatePath(`/game/${gameId}`);
  revalidatePath("/history");
}

// 対局履歴を取得
export async function getGameHistory() {
  const user = await ensureDefaultUser();

  const games = await prisma.game.findMany({
    where: { playerId: user.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return games;
}
