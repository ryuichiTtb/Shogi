// Issue #155: デッキ編成画面ヘッダ。
// 「ホームへ戻る」リンクとタイトルを表示する Client Component。
// editor 保存中はリンクを操作不可 (aria-disabled + cursor-not-allowed +
// 透過) にし、保存処理の途中でユーザーが意図せずホームへ抜けるのを防ぐ。
"use client";

import { ArrowLeft } from "lucide-react";
import { AuthControls } from "@/components/auth/auth-controls";
import { MaskedLink } from "@/components/navigation/masked-link";
import { cn } from "@/lib/utils";

interface DecksPageHeaderProps {
  // 「ホームへ戻る」を操作不可にするフラグ。
  // editor の保存中など、画面遷移を抑止したいときに true。
  homeDisabled?: boolean;
}

export function DecksPageHeader({ homeDisabled = false }: DecksPageHeaderProps) {
  return (
    <header className="shrink-0 bg-background/90 backdrop-blur-sm border-b border-border/50">
      <div className="max-w-6xl lg:max-w-[1440px] mx-auto px-4 py-3 sm:py-4 w-full flex items-center gap-3">
        <MaskedLink
          href="/"
          aria-label="ホームへ戻る"
          aria-disabled={homeDisabled || undefined}
          loadingVariant="spinner"
          // disabled 状態のとき onClick を吸収して遷移を止める。
          // <a> 要素は HTML 仕様上 disabled 属性を持たないため、
          // pointer-events:none + onClick preventDefault で代替する。
          onClick={(e) => {
            if (homeDisabled) e.preventDefault();
          }}
          className={cn(
            "inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors",
            homeDisabled
              ? "opacity-60 cursor-not-allowed pointer-events-none"
              : "hover:text-foreground",
          )}
        >
          <ArrowLeft className="w-4 h-4" />
          ホーム
        </MaskedLink>
        <div className="flex-1">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">デッキ編成</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            カード将棋のデッキを作成・編集する
          </p>
        </div>
        {/* origin/main で導入された AuthControls (ヘッダ右端に認証状態 indicator)。
            旧 /decks Server Component 側にあったものを Client ヘッダに移管。 */}
        <AuthControls variant="indicator" />
      </div>
    </header>
  );
}
