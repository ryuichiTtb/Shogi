import { beforeEach, describe, expect, it, vi } from "vitest";

import { createGuestSessionToken } from "@/lib/auth/guest-session";

// prisma を vi.mock で差し替える。各シナリオで $transaction の中で使われるメソッドを
// 必要なものだけ stub する。完全な inMemory 実装ではないため、主要な早期 return 系の
// 振る舞いのみをここで担保する (フル DB 統合は別 Issue #154 でフォローアップ)。
// vi.mock factory は import より前に hoist されるため、共有 mock は vi.hoisted で先に作る。
const txMocks = vi.hoisted(() => {
  const guestSession = {
    findUnique: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  };
  const user = {
    findUnique: vi.fn(),
    delete: vi.fn(),
  };
  const userPreference = {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
  };
  const playerStats = {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
  };
  const playerCardCollection = {
    findMany: vi.fn(),
    upsert: vi.fn(),
    deleteMany: vi.fn(),
  };
  const deck = {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
  };
  const game = {
    updateMany: vi.fn(),
  };
  return {
    guestSession,
    user,
    userPreference,
    playerStats,
    playerCardCollection,
    deck,
    game,
  };
});

const guestSessionMock = txMocks.guestSession;
const userMock = txMocks.user;
const userPreferenceMock = txMocks.userPreference;
const playerStatsMock = txMocks.playerStats;
const playerCardCollectionMock = txMocks.playerCardCollection;
const deckMock = txMocks.deck;
const gameMock = txMocks.game;

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(async (cb: (tx: typeof txMocks) => unknown) => cb(txMocks)),
  },
}));

import { mergeGuestSessionIntoAccount } from "@/lib/auth/merge";

const accountUserId = "account-user-id";

function resetMocks() {
  for (const fn of [
    guestSessionMock.findUnique,
    guestSessionMock.delete,
    guestSessionMock.deleteMany,
    userMock.findUnique,
    userMock.delete,
    userPreferenceMock.findUnique,
    userPreferenceMock.upsert,
    userPreferenceMock.delete,
    playerStatsMock.findUnique,
    playerStatsMock.upsert,
    playerStatsMock.delete,
    playerCardCollectionMock.findMany,
    playerCardCollectionMock.upsert,
    playerCardCollectionMock.deleteMany,
    deckMock.findFirst,
    deckMock.updateMany,
    deckMock.update,
    gameMock.updateMany,
  ]) {
    fn.mockReset();
  }
}

describe("mergeGuestSessionIntoAccount (early-return behaviors)", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("rejects invalid guest tokens without touching the database", async () => {
    const result = await mergeGuestSessionIntoAccount("short", accountUserId);
    expect(result).toEqual({ merged: false, reason: "missing-session" });
    expect(guestSessionMock.findUnique).not.toHaveBeenCalled();
  });

  it("returns missing-session when no row matches the hashed token", async () => {
    guestSessionMock.findUnique.mockResolvedValue(null);

    const token = createGuestSessionToken();
    const result = await mergeGuestSessionIntoAccount(token, accountUserId);

    expect(result).toEqual({ merged: false, reason: "missing-session" });
    expect(userMock.delete).not.toHaveBeenCalled();
  });

  it("deletes the session and returns same-user when the guest already maps to the account", async () => {
    const token = createGuestSessionToken();
    guestSessionMock.findUnique.mockResolvedValue({
      id: "session-1",
      userId: accountUserId,
      user: { kind: "account" },
    });
    guestSessionMock.delete.mockResolvedValue({});

    const result = await mergeGuestSessionIntoAccount(token, accountUserId);

    expect(result).toEqual({ merged: false, reason: "same-user" });
    expect(guestSessionMock.delete).toHaveBeenCalledWith({ where: { id: "session-1" } });
    expect(userMock.delete).not.toHaveBeenCalled();
  });

  it("refuses to merge if the session points to a non-guest user (defense against tampering)", async () => {
    const token = createGuestSessionToken();
    guestSessionMock.findUnique.mockResolvedValue({
      id: "session-2",
      userId: "another-account",
      user: { kind: "account" },
    });
    guestSessionMock.delete.mockResolvedValue({});

    const result = await mergeGuestSessionIntoAccount(token, accountUserId);

    expect(result).toEqual({ merged: false, reason: "not-guest" });
    expect(guestSessionMock.delete).toHaveBeenCalledWith({ where: { id: "session-2" } });
    // データ移管系は一切走らないこと
    expect(deckMock.updateMany).not.toHaveBeenCalled();
    expect(gameMock.updateMany).not.toHaveBeenCalled();
    expect(playerCardCollectionMock.upsert).not.toHaveBeenCalled();
  });

  it("merges guest data into the account when the session is valid", async () => {
    const token = createGuestSessionToken();
    const guestUserId = "guest-user-1";

    guestSessionMock.findUnique.mockResolvedValue({
      id: "session-3",
      userId: guestUserId,
      user: { kind: "guest" },
    });
    userMock.findUnique.mockResolvedValue({ id: accountUserId, kind: "account" });
    playerStatsMock.findUnique.mockResolvedValue(null);
    userPreferenceMock.findUnique.mockResolvedValue(null);
    playerCardCollectionMock.findMany.mockResolvedValue([]);
    deckMock.findFirst.mockResolvedValue(null);
    deckMock.updateMany.mockResolvedValue({ count: 0 });
    gameMock.updateMany.mockResolvedValue({ count: 0 });
    guestSessionMock.deleteMany.mockResolvedValue({ count: 1 });
    userMock.delete.mockResolvedValue({});

    const result = await mergeGuestSessionIntoAccount(token, accountUserId);

    expect(result).toEqual({ merged: true, reason: "merged" });
    expect(deckMock.updateMany).toHaveBeenCalledWith({
      where: { userId: guestUserId },
      data: { userId: accountUserId },
    });
    expect(gameMock.updateMany).toHaveBeenCalledWith({
      where: { playerId: guestUserId },
      data: { playerId: accountUserId },
    });
    expect(guestSessionMock.deleteMany).toHaveBeenCalledWith({
      where: { userId: guestUserId },
    });
    expect(userMock.delete).toHaveBeenCalledWith({ where: { id: guestUserId } });
  });

  it("preserves the guest deck's isDefault when the new account has no deck yet (Issue #150 P1)", async () => {
    // /auth/complete で「shell only で account 作成 → merge → ensureInitialUserData」と
    // 順序を直したことで、merge 時点で account 側にデッキは無い前提。
    // この場合 moveDecks が isDefault=false へ強制せず、ゲスト deck の isDefault を保持する。
    const token = createGuestSessionToken();
    const guestUserId = "guest-user-2";

    guestSessionMock.findUnique.mockResolvedValue({
      id: "session-4",
      userId: guestUserId,
      user: { kind: "guest" },
    });
    userMock.findUnique.mockResolvedValue({ id: accountUserId, kind: "account" });
    playerStatsMock.findUnique.mockResolvedValue(null);
    userPreferenceMock.findUnique.mockResolvedValue(null);
    playerCardCollectionMock.findMany.mockResolvedValue([]);
    deckMock.findFirst.mockResolvedValue(null); // account に default deck なし
    deckMock.updateMany.mockResolvedValue({ count: 1 });
    gameMock.updateMany.mockResolvedValue({ count: 0 });
    guestSessionMock.deleteMany.mockResolvedValue({ count: 1 });
    userMock.delete.mockResolvedValue({});

    await mergeGuestSessionIntoAccount(token, accountUserId);

    expect(deckMock.updateMany).toHaveBeenCalledWith({
      where: { userId: guestUserId },
      data: { userId: accountUserId },
    });
    // 第二引数に isDefault: false が含まれていないことを念押し
    const updateCallArg = deckMock.updateMany.mock.calls[0]?.[0] as {
      data: { userId: string; isDefault?: boolean };
    };
    expect(updateCallArg.data).not.toHaveProperty("isDefault");
  });
});
