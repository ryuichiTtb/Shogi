"use client";

// Issue #163: ページ遷移時ローディングマスクの共通実装。
// Next.js App Router の <Link> をラップし、useLinkStatus でクリック後の
// pending 状態を取得して LoadingOverlay を Portal で body 直下に投影する。
//
// Portal を使う理由: 親ツリーに framer-motion (PageMotion) など transform を
// 当てるコンポーネントが含まれると、子孫の position:fixed の containing block
// が transform 親側に縮退して viewport 全面被覆が壊れるため。
//
// ビジュアルは loadingVariant で 2 系統:
//   - "rich" (既定): 中央に「裏面 ↔ ランダム駒」の回転カード (card) +
//     下部 indeterminate プログレスバー (progress) + 段階文言フェード (stages)。
//     Issue #155 で導入された主表現で、コンテンツへの "進む" 遷移に使う。
//   - "spinner": Loader2 アイコンのシンプルなくるくる表示 + 1 行メッセージ。
//     "ホームへ戻る" 系の back-navigation でリッチ表現が過剰になる場面に使う。

import Link, { useLinkStatus } from "next/link";
import { createPortal } from "react-dom";
import { useEffect, useState, type ComponentProps, type MouseEvent, type ReactNode } from "react";

import { LoadingOverlay } from "@/components/loading-overlay";
import { resolveLoadingStages } from "@/lib/loading-stages";
import { playSfxOnce } from "@/hooks/use-sound";

interface MaskedLinkProps extends ComponentProps<typeof Link> {
  // ローディング表示のスタイル。既定は "rich" (回転カード + プログレスバー + ステージ文言)。
  // "ホームへ戻る" 等の back-navigation 用に "spinner" (Loader2 + メッセージ) も選べる。
  loadingVariant?: "rich" | "spinner";
  // rich モードのステージ文言。省略時は href から resolveLoadingStages で自動解決。
  loadingStages?: readonly string[];
  // spinner モードの 1 行メッセージ。省略時は "ホームへ戻っています…"。
  loadingMessage?: string;
  // prefetch 済みルートで pending が瞬時に立ち消えるケースで一瞬だけ
  // マスクが見える/フラッシュするのを防ぐ表示遅延 (ms)。
  delayMs?: number;
  children: ReactNode;
}

function MaskedLinkInner({
  variant,
  stages,
  message,
  delayMs,
  children,
}: {
  variant: "rich" | "spinner";
  stages: readonly string[];
  message: string;
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
          variant === "spinner" ? (
            <LoadingOverlay show={show} fullScreen message={message} />
          ) : (
            <LoadingOverlay show={show} fullScreen card progress stages={stages} />
          ),
          document.body,
        )}
    </>
  );
}

export function MaskedLink({
  loadingVariant = "rich",
  loadingStages,
  loadingMessage,
  delayMs = 80,
  children,
  href,
  onClick,
  ...linkProps
}: MaskedLinkProps) {
  // rich モード用 stages の解決: 明示指定がなければ href から自動解決。
  // href は string | UrlObject。UrlObject の場合は pathname を見て解決する。
  const resolvedStages =
    loadingStages ??
    resolveLoadingStages(typeof href === "string" ? href : href.pathname ?? "/");
  // spinner モード用メッセージの既定。spinner は "ホームへ戻る" 専用想定なので
  // 既定文言は「ホームへ戻っています…」とする。
  const resolvedMessage = loadingMessage ?? "ホームへ戻っています...";

  // Issue #79 派生: forward 遷移 (rich variant) のときだけ画面遷移 SFX を発火。
  // spinner variant は "ホームへ戻る" 系の back navigation のため SFX は鳴らさない。
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (loadingVariant === "rich") {
      playSfxOnce("nav_forward");
    }
    onClick?.(e);
  };

  return (
    <Link href={href} {...linkProps} onClick={handleClick}>
      <MaskedLinkInner
        variant={loadingVariant}
        stages={resolvedStages}
        message={resolvedMessage}
        delayMs={delayMs}
      >
        {children}
      </MaskedLinkInner>
    </Link>
  );
}
