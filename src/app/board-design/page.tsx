// Issue #177: 将棋盤デザイン (盤面マス背景) 設定ページ。
// 2 カラム構成: 左に実際のゲーム画面と同じ ShogiBoard を初期盤面で描画して
// プレビュー、右に選択肢リスト (縦スクロール)。右で選択するとすぐに左に反映。
// 設定は localStorage に保存され、対局画面の ShogiBoard にも即時反映される。
"use client";

import { useCallback, useMemo } from "react";
import { ArrowLeft, Check } from "lucide-react";

import {
  useAllBoardLayoutsReady,
  useBoardLayoutControls,
} from "@/components/board-layout/board-layout-provider";
import { BOARD_LAYOUTS, type BoardLayout } from "@/components/board-layout/options";
import { ShogiBoard } from "@/components/game/shogi-board";
import { MaskedLink } from "@/components/navigation/masked-link";
import { AppBackground } from "@/components/layout/app-background";
import { AuthControls } from "@/components/auth/auth-controls";
import { LoadingOverlay } from "@/components/loading-overlay";
import { STANDARD_VARIANT } from "@/lib/shogi/variants/standard";
import type { Move, Position } from "@/lib/shogi/types";
import { cn } from "@/lib/utils";

// プレビュー用 ShogiBoard の固定 props (mount 後不変)。配列は空参照を共有して
// memo の不要な invalidate を避ける。
const EMPTY_MOVES: readonly Move[] = [];
const PREVIEW_SQUARE_SIZE = 36;

// 1 度だけ生成すれば十分な初期盤面を mount 時に固定して再利用する。
function useInitialBoard() {
  return useMemo(() => STANDARD_VARIANT.initialSetup({ rows: 9, cols: 9 }), []);
}

function BoardPreview() {
  const board = useInitialBoard();
  const noOp = useCallback((_pos: Position) => {}, []);
  return (
    <ShogiBoard
      board={board}
      currentPlayer="sente"
      playerColor="sente"
      selectedSquare={null}
      legalMoves={EMPTY_MOVES as Move[]}
      lastMove={null}
      isAiThinking={false}
      inCheck={false}
      onSquareClick={noOp}
      squareSize={PREVIEW_SQUARE_SIZE}
      isMobile={false}
    />
  );
}

interface OptionRowProps {
  layout: BoardLayout;
  selected: boolean;
  onSelect: () => void;
}

// 選択肢 1 マス。モバイルは縦並び (サムネ上 / 名前下) のカード、PC は横並び。
// チェックマークは方向に依存しないよう絶対配置で右上に置く。
function OptionRow({ layout, selected, onSelect }: OptionRowProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "relative flex flex-col sm:flex-row items-center gap-2 sm:gap-3",
        "p-2 sm:p-2.5 rounded-lg border-2 bg-card/85 backdrop-blur-sm",
        "cursor-pointer card-hover-lift transition-colors text-center sm:text-left",
        selected
          ? "border-primary ring-2 ring-primary/40"
          : "border-border hover:border-primary/40",
      )}
      aria-pressed={selected}
    >
      <div
        className="w-10 h-10 sm:w-12 sm:h-12 shrink-0 rounded border-2 bg-cover bg-center"
        style={{
          backgroundImage: `url(${layout.url})`,
          borderColor: layout.lineColor,
        }}
        aria-hidden
      />
      <span className="flex-1 text-xs sm:text-sm font-medium">{layout.name}</span>
      {selected && (
        <Check className="absolute top-1.5 right-1.5 w-4 h-4 text-primary" />
      )}
    </button>
  );
}

export default function BoardDesignPage() {
  const { layout: currentLayout, setLayoutId } = useBoardLayoutControls();
  // Issue #177: 木目テクスチャ画像 4 種すべてのロードが完了するまで一覧を非表示。
  // BoardLayoutProvider 側で mount 時に一括先読みしているため、初回 visit でも
  // ほぼ即時に true になる想定 (cold cache の遅延ぶんだけマスクが残る)。
  const allReady = useAllBoardLayoutsReady();

  return (
    <main
      className={cn(
        "flex flex-col",
        // モバイル: 画面ぴったりの高さ + body スクロール禁止。
        // 「ヘッダ + プレビュー」は固定エリア、選択肢のみ内部スクロール。
        "h-dvh overflow-hidden",
        // PC: 通常のページスクロール (右カラムで独自スクロール)
        "sm:h-auto sm:min-h-dvh sm:overflow-visible sm:pb-16",
      )}
    >
      <AppBackground variant="page" />
      <header className="sticky top-0 z-40 bg-background/90 backdrop-blur-sm border-b border-border/50 shrink-0">
        <div className="max-w-5xl mx-auto px-4 py-3 sm:py-4 w-full flex items-center gap-3">
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
        <div className="max-w-5xl mx-auto px-4 pb-3 sm:pb-4">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">将棋盤デザイン</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            対局画面で使用する盤面の見た目を選択します。設定はブラウザに保存されます。
          </p>
        </div>
      </header>

      <div
        className={cn(
          "max-w-5xl mx-auto px-4 w-full relative",
          // モバイル: ヘッダ下の残り高さを埋め、内部レイアウトを flex で組む
          "flex-1 flex flex-col min-h-0 py-3",
          // PC: 通常 block + 元のスタイル
          "sm:flex-none sm:block sm:py-6 sm:min-h-[400px]",
        )}
      >
        {!allReady && <LoadingOverlay show card />}
        <div
          className={cn(
            "transition-opacity",
            // モバイル: flex-1 で残り高さを取り、内部に [プレビュー / オプション] を縦並び
            "flex-1 flex flex-col gap-3 min-h-0",
            // PC: 2 カラムグリッド (左プレビュー / 右リスト)
            "sm:flex-none sm:grid sm:grid-cols-[auto_1fr] sm:gap-6",
            allReady ? "opacity-100" : "opacity-0",
          )}
        >
          {/* プレビュー
              - モバイル: shrink-0 で固定領域。body スクロール禁止のため sticky 不要。
                半透明 bg + blur + -mx-4 px-4 で画面端まで bg を広げ「ヘッダ」感を出す。
              - PC: 左カラムで sticky 追従 (従来挙動)。 */}
          <div
            className={cn(
              "shrink-0 flex justify-center",
              "py-2 -mx-4 px-4 bg-background/95 backdrop-blur-sm",
              "sm:bg-transparent sm:backdrop-blur-none sm:py-0 sm:mx-0 sm:px-0",
              "sm:sticky sm:top-32 sm:self-start",
            )}
          >
            <BoardPreview />
          </div>

          {/* オプション
              - モバイル: flex-1 + min-h-0 + overflow-y-auto で内部スクロール。
                プレビューと page header は動かず、ここだけが縦スクロールする。
              - PC: 元の max-h スクロール。 */}
          <div
            className={cn(
              "flex-1 min-h-0 overflow-y-auto -mx-4 px-4",
              "sm:flex-none sm:max-h-[calc(100dvh-220px)] sm:mx-0 sm:pr-1",
            )}
          >
            <div className="grid grid-cols-2 sm:grid-cols-1 gap-2">
              {BOARD_LAYOUTS.map((layout) => (
                <OptionRow
                  key={layout.id}
                  layout={layout}
                  selected={currentLayout.id === layout.id}
                  onSelect={() => setLayoutId(layout.id)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
