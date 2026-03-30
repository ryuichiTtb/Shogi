import type { Metadata } from "next";
import { Geist, Geist_Mono, Yuji_Boku } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// display:"optional" でフォント切り替えチラつき（FOUT）を排除する。
// next/font が自己ホスティングするためほぼ即座に読み込まれ、
// キャッシュ済みなら確実に Yuji Boku が表示される。
const yujiBoku = Yuji_Boku({
  variable: "--font-yuji-boku",
  subsets: ["latin"],
  weight: "400",
  display: "optional",
});

export const metadata: Metadata = {
  title: "将棋 - AI対局",
  description: "AIと将棋を楽しもう",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className={`${geistSans.variable} ${geistMono.variable} ${yujiBoku.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
