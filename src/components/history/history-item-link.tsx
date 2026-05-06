// Issue #155: 対局履歴一覧のリンクをクライアント遷移化し、復元中の SSR 待ちを
// 全画面ローディングで埋める。
//   - useTransition + router.push で `/game/[id]` を非同期遷移
//   - isPending true 中は LoadingOverlay (fullScreen + 回転カード + プログレスバー
//     + ステージ文言) を表示
//   - SSR が高速完了する場合のちらつきを防ぐため、表示は 200ms ディレイ
//   - 連打防止に pointer-events:none + aria-disabled
"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { LoadingOverlay } from "@/components/loading-overlay";
import { LOADING_STAGES } from "@/lib/loading-stages";
import { cn } from "@/lib/utils";

const APPEAR_DELAY_MS = 200;

interface HistoryItemLinkProps {
  href: string;
  children: ReactNode;
  className?: string;
}

export function HistoryItemLink({ href, children, className }: HistoryItemLinkProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showOverlay, setShowOverlay] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isPending) {
      // 200ms 経過後に初めて Overlay を表示。短時間遷移ではちらつかせない。
      // setTimeout コールバック内なので effect 内の同期 setState ではない。
      timerRef.current = setTimeout(() => setShowOverlay(true), APPEAR_DELAY_MS);
      return () => {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
      };
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    // isPending 解除に伴う overlay 非表示への同期。effect 内の setState は
    // React 19 で警告対象だが、ここでは「ペンディング終了 → ディレイ表示の
    // キャンセル」という派生状態の更新であり、他の手段 (CSS-only delay 等) では
    // LoadingOverlay の null 返却仕様と両立しない。意図的に許容する。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShowOverlay(false);
  }, [isPending]);

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    if (isPending) return;
    startTransition(() => {
      router.push(href);
    });
  }

  return (
    <>
      <a
        href={href}
        onClick={handleClick}
        aria-disabled={isPending || undefined}
        className={cn(
          "block",
          isPending && "pointer-events-none opacity-80",
          className,
        )}
      >
        {children}
      </a>
      <LoadingOverlay
        show={showOverlay}
        fullScreen
        card
        stages={LOADING_STAGES.gameRestore}
        progress={{ kind: "indeterminate" }}
      />
    </>
  );
}
