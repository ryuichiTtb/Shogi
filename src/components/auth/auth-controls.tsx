"use client";

import { SignInButton, UserButton, useAuth } from "@clerk/nextjs";
import { LogIn } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";

// Issue #150: ログイン後の戻り先を「現在のページ」にするため、相対パス + 検索クエリを
// next にエンコードして /auth/complete?next=... として渡す。
// /auth/complete 側 (route.ts の getSafeRedirectUrl) で同一 origin チェックが入るため、
// ここで生成する値は path のみで十分 (origin 跨ぎは弾かれる)。
function buildAuthCompleteUrl(pathname: string, search: string): string {
  // /auth/complete 自身に戻すと無限ループになるためホームに退避。
  if (pathname.startsWith("/auth/")) {
    return "/auth/complete";
  }
  const next = `${pathname}${search ? `?${search}` : ""}`;
  return `/auth/complete?next=${encodeURIComponent(next)}`;
}

export function AuthControls() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return null;
  }
  return <ClerkAuthControls />;
}

function ClerkAuthControls() {
  const { isLoaded, isSignedIn } = useAuth();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const completeUrl = useMemo(
    () => buildAuthCompleteUrl(pathname ?? "/", searchParams?.toString() ?? ""),
    [pathname, searchParams],
  );

  if (!isLoaded) {
    return <div className="h-7 w-7" aria-hidden />;
  }

  return (
    <div className="inline-flex items-center">
      {isSignedIn ? (
        <UserButton />
      ) : (
        <SignInButton
          mode="redirect"
          oauthFlow="redirect"
          forceRedirectUrl={completeUrl}
          fallbackRedirectUrl={completeUrl}
          signUpForceRedirectUrl={completeUrl}
          signUpFallbackRedirectUrl={completeUrl}
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="bg-card/70 backdrop-blur-sm"
            aria-label="Googleでログイン"
          >
            <LogIn className="w-3.5 h-3.5" />
            ログイン
          </Button>
        </SignInButton>
      )}
    </div>
  );
}
