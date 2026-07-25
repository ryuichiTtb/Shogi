"use server";

import { prisma } from "@/lib/prisma";
import { getCurrentAppUser } from "@/lib/auth/current-user";
import {
  DEFAULT_CARD_BACK_STYLE,
  DEFAULT_THEME,
  isValidBoardLayoutId,
  isValidCardBackStyle,
  isValidThemePreference,
  normalizeBoardLayoutId,
  normalizeCardBackStyle,
  normalizeThemePreference,
  type BoardLayoutId,
  type CardBackStyle,
  type ThemePreference,
} from "@/lib/user-preferences";

export interface CurrentUserPreferences {
  userId: string;
  userKind: "guest" | "account";
  theme: ThemePreference;
  cardBackStyle: CardBackStyle;
  boardLayout: BoardLayoutId;
}

export async function getCurrentUserPreferences(): Promise<CurrentUserPreferences> {
  const user = await getCurrentAppUser();
  const preference = await prisma.userPreference.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      theme: DEFAULT_THEME,
      cardBackStyle: DEFAULT_CARD_BACK_STYLE,
      // Issue #250: boardLayout は書かない (未設定 = NULL)。read 側の
      // normalizeBoardLayout が NULL をコード既定へ吸収するため、既定変更が常に届く。
    },
    update: {},
  });

  return {
    userId: user.id,
    userKind: user.kind,
    theme: normalizeThemePreference(preference.theme),
    cardBackStyle: normalizeCardBackStyle(preference.cardBackStyle),
    // Issue #250: preference.boardLayout は null (未設定) を取りうる。ここで常に
    // コード既定へ吸収するので、CurrentUserPreferences は非 null を保証できる。
    boardLayout: normalizeBoardLayoutId(preference.boardLayout),
  };
}

export async function saveThemePreference(theme: ThemePreference): Promise<void> {
  if (!isValidThemePreference(theme)) {
    throw new Error("Invalid theme preference");
  }
  const user = await getCurrentAppUser();
  await prisma.userPreference.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      theme,
      cardBackStyle: DEFAULT_CARD_BACK_STYLE,
      // Issue #250: boardLayout は書かない (未設定 = NULL = コード既定を適用)。
      // なおこの create は実質到達しない (行は ensureInitialUserData が先に作る) が、
      // 到達した場合も既定を焼き付けないよう防御的に省略しておく。
    },
    update: { theme },
  });
}

export async function saveCardBackStylePreference(
  cardBackStyle: CardBackStyle,
): Promise<void> {
  if (!isValidCardBackStyle(cardBackStyle)) {
    throw new Error("Invalid card back style");
  }
  const user = await getCurrentAppUser();
  await prisma.userPreference.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      theme: DEFAULT_THEME,
      cardBackStyle,
      // Issue #250: boardLayout は書かない (未設定 = NULL = コード既定を適用)。
      // この create も実質到達しない (行は ensureInitialUserData が先に作る)。
    },
    update: { cardBackStyle },
  });
}

// Issue #177: 将棋盤レイアウトをユーザー設定として永続化する。
// CardBack/Theme と同様、未ログインゲストでも guest user に紐付けて DB 保存される。
// ★Issue #250: boardLayout に値を書くのはこの関数 (= ユーザーの明示選択) のみ。
// 他の経路が既定値を書き込むと、その値が「明示選択」と区別できなくなり
// 既定変更が届かなくなる (#250 の原因)。
export async function saveBoardLayoutPreference(
  boardLayout: BoardLayoutId,
): Promise<void> {
  if (!isValidBoardLayoutId(boardLayout)) {
    throw new Error("Invalid board layout id");
  }
  const user = await getCurrentAppUser();
  await prisma.userPreference.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      theme: DEFAULT_THEME,
      cardBackStyle: DEFAULT_CARD_BACK_STYLE,
      boardLayout,
    },
    update: { boardLayout },
  });
}
