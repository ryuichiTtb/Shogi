import "server-only";

import { cache } from "react";
import { auth, currentUser } from "@clerk/nextjs/server";
import { cookies } from "next/headers";

import { prisma } from "@/lib/prisma";
import { isClerkServerConfigured } from "@/lib/auth/config";
import {
  GUEST_SESSION_COOKIE_NAME,
  getGuestSessionExpiresAt,
  hashGuestSessionToken,
  isValidGuestSessionToken,
} from "@/lib/auth/guest-session";
import { ensureInitialUserData } from "@/lib/auth/user-bootstrap";

export type AppUserKind = "guest" | "account";

export interface AppUser {
  id: string;
  kind: AppUserKind;
  clerkUserId: string | null;
  email: string | null;
  name: string;
  createdAt: Date;
}

interface UserRow {
  id: string;
  kind: string;
  clerkUserId: string | null;
  email: string | null;
  name: string;
  createdAt: Date;
}

interface ClerkProfile {
  email: string | null;
  name: string;
}

function toAppUser(user: UserRow): AppUser {
  return {
    id: user.id,
    kind: user.kind === "account" ? "account" : "guest",
    clerkUserId: user.clerkUserId,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt,
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

async function readClerkProfile(clerkUserId: string): Promise<ClerkProfile> {
  try {
    const user = await currentUser();
    if (!user || user.id !== clerkUserId) {
      return { email: null, name: "Player" };
    }

    const primaryEmail = user.emailAddresses.find(
      (email) => email.id === user.primaryEmailAddressId,
    );
    const email =
      primaryEmail?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? null;
    const name =
      user.fullName ??
      [user.firstName, user.lastName].filter(Boolean).join(" ") ??
      "Player";

    return { email, name: name.trim() || "Player" };
  } catch {
    return { email: null, name: "Player" };
  }
}

async function readClerkUserId(): Promise<string | null> {
  if (!isClerkServerConfigured()) return null;
  const authResult = await auth();
  return authResult.userId ?? null;
}

export interface AccountUserShellResult {
  user: AppUser;
  isNewAccount: boolean;
}

// Issue #150: account User レコードの create/get のみを行い、初期データ (デッキ・所持カード・
// preference) は作らない。merge フローで「ゲストデータを引っ越した後に不足分だけ補完したい」
// ケースで使う。bootstrap 込みが必要なら getOrCreateAccountUser を使う。
export async function findOrCreateAccountUserShell(
  clerkUserId: string,
): Promise<AccountUserShellResult> {
  const existing = await prisma.user.findUnique({
    where: { clerkUserId },
  });
  if (existing) {
    return { user: toAppUser(existing), isNewAccount: false };
  }

  const profile = await readClerkProfile(clerkUserId);

  try {
    const created = await prisma.user.create({
      data: {
        kind: "account",
        clerkUserId,
        email: profile.email,
        name: profile.name,
      },
    });
    return { user: toAppUser(created), isNewAccount: true };
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const raced = await prisma.user.findUniqueOrThrow({ where: { clerkUserId } });
    return { user: toAppUser(raced), isNewAccount: false };
  }
}

export async function getOrCreateAccountUser(clerkUserId: string): Promise<AppUser> {
  const existing = await prisma.user.findUnique({
    where: { clerkUserId },
  });
  if (existing) return toAppUser(existing);

  const profile = await readClerkProfile(clerkUserId);

  try {
    // Issue #150: ensureInitialUserData は Card マスタ全件 upsert を含むため、
    // Vercel + Neon HTTP の interactive transaction (5s timeout) に収まらない。
    // user 作成自体は単一 upsert で atomic なので transaction 不要。
    // ensureInitialUserData は upsert ベースで冪等のため、user 作成後に外で実行する。
    const created = await prisma.user.upsert({
      where: { clerkUserId },
      create: {
        kind: "account",
        clerkUserId,
        email: profile.email,
        name: profile.name,
      },
      update: {
        kind: "account",
        email: profile.email,
        name: profile.name,
      },
    });
    await ensureInitialUserData(prisma, created.id);
    return toAppUser(created);
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const raced = await prisma.user.findUniqueOrThrow({ where: { clerkUserId } });
    return toAppUser(raced);
  }
}

async function findGuestByTokenHash(tokenHash: string): Promise<AppUser | null> {
  const session = await prisma.guestSession.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!session) return null;

  const now = new Date();
  if (session.expiresAt.getTime() <= now.getTime()) {
    await prisma.guestSession.delete({ where: { id: session.id } });
    return null;
  }

  await prisma.guestSession.update({
    where: { id: session.id },
    data: {
      lastUsedAt: now,
      expiresAt: getGuestSessionExpiresAt(now),
    },
  });

  return toAppUser(session.user);
}

export async function getOrCreateGuestUserForToken(token: string): Promise<AppUser> {
  if (!isValidGuestSessionToken(token)) {
    throw new Error("Invalid guest session token");
  }

  const tokenHash = hashGuestSessionToken(token);
  const existing = await findGuestByTokenHash(tokenHash);
  if (existing) return existing;

  try {
    // Issue #150: User と GuestSession の同時作成のみ atomic にする。
    // ensureInitialUserData は Card マスタ全件 upsert を含み、
    // Vercel + Neon HTTP の interactive transaction (5s timeout) に収まらないため、
    // transaction 外で実行する。upsert ベースで冪等なので途中失敗時の再試行も安全。
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          kind: "guest",
          name: "Guest",
        },
      });
      await tx.guestSession.create({
        data: {
          tokenHash,
          userId: created.id,
          expiresAt: getGuestSessionExpiresAt(),
        },
      });
      return created;
    });
    await ensureInitialUserData(prisma, user.id);
    return toAppUser(user);
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const raced = await findGuestByTokenHash(tokenHash);
    if (!raced) throw error;
    return raced;
  }
}

export const getCurrentAppUser = cache(async (): Promise<AppUser> => {
  const clerkUserId = await readClerkUserId();
  const cookieStore = await cookies();
  const guestToken = cookieStore.get(GUEST_SESSION_COOKIE_NAME)?.value;
  // Issue #160 Phase 1: 一時 instrumentation。Phase 3 で削除する (grep "#160-debug")。
  // タイムスタンプは Vercel runtime logs が自動付与するため不要。
  console.log("[#160-debug getCurrentAppUser]", {
    clerkUserId: clerkUserId ? clerkUserId.slice(0, 12) : null,
    hasGuestCookie: Boolean(guestToken),
  });
  if (clerkUserId) {
    return getOrCreateAccountUser(clerkUserId);
  }

  if (!guestToken) {
    throw new Error("Guest session cookie is missing");
  }

  return getOrCreateGuestUserForToken(guestToken);
});

export async function getCurrentAccountUser(): Promise<AppUser | null> {
  const clerkUserId = await readClerkUserId();
  if (!clerkUserId) return null;
  return getOrCreateAccountUser(clerkUserId);
}
