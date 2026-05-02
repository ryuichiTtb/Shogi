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
import { CARD_DEFS } from "@/lib/shogi/cards/definitions";

const DEFAULT_PLAYER_ID = "default-player";

// Issue #104 検証用: 対局画面でレア度別の見た目(背景バンド・閃光・オーブ)を
// 確認できるよう、マスターカタログのサンプル 8 枚を山札に強制的に挿入する。
// 各カードは effectId: "noop" なのでゲーム進行への影響はない。
// 検証完了後はこの定数とマージ処理を削除すれば本番デッキ構成に戻る。
const SAMPLE_CARD_IDS: DeckSpec["defId"][] = [
  "sample_normal_common",
  "sample_normal_rare",
  "sample_normal_super_rare",
  "sample_normal_epic",
  "sample_trap_common",
  "sample_trap_rare",
  "sample_trap_super_rare",
  "sample_trap_epic",
];

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
  // 廃止カード(status: "deprecated")が DB の DeckEntry に残っていても初期デッキには含めない。
  // seed 再実行で削除されるはずだが、未再実行の環境向けのランタイムガード。
  return deck.entries
    .filter((e) => CARD_DEFS[e.cardId as DeckSpec["defId"]]?.status !== "deprecated")
    .map((e) => ({
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
    const baseDeckSpec = await loadDeckSpecForUser(user.id);
    // Issue #104 検証用: 既存 DeckEntry に sample_* が含まれていても重複させない
    // ように除外してから、サンプル 8 種を各 1 枚追加する。
    const deckSpec: DeckSpec[] = [
      ...baseDeckSpec.filter((s) => !SAMPLE_CARD_IDS.includes(s.defId)),
      ...SAMPLE_CARD_IDS.map((id) => ({ defId: id, count: 1 })),
    ];
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
