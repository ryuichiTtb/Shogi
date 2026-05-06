import { createHash, randomBytes } from "node:crypto";

export const GUEST_SESSION_COOKIE_NAME = "shogi_guest_session";
export const GUEST_SESSION_TTL_DAYS = 180;
export const GUEST_SESSION_TOKEN_BYTES = 32;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;

export function createGuestSessionToken(): string {
  return randomBytes(GUEST_SESSION_TOKEN_BYTES).toString("base64url");
}

export function isValidGuestSessionToken(token: unknown): token is string {
  return (
    typeof token === "string" &&
    token.length >= 43 &&
    token.length <= 128 &&
    TOKEN_PATTERN.test(token)
  );
}

export function hashGuestSessionToken(token: string): string {
  if (!isValidGuestSessionToken(token)) {
    throw new Error("Invalid guest session token");
  }
  return createHash("sha256").update(token).digest("base64url");
}

export function getGuestSessionExpiresAt(now = new Date()): Date {
  return new Date(now.getTime() + GUEST_SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export function getGuestSessionCookieOptions(now = new Date()) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: getGuestSessionExpiresAt(now),
  };
}

export function setCookieValueInHeader(
  cookieHeader: string | null,
  name: string,
  value: string,
): string {
  const nextCookie = `${name}=${value}`;
  if (!cookieHeader) return nextCookie;

  const retained = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !part.startsWith(`${name}=`));

  return [...retained, nextCookie].join("; ");
}
