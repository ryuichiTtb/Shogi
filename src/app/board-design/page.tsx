// Issue #177: 将棋盤デザイン (盤面マス背景) 設定ページ。
// /card-design (カード裏面設定) と同じ構造で、各案のサムネイルを並べ
// クリックで BoardLayoutProvider の選択を切り替える。
// 設定は localStorage に保存され、対局画面の ShogiBoard に即時反映される。
"use client";

import { ArrowLeft, Check } from "lucide-react";

import {
  useAllBoardLayoutsReady,
  useBoardLayoutControls,
} from "@/components/board-layout/board-layout-provider";
import { BOARD_LAYOUTS } from "@/components/board-layout/options";
import { MaskedLink } from "@/components/navigation/masked-link";
import { AppBackground } from "@/components/layout/app-background";
import { AuthControls } from "@/components/auth/auth-controls";
import { LoadingOverlay } from "@/components/loading-overlay";
import { cn } from "@/lib/utils";

// 9x9 (n=9) のサムネイル盤面。実際の ShogiBoard と同じく、テクスチャ画像を盤全体で
// 連続表示するため、各マスは「盤全体サイズ」の画像から自分の位置の切片を表示する。
const BOARD_THUMB_CELLS = 9;
const BOARD_THUMB_GAP = 1;
// 線・星の色 (Issue #177): 濃い焦げ茶色で light/dark 共通。
const BOARD_LINE_COLOR = "#3a1f0a";

interface BoardThumbnailProps {
  url: string;
  size: number; // px
}

function BoardThumbnail({ url, size }: BoardThumbnailProps) {
  const cellSize = (size - BOARD_THUMB_GAP * (BOARD_THUMB_CELLS - 1)) / BOARD_THUMB_CELLS;
  const totalSize = cellSize * BOARD_THUMB_CELLS + BOARD_THUMB_GAP * (BOARD_THUMB_CELLS - 1);
  const cells = Array.from({ length: BOARD_THUMB_CELLS * BOARD_THUMB_CELLS }, (_, i) => {
    const row = Math.floor(i / BOARD_THUMB_CELLS);
    const col = i % BOARD_THUMB_CELLS;
    return { row, col };
  });
  return (
    <div
      className="grid relative rounded-sm border-2"
      style={{
        gridTemplateColumns: `repeat(${BOARD_THUMB_CELLS}, ${cellSize}px)`,
        gridTemplateRows: `repeat(${BOARD_THUMB_CELLS}, ${cellSize}px)`,
        gap: BOARD_THUMB_GAP,
        backgroundColor: BOARD_LINE_COLOR,
        borderColor: BOARD_LINE_COLOR,
        width: totalSize,
        height: totalSize,
      }}
      aria-hidden
    >
      {cells.map(({ row, col }) => (
        <div
          key={`${row}-${col}`}
          style={{
            backgroundImage: `url(${url})`,
            backgroundSize: `${totalSize}px ${totalSize}px`,
            backgroundPosition: `-${col * (cellSize + BOARD_THUMB_GAP)}px -${row * (cellSize + BOARD_THUMB_GAP)}px`,
          }}
        />
      ))}
      {/* 中央 4 隅の星点 (visualRow/visualCol = 2, 5 の交差) */}
      {[2, 5].flatMap((r) =>
        [2, 5].map((c) => (
          <div
            key={`star-${r}-${c}`}
            className="absolute rounded-full pointer-events-none"
            style={{
              width: Math.max(2, cellSize * 0.12),
              height: Math.max(2, cellSize * 0.12),
              backgroundColor: BOARD_LINE_COLOR,
              left: (c + 1) * cellSize + c * BOARD_THUMB_GAP - 1,
              top: (r + 1) * cellSize + r * BOARD_THUMB_GAP - 1,
              transform: "translate(-50%, -50%)",
            }}
          />
        )),
      )}
    </div>
  );
}

export default function BoardDesignPage() {
  const { layout: currentLayout, setLayoutId } = useBoardLayoutControls();
  // Issue #177: 木目テクスチャ画像 4 種すべてのロードが完了するまで一覧を非表示。
  // BoardLayoutProvider 側で mount 時に一括先読みしているため、初回 visit でも
  // ほぼ即時に true になる想定 (cold cache の遅延ぶんだけマスクが残る)。
  const allReady = useAllBoardLayoutsReady();

  return (
    <main className="min-h-dvh pb-16">
      <AppBackground variant="page" />
      <header className="sticky top-0 z-40 bg-background/90 backdrop-blur-sm border-b border-border/50">
        <div className="max-w-3xl mx-auto px-4 py-3 sm:py-4 w-full flex items-center gap-3">
          <MaskedLink
            href="/"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            aria-label="ホームへ戻る"
            loadingVariant="spinner"
          >
            <ArrowLeft className="w-4 h-4" />
            ホーム
          </MaskedLink>
          <div className="flex-1" />
          <AuthControls variant="indicator" />
        </div>
        <div className="max-w-3xl mx-auto px-4 pb-3 sm:pb-4">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">将棋盤デザイン</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            対局画面で使用する盤面の見た目を選択します。設定はブラウザに保存されます。
          </p>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-6 w-full relative min-h-[260px]">
        {!allReady && <LoadingOverlay show card />}
        <div
          className={cn(
            "grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 transition-opacity",
            allReady ? "opacity-100" : "opacity-0",
          )}
        >
          {BOARD_LAYOUTS.map((layout) => {
            const selected = currentLayout.id === layout.id;
            return (
              <button
                key={layout.id}
                type="button"
                onClick={() => setLayoutId(layout.id)}
                className={cn(
                  "relative rounded-xl border-2 p-3 bg-card/85 backdrop-blur-sm",
                  "flex flex-col items-center gap-2 cursor-pointer card-hover-lift transition-colors",
                  selected
                    ? "border-primary ring-2 ring-primary/40"
                    : "border-border hover:border-primary/40",
                )}
                aria-label={`${layout.name}を選択`}
                aria-pressed={selected}
              >
                <BoardThumbnail url={layout.url} size={140} />
                <span className="text-xs sm:text-sm font-medium">{layout.name}</span>
                {selected && (
                  <div className="absolute top-1.5 right-1.5 bg-primary text-primary-foreground rounded-full p-1 shadow">
                    <Check className="w-3 h-3" />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </main>
  );
}
