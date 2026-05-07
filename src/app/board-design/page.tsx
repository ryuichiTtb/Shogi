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

// 選択肢 1 行: 木目サムネ + 名前 + チェックマーク。
function OptionRow({ layout, selected, onSelect }: OptionRowProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full flex items-center gap-3 p-2.5 rounded-lg border-2 bg-card/85 backdrop-blur-sm",
        "cursor-pointer card-hover-lift transition-colors text-left",
        selected
          ? "border-primary ring-2 ring-primary/40"
          : "border-border hover:border-primary/40",
      )}
      aria-pressed={selected}
    >
      <div
        className="w-12 h-12 shrink-0 rounded border-2 bg-cover bg-center"
        style={{
          backgroundImage: `url(${layout.url})`,
          borderColor: layout.lineColor,
        }}
        aria-hidden
      />
      <span className="flex-1 text-sm font-medium">{layout.name}</span>
      {selected && <Check className="w-4 h-4 text-primary shrink-0" />}
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
    <main className="min-h-dvh pb-16">
      <AppBackground variant="page" />
      <header className="sticky top-0 z-40 bg-background/90 backdrop-blur-sm border-b border-border/50">
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

      <div className="max-w-5xl mx-auto px-4 py-6 w-full relative min-h-[400px]">
        {!allReady && <LoadingOverlay show card />}
        <div
          className={cn(
            "grid gap-6 transition-opacity",
            // モバイル: 縦並び (上にプレビュー、下に選択肢)
            // sm 以上: 左にプレビュー (auto)、右に選択肢 (1fr)
            "grid-cols-1 sm:grid-cols-[auto_1fr]",
            allReady ? "opacity-100" : "opacity-0",
          )}
        >
          {/* 左: プレビュー (PC で sticky 化してスクロール時も追従) */}
          <div className="sm:sticky sm:top-32 sm:self-start flex justify-center">
            <BoardPreview />
          </div>

          {/* 右: 縦スクロール選択リスト。max-height をスクリーン依存にし、
              選択肢が増えても常時ホーム導線が見えるようにする。 */}
          <div className="space-y-2 sm:max-h-[calc(100dvh-220px)] sm:overflow-y-auto sm:pr-1">
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
    </main>
  );
}
