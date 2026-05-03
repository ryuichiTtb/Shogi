// Service Worker for 将棋 - AI対局
//
// Step 4 (Issue #107): CACHE_NAME を v2 にバンプし、古い shogi-v1 キャッシュを
// activate ハンドラで自動削除する。
// Issue #117: 新ホーム公開に合わせて v3 へバンプ。古い shogi-v2 キャッシュ
// (旧モードタブ式 "/" の HTML) をオフライン時に拾わないようにする。
// PRECACHE_ASSETS の SE リストは src/lib/audio/manifest.ts SFX_FILES と
// 同じ実体ファイルを指す (現状は重複管理。将来的には manifest 経由で同期する)。
// BGM (.wav) は SW install 時のプリキャッシュ対象に含めない: 約 2.2MB を
// 一気に取りに行くと初回起動が重くなるため、ロビーで選択中キャラ BGM のみを
// useAssetPreloader (src/hooks/use-asset-preloader.ts) で軽く load する。
const CACHE_NAME = "shogi-v3";

// プリキャッシュする静的アセット
const PRECACHE_ASSETS = [
  "/",
  "/sounds/piece-move.mp3",
  "/sounds/piece-capture.mp3",
  "/sounds/piece-drop.mp3",
  "/sounds/piece-promote.mp3",
  "/sounds/check.mp3",
  "/sounds/game-over.mp3",
  "/sounds/game-start.mp3",
  "/sounds/jump.mp3",
];

// インストール時にプリキャッシュ
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    })
  );
  self.skipWaiting();
});

// 古いキャッシュの削除
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// フェッチ戦略
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // サーバーアクション・APIはネットワーク優先
  if (request.method !== "GET") {
    return;
  }

  // ナビゲーション（HTML）: ネットワーク優先、フォールバックでキャッシュ
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("/")))
    );
    return;
  }

  // 静的アセット（JS, CSS, フォント, 音声, 画像）: キャッシュ優先
  const isStaticAsset =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/sounds/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.endsWith(".woff2") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".ico");

  if (isStaticAsset) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        });
      })
    );
    return;
  }

  // BGM（大きいファイル）: ネットワーク優先、キャッシュに保存
  if (url.pathname.endsWith(".wav")) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // その他: ネットワーク優先
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
