import { describe, expect, it } from "vitest";

import {
  createGuestSessionToken,
  GUEST_SESSION_COOKIE_NAME,
  hashGuestSessionToken,
  isValidGuestSessionToken,
  setCookieValueInHeader,
} from "@/lib/auth/guest-session";

describe("guest-session", () => {
  it("creates high-entropy URL-safe tokens", () => {
    const token = createGuestSessionToken();

    expect(token).toHaveLength(43);
    expect(isValidGuestSessionToken(token)).toBe(true);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("rejects malformed or low-entropy cookie values", () => {
    expect(isValidGuestSessionToken("")).toBe(false);
    expect(isValidGuestSessionToken("short")).toBe(false);
    expect(isValidGuestSessionToken("x".repeat(42))).toBe(false);
    expect(isValidGuestSessionToken("x".repeat(129))).toBe(false);
    expect(isValidGuestSessionToken("x".repeat(42) + "=")).toBe(false);
    expect(isValidGuestSessionToken(null)).toBe(false);
  });

  it("hashes tokens deterministically without storing the raw token", () => {
    const token = createGuestSessionToken();
    const hash = hashGuestSessionToken(token);

    expect(hash).toBe(hashGuestSessionToken(token));
    expect(hash).not.toBe(token);
    expect(hash).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("replaces only the guest cookie in an upstream Cookie header", () => {
    const header = setCookieValueInHeader(
      `a=1; ${GUEST_SESSION_COOKIE_NAME}=old; b=2`,
      GUEST_SESSION_COOKIE_NAME,
      "new-token",
    );

    expect(header).toBe(`a=1; b=2; ${GUEST_SESSION_COOKIE_NAME}=new-token`);
  });
});
