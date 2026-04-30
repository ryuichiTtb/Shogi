"use client";

import { cn } from "@/lib/utils";
import { PHASE0_DRAW_COST } from "@/lib/shogi/cards/definitions";

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
}

const SIZE_CLASS = {
  sm: "w-9 h-12 text-[10px]",
  md: "w-16 h-20 text-[13px]",
  lg: "w-20 h-24 text-sm",
};

// R19: 山札の積み重ね表現。後ろに最大 STACK_MAX 枚のズレカードを描画。
// count が 1 のとき: 上面のみ、ズレカード 0 枚
// count が 2 のとき: ズレカード 1 枚
// ...
// count >= STACK_MAX + 1 のとき: ズレカード STACK_MAX 枚
const STACK_MAX = 4;
const STACK_OFFSET = {
  sm: 1.5,
  md: 2,
  lg: 2.5,
};

interface StackCardProps {
  interactable: boolean;
  dimmed: boolean;
}

// 後ろのズレカード(クリック不可、装飾のみ)
function StackCard({ interactable, dimmed }: StackCardProps) {
  return (
    <div
      className={cn(
        "absolute inset-0 rounded-md border-2 pointer-events-none",
        // ズレカードは上面と同じ色味だが少し透明度を持たせて影感を出す
        !interactable && !dimmed && "bg-gradient-to-br from-amber-800 to-amber-900 border-amber-800",
        !interactable && dimmed && "bg-gradient-to-br from-amber-900 to-amber-950 border-amber-900",
        interactable && "bg-gradient-to-br from-amber-600 to-amber-800 border-amber-400",
      )}
      aria-hidden
    />
  );
}

export function DeckPile({
  count,
  canDraw = false,
  onDraw,
  size = "md",
  showDrawCost = false,
  fullWidth = false,
  dimmed = false,
}: DeckPileProps) {
  const isEmpty = count === 0;
  const interactable = canDraw && count > 0 && !!onDraw;
  const sizeClass = fullWidth
    ? cn(
        "w-full",
        size === "sm" ? "h-12 text-[10px]" : size === "md" ? "h-20 text-[13px]" : "h-24 text-sm",
      )
    : SIZE_CLASS[size];

  // 後ろに重ねる枚数: count - 1 を最大 STACK_MAX で頭打ち
  const stackCount = Math.min(Math.max(count - 1, 0), STACK_MAX);
  const offsetUnit = STACK_OFFSET[size];

  return (
    <div
      className={cn("relative shrink-0", fullWidth ? "w-full" : SIZE_CLASS[size].split(" ")[0])}
      // 後ろのズレカード分の余白を確保 (描画領域を超えてはみ出さないように)
      style={{
        paddingRight: stackCount * offsetUnit,
        paddingBottom: stackCount * offsetUnit,
      }}
    >
      {/* 後ろのズレカード(N 枚)。i=0 が一番奥、i=stackCount-1 が手前。 */}
      {Array.from({ length: stackCount }).map((_, i) => {
        // 手前ほど offset 小、奥ほど offset 大
        const offset = (stackCount - i) * offsetUnit;
        return (
          <div
            key={i}
            className="absolute"
            style={{
              top: 0,
              left: 0,
              right: stackCount * offsetUnit - offset,
              bottom: stackCount * offsetUnit - offset,
              transform: `translate(${offset}px, ${offset}px)`,
              zIndex: i,
            }}
          >
            <StackCard interactable={interactable} dimmed={dimmed} />
          </div>
        );
      })}

      {/* 上面カード(クリック可能) */}
      <button
        type="button"
        onClick={onDraw}
        disabled={!interactable}
        className={cn(
          "relative z-10 rounded-md border-2 transition-all w-full h-full",
          "flex flex-col items-center justify-center text-white px-1",
          sizeClass,
          // 山札が空: 灰色で「使えない感」を視覚的に表現
          isEmpty && "bg-gradient-to-br from-slate-400 to-slate-600 border-slate-500 text-slate-100 cursor-not-allowed opacity-70",
          // 通常時(マナ不足など): amber を抑えた中間色
          !isEmpty && !interactable && !dimmed && "bg-gradient-to-br from-amber-700 to-amber-900 border-amber-800 cursor-not-allowed brightness-90",
          // 相手手番中など: 活性色をベースに更に暗く (R18)
          !isEmpty && !interactable && dimmed && "bg-gradient-to-br from-amber-800 to-amber-950 border-amber-900 cursor-not-allowed brightness-60 opacity-85",
          // ドロー可能時: 明るいアンバー寄りグラデーション + グロー演出
          interactable && "bg-gradient-to-br from-amber-500 to-amber-700 border-amber-300 cursor-pointer hover:scale-[1.03] animate-deck-draw",
        )}
        aria-label={
          isEmpty
            ? "山札 (空)"
            : interactable
              ? `山札からドロー (残${count}枚、コスト${PHASE0_DRAW_COST})`
              : `山札 (残${count}枚)`
        }
      >
        {/* ドローコストを左上に「💎 × N」形式で表示 (空の時は不要なので非表示) */}
        {showDrawCost && !isEmpty && (
          <span
            className={cn(
              "absolute top-0.5 left-0.5 flex items-center gap-0.5 rounded-full px-1.5 leading-tight font-bold tabular-nums",
              "bg-cyan-100 text-cyan-900 dark:bg-cyan-900/60 dark:text-cyan-100",
              size === "sm" ? "text-[8px]" : "text-[10px]",
            )}
            title={`ドローコスト: マナ ${PHASE0_DRAW_COST}`}
          >
            <span aria-hidden>💎</span>
            <span>× {PHASE0_DRAW_COST}</span>
          </span>
        )}

        <div className="opacity-90 leading-none font-medium mt-2">山札</div>
        <div className="font-bold tabular-nums leading-none mt-1 text-base">× {count}</div>
        {isEmpty && (
          <div className="mt-1 leading-none text-slate-200 text-[10px] font-bold">空</div>
        )}
        {interactable && (
          <div className="mt-1 leading-none text-amber-300 text-[10px] font-bold animate-bounce">
            DRAW!
          </div>
        )}
      </button>
    </div>
  );
}
