"use server";

import { prisma } from "@/lib/prisma";
import { getCurrentAppUser } from "@/lib/auth/current-user";
import {
  DEFAULT_CARD_BACK_STYLE,
  DEFAULT_THEME,
  isValidCardBackStyle,
  isValidThemePreference,
  type CardBackStyle,
  type ThemePreference,
} from "@/lib/user-preferences";

export interface CurrentUserPreferences {
  userId: string;
  userKind: "guest" | "account";
  theme: ThemePreference;
  cardBackStyle: CardBackStyle;
}

function normalizeTheme(value: unknown): ThemePreference {
  return isValidThemePreference(value) ? value : DEFAULT_THEME;
}

function normalizeCardBackStyle(value: unknown): CardBackStyle {
  return isValidCardBackStyle(value) ? value : DEFAULT_CARD_BACK_STYLE;
}

export async function getCurrentUserPreferences(): Promise<CurrentUserPreferences> {
  const user = await getCurrentAppUser();
  const preference = await prisma.userPreference.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      theme: DEFAULT_THEME,
      cardBackStyle: DEFAULT_CARD_BACK_STYLE,
    },
    update: {},
  });

  return {
    userId: user.id,
    userKind: user.kind,
    theme: normalizeTheme(preference.theme),
    cardBackStyle: normalizeCardBackStyle(preference.cardBackStyle),
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
    },
    update: { cardBackStyle },
  });
}
