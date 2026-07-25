// Issue #177: 将棋盤レイアウト (盤面マス背景) のユーザー設定を DB (UserPreference.boardLayout)
// に保存し、Context で全体に提供する。CardBackProvider と同パターン。
// Issue #250: DB 値が未設定 (NULL) のときはサーバ側で常にコード既定 (DEFAULT_BOARD_LAYOUT_ID)
// へ正規化されて initialLayoutId に載る。
// ★localStorage ミラーは撤去した (読み手が存在しないデッドストアだった)。将来 theme の
// pre-mount script (app/layout.tsx の themeInitScript) 相当で初回描画のちらつきを潰す場合、
// あのスクリプトは userId を知り得ないので userId 非依存のグローバルキーが必要になる =
// 旧 `shogi-board-layout:${userId}` は流用できない。加えて「未設定ユーザーの派生値」を
// 焼き付けると既定変更が届かない #250 と同型のバグを localStorage 側で作るため、
// 保存するのは明示選択のみに限ること。
//
// 派生 (Issue #177): 木目テクスチャ画像を mount 時に一括先読みし、URL 単位で
// 「ロード完了済」状態を追跡する。対局画面 / 盤デザイン画面はテクスチャが
// 未ロードの間は描画を保留 (LoadingOverlay) し、初回表示時の単色フラッシュを防ぐ。
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@clerk/nextjs";

import {
  getCurrentUserPreferences,
  saveBoardLayoutPreference,
} from "@/app/actions/preferences";
import {
  BOARD_LAYOUTS,
  DEFAULT_BOARD_LAYOUT_ID,
  findBoardLayout,
  type BoardLayout,
  type BoardLayoutId,
} from "./options";

const CLERK_CONFIGURED = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

interface BoardLayoutContextValue {
  layout: BoardLayout;
  setLayoutId: (id: BoardLayoutId) => void;
  // 指定 URL のテクスチャ画像が読み込み完了済みか
  isTextureReady: (url: string) => boolean;
  // 採用 4 種すべてが読み込み完了済みか (盤デザイン画面のサムネイル一覧用)
  allTexturesReady: boolean;
}

const BoardLayoutContext = createContext<BoardLayoutContextValue>({
  layout: findBoardLayout(DEFAULT_BOARD_LAYOUT_ID),
  setLayoutId: () => {},
  isTextureReady: () => false,
  allTexturesReady: false,
});

export function useBoardLayout(): BoardLayout {
  return useContext(BoardLayoutContext).layout;
}

export function useBoardLayoutControls(): BoardLayoutContextValue {
  return useContext(BoardLayoutContext);
}

export function useIsBoardLayoutReady(): boolean {
  const ctx = useContext(BoardLayoutContext);
  return ctx.isTextureReady(ctx.layout.url);
}

export function useAllBoardLayoutsReady(): boolean {
  return useContext(BoardLayoutContext).allTexturesReady;
}

// Issue #160 と同様、SSR で Clerk session 解決が間に合わずゲスト経路に
// 落ちた場合の救済策。Clerk client が hydrate 完了したタイミングで preferences を再取得し、
// SSR で得た値と異なれば onSync で state を更新する。
function ClerkPreferenceSync({
  ssrUserId,
  onSync,
}: {
  ssrUserId: string;
  onSync: (layoutId: BoardLayoutId) => void;
}) {
  const { isLoaded, isSignedIn } = useAuth();
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let cancelled = false;
    getCurrentUserPreferences()
      .then((p) => {
        if (cancelled) return;
        if (p.userId !== ssrUserId) {
          onSync(p.boardLayout);
        }
      })
      .catch((error) => {
        console.error("Failed to rehydrate board layout preference", error);
      });
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, ssrUserId, onSync]);
  return null;
}

export function BoardLayoutProvider({
  children,
  userId,
  userKind,
  initialLayoutId,
}: {
  children: ReactNode;
  userId: string;
  userKind: "guest" | "account";
  initialLayoutId: BoardLayoutId;
}) {
  const [layoutId, setLayoutIdState] = useState<BoardLayoutId>(initialLayoutId);
  // Issue #160 同様: userId / initialLayoutId の props 変化に state を追従させる。
  const [lastSync, setLastSync] = useState({ userId, initialLayoutId });
  if (lastSync.userId !== userId || lastSync.initialLayoutId !== initialLayoutId) {
    setLastSync({ userId, initialLayoutId });
    setLayoutIdState(initialLayoutId);
  }

  const [readyUrls, setReadyUrls] = useState<Set<string>>(() => new Set());

  // 木目テクスチャを 4 種一括先読み。完了 URL を Set に蓄積する。
  // エラー時もマークを進めて UI を永久に止めない。
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    const markReady = (url: string) => {
      if (cancelled) return;
      setReadyUrls((prev) => {
        if (prev.has(url)) return prev;
        const next = new Set(prev);
        next.add(url);
        return next;
      });
    };
    for (const lay of BOARD_LAYOUTS) {
      const img = new window.Image();
      img.onload = () => markReady(lay.url);
      img.onerror = () => markReady(lay.url);
      img.src = lay.url;
      // 既にブラウザキャッシュ済みなら onload が遅延発火する可能性に備え
      // complete を即時チェックする (load を待たずに ready マーク)。
      if (img.complete && img.naturalWidth > 0) {
        markReady(lay.url);
      }
    }
    return () => {
      cancelled = true;
    };
  }, []);

  const setLayoutId = useCallback((id: BoardLayoutId) => {
    setLayoutIdState(id);
    saveBoardLayoutPreference(id).catch((error) => {
      console.error("Failed to save board layout preference", error);
    });
  }, []);

  const handleClerkSync = useCallback((newLayoutId: BoardLayoutId) => {
    setLayoutIdState((prev) => (prev === newLayoutId ? prev : newLayoutId));
  }, []);

  const isTextureReady = useCallback(
    (url: string) => readyUrls.has(url),
    [readyUrls],
  );
  const allTexturesReady = readyUrls.size === BOARD_LAYOUTS.length;

  // フォールバックは findBoardLayout に一元化する (BOARD_LAYOUTS[0] = light-1 を使うと
  // コード既定と別の「第 3 の既定」ができ、#250 と同型の食い違いを生む)。
  const layout = findBoardLayout(layoutId);
  return (
    <BoardLayoutContext.Provider
      value={{ layout, setLayoutId, isTextureReady, allTexturesReady }}
    >
      {CLERK_CONFIGURED && userKind === "guest" && (
        <ClerkPreferenceSync ssrUserId={userId} onSync={handleClerkSync} />
      )}
      {children}
    </BoardLayoutContext.Provider>
  );
}
