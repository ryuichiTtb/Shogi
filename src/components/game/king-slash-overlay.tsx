"use client";

// Issue #225: 詰み時、負けた側の玉へ「赤い斜線で斬られた」斬撃演出を重ねる共通
// コンポーネント。王手崩し (#82) のゴースト被弾演出と同系統の見た目を玉マス上に重ねる。
//
// 演出仕様 (検証フィードバック反映):
// - 玉駒のコピーに被弾フラッシュ (checkmate-king-hit) を一度だけ走らせ、インパクト後は
//   通常状態へ戻す (王手崩しのような持続グローは残さない)。
// - 赤い斬撃 (ghost-slash-line-persist) は描画後フェードさせず opacity 1 のまま **永続表示**
//   する (詰みの「斬られた跡」をずっと残す)。親は本オーバーレイをクリアせず、対局が
//   再開・離脱するまで保持する。
// - 永続表示のため、kingPos と getSquareRect から rect を算出し resize に追従する
//   (モバイル回転等で盤レイアウトが変わっても玉マスへ追従)。
//
// 標準将棋 (shogi-game.tsx) ・カード将棋 (card-shogi-game.tsx) の両方で共用する。

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ShogiPiece } from "./shogi-piece";
import type { Player, Position } from "@/lib/shogi/types";

interface KingSlashOverlayProps {
  // 詰んだ玉のマス。null で非表示。
  kingPos: Position | null;
  // 負けた側 (斬られる玉の所有者)。
  kingOwner: Player | null;
  // 盤の向き (視点)。相手側の玉は ShogiPiece が回転表示する。
  playerColor: Player;
  // 玉マスの DOMRect を返す盤の getter (安定参照=useCallback 推奨)。
  getSquareRect: (row: number, col: number) => DOMRect | null;
  // 再発火用キー。もう1局等で同一参照を避け被弾フラッシュ + 斬撃描画を再走させる。
  animationKey: number;
}

export function KingSlashOverlay({
  kingPos,
  kingOwner,
  playerColor,
  getSquareRect,
  animationKey,
}: KingSlashOverlayProps) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  // kingPos から rect を算出し resize に追従 (永続表示のためレイアウト変化へ対応)。
  // 盤描画後に取得するため次フレームで計算する。全ての setRect を rAF / resize
  // コールバック経由にし、effect 本体での同期 setState (cascading renders) を避ける。
  // kingPos が null のときは rect=null で非表示。
  useEffect(() => {
    const compute = () =>
      setRect(kingPos ? getSquareRect(kingPos.row, kingPos.col) : null);
    const raf = requestAnimationFrame(compute);
    window.addEventListener("resize", compute);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", compute);
    };
  }, [kingPos, getSquareRect]);

  if (!rect || !kingOwner || typeof document === "undefined") return null;

  return createPortal(
    // z-[8]: ShogiBoard 本体 (z-auto/0) ・王手崩しゴースト (z-[5]) より上、
    // 中央オーバーレイ (z-10、「詰み」表示) より下。玉マス上の局所演出。
    <div className="fixed inset-0 pointer-events-none z-[8]">
      <div
        // animationKey 変化時のみ remount し被弾フラッシュ + 斬撃描画を再走。
        // resize 時 (rect のみ変化) は同 key のため再描画のみで再アニメしない (跡を維持)。
        key={animationKey}
        className="checkmate-king-hit"
        style={{
          position: "fixed",
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          transformOrigin: "center center",
        }}
      >
        <ShogiPiece
          piece={{ type: "king", owner: kingOwner }}
          playerColor={playerColor}
          squareSize={rect.width}
        />
        {/* 赤い斬撃 (右上→左下)。描画後フェードせず opacity 1 のまま永続表示。 */}
        <svg
          viewBox={`0 0 ${rect.width} ${rect.height}`}
          preserveAspectRatio="none"
          className="absolute inset-0 w-full h-full pointer-events-none"
          aria-hidden
        >
          <line
            x1={rect.width}
            y1="0"
            x2="0"
            y2={rect.height}
            stroke="#ef4444"
            strokeWidth={Math.max(3, Math.min(5, rect.width * 0.12))}
            strokeLinecap="round"
            className="ghost-slash-line-persist"
          />
        </svg>
      </div>
    </div>,
    document.body,
  );
}
