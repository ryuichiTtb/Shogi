"use client";

import { cn } from "@/lib/utils";
import { DRAW_COST } from "@/lib/shogi/cards/definitions";
import { CardBack } from "@/components/card-back/card-back";

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

export function DeckPile({
  count,
  canDraw = false,
  onDraw,
  size = "md",
  showDrawCost = false,
  fullWidth = false,
  dimmed = false,
  horizontal = false,
}: DeckPileProps) {
  const isEmpty = count === 0;
  const interactable = canDraw && count > 0 && !!onDraw;

  // 横長モード: 縦長の SIZE_CLASS は使わず、2行構成で横幅を圧縮
  // 行1: 💎×5 (showDrawCost 時) / 行2: 山札 ×N
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
          isEmpty ? "山札 (空)" : interactable ? `山札からドロー (残${count}枚)` : `山札 (残${count}枚)`
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
        {interactable && <span className="text-[10px] text-amber-200 font-bold leading-tight animate-bounce">DRAW!</span>}
      </button>
    );
  }

  const sizeClass = fullWidth
    ? cn(
        "w-full",
        size === "sm" ? "h-12 text-[10px]" : size === "md" ? "h-20 text-[13px]" : "h-24 text-sm",
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
              ? `山札からドロー (残${count}枚、コスト${DRAW_COST})`
              : `山札 (残${count}枚)`
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

        <div className="relative z-10 opacity-90 leading-none font-medium mt-2 drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">山札</div>
        <div className="relative z-10 font-bold tabular-nums leading-none mt-1 text-base drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">× {count}</div>
        {isEmpty && (
          <div className="mt-1 leading-none text-slate-200 text-[10px] font-bold">空</div>
        )}
        {interactable && (
          <div className="relative z-10 mt-1 leading-none text-amber-200 text-[10px] font-bold animate-bounce drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)]">
            DRAW!
          </div>
        )}
      </button>
    </div>
  );
}
