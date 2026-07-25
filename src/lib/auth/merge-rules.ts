import {
  DEFAULT_CARD_BACK_STYLE,
  DEFAULT_THEME,
} from "@/lib/user-preferences";

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

// Issue #160: ゲスト preference が「ユーザーが何も触っていないデフォルトのまま」かを判定。
// PC で初めてアプリを開く → ゲスト User が自動生成され DEFAULT_THEME / DEFAULT_CARD_BACK_STYLE
// で preference が作られる → 同アカウントでログインすると、ゲスト側の updatedAt が
// アカウント側 (モバイルで保存した値) より新しいため、shouldUseGuestPreference が true を返し、
// アカウント側の設定が pristine な ゲスト デフォルト値で上書きされていた。
// pristine 判定が true ならゲスト preference を merge せず削除する。
//
// ★判定対象は theme / cardBackStyle のみ (Issue #250)。両者は非 null + 既定値付きで
// 「既定のまま」と「既定と同じ値を自分で選んだ」を区別できないため、行まるごとの
// all-or-nothing 判定に頼らざるを得ない。boardLayout は nullable (null = 未設定) ゆえ
// フィールド単体で明示選択を判定でき、mergePreferences 側で独立に引き継ぐ。
// ここに boardLayout を足すと「盤デザインだけ触ったゲスト」が non-pristine になり、
// ゲストの既定 theme / cardBackStyle がアカウントの保存値を上書きする (#160 の再発)。
export function isPristineGuestPreference(p: {
  theme: string;
  cardBackStyle: string;
}): boolean {
  return p.theme === DEFAULT_THEME && p.cardBackStyle === DEFAULT_CARD_BACK_STYLE;
}

export function shouldUseGuestPreference(
  account: { updatedAt: Date } | null,
  guest: { updatedAt: Date },
): boolean {
  return !account || guest.updatedAt.getTime() > account.updatedAt.getTime();
}
