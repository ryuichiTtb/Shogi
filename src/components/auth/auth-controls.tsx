"use client";

import { SignInButton, UserButton, useAuth, useUser } from "@clerk/nextjs";
import { LogIn } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { LoadingOverlay } from "@/components/loading-overlay";
import { LOADING_STAGES } from "@/lib/loading-stages";

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
    return <div className="h-6 w-6" aria-hidden />;
  }

  // signInOnly: 未ログイン時のみ「ログイン」ボタン。それ以外は何も出さない。
  if (slot === "signInOnly") {
    if (isSignedIn) return null;
    return <SignInButtonWithMask completeUrl={completeUrl} />;
  }

  // signedInOnly: ログイン済み時のみアイコン。未ログインは何も出さない。
  if (slot === "signedInOnly") {
    if (!isSignedIn) return null;
    return (
      <div className="inline-flex items-center">
        {variant === "home" ? <HomeUserButton /> : <SignedInIndicator />}
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
      {isSignedIn ? <HomeUserButton /> : <SignInButtonWithMask completeUrl={completeUrl} />}
    </div>
  );
}

// Issue #163: ログインボタン押下時、Clerk OAuth ホストへの外部リダイレクトに
// 入るまでの間 (= ブラウザの page redirect が完了するまで) にローディング
// マスクを表示する。Clerk の SignInButton は Next.js のクライアント遷移ではなく
// 外部 redirect を起こすため、useLinkStatus / loading.tsx は捕捉できない。
// よってクリック時に local state を立て、Portal で body 直下に LoadingOverlay
// を描画する。リダイレクト完了でコンポーネント自体が unmount されるため、
// state は自然解除される。
function SignInButtonWithMask({ completeUrl }: { completeUrl: string }) {
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // SSR 時 createPortal は使えないため mount 後にだけ Portal を有効化する。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  return (
    <>
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
          onClick={() => setIsSigningIn(true)}
          disabled={isSigningIn}
        >
          <LogIn className="w-3.5 h-3.5" />
          ログイン
        </Button>
      </SignInButton>
      {mounted &&
        typeof document !== "undefined" &&
        createPortal(
          <LoadingOverlay
            show={isSigningIn}
            fullScreen
            card
            progress
            stages={LOADING_STAGES.signIn}
          />,
          document.body,
        )}
    </>
  );
}

// Issue #150: ホーム画面のログインアイコン。Clerk の UserButton をそのまま使うと
// 緑 ring が無いため、外側 span で包んで他画面の SignedInIndicator と揃える。
// avatarBox は Tailwind 文字列で h-6 w-6 (24px) に縮小し、ヘッダーやステータスバーで
// 上下に見切れないようにする。クリック挙動は維持し、サインアウト導線が機能する。
function HomeUserButton() {
  return (
    <span className="inline-flex rounded-full ring-2 ring-emerald-500 leading-none">
      <UserButton
        appearance={{
          elements: {
            avatarBox: "h-6 w-6",
          },
        }}
      />
    </span>
  );
}

// Issue #150: ログイン状態を示すだけの非操作インジケーター。
// Clerk の <UserButton> はクリックでメニューを開くため、他画面では使わない。
// 画像取得失敗時はイニシャル付きのフォールバック円を表示する。
function SignedInIndicator() {
  const { isLoaded, user } = useUser();
  if (!isLoaded || !user) {
    return <div className="h-6 w-6" aria-hidden />;
  }

  const initial = (user.firstName?.[0] ?? user.username?.[0] ?? "U").toUpperCase();

  return (
    // Issue #150: 「アクティブ (ログイン中)」を視覚的に示すため、Teams のオンライン
    // インジケータと同系の緑色 ring を装飾する。色そのものに UI 上の操作性は
    // 持たせず、サインアウトはホーム画面の UserButton に集約。
    // ring-offset は対局画面ヘッダーで上下が見切れる原因になるため付けない。
    <div
      className="h-6 w-6 rounded-full overflow-hidden bg-muted ring-2 ring-emerald-500 flex items-center justify-center text-[9px] font-semibold select-none"
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
