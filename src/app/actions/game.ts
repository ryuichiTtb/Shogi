"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { createInitialGameState, serializeGameState, deserializeGameState } from "@/lib/shogi/board";
import { getVariantById } from "@/lib/shogi/variants/index";
import type { Difficulty, GameConfig, GameState, Move, Player } from "@/lib/shogi/types";
import type { CardGameState } from "@/lib/shogi/cards/types";
import {
  createInitialCardState,
  serializeCardState,
  deserializeCardState,
  type DeckSpec,
} from "@/lib/shogi/cards/state";

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

// card-shogi variant 用: ユーザーのデフォルトデッキから DeckSpec を取得
async function loadDeckSpecForUser(userId: string): Promise<DeckSpec[]> {
  const deck = await prisma.deck.findFirst({
    where: { userId, isDefault: true },
    include: { entries: true },
  });
  if (!deck) {
    throw new Error(`No default deck found for user ${userId}. Run "npx prisma db seed".`);
  }
  return deck.entries.map((e) => ({
    defId: e.cardId as DeckSpec["defId"],
    count: e.count,
  }));
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

  // card-shogi variant の場合は cardState を初期化
  let initialCardState: unknown = undefined;
  if (variantId === "card-shogi") {
    const deckSpec = await loadDeckSpecForUser(user.id);
    const cardState = createInitialCardState(deckSpec);
    initialCardState = serializeCardState(cardState);
  }

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
      cardState: initialCardState as never,
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

  // card-shogi variant のとき cardState を復元
  let cardState: CardGameState | null = null;
  if (game.variantId === "card-shogi" && game.cardState) {
    cardState = deserializeCardState(game.cardState);
  }

  return {
    ...game,
    boardState: deserializeGameState(game.boardState),
    gameConfig,
    cardState,
  };
}

// 手を保存してゲーム状態を更新 (standard variant)
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

// 手を保存してゲーム状態を更新 (card-shogi variant、cardState も同時保存)
export async function saveCardShogiMove(
  gameId: string,
  move: Move,
  newBoardState: GameState,
  newCardState: CardGameState,
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
        cardState: serializeCardState(newCardState) as never,
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
