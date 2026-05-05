"use client";

import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
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

// Issue #130: 数値版の寸法 + テキストサイズ。border-box の都合で「コンテナ
// 全体寸法 = カード寸法 + stack offset」を inline style で正確に渡す必要があり、
// 旧 SIZE_CLASS (w-12/h-16 等の Tailwind class) だけでは精度不足だったため
// 数値定義に置換。sm = CardView sm (w-12 h-16) と同寸法、相手手札 stack と
// 並べられるようにする (Issue #105 モバイル相手バー)。
const CARD_DIMS = {
  sm: { w: 48, h: 64, text: "text-[10px]" },
  md: { w: 64, h: 80, text: "text-[13px]" },
  lg: { w: 80, h: 96, text: "text-sm" },
} as const;

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

  // 横長モード: 縦長の CARD_DIMS は使わず、2 行 (+ 進捗 1 行) 構成で横幅を圧縮
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

  // 後ろに重ねる枚数: count - 1 を最大 STACK_MAX で頭打ち
  const stackCount = Math.min(Math.max(count - 1, 0), STACK_MAX);
  const offsetUnitX = STACK_OFFSET_X[size];
  const offsetUnitY = STACK_OFFSET_Y[size];
  const dims = CARD_DIMS[size];
  const stackOffsetTotalX = stackCount * offsetUnitX;
  const stackOffsetTotalY = stackCount * offsetUnitY;

  // 視覚的な上面カードの実寸。外側コンテナは stack offset を含むが、
  // CardBack / SVG リング / テキストはこの寸法だけを基準に描画する。
  const cardStyle: CSSProperties = {
    width: fullWidth ? `calc(100% - ${stackOffsetTotalX}px)` : dims.w,
    height: dims.h,
  };
  const sizeClass = dims.text;
  const ringInset = size === "lg" ? 5 : 4;

  // コンテナ寸法 = カード寸法 + stack offset。
  // - non-fullWidth: 横も縦も固定 (= dims.w + offsetX, dims.h + offsetY)
  // - fullWidth: 横は親幅に追従 (w-full)、縦のみ固定
  const containerStyle: CSSProperties = {
    height: dims.h + stackOffsetTotalY,
    ...(fullWidth ? {} : { width: dims.w + stackOffsetTotalX }),
  };

  return (
    <div
      className={cn("relative shrink-0", fullWidth && "w-full")}
      style={containerStyle}
    >
      {/* 後ろのズレカード(N 枚)。i=0 が一番奥、i=stackCount-1 が手前。
          上面カードと同じ cardStyle を使い、リングやテキストの基準寸法と
          stack offset を混ぜない。 */}
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
              ...cardStyle,
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
          "text-white transition-all",
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
        style={cardStyle}
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
            CardBack (amber border-2) の内側に固定 px inset で納める。
            旧実装の viewBox % inset は横長カードで x/y の実 px が変わり、
            モバイルで枠とズレて見えたため、カード本体に対する実 px 基準にする。
            preserveAspectRatio="none" + vector-effect="non-scaling-stroke" で
            縦横比に依存せず一定の線幅・等分セグメントを維持する。
            primed (= displayProgress === interval - 1) のときは emerald-300 +
            amber-200 二重描画 + 1.4s パルス (最大 6 ループ)。reduced-motion 時は
            パルス停止。displayProgress は 4→0 遷移時に 1 frame だけ強制 5 描画
            (= firing の起点、useLayoutEffect で実装)。 */}
        {hasProgress && !isEmpty && (
          <svg
            className="absolute z-10 pointer-events-none"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={interval}
            aria-valuenow={Math.min(displayProgress, interval)}
            aria-label={`自動ドロー進捗 ${Math.min(displayProgress, interval)}/${interval}`}
            style={{
              top: ringInset,
              right: ringInset,
              bottom: ringInset,
              left: ringInset,
              overflow: "visible",
            }}
          >
            {/* track: 5 セグメント等分の薄い縁取り。SVG 自体を固定 px inset
                しているので rect は viewBox 全体を使う。 */}
            <rect
              x={0}
              y={0}
              width={100}
              height={100}
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
                x={0}
                y={0}
                width={100}
                height={100}
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
              x={0}
              y={0}
              width={100}
              height={100}
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
                transformBox: "fill-box",
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
              "absolute top-0.5 left-0.5 z-30 flex items-center gap-0.5 rounded-full px-1.5 leading-tight font-bold tabular-nums",
              "bg-cyan-100 text-cyan-900 dark:bg-cyan-900/60 dark:text-cyan-100",
              size === "sm" ? "text-[8px]" : "text-[10px]",
            )}
            title={`ドローコスト: マナ ${DRAW_COST}`}
          >
            <span aria-hidden>💎</span>
            <span>×{DRAW_COST}</span>
          </span>
        )}

        {/* カード内テキスト群。山札であることは裏面カードと配置で分かるため、
            視覚ラベルは置かず、枚数・DRAW・次まで表示に縦スペースを使う。 */}
        <div
          className={cn(
            "absolute z-20 pointer-events-none select-none text-center",
            "grid grid-rows-[minmax(0,1fr)_auto]",
            size === "sm" ? "inset-[4px]" : "inset-[5px]",
          )}
        >
          <div className="min-h-0 flex flex-col items-center justify-center">
            {!isEmpty && (
              <div
                className={cn(
                  "font-bold tabular-nums leading-none drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]",
                  size === "sm" ? "text-[11px]" : "text-base",
                )}
              >
                × {count}
              </div>
            )}
            {isEmpty && (
              <div className="leading-none text-slate-200 text-[10px] font-bold">空</div>
            )}
            {interactable && (
              <div
                className={cn(
                  "leading-none text-amber-200 font-bold animate-bounce drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)] mt-1",
                  size === "sm" ? "text-[8px]" : "text-[10px]",
                )}
              >
                DRAW!
              </div>
            )}
          </div>

          <div
            className={cn(
              "min-h-[10px] flex items-end justify-center leading-none font-medium tabular-nums whitespace-nowrap",
              "text-emerald-200/90 drop-shadow-[0_1px_1px_rgba(0,0,0,0.7)]",
              size === "sm" ? "text-[8px]" : "text-[10px]",
            )}
            aria-hidden
          >
            {hasProgress && !isEmpty ? `次まで${remainingTurns}手` : ""}
          </div>
        </div>
      </button>

      {/* Issue #130: 自動ドロー進捗マイクロテキストはカード内 (ボタン flex 内)
          に移動済 (持ち駒エリア圧迫対策、コミット内コメント参照)。 */}
    </div>
  );
});
