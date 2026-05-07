"use client";

// Issue #163: ページ遷移時ローディングマスクの共通実装。
// Next.js App Router の <Link> をラップし、useLinkStatus でクリック後の
// pending 状態を取得して LoadingOverlay (fullScreen + card + progress + stages)
// を Portal で body 直下に投影する。
//
// Portal を使う理由: 親ツリーに framer-motion (PageMotion) など transform を
// 当てるコンポーネントが含まれると、子孫の position:fixed の containing block
// が transform 親側に縮退して viewport 全面被覆が壊れるため。
//
// ビジュアルは既存リッチローディング (Issue #155) と完全統一:
//   - 中央に「裏面 ↔ ランダム駒」の回転カード (card)
//   - 下部に indeterminate プログレスバー (progress)
//   - href から自動解決した段階文言 (stages)
// 既存の useTransition ベース箇所 (app/page.tsx, match-setup.tsx,
// card-catalog-tile.tsx 等) と同じ見た目を提供する。

import Link, { useLinkStatus } from "next/link";
import { createPortal } from "react-dom";
import { useEffect, useState, type ComponentProps, type ReactNode } from "react";

import { LoadingOverlay } from "@/components/loading-overlay";
import { resolveLoadingStages } from "@/lib/loading-stages";

interface MaskedLinkProps extends ComponentProps<typeof Link> {
  // ステージ文言の明示指定。省略時は href から自動解決する
  // (resolveLoadingStages: 例 "/" → homeNavigate, "/cards" → cardsNavigate)。
  loadingStages?: readonly string[];
  // prefetch 済みルートで pending が瞬時に立ち消えるケースで一瞬だけ
  // マスクが見える/フラッシュするのを防ぐ表示遅延 (ms)。
  delayMs?: number;
  children: ReactNode;
}

function MaskedLinkInner({
  stages,
  delayMs,
  children,
}: {
  stages: readonly string[];
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
          <LoadingOverlay show={show} fullScreen card progress stages={stages} />,
          document.body,
        )}
    </>
  );
}

export function MaskedLink({
  loadingStages,
  delayMs = 80,
  children,
  href,
  ...linkProps
}: MaskedLinkProps) {
  // 明示指定がなければ href から自動解決。
  // href は string | UrlObject。UrlObject の場合は pathname を見て解決する。
  const resolvedStages =
    loadingStages ??
    resolveLoadingStages(typeof href === "string" ? href : href.pathname ?? "/");

  return (
    <Link href={href} {...linkProps}>
      <MaskedLinkInner stages={resolvedStages} delayMs={delayMs}>
        {children}
      </MaskedLinkInner>
    </Link>
  );
}
