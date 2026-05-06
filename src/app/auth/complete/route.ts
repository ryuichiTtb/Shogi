import { NextRequest, NextResponse } from "next/server";

import { getCurrentAccountUser } from "@/lib/auth/current-user";
import { GUEST_SESSION_COOKIE_NAME } from "@/lib/auth/guest-session";
import { mergeGuestSessionIntoAccount } from "@/lib/auth/merge";

function getSafeRedirectUrl(request: NextRequest): URL {
  const next = request.nextUrl.searchParams.get("next") ?? "/";
  try {
    const target = new URL(next, request.url);
    if (target.origin !== request.nextUrl.origin) {
      return new URL("/", request.url);
    }
    return target;
  } catch {
    return new URL("/", request.url);
  }
}

export async function GET(request: NextRequest) {
  const accountUser = await getCurrentAccountUser();
  const redirectUrl = getSafeRedirectUrl(request);
  const response = NextResponse.redirect(redirectUrl);

  if (!accountUser) {
    return response;
  }

  const guestToken = request.cookies.get(GUEST_SESSION_COOKIE_NAME)?.value;
  await mergeGuestSessionIntoAccount(guestToken, accountUser.id);
  response.cookies.delete(GUEST_SESSION_COOKIE_NAME);

  return response;
}
