// Issue #155: ローディングカード表面・全パターンの確認用プレビュー。
//   - 8 駒の表面 (静止) を grid で一覧
//   - 回転アニメ込みの LoadingCardVisual サンプル
//   - LoadingOverlay フルセット (回転カード + 進捗バー + ステージ文言) を
//     ボックス内 (absolute) で確認できるトグル
//   - 裏面 3 種 (seigaiha / emblem / minimal) も並べ、表裏の世界観を比較
//
// /dev/* 配下と同じく開発・確認用の永続ページ。本番リンクからは導線なし。
"use client";

import { useState } from "react";
import { ArrowLeft } from "lucide-react";

import { LoadingOverlay } from "@/components/loading-overlay";
import { MaskedLink } from "@/components/navigation/masked-link";
import {
  LoadingCardVisual,
  LOADING_FACE_PIECE_TYPES,
  LOADING_FACE_PIECE_LABEL,
} from "@/components/loading/loading-card-visual";
import { LOADING_STAGES } from "@/lib/loading-stages";
import { CardBackEmblem } from "@/components/card-back/back-emblem";
import { CardBackSeigaiha } from "@/components/card-back/back-seigaiha";
import { CardBackMinimal } from "@/components/card-back/back-minimal";
import { Button } from "@/components/ui/button";
import { AppBackground } from "@/components/layout/app-background";
import { useBgm } from "@/hooks/use-bgm";

export default function LoadingPreviewPage() {
  // Issue #79: dev page では BGM 停止 (singleton 漏れ防止)
  useBgm(null);
  const [overlayOpen, setOverlayOpen] = useState(false);

  return (
    <main className="min-h-dvh px-4 py-6 max-w-5xl mx-auto safe-area-inset">
      <AppBackground variant="page" />

      <header className="flex items-center gap-3 mb-6">
        <MaskedLink
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          loadingVariant="spinner"
        >
          <ArrowLeft className="w-4 h-4" />
          ホーム
        </MaskedLink>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
          ローディングカード プレビュー
        </h1>
      </header>

      {/* (1) 表面 14 駒の一覧 (Issue #200: 通常 8 駒 + 成り駒 6 種) */}
      <section className="mb-10">
        <h2 className="text-base font-bold mb-3">
          表面 14 駒 (静止 / ふわふわアニメは個別)
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          通常 8 駒 (歩兵 / 香車 / 桂馬 / 銀将 / 金将 / 飛車 / 角行 / 王将) と
          成り駒 6 種 (と金 / 成香 / 成桂 / 成銀 / 竜馬 / 龍王) の計 14 枚。成り駒
          は ShogiPiece の `promoted_*` 判定で自動的に赤字 (text-red-700) になります。
          各カードは個別にマウントされるので、上下のふわふわ + 回転アニメは
          位相がバラけて表示されます。実際のローディング中は 1 枚だけがランダムに
          選ばれて表示されます。
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {LOADING_FACE_PIECE_TYPES.map((type) => (
            <div key={type} className="flex flex-col items-center gap-2">
              <LoadingCardVisual forcePieceType={type} />
              <div className="text-xs text-muted-foreground text-center">
                <div className="font-bold text-sm text-foreground">
                  {LOADING_FACE_PIECE_LABEL[type]}
                </div>
                <div className="font-mono">{type}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* (2) LoadingOverlay フルセット (回転カード + 進捗バー + ステージ文言) */}
      <section className="mb-10">
        <h2 className="text-base font-bold mb-3">
          LoadingOverlay フルセット
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          実際の本番表示と同じ構成 (回転カード + indeterminate プログレスバー +
          ステージ文言フェード)。stages はデッキ保存中のものを使用。トグルで
          表示・非表示を切替できます。
        </p>
        <div className="flex items-center gap-3 mb-4">
          <Button
            size="sm"
            onClick={() => setOverlayOpen((v) => !v)}
            variant={overlayOpen ? "default" : "outline"}
          >
            {overlayOpen ? "Overlay を非表示にする" : "Overlay を表示する"}
          </Button>
          <span className="text-xs text-muted-foreground">
            stages: {LOADING_STAGES.deckSaving.join(" / ")}
          </span>
        </div>
        <div className="relative w-full h-80 rounded-lg border border-border bg-card overflow-hidden">
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            (背面コンテンツ。Overlay 表示中はこれが半透明マスクで覆われる)
          </div>
          <LoadingOverlay
            show={overlayOpen}
            card
            stages={LOADING_STAGES.deckSaving}
            progress
          />
        </div>
      </section>

      {/* (3) 裏面 3 種 (比較用) */}
      <section className="mb-10">
        <h2 className="text-base font-bold mb-3">
          裏面 3 種 (比較用)
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          ユーザ設定で選択中の裏面が実機表示で使われます。表面のデザインは
          「金フレーム + 中央スポット + 中央駒シルエット」で 3 種いずれの裏面と
          趣の整合が取れるよう調整。
        </p>
        <div className="grid grid-cols-3 gap-4">
          <div className="flex flex-col items-center gap-2">
            <CardBackSeigaiha size="lg" />
            <div className="text-xs">
              <span className="font-bold">波 (seigaiha)</span>
              <span className="text-muted-foreground"> — default</span>
            </div>
          </div>
          <div className="flex flex-col items-center gap-2">
            <CardBackEmblem size="lg" />
            <div className="text-xs font-bold">煌 (emblem)</div>
          </div>
          <div className="flex flex-col items-center gap-2">
            <CardBackMinimal size="lg" />
            <div className="text-xs font-bold">漆 (minimal)</div>
          </div>
        </div>
      </section>
    </main>
  );
}
