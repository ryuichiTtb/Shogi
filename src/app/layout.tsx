import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { Geist, Geist_Mono, Noto_Sans_JP } from "next/font/google";
import localFont from "next/font/local";
import { ThemeProvider } from "@/components/theme-provider";
import { CardBackProvider } from "@/components/card-back/card-back-provider";
import { ServiceWorkerRegister } from "@/components/sw-register";
import { getCurrentUserPreferences } from "@/app/actions/preferences";
import { isClerkServerConfigured } from "@/lib/auth/config";
import "./globals.css";

// Issue #160: 初回 SSR で Clerk session 解決が間に合わずゲスト経路に落ちる現象を防ぐため、
// Static Render / Edge Cache を明示的に無効化する。getCurrentUserPreferences が
// cookies()/auth() を呼ぶので元々 dynamic 扱いになるはずだが、Vercel preview で初回
// アクセスのキャッシュ動作が観測されたため明示する。
export const dynamic = "force-dynamic";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const notoSansJP = Noto_Sans_JP({
  variable: "--font-noto-sans-jp",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
});

// 駒字・オーバーレイに使う文字のみのサブセット（約10KB）を自己ホスト。
// フルの日本語フォント（3.5MB）に比べて超軽量なため、
// display:"swap" でも切り替えラグがほぼ発生しない。
const yujiBoku = localFont({
  src: "./fonts/yuji-boku-subset.woff2",
  variable: "--font-yuji-boku",
  weight: "400",
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f0e1" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1410" },
  ],
};

export const metadata: Metadata = {
  title: "将棋 - AI対局",
  description: "AIと将棋を楽しもう",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "将棋",
  },
  icons: {
    apple: "/icons/apple-touch-icon.png",
  },
};

function MaybeClerkProvider({ children }: { children: React.ReactNode }) {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return <>{children}</>;
  }
  return (
    <ClerkProvider afterSignOutUrl="/">
      {children}
    </ClerkProvider>
  );
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Issue #160: Clerk session の解決を SSR の最初に明示的に待たせる。
  // 初回アクセス時、proxy (clerkMiddleware) で auth() の userId が null になり
  // getCurrentAppUser がゲスト経路に落ちて preference (theme=system) が新規生成される
  // 現象が観測されたため、layout の冒頭で auth() を await して認証解決を強制する。
  // 同 request 内では cache(...) で memoize されるため getCurrentAppUser 内の auth() は
  // cache hit する。
  // Clerk 未設定環境 (NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY や CLERK_SECRET_KEY が無い
  // ローカル / guest-only 環境) では auth() が落ちる可能性があるため、設定ガードを通す。
  // 既存の current-user.ts / auth/complete/route.ts / proxy.ts と同様の防御。
  if (isClerkServerConfigured()) {
    await auth();
  }

  const preferences = await getCurrentUserPreferences();

  // Issue #160: 初期 paint flash 防止のための inline script。
  // SSR 段階で `<html>` の class はテーマ未確定だが、CSS は `:root` (light) と
  // `.dark` のみで切り替わるため、初期 paint で `.dark` クラスを正しく付与すれば
  // フラッシュなしで描画できる。
  // next-themes 等が採用する標準パターンで、`<body>` の最初の子要素として配置することで
  // HTML パーサーが本体描画前に同期実行する。Next.js 16 で root layout の `<head>` に
  // 手書き要素を入れた場合の挙動が不確実なため、確実な `<body>` 直下方式に統一する。
  // 優先順位:
  //   1. SSR が account 経路で取れた preferences.theme (light/dark/system) を尊重
  //      (= account ユーザーが明示的に system を選んでいた場合は systemTheme 判定)
  //   2. SSR がゲスト経路で theme="system" の **デフォルト値** のとき、過去にユーザーが
  //      設定した `localStorage["shogi-theme:last"]` を userId 非依存のグローバルキーとして
  //      参照 (= 同一ブラウザで最後に切り替えた値) — Clerk SSR cold start でゲスト経路に
  //      落ちた account ユーザーの救済。account 経路では絶対に saved を優先しない。
  //   3. それも無ければ system → prefers-color-scheme で判定
  // theme/userKind は server actions で enum 化された値のため JSON.stringify は安全。
  const themeInitScript = `(function(){try{
var ssr=${JSON.stringify(preferences.theme)};
var kind=${JSON.stringify(preferences.userKind)};
var saved=null;try{saved=localStorage.getItem("shogi-theme:last");}catch(_){}
var t=(kind==="guest"&&ssr==="system"&&saved&&(saved==="light"||saved==="dark"))?saved:ssr;
var dark=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);
if(dark)document.documentElement.classList.add("dark");else document.documentElement.classList.remove("dark");
}catch(e){}})();`;

  return (
    <html
      lang="ja"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${notoSansJP.variable} ${yujiBoku.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <MaybeClerkProvider>
          <ThemeProvider
            userId={preferences.userId}
            userKind={preferences.userKind}
            initialTheme={preferences.theme}
          >
            <CardBackProvider
              userId={preferences.userId}
              userKind={preferences.userKind}
              initialStyle={preferences.cardBackStyle}
            >
              {children}
              <ServiceWorkerRegister />
            </CardBackProvider>
          </ThemeProvider>
        </MaybeClerkProvider>
      </body>
    </html>
  );
}
