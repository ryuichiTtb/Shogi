"use client";

// Issue #163: ページ遷移時ローディングマスクの共通実装。
// Next.js App Router の <Link> をラップし、useLinkStatus でクリック後の
// pending 状態を取得して LoadingOverlay (fullScreen) を Portal で body 直下に
// 投影する。Portal を使う理由: 親ツリーに framer-motion (PageMotion) など
// transform を当てるコンポーネントが含まれると、子孫の position:fixed の
// containing block が transform 親側に縮退して viewport 全面被覆が壊れるため。

import Link, { useLinkStatus } from "next/link";
import { createPortal } from "react-dom";
import { useEffect, useState, type ComponentProps, type ReactNode } from "react";

import { LoadingOverlay } from "@/components/loading-overlay";

interface MaskedLinkProps extends ComponentProps<typeof Link> {
  loadingMessage?: string;
  // prefetch 済みルートで pending が瞬時に立ち消えるケースで一瞬だけ
  // マスクが見える/フラッシュするのを防ぐ表示遅延 (ms)。
  delayMs?: number;
  children: ReactNode;
}

function MaskedLinkInner({
  loadingMessage,
  delayMs,
  children,
}: {
  loadingMessage: string;
  delayMs: number;
  children: ReactNode;
}) {
  const { pending } = useLinkStatus();
  const [show, setShow] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // SSR 時は createPortal が使えないため mount 後にだけ Portal を有効化する。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!pending) {
      // pending が解除されたら即座にマスクを消す (画面が遷移完了済のため)。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShow(false);
      return;
    }
    // pending 中も delayMs 経過してからマスクを出すことで、prefetch 済みルートの
    // 高速遷移時にマスクが一瞬フラッシュするのを抑制する。
    const id = setTimeout(() => setShow(true), delayMs);
    return () => clearTimeout(id);
  }, [pending, delayMs]);

  return (
    <>
      <span
        aria-busy={pending || undefined}
        style={{
          pointerEvents: pending ? "none" : undefined,
          display: "contents",
        }}
      >
        {children}
      </span>
      {mounted &&
        typeof document !== "undefined" &&
        createPortal(
          <LoadingOverlay show={show} fullScreen message={loadingMessage} />,
          document.body,
        )}
    </>
  );
}

export function MaskedLink({
  loadingMessage = "読み込み中...",
  delayMs = 80,
  children,
  ...linkProps
}: MaskedLinkProps) {
  return (
    <Link {...linkProps}>
      <MaskedLinkInner loadingMessage={loadingMessage} delayMs={delayMs}>
        {children}
      </MaskedLinkInner>
    </Link>
  );
}
