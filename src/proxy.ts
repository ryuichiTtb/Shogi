import { clerkMiddleware } from "@clerk/nextjs/server";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  createGuestSessionToken,
  getGuestSessionCookieOptions,
  GUEST_SESSION_COOKIE_NAME,
  isValidGuestSessionToken,
  setCookieValueInHeader,
} from "@/lib/auth/guest-session";

function isClerkConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
      process.env.CLERK_SECRET_KEY,
  );
}

function ensureGuestCookie(request: NextRequest): NextResponse {
  const existingToken = request.cookies.get(GUEST_SESSION_COOKIE_NAME)?.value;
  const token = isValidGuestSessionToken(existingToken)
    ? existingToken
    : createGuestSessionToken();

  if (token === existingToken) {
    const response = NextResponse.next();
    response.cookies.set(
      GUEST_SESSION_COOKIE_NAME,
      token,
      getGuestSessionCookieOptions(),
    );
    return response;
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(
    "cookie",
    setCookieValueInHeader(
      requestHeaders.get("cookie"),
      GUEST_SESSION_COOKIE_NAME,
      token,
    ),
  );

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.cookies.set(
    GUEST_SESSION_COOKIE_NAME,
    token,
    getGuestSessionCookieOptions(),
  );
  return response;
}

const guestOnlyProxy = (request: NextRequest) => ensureGuestCookie(request);

const clerkProxy = clerkMiddleware(async (auth, request) => {
  const { userId } = await auth();
  if (userId) {
    return NextResponse.next();
  }
  return ensureGuestCookie(request);
});

export default isClerkConfigured() ? clerkProxy : guestOnlyProxy;

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|mp3|wav|ogg)).*)",
    "/(api|trpc)(.*)",
  ],
};
