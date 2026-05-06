// Service Worker for 将棋 - AI対局
//
// Step 4 (Issue #107): CACHE_NAME を v2 にバンプし、古い shogi-v1 キャッシュを
// activate ハンドラで自動削除する。
// Issue #117: 新ホーム公開に合わせて v3 へバンプ。古い shogi-v2 キャッシュ
// (旧モードタブ式 "/" の HTML) をオフライン時に拾わないようにする。
// Issue #79: BGM 機能を削除したため v4 へバンプ。旧 shogi-v3 にキャッシュされた
// .wav BGM (約 2.2MB × 3 ファイル) を自動削除する。
// Issue #79 (PR 1.7): 音源プール拡張 + BGM 再導入で v5 へバンプ。
// 新音源 (public/sounds/音源/ 配下 73 ファイル) と新 BGM mp3 は既存 /sounds/*
// cache-first パターンで自動キャッシュされる。
// PRECACHE_ASSETS の SE リストは src/lib/audio/manifest.ts SFX_FILES と
// 同じ実体ファイルを指す (現状は重複管理。将来的には manifest 経由で同期する)。
//
// Issue #117 (#128): SW フェッチハンドラの堅牢化 (バグ修正)。
// 旧実装は (a) 静的アセットの fetch 失敗時に catch していないため、Vercel 一時
// エラーで navigation 全体が Chrome NETERR になる、(b) navigation で 5xx 応答も
// キャッシュ汚染する、(c) fallback で undefined を返しうる ──の 3 点で起動失敗
// を引き起こしていた。3 点まとめて修正。
const CACHE_NAME = "shogi-v5";

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
      // cache.addAll は 1 件でも失敗すると全体が reject されるため、
      // 個別 add に分割して落とす。1 つ取れなくても他のキャッシュは活かす。
      return Promise.all(
        PRECACHE_ASSETS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn(`[sw] precache failed for ${url}`, err);
          }),
        ),
      );
    }),
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

// 最終フォールバック: respondWith に渡せない事態 (cache miss + network fail) でも
// Chrome NETERR を出さないため、503 の Response を返す。
function offlineFallback() {
  return new Response("Offline", {
    status: 503,
    statusText: "Service Unavailable",
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

// フェッチ戦略
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // サーバーアクション・APIはネットワーク優先 (SW 介入せず)
  if (request.method !== "GET") {
    return;
  }

  // ナビゲーション（HTML）: ネットワーク優先、失敗時のみキャッシュにフォールバック
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // 2xx のみキャッシュ。5xx を保存して以後永続化する事故を防ぐ。
          if (response.ok) {
            const clone = response.clone();
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(request, clone))
              .catch(() => {});
          }
          return response;
        })
        .catch(async () => {
          // ネットワーク失敗 → 同一URLのキャッシュ → "/" → 503 の順で常に Response を返す
          const cached = await caches.match(request);
          if (cached) return cached;
          const home = await caches.match("/");
          if (home) return home;
          return offlineFallback();
        }),
    );
    return;
  }

  // 静的アセット（JS, CSS, フォント, 音声, 画像）: キャッシュ優先 + 失敗時もフォールバック
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
        return fetch(request)
          .then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches
                .open(CACHE_NAME)
                .then((cache) => cache.put(request, clone))
                .catch(() => {});
            }
            return response;
          })
          .catch(() => offlineFallback());
      }),
    );
    return;
  }

  // その他 (RSC payload など): ネットワーク優先、失敗時はキャッシュ → 503
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(request, clone))
            .catch(() => {});
        }
        return response;
      })
      .catch(async () => (await caches.match(request)) ?? offlineFallback()),
  );
});
