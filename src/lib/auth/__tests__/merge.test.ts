import { beforeEach, describe, expect, it, vi } from "vitest";

import { createGuestSessionToken } from "@/lib/auth/guest-session";

// prisma を vi.mock で差し替える。Issue #150 で merge.ts は transaction 撤去済みのため、
// prisma 直下のメソッドを直接 stub する。完全な inMemory 実装ではないため、主要な
// 早期 return 系の振る舞いをここで担保する (フル DB 統合は別 Issue #154)。
// vi.mock factory は import より前に hoist されるため、共有 mock は vi.hoisted で先に作る。
const dbMocks = vi.hoisted(() => {
  const guestSession = {
    findUnique: vi.fn(),
    deleteMany: vi.fn(),
  };
  const user = {
    findUnique: vi.fn(),
    deleteMany: vi.fn(),
  };
  const userPreference = {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    deleteMany: vi.fn(),
  };
  const playerStats = {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    deleteMany: vi.fn(),
  };
  const playerCardCollection = {
    findMany: vi.fn(),
    upsert: vi.fn(),
    deleteMany: vi.fn(),
  };
  const deck = {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
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

const guestSessionMock = dbMocks.guestSession;
const userMock = dbMocks.user;
const userPreferenceMock = dbMocks.userPreference;
const playerStatsMock = dbMocks.playerStats;
const playerCardCollectionMock = dbMocks.playerCardCollection;
const deckMock = dbMocks.deck;
const gameMock = dbMocks.game;

vi.mock("@/lib/prisma", () => ({
  prisma: dbMocks,
}));

import { mergeGuestSessionIntoAccount } from "@/lib/auth/merge";

const accountUserId = "account-user-id";

function resetMocks() {
  for (const fn of [
    guestSessionMock.findUnique,
    guestSessionMock.deleteMany,
    userMock.findUnique,
    userMock.deleteMany,
    userPreferenceMock.findUnique,
    userPreferenceMock.upsert,
    userPreferenceMock.deleteMany,
    playerStatsMock.findUnique,
    playerStatsMock.upsert,
    playerStatsMock.deleteMany,
    playerCardCollectionMock.findMany,
    playerCardCollectionMock.upsert,
    playerCardCollectionMock.deleteMany,
    deckMock.findFirst,
    deckMock.findMany,
    deckMock.updateMany,
    deckMock.update,
    deckMock.delete,
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
    expect(userMock.deleteMany).not.toHaveBeenCalled();
  });

  it("deletes the session and returns same-user when the guest already maps to the account", async () => {
    const token = createGuestSessionToken();
    guestSessionMock.findUnique.mockResolvedValue({
      id: "session-1",
      userId: accountUserId,
      user: { kind: "account" },
    });
    guestSessionMock.deleteMany.mockResolvedValue({ count: 1 });

    const result = await mergeGuestSessionIntoAccount(token, accountUserId);

    expect(result).toEqual({ merged: false, reason: "same-user" });
    expect(guestSessionMock.deleteMany).toHaveBeenCalledWith({ where: { id: "session-1" } });
    expect(userMock.deleteMany).not.toHaveBeenCalled();
  });

  it("refuses to merge if the session points to a non-guest user (defense against tampering)", async () => {
    const token = createGuestSessionToken();
    guestSessionMock.findUnique.mockResolvedValue({
      id: "session-2",
      userId: "another-account",
      user: { kind: "account" },
    });
    guestSessionMock.deleteMany.mockResolvedValue({ count: 1 });

    const result = await mergeGuestSessionIntoAccount(token, accountUserId);

    expect(result).toEqual({ merged: false, reason: "not-guest" });
    expect(guestSessionMock.deleteMany).toHaveBeenCalledWith({ where: { id: "session-2" } });
    // データ移管系は一切走らないこと
    expect(deckMock.findMany).not.toHaveBeenCalled();
    expect(deckMock.update).not.toHaveBeenCalled();
    expect(deckMock.delete).not.toHaveBeenCalled();
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
    deckMock.findMany.mockResolvedValue([]); // ゲストに deck なし
    gameMock.updateMany.mockResolvedValue({ count: 0 });
    guestSessionMock.deleteMany.mockResolvedValue({ count: 1 });
    userMock.deleteMany.mockResolvedValue({ count: 1 });

    const result = await mergeGuestSessionIntoAccount(token, accountUserId);

    expect(result).toEqual({ merged: true, reason: "merged" });
    expect(gameMock.updateMany).toHaveBeenCalledWith({
      where: { playerId: guestUserId },
      data: { playerId: accountUserId },
    });
    expect(guestSessionMock.deleteMany).toHaveBeenCalledWith({
      where: { userId: guestUserId },
    });
    expect(userMock.deleteMany).toHaveBeenCalledWith({ where: { id: guestUserId } });
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
    deckMock.findMany.mockResolvedValue([
      {
        id: "guest-deck-1",
        name: "デフォルトデッキ",
        isDefault: true,
        entries: [{ cardId: "any", count: 2 }],
      },
    ]);
    deckMock.update.mockResolvedValue({});
    gameMock.updateMany.mockResolvedValue({ count: 0 });
    guestSessionMock.deleteMany.mockResolvedValue({ count: 1 });
    userMock.deleteMany.mockResolvedValue({ count: 1 });

    await mergeGuestSessionIntoAccount(token, accountUserId);

    // deck.update は呼ばれる (guest deck の所有権移管) が、isDefault は data に
    // 含まれない (= ゲスト側の isDefault が保持される)。
    expect(deckMock.update).toHaveBeenCalledWith({
      where: { id: "guest-deck-1" },
      data: { userId: accountUserId },
    });
    const updateCallArg = deckMock.update.mock.calls[0]?.[0] as {
      data: { userId: string; isDefault?: boolean };
    };
    expect(updateCallArg.data).not.toHaveProperty("isDefault");
  });

  it("does not wrap data movement in a transaction (Issue #150 Vercel/Neon timeout fix)", async () => {
    // transaction を使うと Vercel + Neon HTTP の interactive transaction (5s) に
    // 引っかかるため、Issue #150 で外した。再導入しないことを担保する regression test。
    const token = createGuestSessionToken();
    const guestUserId = "guest-user-3";

    guestSessionMock.findUnique.mockResolvedValue({
      id: "session-5",
      userId: guestUserId,
      user: { kind: "guest" },
    });
    userMock.findUnique.mockResolvedValue({ id: accountUserId, kind: "account" });
    playerStatsMock.findUnique.mockResolvedValue(null);
    userPreferenceMock.findUnique.mockResolvedValue(null);
    playerCardCollectionMock.findMany.mockResolvedValue([]);
    deckMock.findFirst.mockResolvedValue(null);
    deckMock.findMany.mockResolvedValue([]);
    gameMock.updateMany.mockResolvedValue({ count: 0 });
    guestSessionMock.deleteMany.mockResolvedValue({ count: 1 });
    userMock.deleteMany.mockResolvedValue({ count: 1 });

    // prisma stub に $transaction を一切定義していない (= 呼ぶと undefined エラー)。
    // この状態で merge が成功すれば、transaction 経由ではなく直接呼び出しで動いている証。
    const result = await mergeGuestSessionIntoAccount(token, accountUserId);
    expect(result).toEqual({ merged: true, reason: "merged" });
  });

  it("deletes pristine guest default deck instead of stacking it onto the account (deck duplication regression)", async () => {
    // Issue #150: サインアウト→サインインを繰り返すと account の deck が毎回 +1 増殖
    // していた問題の regression test。
    // ゲストが何も触っていない初期構成 (デフォルトデッキ名 + 全 playable カード ×
    // INITIAL_DECK_CARD_COUNT 枚 + isDefault=true) かつ account に既に default deck が
    // ある場合、移管せず削除する。
    const { ALL_CARD_DEFS } = await import("@/lib/shogi/cards/definitions");
    const { INITIAL_DECK_CARD_COUNT } = await import("@/lib/auth/user-bootstrap");
    const playableEntries = ALL_CARD_DEFS.filter((d) => d.status !== "deprecated").map(
      (d) => ({ cardId: d.id, count: INITIAL_DECK_CARD_COUNT }),
    );

    const token = createGuestSessionToken();
    const guestUserId = "guest-user-4";

    guestSessionMock.findUnique.mockResolvedValue({
      id: "session-6",
      userId: guestUserId,
      user: { kind: "guest" },
    });
    userMock.findUnique.mockResolvedValue({ id: accountUserId, kind: "account" });
    playerStatsMock.findUnique.mockResolvedValue(null);
    userPreferenceMock.findUnique.mockResolvedValue(null);
    playerCardCollectionMock.findMany.mockResolvedValue([]);
    // account には既に default deck がある
    deckMock.findFirst.mockResolvedValue({ id: "account-default" });
    // ゲストは未編集の初期構成 default deck を 1 つ持つ
    deckMock.findMany.mockResolvedValue([
      {
        id: "guest-pristine-deck",
        name: "デフォルトデッキ",
        isDefault: true,
        entries: playableEntries,
      },
    ]);
    deckMock.delete.mockResolvedValue({});
    gameMock.updateMany.mockResolvedValue({ count: 0 });
    guestSessionMock.deleteMany.mockResolvedValue({ count: 1 });
    userMock.deleteMany.mockResolvedValue({ count: 1 });

    await mergeGuestSessionIntoAccount(token, accountUserId);

    expect(deckMock.delete).toHaveBeenCalledWith({ where: { id: "guest-pristine-deck" } });
    expect(deckMock.update).not.toHaveBeenCalled();
  });

  it("preserves a guest-edited deck (different name or different entries) by moving it to the account", async () => {
    // ゲストが触ったデッキ (= name 変更 / 編成変更) は削除せず移管。
    const token = createGuestSessionToken();
    const guestUserId = "guest-user-5";

    guestSessionMock.findUnique.mockResolvedValue({
      id: "session-7",
      userId: guestUserId,
      user: { kind: "guest" },
    });
    userMock.findUnique.mockResolvedValue({ id: accountUserId, kind: "account" });
    playerStatsMock.findUnique.mockResolvedValue(null);
    userPreferenceMock.findUnique.mockResolvedValue(null);
    playerCardCollectionMock.findMany.mockResolvedValue([]);
    deckMock.findFirst.mockResolvedValue({ id: "account-default" });
    deckMock.findMany.mockResolvedValue([
      {
        id: "guest-custom-deck",
        name: "ゲスト自作デッキ", // 名前が違う = 編集済み
        isDefault: true,
        entries: [{ cardId: "any", count: 2 }],
      },
    ]);
    deckMock.update.mockResolvedValue({});
    gameMock.updateMany.mockResolvedValue({ count: 0 });
    guestSessionMock.deleteMany.mockResolvedValue({ count: 1 });
    userMock.deleteMany.mockResolvedValue({ count: 1 });

    await mergeGuestSessionIntoAccount(token, accountUserId);

    // 削除はされず、isDefault=false で account 側に移管される
    expect(deckMock.delete).not.toHaveBeenCalled();
    expect(deckMock.update).toHaveBeenCalledWith({
      where: { id: "guest-custom-deck" },
      data: { userId: accountUserId, isDefault: false },
    });
  });
});
