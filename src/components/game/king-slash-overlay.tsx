"use client";

// Issue #225: 詰み時、負けた側の玉へ「赤い斜線で斬られた」斬撃演出を重ねる共通
// コンポーネント。王手崩し (#82) のゴースト被弾演出 (animate-ghost-trap-hit +
// ghost-slash-line) と同じ見た目を、玉のマス上に重ねて再現する。
//
// 詰み時は玉が盤上に残っているため、本オーバーレイは玉駒のコピーを玉マスに重ね描き
// し、被弾フラッシュ + 赤い斬撃を走らせる (実盤の玉は ShogiBoard 内にあり外部から
// アニメ付与できないため、上に同じ玉を重ねて演出する)。演出尺経過後は親が rect=null
// にしてアンマウントし、下の実盤の玉が見える状態へ戻る。
//
// 標準将棋 (shogi-game.tsx) ・カード将棋 (card-shogi-game.tsx) の両方で共用する。

import { createPortal } from "react-dom";
import { ShogiPiece } from "./shogi-piece";
import type { Player } from "@/lib/shogi/types";

interface KingSlashOverlayProps {
  // 詰んだ玉のマスの DOMRect。null で非表示 (アンマウント)。
  rect: DOMRect | null;
  // 負けた側 (斬られる玉の所有者)。
  kingOwner: Player | null;
  // 盤の向き (視点)。相手側の玉は ShogiPiece が回転表示する。
  playerColor: Player;
  // 再発火用キー。もう1局等で同一参照を避け CSS アニメを再走させる。
  animationKey: number;
}

export function KingSlashOverlay({
  rect,
  kingOwner,
  playerColor,
  animationKey,
}: KingSlashOverlayProps) {
  if (!rect || !kingOwner || typeof document === "undefined") return null;

  return createPortal(
    // z-[8]: ShogiBoard 本体 (z-auto/0) ・王手崩しゴースト (z-[5]) より上、
    // 中央オーバーレイ (z-10、「詰み」表示) より下。玉マス上の局所演出。
    <div className="fixed inset-0 pointer-events-none z-[8]">
      <div
        key={animationKey}
        className="animate-ghost-trap-hit"
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
        {/* 赤い斬撃 (右上→左下)。王手崩しと同じ ghost-slash アニメーション。 */}
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
            className="ghost-slash-line"
          />
        </svg>
      </div>
    </div>,
    document.body,
  );
}
