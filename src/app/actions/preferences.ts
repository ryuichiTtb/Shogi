"use server";

import { prisma } from "@/lib/prisma";
import { getCurrentAppUser } from "@/lib/auth/current-user";
import {
  DEFAULT_BOARD_LAYOUT_ID,
  DEFAULT_CARD_BACK_STYLE,
  DEFAULT_THEME,
  isValidBoardLayoutId,
  isValidCardBackStyle,
  isValidThemePreference,
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

function normalizeTheme(value: unknown): ThemePreference {
  return isValidThemePreference(value) ? value : DEFAULT_THEME;
}

function normalizeCardBackStyle(value: unknown): CardBackStyle {
  return isValidCardBackStyle(value) ? value : DEFAULT_CARD_BACK_STYLE;
}

function normalizeBoardLayout(value: unknown): BoardLayoutId {
  return isValidBoardLayoutId(value) ? value : DEFAULT_BOARD_LAYOUT_ID;
}

export async function getCurrentUserPreferences(): Promise<CurrentUserPreferences> {
  const user = await getCurrentAppUser();
  const preference = await prisma.userPreference.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      theme: DEFAULT_THEME,
      cardBackStyle: DEFAULT_CARD_BACK_STYLE,
      boardLayout: DEFAULT_BOARD_LAYOUT_ID,
    },
    update: {},
  });

  return {
    userId: user.id,
    userKind: user.kind,
    theme: normalizeTheme(preference.theme),
    cardBackStyle: normalizeCardBackStyle(preference.cardBackStyle),
    boardLayout: normalizeBoardLayout(preference.boardLayout),
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
      boardLayout: DEFAULT_BOARD_LAYOUT_ID,
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
      boardLayout: DEFAULT_BOARD_LAYOUT_ID,
    },
    update: { cardBackStyle },
  });
}

// Issue #177: 将棋盤レイアウトをユーザー設定として永続化する。
// CardBack/Theme と同様、未ログインゲストでも guest user に紐付けて DB 保存される。
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
