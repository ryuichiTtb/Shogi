export function mergedCardCount(accountCount: number | undefined, guestCount: number): number {
  return Math.max(accountCount ?? 0, guestCount);
}

export function mergedStats(
  account:
    | { rating: number; wins: number; losses: number; draws: number }
    | null,
  guest: { rating: number; wins: number; losses: number; draws: number },
) {
  return {
    rating: Math.max(account?.rating ?? 1500, guest.rating),
    wins: (account?.wins ?? 0) + guest.wins,
    losses: (account?.losses ?? 0) + guest.losses,
    draws: (account?.draws ?? 0) + guest.draws,
  };
}

export function shouldUseGuestPreference(
  account: { updatedAt: Date } | null,
  guest: { updatedAt: Date },
): boolean {
  return !account || guest.updatedAt.getTime() > account.updatedAt.getTime();
}
