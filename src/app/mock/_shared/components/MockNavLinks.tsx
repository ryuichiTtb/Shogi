"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

const VARIANTS = [
  { href: "/mock/card-shogi-a", label: "A 上下分割" },
  { href: "/mock/card-shogi-b", label: "B ボトムドロワー" },
  { href: "/mock/card-shogi-c", label: "C オーバーレイ" },
];

interface MockNavLinksProps {
  current: "a" | "b" | "c";
}

export function MockNavLinks({ current }: MockNavLinksProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <Link href="/mock" className="text-muted-foreground hover:underline">
        ← 一覧
      </Link>
      <span className="text-muted-foreground">|</span>
      {VARIANTS.map((v) => {
        const isCurrent = v.href.endsWith(`-${current}`);
        return (
          <Link
            key={v.href}
            href={v.href}
            className={cn(
              "px-2 py-0.5 rounded border",
              isCurrent
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border hover:bg-muted",
            )}
          >
            {v.label}
          </Link>
        );
      })}
    </div>
  );
}
