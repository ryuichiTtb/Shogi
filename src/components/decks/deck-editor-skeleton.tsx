"use client";

import { LoadingOverlay } from "@/components/loading-overlay";
import { LOADING_STAGES } from "@/lib/loading-stages";

// デッキ詳細を読み込み中・別デッキ切替直後に表示する placeholder。
// DeckEditorPane と同じレイアウト構造 (header + body grid) を再現することで、
// 読み込み完了時に高さがジャンプしない。animate-pulse + 共通 LoadingOverlay
// (中央にスピナー) を重ねて、進行中であることをハッキリ示す。

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

      {/* 本体: 左 (現在のデッキ) / 右 (所持カード)
          editor 本体と同じ grid-cols-2 divide-x にし、overflow-hidden で縦の
          はみ出しを抑止 (skeleton placeholder の合計高さでページがスクロール
          してしまう症状の対策)。 */}
      <div className="flex-1 min-h-0 grid grid-cols-2 divide-x overflow-hidden">
        <SkeletonSection labelW="w-32" />
        <SkeletonSection labelW="w-28" />
      </div>

      <LoadingOverlay
        show
        card
        stages={LOADING_STAGES.deckLoading}
        progress={{ kind: "indeterminate" }}
      />
    </div>
  );
}

function SkeletonSection({ labelW }: { labelW: string }) {
  return (
    <section className="flex flex-col min-h-0 overflow-hidden">
      <header className="p-2 border-b shrink-0">
        <div className={`h-3 ${labelW} bg-muted rounded animate-pulse`} />
      </header>
      <div className="flex-1 min-h-0 overflow-hidden p-2">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-1.5 lg:gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              // モバイル: コンパクトタイル相当の h-8、デスクトップ:
              // 縦長カード相当の aspect-[3/4]。
              className="h-8 lg:h-auto lg:aspect-[3/4] bg-muted rounded-md animate-pulse"
            />
          ))}
        </div>
      </div>
    </section>
  );
}
