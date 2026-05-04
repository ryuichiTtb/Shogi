"use client";

import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

import { cn } from "@/lib/utils";
import { AUTO_DRAW_INTERVAL, DRAW_COST } from "@/lib/shogi/cards/definitions";
import { CardBack } from "@/components/card-back/card-back";
import {
  AUTO_DRAW_PRIMED_MAX_LOOPS,
  AUTO_DRAW_PRIMED_PULSE_S,
  AUTO_DRAW_RING_TRANSITION_MS,
} from "./animation-constants";

// SSR 環境で useLayoutEffect の警告を回避するための条件分岐 (browser only)。
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

interface DeckPileProps {
  count: number;
  canDraw?: boolean;
  onDraw?: () => void;
  size?: "sm" | "md" | "lg";
  // ドローコストを画面に表示するか(自分側のみ true、相手側は false)
  showDrawCost?: boolean;
  // true のとき横幅を親に合わせる(縦並び・中央揃えで使用)
  fullWidth?: boolean;
  // 相手手番中など、より暗くした非活性表示にしたい場合に true
  dimmed?: boolean;
  // true のとき横長表示にしてズレカードを描画しない (相手細バー等の縦幅圧縮で使用)
  horizontal?: boolean;
  // Issue #130: 自動ドロー進捗 (drawProgress[player])。0..interval の値域を想定。
  // undefined のときはゲージを描画しない (旧呼び出し互換)。
  progress?: number;
  // Issue #130: 自動ドローしきい値。既定 AUTO_DRAW_INTERVAL=5。
  interval?: number;
  // Issue #130: 進捗ゲージを描画するか。両者表示が既定。
  showProgress?: boolean;
}

const SIZE_CLASS = {
  // sm は CardView の sm (w-12 h-16) と寸法を揃え、相手手札 stack と同じ
  // カードサイズで並べられるようにする (Issue #105 モバイル相手バー)。
  sm: "w-12 h-16 text-[10px]",
  md: "w-16 h-20 text-[13px]",
  lg: "w-20 h-24 text-sm",
};

// R19: 山札の積み重ね表現。後ろに最大 STACK_MAX 枚のズレカードを描画。
// count が 1 のとき: 上面のみ、ズレカード 0 枚
// count が 2 のとき: ズレカード 1 枚
// ...
// count >= STACK_MAX + 1 のとき: ズレカード STACK_MAX 枚
const STACK_MAX = 4;
// X (横) は極小: 隣接する TRAP との被りを避けるため最小限のはみ出しに抑える。
// Y (縦) は少し控えめに: 視認できる程度に積み重なりを表現。
const STACK_OFFSET_X = {
  sm: 0.5,
  md: 0.8,
  lg: 1,
};
const STACK_OFFSET_Y = {
  sm: 1,
  md: 1.5,
  lg: 2,
};

interface StackCardProps {
  size: "sm" | "md" | "lg";
  dimmed: boolean;
}

// 後ろのズレカード(クリック不可、装飾のみ)。ユーザー設定の裏面スタイルを
// 上面と同じく描画し、奥に行くほど暗く見えるよう brightness を落とす。
function StackCard({ size, dimmed }: StackCardProps) {
  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden>
      <CardBack
        size={size}
        fullWidth
        className={cn("brightness-75 opacity-95", dimmed && "brightness-50 opacity-80")}
      />
    </div>
  );
}

export const DeckPile = memo(function DeckPile({
  count,
  canDraw = false,
  onDraw,
  size = "md",
  showDrawCost = false,
  fullWidth = false,
  dimmed = false,
  horizontal = false,
  progress,
  interval = AUTO_DRAW_INTERVAL,
  showProgress = true,
}: DeckPileProps) {
  const isEmpty = count === 0;
  const interactable = canDraw && count > 0 && !!onDraw;
  const reducedMotion = useReducedMotion();
  // Issue #130: 進捗ゲージ用の派生値。山札枯渇時は drawProgress が interval を超え得るため
  // 表示は Math.min でクランプして 0..interval に収める。
  const hasProgress = showProgress && progress !== undefined && interval > 0;
  const clampedProgress = hasProgress ? Math.min(Math.max(progress!, 0), interval) : 0;

  // displayProgress: reducer は同期的に 4→0 へ瞬間遷移するため、UI 側で「リング満タン
  // (interval/interval)」状態を 1 frame だけ強制描画して firing 演出の起点を作る。
  // useLayoutEffect で setDisplayProgress(interval) → rAF で setDisplayProgress(0) の
  // 2 段階セット。それ以外のときは clampedProgress をそのまま使う。
  const [displayProgress, setDisplayProgress] = useState(clampedProgress);
  const prevProgressRef = useRef(clampedProgress);
  useIsoLayoutEffect(() => {
    const prev = prevProgressRef.current;
    const next = clampedProgress;
    prevProgressRef.current = next;
    // 4→0 遷移を検知 (= reducer が auto-draw 発火で進捗をリセット)
    if (prev === interval - 1 && next === 0) {
      setDisplayProgress(interval); // 1 frame だけ満タン描画
      const rafId = window.requestAnimationFrame(() => {
        setDisplayProgress(0);
      });
      return () => window.cancelAnimationFrame(rafId);
    }
    setDisplayProgress(next);
  }, [clampedProgress, interval]);

  const remainingTurns = hasProgress
    ? Math.max(0, interval - Math.min(displayProgress, interval))
    : 0;
  const isPrimed = hasProgress && displayProgress === interval - 1;
  // 山札 button フォーカス時に SR で必ず読まれるよう、aria-label に統合する。
  // (リング自体に role=progressbar を付けてもフォーカスは button が握るため別途必要)
  const autoDrawHint = hasProgress && !isEmpty ? ` (自動ドローまで${remainingTurns}手)` : "";

  // 横長モード: 縦長の SIZE_CLASS は使わず、2 行 (+ 進捗 1 行) 構成で横幅を圧縮
  // 行1: 💎×N (showDrawCost 時) / 行2: 山札 ×N / 行3 (#130): 進捗ドット ●●●●○
  // h-full で親 (items-stretch) の高さに追従可能
  if (horizontal) {
    return (
      <button
        type="button"
        onClick={onDraw}
        disabled={!interactable}
        className={cn(
          "relative rounded-md border-2 transition-all px-1.5 py-0.5 h-full",
          "flex flex-col items-center justify-center gap-0.5 text-white shrink-0 leading-tight",
          fullWidth ? "w-full" : "w-auto",
          isEmpty && "bg-gradient-to-br from-slate-400 to-slate-600 border-slate-500 text-slate-100 cursor-not-allowed opacity-70",
          !isEmpty && !interactable && !dimmed && "bg-gradient-to-br from-amber-700 to-amber-900 border-amber-800 cursor-not-allowed brightness-90",
          !isEmpty && !interactable && dimmed && "bg-gradient-to-br from-amber-800 to-amber-950 border-amber-900 cursor-not-allowed brightness-60 opacity-85",
          interactable && "bg-gradient-to-br from-amber-500 to-amber-700 border-amber-300 cursor-pointer hover:scale-[1.02] animate-deck-draw",
        )}
        aria-label={
          isEmpty
            ? "山札 (空)"
            : interactable
              ? `山札からドロー (残${count}枚)${autoDrawHint}`
              : `山札 (残${count}枚)${autoDrawHint}`
        }
      >
        {showDrawCost && !isEmpty && (
          <span
            className={cn(
              "flex items-center gap-0.5 rounded-full px-1 leading-tight font-bold tabular-nums text-[10px]",
              "bg-cyan-100 text-cyan-900 dark:bg-cyan-900/60 dark:text-cyan-100",
            )}
            title={`ドローコスト: マナ ${DRAW_COST}`}
          >
            <span aria-hidden>💎</span>
            <span>×{DRAW_COST}</span>
          </span>
        )}
        <span className="text-[11px] font-bold leading-tight">山札 ×{count}</span>
        {isEmpty && <span className="text-[10px] opacity-90 leading-tight">空</span>}
        {/* Issue #130: 横長モードはリング描画を省略しドット 5 個 (●●●●○) で進捗を表現 */}
        {hasProgress && !isEmpty && (
          <span
            className="flex items-center gap-[1px] text-[10px] leading-none text-emerald-200/85 tabular-nums"
            aria-hidden
          >
            {Array.from({ length: interval }).map((_, i) => (
              <span key={i} className={i < clampedProgress ? "text-emerald-300" : "text-slate-300/40"}>
                ●
              </span>
            ))}
          </span>
        )}
        {interactable && <span className="text-[10px] text-amber-200 font-bold leading-tight animate-bounce">DRAW!</span>}
      </button>
    );
  }

  const sizeClass = fullWidth
    ? cn(
        "w-full",
        size === "sm" ? "h-16 text-[10px]" : size === "md" ? "h-20 text-[13px]" : "h-24 text-sm",
      )
    : SIZE_CLASS[size];

  // 後ろに重ねる枚数: count - 1 を最大 STACK_MAX で頭打ち
  const stackCount = Math.min(Math.max(count - 1, 0), STACK_MAX);
  const offsetUnitX = STACK_OFFSET_X[size];
  const offsetUnitY = STACK_OFFSET_Y[size];

  return (
    <div
      className={cn("relative shrink-0", fullWidth ? "w-full" : SIZE_CLASS[size].split(" ")[0])}
      // 後ろのズレカード分の余白を確保 (描画領域を超えてはみ出さないように)
      style={{
        paddingRight: stackCount * offsetUnitX,
        paddingBottom: stackCount * offsetUnitY,
      }}
    >
      {/* 後ろのズレカード(N 枚)。i=0 が一番奥、i=stackCount-1 が手前。 */}
      {Array.from({ length: stackCount }).map((_, i) => {
        // 手前ほど offset 小、奥ほど offset 大
        const offsetX = (stackCount - i) * offsetUnitX;
        const offsetY = (stackCount - i) * offsetUnitY;
        return (
          <div
            key={i}
            className="absolute"
            style={{
              top: 0,
              left: 0,
              right: stackCount * offsetUnitX - offsetX,
              bottom: stackCount * offsetUnitY - offsetY,
              transform: `translate(${offsetX}px, ${offsetY}px)`,
              zIndex: i,
            }}
          >
            <StackCard size={size} dimmed={dimmed} />
          </div>
        );
      })}

      {/* 上面カード(クリック可能)。
          - 空: 従来の灰色プレースホルダ (裏面表示しない)
          - それ以外: ユーザー設定の CardBack を背景にして上にテキストを重ねる */}
      <button
        type="button"
        onClick={onDraw}
        disabled={!interactable}
        className={cn(
          "relative z-10 w-full h-full",
          "flex flex-col items-center justify-center text-white px-1 transition-all",
          sizeClass,
          isEmpty &&
            "rounded-md border-2 bg-gradient-to-br from-slate-400 to-slate-600 border-slate-500 text-slate-100 cursor-not-allowed opacity-70",
          !isEmpty && !interactable && "cursor-not-allowed",
          interactable && "cursor-pointer hover:scale-[1.03] animate-deck-draw rounded-md",
        )}
        aria-label={
          isEmpty
            ? "山札 (空)"
            : interactable
              ? `山札からドロー (残${count}枚、コスト${DRAW_COST})${autoDrawHint}`
              : `山札 (残${count}枚)${autoDrawHint}`
        }
      >
        {/* 裏面 (CardBack) を背景として最下層に。空の時は非表示。 */}
        {!isEmpty && (
          <div className="absolute inset-0 pointer-events-none" aria-hidden>
            <CardBack
              size={size}
              fullWidth
              dimmed={!interactable && dimmed}
              className={cn(
                !interactable && !dimmed && "brightness-90",
                interactable && "ring-2 ring-amber-300/80",
              )}
            />
          </div>
        )}

        {/* Issue #130: 自動ドロー進捗リング。
            CardBack の直上、テキストの直下に重ね、SVG の rounded-rect ストロークで
            カードシルエットを縁取る。プラン記載の「circle」は実装上、左上の
            DRAW_COST バッジ (cyan, 11時方向) と重なるため、矩形ストロークで代替。
            5 セグメントは strokeDasharray で「等分の点線→塗り進捗」として描画。
            preserveAspectRatio="none" + vector-effect="non-scaling-stroke" で
            縦横比に依存せず一定の線幅・等分セグメントを維持する。
            primed (= displayProgress === interval - 1) のときは emerald-300 +
            amber-200 二重描画 + 1.4s パルス (最大 6 ループ)。reduced-motion 時は
            パルス停止。displayProgress は 4→0 遷移時に 1 frame だけ強制 5 描画
            (= firing の起点、useLayoutEffect で実装)。 */}
        {hasProgress && !isEmpty && (
          <svg
            className="absolute inset-0 z-10 pointer-events-none"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={interval}
            aria-valuenow={Math.min(displayProgress, interval)}
            aria-label={`自動ドロー進捗 ${Math.min(displayProgress, interval)}/${interval}`}
          >
            {/* track: 5 セグメント等分の薄い縁取り */}
            <rect
              x={2}
              y={2}
              width={96}
              height={96}
              rx={3}
              ry={3}
              fill="none"
              stroke="rgb(51 65 85 / 0.4)"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              pathLength={interval}
              strokeDasharray={`${(interval - 0.5) / interval} ${0.5 / interval}`}
            />
            {/* primed 時の amber 二重ストローク (内側 1px) */}
            {isPrimed && (
              <rect
                x={2}
                y={2}
                width={96}
                height={96}
                rx={3}
                ry={3}
                fill="none"
                stroke="rgb(254 240 138 / 0.7)" /* amber-200 */
                strokeWidth={1}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                pathLength={interval}
                strokeDasharray={interval}
                strokeDashoffset={interval - Math.min(displayProgress, interval)}
                style={{ transform: "translate(0.5px, 0.5px)" }}
              />
            )}
            {/* progress: 通常 emerald-400/85, primed は emerald-300 (主層) */}
            <motion.rect
              x={2}
              y={2}
              width={96}
              height={96}
              rx={3}
              ry={3}
              fill="none"
              stroke={isPrimed ? "rgb(110 231 183 / 0.95)" : "rgb(52 211 153 / 0.85)"}
              strokeWidth={isPrimed ? 2.6 : 2}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              pathLength={interval}
              strokeDasharray={interval}
              strokeDashoffset={interval - Math.min(displayProgress, interval)}
              animate={
                reducedMotion || !isPrimed
                  ? undefined
                  : { opacity: [0.85, 1, 0.85], scale: [1, 1.015, 1] }
              }
              transition={
                reducedMotion || !isPrimed
                  ? undefined
                  : {
                      duration: AUTO_DRAW_PRIMED_PULSE_S,
                      repeat: AUTO_DRAW_PRIMED_MAX_LOOPS,
                      ease: "easeInOut",
                    }
              }
              style={{
                transformOrigin: "center center",
                transition: `stroke-dashoffset ${AUTO_DRAW_RING_TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`,
                filter: isPrimed ? "drop-shadow(0 0 6px rgb(52 211 153 / 0.55))" : undefined,
              }}
            />
          </svg>
        )}

        {/* ドローコストを左上に「💎 × N」形式で表示 (空の時は不要なので非表示) */}
        {showDrawCost && !isEmpty && (
          <span
            className={cn(
              "absolute top-0.5 left-0.5 z-10 flex items-center gap-0.5 rounded-full px-1.5 leading-tight font-bold tabular-nums",
              "bg-cyan-100 text-cyan-900 dark:bg-cyan-900/60 dark:text-cyan-100",
              size === "sm" ? "text-[8px]" : "text-[10px]",
            )}
            title={`ドローコスト: マナ ${DRAW_COST}`}
          >
            <span aria-hidden>💎</span>
            <span>× {DRAW_COST}</span>
          </span>
        )}

        <div
          className={cn(
            "relative z-10 opacity-90 leading-none font-medium drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]",
            size === "sm" ? "mt-1 text-[10px]" : "mt-2",
          )}
        >
          山札
        </div>
        <div
          className={cn(
            "relative z-10 font-bold tabular-nums leading-none mt-1 drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]",
            size === "sm" ? "text-[11px]" : "text-base",
          )}
        >
          × {count}
        </div>
        {isEmpty && (
          <div className="mt-1 leading-none text-slate-200 text-[10px] font-bold">空</div>
        )}
        {interactable && (
          <div
            className={cn(
              "relative z-10 leading-none text-amber-200 font-bold animate-bounce drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)]",
              size === "sm" ? "mt-0.5 text-[8px]" : "mt-1 text-[10px]",
            )}
          >
            DRAW!
          </div>
        )}
      </button>

      {/* Issue #130: 自動ドロー進捗マイクロテキスト「次のドローまで N」。
          山札 button の真下、stack 余白の中に配置。空時・進捗未指定時・
          horizontal モードでは表示しない (horizontal は別途ドット表現)。
          コントラスト比確保のため emerald-200 + drop-shadow を併用。 */}
      {hasProgress && !isEmpty && (
        <div
          className={cn(
            "absolute left-0 right-0 text-center pointer-events-none select-none",
            "text-emerald-200/90 leading-none font-medium tabular-nums",
            "drop-shadow-[0_1px_1px_rgba(0,0,0,0.7)]",
            size === "sm" ? "text-[8px] -bottom-3" : "text-[10px] -bottom-3.5",
          )}
          aria-hidden
        >
          次のドローまで {remainingTurns}
        </div>
      )}
    </div>
  );
});
