import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { Geist, Geist_Mono, Noto_Sans_JP } from "next/font/google";
import localFont from "next/font/local";
import { ThemeProvider } from "@/components/theme-provider";
import { CardBackProvider } from "@/components/card-back/card-back-provider";
import { ServiceWorkerRegister } from "@/components/sw-register";
import { getCurrentUserPreferences } from "@/app/actions/preferences";
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
  await auth();

  const preferences = await getCurrentUserPreferences();

  return (
    <html
      lang="ja"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${notoSansJP.variable} ${yujiBoku.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
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
