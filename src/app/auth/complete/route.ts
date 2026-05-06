import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import {
  findOrCreateAccountUserShell,
  getCurrentAccountUser,
} from "@/lib/auth/current-user";
import { GUEST_SESSION_COOKIE_NAME, isValidGuestSessionToken } from "@/lib/auth/guest-session";
import { mergeGuestSessionIntoAccount } from "@/lib/auth/merge";
import { ensureInitialUserData } from "@/lib/auth/user-bootstrap";
import { auth } from "@clerk/nextjs/server";
import { isClerkServerConfigured } from "@/lib/auth/config";

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

async function readClerkUserId(): Promise<string | null> {
  if (!isClerkServerConfigured()) return null;
  const result = await auth();
  return result.userId ?? null;
}

export async function GET(request: NextRequest) {
  const redirectUrl = getSafeRedirectUrl(request);
  const response = NextResponse.redirect(redirectUrl);

  const clerkUserId = await readClerkUserId();
  if (!clerkUserId) {
    // 認証されていない場合は次画面に戻すだけ。AuthControls の SignInButton 経由で来る想定なので
    // 通常は発生しないが、直接アクセスされた場合の安全動作。
    return response;
  }

  const guestToken = request.cookies.get(GUEST_SESSION_COOKIE_NAME)?.value;
  const hasValidGuestToken = isValidGuestSessionToken(guestToken);

  if (hasValidGuestToken) {
    // Issue #150: ゲストデータがある場合は account を空 (bootstrap なし) で作成し、
    // merge でゲストデータを引っ越した後、不足分だけ ensureInitialUserData で補完する。
    // これにより「初回ログインで account 初期データが直前生成され、merge 時に preference の
    // updatedAt が新しくなりすぎる / default deck が居座ってゲスト deck が isDefault=false に
    // 落とされる」という順序バグを回避する。
    const { user: accountUser } = await findOrCreateAccountUserShell(clerkUserId);
    await mergeGuestSessionIntoAccount(guestToken, accountUser.id);
    await ensureInitialUserData(prisma, accountUser.id);
  } else {
    // ゲストトークンが無い/無効な場合は従来通り bootstrap 込みで取得する。
    // getCurrentAccountUser は内部で getOrCreateAccountUser を呼び ensureInitialUserData まで実行。
    await getCurrentAccountUser();
  }

  response.cookies.delete(GUEST_SESSION_COOKIE_NAME);
  return response;
}
