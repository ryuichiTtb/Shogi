import type { Metadata, Viewport } from "next";
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

const yujiBoku = Yuji_Boku({
  variable: "--font-yuji-boku",
  subsets: ["latin"],
  weight: "400",
  display: "block",
});

export const metadata: Metadata = {
  title: "将棋 - AI対局",
  description: "AIと将棋を楽しもう",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
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
