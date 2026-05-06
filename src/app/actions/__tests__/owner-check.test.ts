// Issue #150: Server Action が「他ユーザーの deckId / gameId を直接渡されたとき」に
// 拒否することを regression test として担保する。
// 完全な DB 統合テストではなく、prisma を vi.mock して
// 「prisma.findFirst の where 句に必ず userId が含まれていること」と
// 「null 戻り値で適切に扱われること」を検証する。
import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock の factory は import より前に hoist されるため、共有 mock は vi.hoisted で先に作る。
const mocks = vi.hoisted(() => {
  const deck = {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
    create: vi.fn(),
  };
  const playerCardCollection = {
    findMany: vi.fn(),
    upsert: vi.fn(),
    deleteMany: vi.fn(),
  };
  const deckEntry = {
    findMany: vi.fn(),
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  };
  const game = {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  };
  const gameMove = {
    create: vi.fn(),
    deleteMany: vi.fn(),
  };
  return { deck, playerCardCollection, deckEntry, game, gameMove };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    deck: mocks.deck,
    playerCardCollection: mocks.playerCardCollection,
    deckEntry: mocks.deckEntry,
    game: mocks.game,
    gameMove: mocks.gameMove,
    $transaction: vi.fn(async (arg: unknown) => {
      if (typeof arg === "function") {
        return (arg as (tx: unknown) => unknown)({
          deck: mocks.deck,
          deckEntry: mocks.deckEntry,
          game: mocks.game,
          gameMove: mocks.gameMove,
        });
      }
      return arg;
    }),
  },
}));

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentAppUser: vi.fn(async () => ({
    id: "user-A",
    kind: "guest",
    clerkUserId: null,
    email: null,
    name: "Player",
    createdAt: new Date(),
  })),
}));

vi.mock("@/lib/auth/user-bootstrap", () => ({
  ensureCardMaster: vi.fn(async () => undefined),
  ensureInitialUserData: vi.fn(async () => undefined),
  INITIAL_OWNED_CARD_COUNT: 10,
  INITIAL_DECK_CARD_COUNT: 2,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import {
  getDeckDetail,
  renameDeck,
  saveDeckEntries,
  setDefaultDeck,
  deleteDeck,
} from "@/app/actions/deck";
import { getGame, updateGameStatus } from "@/app/actions/game";

function resetMocks() {
  for (const m of [
    mocks.deck.findFirst,
    mocks.deck.findMany,
    mocks.deck.count,
    mocks.deck.updateMany,
    mocks.deck.deleteMany,
    mocks.deck.create,
    mocks.playerCardCollection.findMany,
    mocks.playerCardCollection.upsert,
    mocks.playerCardCollection.deleteMany,
    mocks.deckEntry.findMany,
    mocks.deckEntry.deleteMany,
    mocks.deckEntry.createMany,
    mocks.game.findFirst,
    mocks.game.updateMany,
    mocks.game.update,
    mocks.game.create,
    mocks.gameMove.create,
    mocks.gameMove.deleteMany,
  ]) {
    m.mockReset();
  }
}

describe("Server Action owner-check regression (Issue #150)", () => {
  beforeEach(() => {
    resetMocks();
  });

  describe("deck actions", () => {
    it("getDeckDetail returns null when the deck belongs to another user", async () => {
      mocks.deck.findFirst.mockResolvedValue(null);

      const result = await getDeckDetail("deck-of-user-B");

      expect(result).toBeNull();
      expect(mocks.deck.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: "deck-of-user-B", userId: "user-A" }),
        }),
      );
    });

    it("renameDeck throws when the target deck is not owned by the current user", async () => {
      mocks.deck.updateMany.mockResolvedValue({ count: 0 });

      await expect(renameDeck("deck-of-user-B", "新しい名前")).rejects.toThrow(
        "デッキが見つかりません",
      );
      expect(mocks.deck.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: "deck-of-user-B", userId: "user-A" }),
        }),
      );
    });

    it("saveDeckEntries refuses to write into a deck owned by another user", async () => {
      mocks.deck.findFirst.mockResolvedValue(null);

      await expect(saveDeckEntries("deck-of-user-B", [])).rejects.toThrow(
        "デッキが見つかりません",
      );
      expect(mocks.deckEntry.deleteMany).not.toHaveBeenCalled();
      expect(mocks.deckEntry.createMany).not.toHaveBeenCalled();
    });

    it("setDefaultDeck refuses to mark another user's deck as default", async () => {
      mocks.deck.findFirst.mockResolvedValue(null);

      await expect(setDefaultDeck("deck-of-user-B")).rejects.toThrow(
        "デッキが見つかりません",
      );
      expect(mocks.deck.updateMany).not.toHaveBeenCalled();
    });

    it("deleteDeck refuses to delete another user's deck (not in their list)", async () => {
      mocks.deck.findMany.mockResolvedValue([
        { id: "deck-of-A-1", isDefault: true },
        { id: "deck-of-A-2", isDefault: false },
      ]);

      await expect(deleteDeck("deck-of-user-B")).rejects.toThrow(
        "デッキが見つかりません",
      );
      expect(mocks.deck.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe("game actions", () => {
    it("getGame returns null when the game belongs to another user", async () => {
      mocks.game.findFirst.mockResolvedValue(null);

      const result = await getGame("game-of-user-B");

      expect(result).toBeNull();
      expect(mocks.game.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: "game-of-user-B",
            playerId: "user-A",
          }),
        }),
      );
    });

    it("updateGameStatus throws when targeting a game owned by another user", async () => {
      mocks.game.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        updateGameStatus("game-of-user-B", "resign", "gote"),
      ).rejects.toThrow("対局が見つかりません");
      expect(mocks.game.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: "game-of-user-B",
            playerId: "user-A",
          }),
        }),
      );
    });
  });
});
