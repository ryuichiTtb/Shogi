"use client";

import { Loader2 } from "lucide-react";

// デッキ詳細を読み込み中・別デッキ切替直後に表示する placeholder。
// DeckEditorPane と同じレイアウト構造 (header + body grid) を再現することで、
// 読み込み完了時に高さがジャンプしない。animate-pulse で読み込み中を示す。
// さらに中央にくるくる回るスピナーをオーバーレイで重ね、進行中であることを
// ハッキリ示す。

export function DeckEditorSkeleton() {
  return (
    <div className="relative flex flex-col flex-1 min-h-0">
      {/* ヘッダ: デッキ名 / サマリ / 保存ボタンの代替プレースホルダ */}
      <div className="p-3 border-b flex flex-col gap-2 shrink-0">
        <div className="flex items-center gap-2">
          <div className="h-5 w-40 bg-muted rounded animate-pulse" />
          <div className="flex-1" />
          <div className="h-7 w-16 bg-muted rounded animate-pulse" />
        </div>
        <div className="flex items-center gap-3">
          <div className="h-3 w-20 bg-muted rounded animate-pulse" />
          <div className="h-3 w-16 bg-muted rounded animate-pulse" />
          <div className="h-3 w-16 bg-muted rounded animate-pulse" />
          <div className="h-3 w-20 bg-muted rounded animate-pulse" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-7 w-20 bg-muted rounded animate-pulse" />
        </div>
      </div>

      {/* 本体: 左 (現在のデッキ) / 右 (所持カード) */}
      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x">
        <SkeletonSection labelW="w-32" />
        <SkeletonSection labelW="w-28" />
      </div>

      {/* 中央スピナー (回転アニメ)。aria-busy はフレーム親側で必要なら付与。 */}
      <div
        className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none"
        aria-label="読み込み中"
        role="status"
      >
        <div className="rounded-full bg-background/85 shadow-md p-3 backdrop-blur-sm">
          <Loader2 className="w-7 h-7 text-primary animate-spin" />
        </div>
        <span className="text-xs text-muted-foreground bg-background/85 px-2 py-0.5 rounded-md">
          読み込み中...
        </span>
      </div>
    </div>
  );
}

function SkeletonSection({ labelW }: { labelW: string }) {
  return (
    <section className="flex flex-col min-h-0">
      <header className="p-2 border-b shrink-0">
        <div className={`h-3 ${labelW} bg-muted rounded animate-pulse`} />
      </header>
      <div className="flex-1 min-h-0 p-2 grid grid-cols-1 lg:grid-cols-2 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="aspect-[3/4] bg-muted rounded-md animate-pulse"
          />
        ))}
      </div>
    </section>
  );
}
