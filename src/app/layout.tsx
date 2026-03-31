import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Noto_Sans_JP } from "next/font/google";
import localFont from "next/font/local";
import { ThemeProvider } from "@/components/theme-provider";
import { ServiceWorkerRegister } from "@/components/sw-register";
import "./globals.css";

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${notoSansJP.variable} ${yujiBoku.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <ThemeProvider>
          {children}
          <ServiceWorkerRegister />
        </ThemeProvider>
      </body>
    </html>
  );
}
