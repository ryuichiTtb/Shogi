"use client";

import { SignInButton, UserButton, useAuth, useUser } from "@clerk/nextjs";
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

// variant の意味:
// - "home"      : ホーム画面用。ログイン済み時は操作可能な UserButton (メニューから
//                 サインアウトできる)。サインインは left スロット側に出すため、本 variant
//                 では SignInButton 側のレンダリング箇所が分かれる。
// - "indicator" : 他画面用。ログイン済み時はアバター画像のみ (操作不可)、未ログイン時は
//                 何も表示しない。サインアウト導線はホーム画面に統一する。
type AuthControlsVariant = "home" | "indicator";

// slot の意味:
// - "default"      : 従来通りログイン状態に応じた UI を 1 箇所に出す (indicator 専用)。
// - "signInOnly"   : 未ログイン時のみログインボタンを描画 (ホーム左上専用)。
// - "signedInOnly" : ログイン済み時のみアバター/UserButton を描画 (ホーム右上専用)。
type AuthControlsSlot = "default" | "signInOnly" | "signedInOnly";

interface AuthControlsProps {
  variant?: AuthControlsVariant;
  slot?: AuthControlsSlot;
}

export function AuthControls({
  variant = "home",
  slot = "default",
}: AuthControlsProps) {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return null;
  }
  return <ClerkAuthControls variant={variant} slot={slot} />;
}

function ClerkAuthControls({
  variant,
  slot,
}: {
  variant: AuthControlsVariant;
  slot: AuthControlsSlot;
}) {
  const { isLoaded, isSignedIn } = useAuth();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const completeUrl = useMemo(
    () => buildAuthCompleteUrl(pathname ?? "/", searchParams?.toString() ?? ""),
    [pathname, searchParams],
  );

  if (!isLoaded) {
    // ロード中: スロット位置を確保するため最小のプレースホルダ。
    if (slot === "signInOnly" && variant === "home") {
      return <div className="h-8 w-20" aria-hidden />;
    }
    return <div className="h-7 w-7" aria-hidden />;
  }

  // signInOnly: 未ログイン時のみ「ログイン」ボタン。それ以外は何も出さない。
  if (slot === "signInOnly") {
    if (isSignedIn) return null;
    return renderSignInButton(completeUrl);
  }

  // signedInOnly: ログイン済み時のみアイコン。未ログインは何も出さない。
  if (slot === "signedInOnly") {
    if (!isSignedIn) return null;
    return (
      <div className="inline-flex items-center">
        {variant === "home" ? <UserButton /> : <SignedInIndicator />}
      </div>
    );
  }

  // default (slot 未指定): indicator variant 用の単一スロット。
  if (variant === "indicator") {
    if (!isSignedIn) return null;
    return (
      <div className="inline-flex items-center">
        <SignedInIndicator />
      </div>
    );
  }

  // default + home: 旧挙動 (1 箇所にログイン状態に応じた UI)。テスト互換のため残す。
  return (
    <div className="inline-flex items-center">
      {isSignedIn ? <UserButton /> : renderSignInButton(completeUrl)}
    </div>
  );
}

function renderSignInButton(completeUrl: string) {
  return (
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
  );
}

// Issue #150: ログイン状態を示すだけの非操作インジケーター。
// Clerk の <UserButton> はクリックでメニューを開くため、他画面では使わない。
// 画像取得失敗時はイニシャル付きのフォールバック円を表示する。
function SignedInIndicator() {
  const { isLoaded, user } = useUser();
  if (!isLoaded || !user) {
    return <div className="h-7 w-7" aria-hidden />;
  }

  const initial = (user.firstName?.[0] ?? user.username?.[0] ?? "U").toUpperCase();

  return (
    // Issue #150: 「アクティブ (ログイン中)」を視覚的に示すため、Teams のオンライン
    // インジケータと同系の緑色 ring を装飾する。色そのものに UI 上の操作性は
    // 持たせず、サインアウトはホーム画面の UserButton に集約。
    <div
      className="h-7 w-7 rounded-full overflow-hidden bg-muted ring-2 ring-emerald-500 ring-offset-1 ring-offset-background flex items-center justify-center text-[10px] font-semibold select-none"
      aria-label="ログイン中"
      title="ログイン中 (サインアウトはホーム画面から)"
    >
      {user.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={user.imageUrl}
          alt=""
          className="h-full w-full object-cover"
          draggable={false}
        />
      ) : (
        <span>{initial}</span>
      )}
    </div>
  );
}
