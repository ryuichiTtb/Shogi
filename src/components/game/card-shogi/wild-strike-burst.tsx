"use client";

// カード将棋 (Issue #196 乱撃): 相手の玉以外の盤上駒 (最大6枚) を、ランダム順に1枚ずつ
// 「斬撃 (白フラッシュ) → 血しぶき → 消滅」させる演出オーバーレイ。
//
// 設計:
// - reducer は既に対象駒を盤上から除去済 (destroyedPieces にメタ情報)。本コンポーネントは
//   元位置に「ゴースト駒」を重ねて斬る (王手崩し #82 の checkBreakAnim と同じ考え方)。
// - 各駒の発火を WILD_STRIKE_STAGGER_MS ずつずらして順次再生する。タイミングは CSS の
//   animation-delay (CSS 変数 --ws-* 経由) で制御し、JS では完了タイマーのみ持つ
//   (piece-flight の保険タイマーと同方針 = framer callback 律速を避ける単一の完了源)。
// - prefers-reduced-motion 時は斬撃等を出さず短時間で消すフォールバック (globals.css 側 +
//   完了尺の短縮)。
//
// 入力ロックは呼び出し側の isPlayingCard (reducer が CONFIRM_PLAY_CARD で true 設定) が
// onComplete → finalizePlayCard (COMMIT_PLAY_CARD) まで効くため、本コンポーネントは
// 専用ロックを持たない。

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { ShogiPiece } from "../shogi-piece";
import type { Player } from "@/lib/shogi/types";
import {
  WILD_STRIKE_INTRO_MS,
  WILD_STRIKE_STAGGER_MS,
  WILD_STRIKE_SLASH_COUNT,
  WILD_STRIKE_SLASH_MS,
  WILD_STRIKE_SLASH_GAP_MS,
  WILD_STRIKE_SLASH_PHASE_MS,
  WILD_STRIKE_VANISH_MS,
  WILD_STRIKE_REDUCED_MS,
  wildStrikeTotalMs,
} from "./animation-constants";

export interface WildStrikeTarget {
  rect: DOMRect;
  pieceType: string;
  owner: Player;
}

interface WildStrikeBurstProps {
  targets: WildStrikeTarget[];
  playerColor: Player;
  onComplete: () => void;
}

// CSS カスタムプロパティをまとめて style に流すためのヘルパ型。
type CSSVars = React.CSSProperties & Record<`--${string}`, string>;

// 1駒に重ねる斬撃線 (3本) の角度バリエーション。viewBox は駒矩形と同寸。
function slashEndpoints(k: number, w: number, h: number) {
  switch (k % 3) {
    case 0:
      return { x1: w, y1: 0, x2: 0, y2: h }; // 右上 → 左下
    case 1:
      return { x1: 0, y1: h * 0.2, x2: w, y2: h * 0.8 }; // 左 → 右 (浅め)
    default:
      return { x1: w * 0.1, y1: h, x2: w * 0.92, y2: h * 0.08 }; // 左下 → 右上 (急)
  }
}

export function WildStrikeBurst({ targets, playerColor, onComplete }: WildStrikeBurstProps) {
  // 完了は単一の JS タイマーで通知する (CSS アニメーション完了の取りこぼし対策)。
  // 親が key で remount するため mount 時に1回スケジュールすれば十分。
  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const total = reduced ? WILD_STRIKE_REDUCED_MS : wildStrikeTotalMs(targets.length);
    const id = window.setTimeout(onComplete, total);
    return () => window.clearTimeout(id);
  }, [targets, onComplete]);

  if (typeof document === "undefined" || targets.length === 0) return null;

  return createPortal(
    // z-[55]: カード使用系オーバーレイ帯。盤面・BoardOverlay より手前で斬撃を見せる。
    <div className="fixed inset-0 pointer-events-none z-[55]">
      {/* 冒頭の一瞬暗転 → 白フラッシュ (全体1回)。全画面を薄く覆う。 */}
      <div
        className="wild-strike-intro absolute inset-0"
        style={{ "--ws-intro-ms": `${WILD_STRIKE_INTRO_MS}ms` } as CSSVars}
        aria-hidden
      />
      {targets.map((t, i) => {
        const { rect } = t;
        const baseDelay = WILD_STRIKE_INTRO_MS + i * WILD_STRIKE_STAGGER_MS;
        const vanishDelay = baseDelay + WILD_STRIKE_SLASH_PHASE_MS;
        const strokeW = Math.max(3, Math.min(6, rect.width * 0.12));
        return (
          <div
            key={`ws-${i}-${rect.left}-${rect.top}`}
            className="wild-strike-vanish"
            style={
              {
                position: "fixed",
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
                transformOrigin: "center center",
                "--ws-vanish-ms": `${WILD_STRIKE_VANISH_MS}ms`,
                "--ws-vanish-delay": `${vanishDelay}ms`,
              } as CSSVars
            }
          >
            {/* 斬撃の瞬間、駒を一瞬暗転 → 白フラッシュ。 */}
            <div
              className="wild-strike-hit"
              style={
                {
                  width: "100%",
                  height: "100%",
                  "--ws-delay": `${baseDelay}ms`,
                  "--ws-hit-ms": `${WILD_STRIKE_SLASH_PHASE_MS}ms`,
                } as CSSVars
              }
            >
              <ShogiPiece
                piece={{ type: t.pieceType, owner: t.owner }}
                playerColor={playerColor}
                squareSize={rect.width}
              />
            </div>

            {/* 血しぶき (赤の放射状スプラッタ)。消滅と同タイミングで開始。 */}
            <div
              className="wild-strike-blood absolute inset-0"
              style={
                {
                  borderRadius: "50%",
                  background:
                    "radial-gradient(circle at 50% 50%, rgba(170,0,0,0.85) 0%, rgba(130,0,0,0.35) 38%, transparent 62%)," +
                    "radial-gradient(circle at 30% 35%, rgba(190,0,0,0.7) 0%, transparent 22%)," +
                    "radial-gradient(circle at 70% 60%, rgba(150,0,0,0.7) 0%, transparent 20%)," +
                    "radial-gradient(circle at 62% 30%, rgba(190,0,0,0.6) 0%, transparent 16%)",
                  "--ws-vanish-ms": `${WILD_STRIKE_VANISH_MS}ms`,
                  "--ws-vanish-delay": `${vanishDelay}ms`,
                } as CSSVars
              }
              aria-hidden
            />

            {/* 白い斬撃 (3本)。本ごとに発火を少しずつずらす。 */}
            <svg
              viewBox={`0 0 ${rect.width} ${rect.height}`}
              preserveAspectRatio="none"
              className="absolute inset-0 w-full h-full pointer-events-none"
              aria-hidden
            >
              {Array.from({ length: WILD_STRIKE_SLASH_COUNT }).map((_, k) => {
                const e = slashEndpoints(k, rect.width, rect.height);
                return (
                  <line
                    key={k}
                    x1={e.x1}
                    y1={e.y1}
                    x2={e.x2}
                    y2={e.y2}
                    stroke="#ffffff"
                    strokeWidth={strokeW}
                    strokeLinecap="round"
                    className="wild-strike-slash-line"
                    style={
                      {
                        "--ws-delay": `${baseDelay + k * WILD_STRIKE_SLASH_GAP_MS}ms`,
                        "--ws-slash-ms": `${WILD_STRIKE_SLASH_MS}ms`,
                      } as CSSVars
                    }
                  />
                );
              })}
            </svg>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
